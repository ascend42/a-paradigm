/**
 * #warp-store — minimal content-addressed store for WARP objects + states.
 *
 * In-memory map is the primary store; disk under `.warpline/` is a debug cache. No
 * GC / packing / refs in v0. The ONLY thing Warpline ever writes to disk is under
 * `.warpline/` — never the user's tracked files, HEAD, index, or worktree.
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
  private readonly warplineDir: string;
  private readonly diskCache: boolean;

  constructor(rootDir: string, opts: { diskCache?: boolean } = {}) {
    this.warplineDir = path.join(rootDir, '.warpline');
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

  /**
   * Read a state back from the durable `.warpline/states/` cache (the Phase-2
   * write path needs the PARENT state across CLI runs, when the in-mem map is
   * empty). Rehydrates the serialized WarpObject[] into the objects Map keyed by
   * symbol — faithful because `diff` reads only stableKey/contentId/contract off
   * each object, all of which serializeState preserves. Returns undefined if the
   * state was never persisted (or the JSON is unreadable).
   */
  loadState(stateId: string): WarpState | undefined {
    const inMem = this.states.get(stateId);
    if (inMem) return inMem;
    try {
      const full = path.join(this.warplineDir, 'states', `${this.safe(stateId)}.json`);
      const data = JSON.parse(fs.readFileSync(full, 'utf8')) as {
        ref: string;
        treeSha: string | null;
        stateId: string;
        absorbedAt: string;
        objects: WarpObject[];
      };
      const objects = new Map<string, WarpObject>();
      for (const obj of data.objects) objects.set(obj.symbol, obj);
      const state: WarpState = {
        ref: data.ref,
        treeSha: data.treeSha,
        stateId: data.stateId,
        absorbedAt: data.absorbedAt,
        objects,
      };
      this.states.set(state.stateId, state);
      for (const obj of objects.values()) this.objects.set(obj.contentId, obj);
      return state;
    } catch {
      return undefined;
    }
  }

  /** Append a JSONL row to `.warpline/<file>` (the oracle ledger). */
  appendJsonl(file: string, row: unknown): void {
    const full = path.join(this.warplineDir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.appendFileSync(full, JSON.stringify(row) + '\n', 'utf8');
  }

  private writeJson(rel: string, value: unknown): void {
    try {
      const full = path.join(this.warplineDir, rel);
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
