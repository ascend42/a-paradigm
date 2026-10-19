/**
 * @symbol #gui
 *
 * #gui launch fragment and key pin (spec §11.2 rule 2, §4.9 "Loopback
 * WebSocket transport", S25-L2, S25-M4). PURE: the browser glue lives in
 * static/boot.js (the read-and-clear, which must run before any other script)
 * and ui/app.ts (localStorage).
 *
 * Fragment: `#launch=<token>&k=<base64url spki>`; both values are base64url.
 * Pin: the kernel public key is the ONLY thing the page ever stores
 * (`localStorage[PIN_KEY]`, public material). The fragment key arrived over
 * the kernel's own authenticated channel (`gnomon open` on the unix socket),
 * so a launch with a fragment verifies against the FRAGMENT key and re-pins it
 * — when that replaces an older pin the page says so (a key rotation is
 * visible, never silent). A page without a fragment (Reconnect) verifies
 * every `hello` against the pin; with no pin it has nothing to verify against
 * and refuses to send anything (`no-pin`).
 *
 * #bare-entry (spec §2.4 rule 8): bare `gnomon` may append `&cwd=<base64url
 * utf-8>` — a FOLDER HINT, an unverified claim from a same-user process. It
 * only prefills the new-session form and is shown as plain text (escaped,
 * capped); it never opens a session, approves a card or skips one, and a
 * path that needs escaping is shown but never prefilled (cwdHintOf,
 * applyCwdHint).
 */

export const PIN_KEY = 'gnomon.kernelPublicKey.v1';
const B64URL = /^[A-Za-z0-9_-]+$/;

export interface LaunchFragment {
  launchToken: string;
  kernelPublicKey: string;
  /** #bare-entry: the raw base64url folder hint, when present (decode with cwdHintOf). */
  cwd?: string;
}

/** The largest folder hint carried (UTF-8 bytes; the CLI's HINT_MAX_BYTES) and its base64url length. */
export const CWD_HINT_MAX_BYTES = 1024;
const CWD_B64_MAX = Math.ceil((CWD_HINT_MAX_BYTES * 4) / 3);
/** Display cap, in code points (the CLI's DISPLAY_CAP). */
export const CWD_DISPLAY_CAP = 240;

/** Code points escaped for display (the CLI's displayPath rule): C0, DEL + C1, soft hyphen, ALM, MVS, zero-width + bidi marks, LS/PS, embeddings/overrides, word joiner + isolates, BOM, U+FFFD (invalid UTF-8), backslash. */
const ESCAPE_RANGES: ReadonlyArray<readonly [number, number]> = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff], [0xfffd, 0xfffd], [0x5c, 0x5c]];
const escapes = (c: string): boolean => {
  const n = c.codePointAt(0)!;
  return ESCAPE_RANGES.some(([a, b]) => n >= a && n <= b);
};

export interface CwdHint {
  /** The path for display: escaped and capped, for textContent only. */
  display: string;
  /** The value to prefill the cwd field with, or null when the path is shown but not prefilled. */
  prefill: string | null;
  /** Why it is not prefilled (null when it is). */
  why: string | null;
}

/** Decode a base64url folder hint; null when it is not one. Invalid UTF-8 decodes to U+FFFD (then never prefilled). */
export function cwdHintOf(b64: string): CwdHint | null {
  if (!B64URL.test(b64) || b64.length > CWD_B64_MAX) return null;
  let bytes: Uint8Array;
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > CWD_HINT_MAX_BYTES) return null;
  const p = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const cps = [...p];
  const display = cps.slice(0, CWD_DISPLAY_CAP).map((c) => (c === '\\' ? '\\\\' : escapes(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c)).join('') + (cps.length > CWD_DISPLAY_CAP ? `… (+${cps.length - CWD_DISPLAY_CAP} chars)` : '');
  const why = cps.some(escapes) ? 'it holds characters that had to be escaped to show it; type the path yourself' : !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p) ? 'it is not an absolute path' : null;
  return { display, prefill: why ? null : p, why };
}

