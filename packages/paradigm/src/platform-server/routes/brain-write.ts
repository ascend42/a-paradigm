/**
 * Brain WRITE Routes — the one owner write the Platform Brain section needs:
 * recording a verdict (accept / reject / skip) on a suggestion (7.14.0).
 *
 * Mirrors the memory-write router shape (createXWriteRouter(ctx, wsContext),
 * wrapped handlers, best-effort `brain:changed` broadcast) and adds the
 * ^brain-owner-write gate: a per-process owner token delivered ONLY as an
 * HttpOnly, SameSite=Strict cookie (`brain_owner`, Path=/api/brain) set by a
 * same-origin GET /api/brain/overview. The token never appears in a response
 * body, so no page can read it. POST /verdict requires BOTH the cookie AND an
 * Origin that is exactly the Platform's own origin (a SameSite=Strict cookie is
 * still sent from another localhost port — same site — so the Origin check is
 * what stops a cross-port page). DNS rebinding is refused by the loopback-Host
 * check here and in ^local-only.
 *
 * Endpoint:
 *   POST /verdict { suggestionId, verdict: 'accept'|'reject'|'skip', brain? }
 *
 * Every verdict proxies the SAME engine function the CLI `paradigm brain
 * confirm` calls (utils/brain/suggest.ts), which re-opens the owner view and
 * refuses suggestions that target locked files.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import * as crypto from 'node:crypto';
import type { PlatformWsContext } from '../ws/index.js';
import { isLoopbackHost, isOwnOrigin } from '../local-guard.js';
import { log } from '../../../../paradigm-mcp/src/utils/mcp-logger.js';
import { isRootHash, listBrains } from '../../../../paradigm-mcp/src/utils/brain/config.js';
import type { BrainOptions } from '../../../../paradigm-mcp/src/utils/brain/types.js';
import { recordVerdict, SuggestionError } from '../../../../paradigm-mcp/src/utils/brain/suggest.js';

const L = () => log.component('#brain-write-routes');

const VERDICTS = new Set(['accept', 'reject', 'skip']);
const SUGGESTION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// ── ^brain-owner-write token (per server process) ─────────────────────

let ownerToken: string | null = null;

/** The per-process owner write token. Delivered to the local UI only as the HttpOnly `brain_owner` cookie. */
export function getBrainOwnerToken(): string {
  if (!ownerToken) ownerToken = crypto.randomBytes(32).toString('hex');
  return ownerToken;
}

export const BRAIN_OWNER_COOKIE = 'brain_owner';

/** Set the owner cookie (HttpOnly, SameSite=Strict, scoped to /api/brain). Caller guarantees same-origin. */
export function setBrainOwnerCookie(res: Response): void {
  res.append('Set-Cookie', `${BRAIN_OWNER_COOKIE}=${getBrainOwnerToken()}; Path=/api/brain; HttpOnly; SameSite=Strict`);
}

/** Read one cookie value from the raw Cookie header (no cookie-parser dependency). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Same-origin for a Brain request: an Origin, when present, must be exactly the
 * Platform's own origin; a Sec-Fetch-Site, when present, must be same-origin
 * (or 'none' — a typed URL / bookmark).
 */
export function isSameOriginBrainRequest(req: Request): boolean {
  const origin = req.headers.origin;
  if (origin && !isOwnOrigin(req, origin)) return false;
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

function tokenMatches(presented: unknown): boolean {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(getBrainOwnerToken(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Brain-scoped guard — applied to EVERY /api/brain request, reads included
 * (Brain metadata is private; the global ^local-only guard only gates mutating
 * methods). Host must be loopback; a present Origin must be EXACTLY the
 * Platform's own origin (another localhost port is refused); a present
 * Sec-Fetch-Site must be same-origin. ACAO is never left on a Brain response
 * for a foreign origin.
 */
export function brainLocalGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopbackHost(req.headers.host)) {
    res.removeHeader('Access-Control-Allow-Origin');
    res.status(403).json({ error: 'blocked: non-local request' });
    return;
  }
  if (!isSameOriginBrainRequest(req)) {
    res.removeHeader('Access-Control-Allow-Origin');
    res.status(403).json({ error: 'blocked: not the Paradigm Platform page' });
    return;
  }
  next();
}

/** Resolve ?brain= / body.brain to a known rootHash (default: the first brain). */
export function pickBrain(raw: unknown, opts: BrainOptions): { rootHash: string } | { status: number; error: string } {
  const brains = listBrains(opts);
  if (raw !== undefined && raw !== null && raw !== '') {
    if (!isRootHash(raw)) return { status: 400, error: 'invalid brain id' };
    if (!brains.some((b) => b.rootHash === raw)) return { status: 404, error: 'no such brain' };
    return { rootHash: raw };
  }
  if (brains.length === 0) return { status: 404, error: 'no brain set up yet' };
  return { rootHash: brains[0].rootHash };
}

export interface BrainRouterOptions extends BrainOptions {}

export function createBrainWriteRouter(options: BrainRouterOptions = {}, wsContext?: PlatformWsContext): Router {
  const router = Router();
  const opts: BrainOptions = options.homedir ? { homedir: options.homedir } : {};
  router.use(brainLocalGuard);

  const notify = (rootHash: string): void => {
    try {
      wsContext?.broadcast?.({ type: 'brain:changed', brain: rootHash });
    } catch {
      /* best-effort live nudge — never blocks the response */
    }
  };

  // POST /verdict — ^brain-owner-write.
  router.post('/verdict', async (req: Request, res: Response) => {
    try {
      if (!isOwnOrigin(req)) {
        L().warn('Verdict rejected: Origin is not the Platform page');
        res.status(403).json({ error: 'owner token required' });
        return;
      }
      if (!tokenMatches(readCookie(req.headers.cookie, BRAIN_OWNER_COOKIE))) {
        L().warn('Verdict rejected: missing or wrong owner cookie');
        res.status(403).json({ error: 'owner token required' });
        return;
      }
      const { suggestionId, verdict, brain } = (req.body ?? {}) as { suggestionId?: unknown; verdict?: unknown; brain?: unknown };
      if (typeof suggestionId !== 'string' || !SUGGESTION_ID_RE.test(suggestionId)) {
        res.status(400).json({ error: 'a valid suggestionId is required' });
        return;
      }
      if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) {
        res.status(400).json({ error: 'verdict must be accept, reject or skip' });
        return;
      }
      const picked = pickBrain(brain, opts);
      if ('error' in picked) {
        res.status(picked.status).json({ error: picked.error });
        return;
      }
      const result = await applyVerdict(picked.rootHash, suggestionId, verdict as 'accept' | 'reject' | 'skip', opts);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      notify(picked.rootHash);
      L().info('Verdict recorded', { verdict });
      res.json({ ok: true, suggestionId, verdict });
    } catch (err) {
      L().error('Verdict failed', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'brain operation failed' });
    }
  });

  return router;
}

// ── Engine adapter (Builder B1's suggest.recordVerdict) ───────────────

type VerdictResult = { ok: true } | { ok: false; status: number; error: string };

async function applyVerdict(
  rootHash: string,
  suggestionId: string,
  verdict: 'accept' | 'reject' | 'skip',
  opts: BrainOptions,
): Promise<VerdictResult> {
  try {
    recordVerdict(rootHash, suggestionId, verdict, opts);
    return { ok: true };
  } catch (err) {
    if (err instanceof SuggestionError) {
      return { ok: false, status: err.code === 'not-found' ? 404 : 409, error: err.message };
    }
    throw err;
  }
}
