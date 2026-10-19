/**
 * @symbol #gui
 *
 * #gui self-update restart (TD-2026-10-19-063 flow 2). PURE except the
 * injected storage / fetch.
 *
 *   - BANNER: a pending daemon-stop card whose reason is `upgrade` shows
 *     "Gnomon was updated · [Restart now]"; the button only FOCUSES the card
 *     (the decision is still the card's accept, with Touch ID).
 *   - MARKER: on THIS page's accept of that card a single-use
 *     sessionStorage marker is set (markRestarting); the kernel's
 *     `gui.resume{resumeToken, kernelPublicKey}` notification, arriving on
 *     this connection only, is stored INTO the marker (noteResume) — never
 *     without a marker, so no other page state can carry a token.
 *   - RELOAD: when the socket closes with the marker present the page polls
 *     its own origin (waitForOrigin) and reloads (the new bundle). The
 *     reloaded page takes the marker ONCE (takeRestart: read + remove) and
 *     reconnects with `{resumeToken}`, re-pinning to the successor's key that
 *     came over the old, verified connection.
 *   - GUIDANCE: an origin that never answers (the successor fell back to
 *     another port, or did not start) gets plain-language guidance.
 */
export const RESTART_KEY = 'gnomon.restarting.v1';
/** The origin poll cadence and how many polls before the page gives guidance instead (configured bounds). */
export const ORIGIN_POLL_MS = 1_000;
export const ORIGIN_POLL_TRIES = 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^[A-Za-z0-9_-]{40,200}$/;

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface UpgradeCardLike {
  kind: string;
  card: Record<string, unknown>;
}

/** Is this pending card the kernel's upgrade card (daemon-stop, reason upgrade)? */
export function isUpgradeCard(c: UpgradeCardLike): boolean {
  if (c.kind !== 'daemon-stop') return false;
  const d = c.card.detail as { reason?: unknown } | undefined;
  if (d && d.reason === 'upgrade') return true;
  const lines = c.card.lines;
  return Array.isArray(lines) && lines.includes('reason: upgrade');
}

/** The banner text, or null when no upgrade card is pending. */
export function upgradeBannerOf(cards: Iterable<UpgradeCardLike & { cardId: string }>): { text: string; cardId: string } | null {
  for (const c of cards) if (isUpgradeCard(c)) return { text: 'Gnomon was updated', cardId: c.cardId };
  return null;
}

interface Marker {
  cardId: string;
  resumeToken?: string;
  kernelPublicKey?: string;
}

export function markRestarting(s: StorageLike, cardId: string): void {
  s.setItem(RESTART_KEY, JSON.stringify({ cardId } satisfies Marker));
}

export function clearRestarting(s: StorageLike): void {
  s.removeItem(RESTART_KEY);
}

export function restarting(s: StorageLike): boolean {
  return s.getItem(RESTART_KEY) !== null;
}

/** Store the gui.resume notification into an existing marker; false (and nothing stored) without one or on a bad shape. */
export function noteResume(s: StorageLike, params: unknown): boolean {
  const raw = s.getItem(RESTART_KEY);
  if (raw === null) return false;
  const p = (params ?? {}) as { resumeToken?: unknown; kernelPublicKey?: unknown };
  if (typeof p.resumeToken !== 'string' || !TOKEN.test(p.resumeToken) || typeof p.kernelPublicKey !== 'string' || !KEY.test(p.kernelPublicKey)) return false;
  let m: Marker;
  try {
    m = JSON.parse(raw) as Marker;
  } catch {
    return false;
  }
  s.setItem(RESTART_KEY, JSON.stringify({ cardId: m.cardId, resumeToken: p.resumeToken, kernelPublicKey: p.kernelPublicKey } satisfies Marker));
  return true;
}

/** SINGLE USE: read and remove the marker; the resume form only when the kernel sent one. */
export function takeRestart(s: StorageLike): { resumeToken: string; kernelPublicKey: string } | null {
  const raw = s.getItem(RESTART_KEY);
  s.removeItem(RESTART_KEY);
  if (raw === null) return null;
  try {
    const m = JSON.parse(raw) as Marker;
    return typeof m.resumeToken === 'string' && TOKEN.test(m.resumeToken) && typeof m.kernelPublicKey === 'string' && KEY.test(m.kernelPublicKey) ? { resumeToken: m.resumeToken, kernelPublicKey: m.kernelPublicKey } : null;
  } catch {
    return null;
  }
}

/** Poll the page's own origin until it answers (the successor's static bundle); false after `tries`. */
export async function waitForOrigin(fetchFn: (u: string) => Promise<{ ok: boolean }>, origin: string, o: { intervalMs?: number; tries?: number; between?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const between = o.between ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < (o.tries ?? ORIGIN_POLL_TRIES); i++) {
    await between(o.intervalMs ?? ORIGIN_POLL_MS);
    try {
      if ((await fetchFn(`${origin}/`)).ok) return true;
    } catch {
      /* not up yet */
    }
  }
  return false;
}

/** Plain-language guidance when the restarted Gnomon is not at this address (no terminal command as the only path). */
export const RESTART_GUIDANCE =
  'Gnomon restarted, but not at this address (its old port was taken). Open Gnomon again: from Gnomon.app, or by running `gnomon` in a terminal. Your sessions were saved and resume in the new window.';
