/**
 * #f4-seed — the SCRIPTED SECOND PRINCIPAL (T-2026-07-21-005; Jinx trap 6).
 *
 * A single principal CANNOT produce a KNOT through the verb surface: fork
 * always re-mints at the current selvage tip and a successful admit clears
 * scratch, so scratch-base ≠ selvage is unreachable alone. The F4 harness
 * therefore needs a scripted RIVAL that advances the selvage underneath the
 * agent under test — this module is that machinery, driving the SAME engine
 * functions the daemon drives (never a parallel path).
 *
 * SCOPE DISCIPLINE: this is the MECHANISM only. The pre-registered corpus
 * COMPOSITION (how many semantic KNOTs with payload, how many byte-downgrade
 * KNOTs without, the payload-persist-failure case, the corpus hash) is
 * founder-gate FG-4 — ratified in T-005's pre-registration, never chosen by
 * the harness builder. Nothing here encodes a corpus.
 *
 * ISOLATION LAW (Shield's ruling, lore L-2026-07-21): staged KNOTs must never
 * feed this repo's organic K3/F2 record — the harness runs against SCRATCH
 * fabrics only. Nothing in this module resolves a repo root implicitly; every
 * function demands the fixture root explicitly.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { forkNative, proposeNative, admitNative } from '../fabric/native.js';

export interface SeedWorldOptions {
  /** the SCRATCH fabric root (never a live repo — isolation law). */
  root: string;
  /** relative path of the contested module. */
  file?: string;
  /** initial body — must contain the symbol the rival will contest. */
  baseBody?: string;
}

export interface RivalAdvanceOptions {
  root: string;
  /** the scripted rival's principal (distinct from the agent under test). */
  rivalId?: string;
  file?: string;
  /** the rival's competing body for the contested file. */
  body?: string;
  intent?: string;
}

const DEFAULT_FILE = 'src/contested.ts';
const DEFAULT_BASE = 'export function pivot() { return 1; }\nexport function caller() { return pivot() + 1; }\n';
const DEFAULT_RIVAL_BODY = 'export function pivot() { return 100; }\nexport function caller() { return pivot() + 1; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

/**
 * Initialize a scratch WORLD: base file + a sealed genesis selvage (authored
 * by the neutral 'seed-genesis' principal). Returns the contested file path.
 * The agent under test then drives fork → propose → admit itself.
 */
export async function seedWorld(opts: SeedWorldOptions): Promise<{ file: string }> {
  const file = opts.file ?? DEFAULT_FILE;
  write(opts.root, file, opts.baseBody ?? DEFAULT_BASE);
  await proposeNative(opts.root, { worktree: opts.root, agentId: 'seed-genesis', intent: 'seed: genesis' });
  await admitNative(opts.root, { worktree: opts.root, agentId: 'seed-genesis', noRestore: true });
  return { file };
}

/**
 * The rival's move: fork → edit the contested symbol → propose → admit, in an
 * ISOLATED worktree (the shared root worktree is the subject agent's — the
 * rival must never touch its bytes). Called by the runner AFTER the agent
 * under test has forked/proposed (observable via its f4Trace rows), so the
 * agent's subsequent admit meets a moved selvage and the contested symbol
 * KNOTs. Returns the rival's sealed state for the run record.
 */
export async function rivalAdvance(opts: RivalAdvanceOptions): Promise<{ rivalId: string; sealed: boolean; status: string }> {
  const rivalId = opts.rivalId ?? 'seed-rival';
  const file = opts.file ?? DEFAULT_FILE;
  const wt = fs.mkdtempSync(path.join(path.dirname(opts.root), path.basename(opts.root) + '-rival-'));
  try {
    forkNative(opts.root, rivalId, { into: wt });
    write(wt, file, opts.body ?? DEFAULT_RIVAL_BODY);
    await proposeNative(opts.root, { worktree: wt, agentId: rivalId, intent: opts.intent ?? 'seed: rival contests the pivot' });
    const admitted = await admitNative(opts.root, { worktree: wt, agentId: rivalId, noRestore: true });
    return { rivalId, sealed: admitted.sealed, status: admitted.decision.status };
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
}
