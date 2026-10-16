/**
 * Brain Routes — the Platform Brain section's READ surface (7.14.0).
 *
 * Every handler goes through the single gate choke point
 * openBrainView(rootHash, 'owner') — this router never touches the index,
 * brain.yaml zones, or the user's folder directly. Owner audience sees open +
 * private files; sensitive zones (medical / financial / third-party-data /
 * quarantined) surface ONLY as {folder, gate, count} — never filenames, titles
 * or headings. Health and suggestions are computed by the engine over the
 * already-filtered view, so hidden records can never influence their output.
 *
 * Every /api/brain request (reads included) must carry a loopback Host and, if
 * present, an Origin that is EXACTLY the Platform's own origin (brainLocalGuard)
 * — Brain metadata is private, even from other localhost ports.
 *
 * Endpoints (all GET; `?brain=<rootHash>` optional, default = first brain):
 *   /overview      — brains list, egress badge, map (type/size/recency),
 *                    locked zones (counts only), tamper banner, suggestions
 *                    paused flag; sets the HttpOnly `brain_owner` cookie
 *                    (the write token is NEVER in the body)
 *   /health        — broken links / loose notes / same-name notes
 *   /suggestions   — next ≤10 folder-first suggestions with rationale
 *   /find?q=       — title / heading / path / topic search (q ≤ 200 chars)
 */

import { Router, type Request, type Response } from 'express';
import * as path from 'node:path';
import { log } from '../../../../paradigm-mcp/src/utils/mcp-logger.js';
import { listBrains } from '../../../../paradigm-mcp/src/utils/brain/config.js';
import { openBrainView } from '../../../../paradigm-mcp/src/utils/brain/view.js';
import { egressSummary, readEgress } from '../../../../paradigm-mcp/src/utils/brain/egress.js';
import { computeHealth } from '../../../../paradigm-mcp/src/utils/brain/health.js';
import { MAX_BATCH, nextSuggestions, suggestionsState } from '../../../../paradigm-mcp/src/utils/brain/suggest.js';
import { TAMPER_BANNER, type BrainOptions, type BrainView, type ViewFile } from '../../../../paradigm-mcp/src/utils/brain/types.js';
import { brainLocalGuard, pickBrain, setBrainOwnerCookie, type BrainRouterOptions } from './brain-write.js';

const L = () => log.component('#brain-routes');

/** Longest accepted find query (chars) — longer → 400. */
export const MAX_FIND_QUERY = 200;
const FIND_LIMIT = 25;
const DAY = 24 * 60 * 60 * 1000;

export interface BrainMap {
  byType: { markdown: number; text: number; other: number };
  bySize: { small: number; medium: number; large: number; huge: number };
  byRecency: { week: number; month: number; year: number; older: number; unknown: number };
}

/** Counts by type / size / recency over the VISIBLE files only. */
export function buildMap(files: ViewFile[], now = Date.now()): BrainMap {
  const m: BrainMap = {
    byType: { markdown: 0, text: 0, other: 0 },
    bySize: { small: 0, medium: 0, large: 0, huge: 0 },
    byRecency: { week: 0, month: 0, year: 0, older: 0, unknown: 0 },
  };
  for (const f of files) {
    m.byType[f.kind]++;
    if (f.size < 10_000) m.bySize.small++;
    else if (f.size < 100_000) m.bySize.medium++;
    else if (f.size < 1_000_000) m.bySize.large++;
    else m.bySize.huge++;
    if (typeof f.mtimeMs !== 'number') m.byRecency.unknown++;
    else {
      const age = now - f.mtimeMs;
      if (age < 7 * DAY) m.byRecency.week++;
      else if (age < 31 * DAY) m.byRecency.month++;
      else if (age < 366 * DAY) m.byRecency.year++;
      else m.byRecency.older++;
    }
  }
  return m;
}

/** Plain display shape for one visible file (no hashes, no link internals). */
export function fileCard(f: ViewFile) {
  return {
    id: f.id,
    title: f.title ?? path.posix.basename(f.relpath).replace(/\.(md|markdown|txt)$/i, ''),
    path: f.relpath,
    folder: f.folder,
    kind: f.kind,
    topics: [...f.tags],
  };
}

