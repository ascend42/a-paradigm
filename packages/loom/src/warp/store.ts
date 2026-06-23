/**
 * #warp-store — minimal content-addressed store for WARP objects + states.
 *
 * In-memory map is the primary store; disk under `.loom/` is a debug cache. No
 * GC / packing / refs in v0. The ONLY thing Loom ever writes to disk is under
 * `.loom/` — never the user's tracked files, HEAD, index, or worktree.
 *
 * Library code: no console output.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { WarpObject } from './warp-object.js';
import type { WarpState } from './warp-state.js';

export class WarpStore {
  private objects = new Map<string, WarpObject>();
  private states = new Map<string, WarpState>();
  private readonly loomDir: string;
  private readonly diskCache: boolean;

  constructor(rootDir: string, opts: { diskCache?: boolean } = {}) {
    this.loomDir = path.join(rootDir, '.loom');
    this.diskCache = opts.diskCache ?? true;
  }

  /** Put an object by its contentId (idempotent — same contentId ⇒ same bytes). */
  putObject(obj: WarpObject): void {
    if (!obj.contentId) return;
    this.objects.set(obj.contentId, obj);
    if (this.diskCache) {
      this.writeJson(path.join('warp', 'objects', `${this.safe(obj.contentId)}.json`), obj);
    }
  }

  getObject(contentId: string): WarpObject | undefined {
    return this.objects.get(contentId);
  }

  /** Put a whole state (and all its objects). */
  putState(state: WarpState): void {
    for (const obj of state.objects.values()) this.putObject(obj);
    this.states.set(state.stateId, state);
    if (this.diskCache) {
      this.writeJson(path.join('states', `${this.safe(state.stateId)}.json`), serializeState(state));
    }
  }

  getState(stateId: string): WarpState | undefined {
    return this.states.get(stateId);
  }

  /** Append a JSONL row to `.loom/<file>` (the oracle ledger). */
  appendJsonl(file: string, row: unknown): void {
    const full = path.join(this.loomDir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, JSON.stringify(row) + '\n', 'utf8');
  }

  private writeJson(rel: string, value: unknown): void {
    try {
      const full = path.join(this.loomDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(value), 'utf8');
    } catch {
      /* disk cache is best-effort */
    }
  }

  private safe(id: string): string {
    // contentIds contain ':' which is fine on POSIX but replace for safety.
    return id.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

/** A state with its object Map flattened to an array for JSON. */
export function serializeState(state: WarpState): unknown {
  return {
    ref: state.ref,
    treeSha: state.treeSha,
    stateId: state.stateId,
    absorbedAt: state.absorbedAt,
    objects: Array.from(state.objects.values()),
  };
}
