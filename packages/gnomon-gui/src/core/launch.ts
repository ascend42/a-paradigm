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
 */

export const PIN_KEY = 'gnomon.kernelPublicKey.v1';
const B64URL = /^[A-Za-z0-9_-]+$/;

export interface LaunchFragment {
  launchToken: string;
  kernelPublicKey: string;
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
  if (!launchToken || !kernelPublicKey || params.size !== 2) return null;
  if (!B64URL.test(launchToken) || !B64URL.test(kernelPublicKey)) return null;
  if (launchToken.length > 128 || kernelPublicKey.length > 256) return null;
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