export function createBrainRouter(options: BrainRouterOptions = {}): Router {
  const router = Router();
  const opts: BrainOptions = options.homedir ? { homedir: options.homedir } : {};
  router.use(brainLocalGuard);

  /** Resolve the brain + open the owner view, or answer with an error. */
  const withView = (req: Request, res: Response): { rootHash: string; view: BrainView } | null => {
    const picked = pickBrain(req.query.brain, opts);
    if ('error' in picked) {
      res.status(picked.status).json({ error: picked.error });
      return null;
    }
    const view = openBrainView(picked.rootHash, 'owner', opts);
    return { rootHash: picked.rootHash, view };
  };

  const fail = (res: Response, what: string, err: unknown): void => {
    L().error(`${what} failed`, { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'brain operation failed' });
  };

  // GET /overview — the landing payload. Empty brains list → UI empty state.
  router.get('/overview', (req: Request, res: Response) => {
    try {
      // brainLocalGuard already refused any foreign Origin / Sec-Fetch-Site,
      // so this is the Platform page itself: hand it the HttpOnly owner cookie.
      setBrainOwnerCookie(res);
      const listed = listBrains(opts);
      const brains = listed.map((b) => ({ id: b.rootHash, name: path.basename(b.root), root: b.root }));
      if (brains.length === 0) {
        res.json({ brains: [], selected: null });
        return;
      }
      const ctx = withView(req, res);
      if (!ctx) return;
      const { rootHash, view } = ctx;
      const summary = view.summary();
      const eg = egressSummary(rootHash, opts);
      const recent = readEgress(rootHash, opts)
        .slice(-20)
        .reverse()
        .map((r) => ({ at: r.at, channel: r.channel, op: r.op, items: r.fileIds.length, bytes: r.bytes }));
      res.json({
        brains,
        selected: rootHash,
        scannedAt: summary.scannedAt,
        visible: summary.visible,
        badge: { nothingLeft: eg.nothingLeft, count: eg.count, bytes: eg.bytes, last: eg.last },
        egress: recent,
        map: buildMap(view.files()),
        locked: view.lockedZones(),
        lockedTotal: summary.locked,
        agentAccess: summary.agentAccess,
        banner: listed.find((b) => b.rootHash === rootHash)?.tampered ? TAMPER_BANNER : null,
        paused: suggestionsPaused(rootHash, opts),
      });
    } catch (err) {
      fail(res, 'overview', err);
    }
  });

  // GET /find?q= — plain substring search over visible files (view.search).
  router.get('/find', (req: Request, res: Response) => {
    try {
      const raw = req.query.q;
      if (raw !== undefined && typeof raw !== 'string') {
        res.status(400).json({ error: 'q must be a single string' });
        return;
      }
      const q = raw ?? '';
      if (q.length > MAX_FIND_QUERY) {
        res.status(400).json({ error: `q must be at most ${MAX_FIND_QUERY} characters` });
        return;
      }
      const ctx = withView(req, res);
      if (!ctx) return;
      const hits = q.trim() ? ctx.view.search(q, FIND_LIMIT) : [];
      // The query is NOT echoed back — the caller already has it, and echoing
      // request text would make every response a reflection surface.
      res.json({ hits: hits.map((h) => ({ ...fileCard(h.file), matched: h.field })) });
    } catch (err) {
      fail(res, 'find', err);
    }
  });

  // GET /health — broken links / loose notes / same-name notes.
  router.get('/health', async (req: Request, res: Response) => {
    try {
      const ctx = withView(req, res);
      if (!ctx) return;
      res.json(await healthFor(ctx.view, ctx.rootHash, opts));
    } catch (err) {
      fail(res, 'health', err);
    }
  });

  // GET /suggestions — next ≤10 with rationale.
  router.get('/suggestions', async (req: Request, res: Response) => {
    try {
      const ctx = withView(req, res);
      if (!ctx) return;
      res.json(await suggestionsFor(ctx.view, ctx.rootHash, opts));
    } catch (err) {
      fail(res, 'suggestions', err);
    }
  });

  return router;
}

// ── Engine adapters (Builder B1's health / suggest) ───────────────────
// Both consume the SAME owner view the other routes use (computeHealth is pure
// over it; nextSuggestions opens its own owner view). Output is reshaped into
// plain display rows — no evidence type ids, hashes or anchors leave here.

function noteRef(view: BrainView, id: string, relpath: string) {
  const f = view.get(id);
  return f ? { id, title: fileCard(f).title, path: f.relpath } : { id, title: path.posix.basename(relpath), path: relpath };
}

async function healthFor(view: BrainView, _rootHash: string, _opts: BrainOptions) {
  const h = computeHealth(view);
  return {
    scannedAt: h.scannedAt,
    notes: h.notes,
    counts: h.counts,
    brokenLinks: h.brokenLinks.map((b) => ({
      from: noteRef(view, b.fileId, b.relpath),
      target: b.heading ? `${b.target} › ${b.heading}` : b.target,
    })),
    looseNotes: h.looseNotes.map((n) => noteRef(view, n.fileId, n.relpath)),
    sameName: h.sameNameNotes.map((g) => ({ name: g.name, notes: g.files.map((f) => noteRef(view, f.fileId, f.relpath)) })),
  };
}

function suggestionsPaused(rootHash: string, opts: BrainOptions): boolean {
  try { return suggestionsState(rootHash, opts).paused === true; } catch { return false; }
}

async function suggestionsFor(view: BrainView, rootHash: string, opts: BrainOptions) {
  const batch = nextSuggestions(rootHash, { ...opts, limit: MAX_BATCH });
  return {
    enabled: batch.state.enabled,
    paused: batch.state.paused === true,
    acceptance: batch.state.acceptance,
    remaining: batch.remaining,
    suggestions: batch.suggestions.slice(0, MAX_BATCH).map((s) => {
      const target = s.scope === 'file' ? (view.get(s.target) ? fileCard(view.get(s.target)!).path : '') : s.target;
      return {
        id: s.id,
        label: s.label,
        scope: s.scope,
        target,
        score: s.score,
        rationale: s.evidence.map((e) => e.detail).join('; '),
      };
    }),
  };
}
