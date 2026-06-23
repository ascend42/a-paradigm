/**
 * Warpline Routes — the Convergence/Divergence Oracle, made web-reachable.
 *
 * This is the Platform-section data layer for the Warpline engine (`@a-company/
 * warpline`). It mirrors `routes/tasks.ts`: a thin HTTP layer over the engine's
 * EXPORTED functions, imported IN-PROCESS (never shelling the CLI). It owns no
 * storage of its own beyond an in-memory WarpState cache.
 *
 * READ-ONLY BY CONSTRUCTION. The `weave` write verb is RESERVED and not built in
 * the engine; this router NEVER constructs a write/`weave`/consolidate call. The
 * only disk Warpline ever touches is the engine's own `.warpline/oracle.jsonl`
 * append (via `oracle()` — append-only, the historical ledger). Read-only here
 * is therefore *structural*, not policed — there is no reachable write path.
 *
 * Three data layers (per the GUI plan §1):
 *   (A) Ledger reader — GET /ledger reads .warpline/oracle.jsonl (zero compute,
 *       zero git contact, version-guarded on schemaVersion) + fs.watch → WS.
 *   (B) Live compute — POST /forecast (ephemeral, no ledger write), POST /oracle
 *       (appends ledger → fires WS), POST /diff, GET /absorb/:ref. Every handler
 *       that spins git worktrees runs under an in-process concurrency semaphore
 *       and reuses a per-stateId WarpState cache (absorb is deterministic).
 *   (C) /refs — local git branch list + HEAD for the ref pickers.
 *
 * Endpoints:
 *   GET  /ledger?limit=        — past OracleRecords, newest-first
 *   GET  /refs                 — local branches + HEAD (read-only `git branch`)
 *   POST /forecast {branchA,branchB,vsGit?}  — pre-merge meaning forecast (ephemeral)
 *   POST /oracle   {branchA,branchB}         — full Oracle (appends ledger)
 *   POST /diff     {refA?,refB?}             — semantic diff
 *   GET  /absorb/:ref          — serialized WarpState for a ref
 */

import { Router, type Request, type Response } from 'express';
import * as path from 'node:path';
import * as fs from 'node:fs';
import simpleGit, { type SimpleGit } from 'simple-git';

import type { PlatformWsContext } from '../ws/index.js';