/** The new-session form elements a hint touches: values and text only (no submit is reachable from here). */
export interface CwdHintTarget {
  input: { value: string };
  note: { textContent: string | null; hidden: boolean };
  dialog: { hidden: boolean };
}

/**
 * Show a folder hint: open the new-session form, prefill the cwd field when
 * the path is clean, and say where it came from in plain text. It never
 * submits: session.open still needs the human's click on `open`.
 */
export function applyCwdHint(t: CwdHintTarget, hint: CwdHint): void {
  t.note.textContent = hint.prefill !== null
    ? `Suggested by \`gnomon\` in a terminal (not verified): ${hint.display} — check it, then open.`
    : `A terminal suggested a folder that is not prefilled (${hint.why}): ${hint.display}`;
  t.note.hidden = false;
  if (hint.prefill !== null) t.input.value = hint.prefill;
  t.dialog.hidden = false;
}

/** Parse a location.hash; null when it is not a well-formed launch fragment. */
export function parseLaunchFragment(hash: string): LaunchFragment | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h) return null;
  const params = new Map<string, string>();
  for (const part of h.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const k = part.slice(0, eq);
    if (params.has(k)) return null; // a duplicated key is not a fragment the kernel built
    params.set(k, part.slice(eq + 1));
  }
  const launchToken = params.get('launch');
  const kernelPublicKey = params.get('k');
  const cwd = params.get('cwd');
  if (!launchToken || !kernelPublicKey || params.size !== (cwd === undefined ? 2 : 3)) return null;
  if (!B64URL.test(launchToken) || !B64URL.test(kernelPublicKey)) return null;
  if (launchToken.length > 128 || kernelPublicKey.length > 256) return null;
  // a malformed hint drops the hint, never the launch: the token and key are the kernel's, the hint is a terminal's claim
  if (cwd !== undefined && cwdHintOf(cwd) !== null) return { launchToken, kernelPublicKey, cwd };
  return { launchToken, kernelPublicKey };
}

export type PinDecision =
  | { ok: true; verifyWith: string; store: string | null; notice: string | null }
  | { ok: false; reason: 'no-pin'; message: string };

/**
 * Which key verifies the next `hello`, and what to store.
 *  - fragment, no pin           → verify with the fragment key, store it.
 *  - fragment equal to the pin  → verify with it, store nothing.
 *  - fragment differs from pin  → verify with the fragment key, re-pin, and show the change.
 *  - no fragment, pin           → verify with the pin (Reconnect).
 *  - no fragment, no pin        → refuse: nothing to verify against.
 */
export function decidePin(fragmentKey: string | null, pinned: string | null): PinDecision {
  if (fragmentKey) {
    if (!pinned) return { ok: true, verifyWith: fragmentKey, store: fragmentKey, notice: null };
    if (pinned === fragmentKey) return { ok: true, verifyWith: fragmentKey, store: null, notice: null };
    return { ok: true, verifyWith: fragmentKey, store: fragmentKey, notice: 'kernel key changed since this page last pinned it; the new key came from `gnomon open` and is pinned now' };
  }
  if (pinned) return { ok: true, verifyWith: pinned, store: null, notice: null };
  return { ok: false, reason: 'no-pin', message: 'no pinned kernel key on this page: run `gnomon open`' };
}

/**
 * Which host the page runs in (T-2026-10-18-018 N1; #gnomon-wrapper, spec §11.1).
 * 'wrapper' ONLY when the wrapper's document-start script defined
 * `gnomonSurface` as a frozen own data property with the value 'wrapper'
 * (non-writable, non-configurable). Under the kernel's CSP (`script-src
 * 'self'`, no inline, no eval) no script but the pinned bundle runs in the
 * page, and the bundle never defines it, so a plain browser cannot produce
 * the marker. Display only (`hello.client.surface` and the extension-risk
 * badge); the kernel never treats the surface as a security input.
 */
export function hostSurface(g: object = globalThis): 'browser' | 'wrapper' {
  const d = Object.getOwnPropertyDescriptor(g, 'gnomonSurface');
  return d !== undefined && 'value' in d && d.value === 'wrapper' && d.writable === false && d.configurable === false ? 'wrapper' : 'browser';
}