// ── Concurrency control ──────────────────────────────────────────────────────
//
// Every absorb spins `git worktree add` + a full live-graph parse; oracle and
// forecast absorb THREE refs (base, A, B). Under interactive fan-out this is the
// engine's biggest risk (temp-worktree contention). Cap concurrent
// absorb-spawning handlers at MAX_CONCURRENT (~2–3) with a tiny FIFO semaphore.
const MAX_CONCURRENT = 2;

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export function createWarplineRouter(projectDir: string, ws?: PlatformWsContext): Router {
  const router = Router();
  const git: SimpleGit = simpleGit(projectDir);
  const ledgerPath = path.join(projectDir, '.warpline', 'oracle.jsonl');

  const semaphore = new Semaphore(MAX_CONCURRENT);

  // Per-stateId WarpState cache. absorb is deterministic — the same ref at the
  // same tree yields the same stateId — but we key on the *ref string* here
  // because the route only knows the ref the caller asked for. A more precise
  // key would be ref+treeSha; ref is a safe approximation for the interactive
  // session (the cache is dropped when the server restarts). Stores the
  // already-serialized state (the Map is flattened by serializeState).
  const absorbCache = new Map<string, unknown>();

  // ── (A) Ledger reader ──────────────────────────────────────────────────────

  // GET /ledger?limit= — read .warpline/oracle.jsonl line-by-line, version-guard
  // on schemaVersion (skip unknown rows, never throw), return newest-first. Zero
  // compute, zero git contact. Missing file → [].
  router.get('/ledger', (req: Request, res: Response) => {
    try {
      const limit = parseLimit(req.query.limit);
      const records = readLedger(ledgerPath);
      const newestFirst = records.reverse();
      res.json(limit ? newestFirst.slice(0, limit) : newestFirst);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read ledger', detail: String(err) });
    }
  });

  // ── (C) Refs ─────────────────────────────────────────────────────────────

  // GET /refs — local git branch list + HEAD for the ref pickers. Read-only:
  // simple-git `branch()` runs `git branch` only; no fetch, no mutation.
  router.get('/refs', async (_req: Request, res: Response) => {
    try {
      const info = await git.branch();
      const branches = Object.values(info.branches).map((b) => b.name);
      res.json({ head: info.current, branches });
    } catch (err) {
      res.status(500).json({ error: 'Failed to list refs', detail: String(err) });
    }
  });

  // ── (B) Live compute ───────────────────────────────────────────────────────

  // POST /forecast {branchA, branchB, vsGit?} — the pre-merge MEANING forecast.
  // EPHEMERAL: forecast() never writes the ledger (only oracle does). vsGit adds
  // the git-reality divergence comparison (runs the full Oracle with noWrite).
  router.post('/forecast', async (req: Request, res: Response) => {
    const { branchA, branchB, vsGit } = req.body ?? {};
    if (!isRef(branchA) || !isRef(branchB)) {
      res.status(400).json({ error: 'forecast requires string `branchA` and `branchB`' });
      return;
    }
    try {
      const { forecast } = await import('@a-company/warpline');
      const result = await semaphore.run(() =>
        forecast(branchA, branchB, { cwd: projectDir, vsGit: vsGit === true }),
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Forecast failed', detail: String(err) });
    }
  });

  // POST /oracle {branchA, branchB} — the full Convergence/Divergence Oracle.
  // This APPENDS an OracleRecord to .warpline/oracle.jsonl (the only write the
  // engine ever performs — append-only ledger), which the fs.watch below picks
  // up and broadcasts. Read-only on the user's git (no merge committed).
  router.post('/oracle', async (req: Request, res: Response) => {
    const { branchA, branchB } = req.body ?? {};
    if (!isRef(branchA) || !isRef(branchB)) {
      res.status(400).json({ error: 'oracle requires string `branchA` and `branchB`' });
      return;
    }
    try {
      const { oracle } = await import('@a-company/warpline');
      const record = await semaphore.run(() => oracle(branchA, branchB, { cwd: projectDir }));
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: 'Oracle failed', detail: String(err) });
    }
  });

  // POST /diff {refA?, refB?} — the SEMANTIC diff between two refs. Read-only;
  // never writes .warpline/. Defaults mirror the CLI: refA=WORKTREE, refB=HEAD.
  router.post('/diff', async (req: Request, res: Response) => {
    const refA = isRef(req.body?.refA) ? req.body.refA : 'WORKTREE';
    const refB = isRef(req.body?.refB) ? req.body.refB : 'HEAD';
    try {
      const { semanticDiff } = await import('@a-company/warpline');
      const report = await semaphore.run(() => semanticDiff(refA, refB, { cwd: projectDir }));
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: 'Semantic diff failed', detail: String(err) });
    }
  });

  // GET /absorb/:ref — serialize(absorb(ref)). The WarpState Map MUST be
  // serialized (serializeState flattens it). Cached per-ref (absorb is
  // deterministic). Read-only: absorb spins a throwaway worktree, torn down.
  router.get('/absorb/:ref', async (req: Request, res: Response) => {
    const ref = req.params.ref;
    if (!isRef(ref)) {
      res.status(400).json({ error: 'absorb requires a ref path param' });
      return;
    }
    try {
      const cached = absorbCache.get(ref);
      if (cached) {
        res.json(cached);
        return;
      }
      const { absorb, serializeState } = await import('@a-company/warpline');
      const serialized = await semaphore.run(async () => {
        const state = await absorb(ref, { cwd: projectDir });
        return serializeState(state);
      });
      absorbCache.set(ref, serialized);
      res.json(serialized);
    } catch (err) {
      res.status(500).json({ error: 'Absorb failed', detail: String(err) });
    }
  });

  // ── Ledger fs.watch → WS broadcast ──────────────────────────────────────────
  //
  // Watch .warpline/oracle.jsonl; on append, broadcast `!oracle-record-appended`
  // with the newest record so a live viewer repaints without polling. The WS bus
  // routes on the channel = segment before the first ':' in `type`, so we prefix
  // with `warpline:` (mirrors how tasks broadcasts `tasks:synced`). Best-effort:
  // a watch failure (missing dir, FS that can't watch) never disrupts the server.
  if (ws) {
    attachLedgerWatch(ledgerPath, (record) => {
      ws.broadcast({ type: 'warpline:oracle-record-appended', record });
    });
  }

  return router;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Coerce a `?limit=` query value to a sane positive integer, or undefined. */
function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A usable git ref/branch string (non-empty, no obvious shell metacharacters). */
function isRef(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Schema versions of OracleRecord this reader understands. Unknown → skipped. */
const KNOWN_SCHEMA_VERSIONS = new Set<number>([1]);

/**
 * Read the oracle ledger line-by-line. Version-guards on schemaVersion (skips
 * unknown/malformed rows — NEVER throws on a single bad line) and returns the
 * surviving records in file order (oldest-first; callers reverse). Missing file
 * → []. Only the ledger reader (data layer A) parses this file.
 */
function readLedger(ledgerPath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(ledgerPath)) return [];
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const out: Array<Record<string, unknown>> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      const v = typeof row?.schemaVersion === 'number' ? row.schemaVersion : undefined;
      if (v === undefined || !KNOWN_SCHEMA_VERSIONS.has(v)) continue; // skip unknown
      out.push(row);
    } catch {
      // skip a malformed/partial line (e.g. a half-flushed append) — never throw
    }
  }
  return out;
}

/**
 * fs.watch the ledger file (and its dir, so a first-ever append is caught even
 * when the file doesn't yet exist) and invoke `onRecord` with the newest record
 * on each change. Debounced + last-seen-count guarded so a single append fires
 * exactly once. Best-effort; swallows all errors.
 */
function attachLedgerWatch(ledgerPath: string, onRecord: (record: Record<string, unknown>) => void): void {
  const dir = path.dirname(ledgerPath);
  let lastCount = fs.existsSync(ledgerPath) ? readLedger(ledgerPath).length : 0;
  let timer: NodeJS.Timeout | null = null;

  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const records = readLedger(ledgerPath);
        if (records.length > lastCount) {
          const newest = records[records.length - 1];
          lastCount = records.length;
          onRecord(newest);
        }
      } catch {
        /* best-effort */
      }
    }, 100);
    timer.unref?.();
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    const watcher = fs.watch(dir, (_event, filename) => {
      if (!filename || filename === 'oracle.jsonl') fire();
    });
    watcher.unref?.();
    watcher.on('error', () => {
      /* best-effort — a watch failure never disrupts the server */
    });
  } catch {
    /* best-effort — some filesystems can't watch */
  }
}
