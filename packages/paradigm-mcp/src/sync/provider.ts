/**
 * SyncProvider seam (#sync-provider) — Phase 2a of the task-management
 * expansion (TD-2026-06-13-768).
 *
 * The provider-agnostic, GitHub-only-IMPLEMENTED foundation for pushing local
 * tasks out to an external tracker. This is the THIN seam Arky designed: the
 * interface is exactly what GitHub needs and NOTHING MORE.
 *
 * HARD TENETS (do not relax without a new decision):
 *   - Fully-local-first. The whole task system works with ZERO provider. Sync
 *     is a purely additive opt-in overlay. The core (`task-loader.ts`) NEVER
 *     imports a concrete provider — only this interface type + the registry
 *     lookup. A missing/failed/un-authed provider never degrades local CRUD.
 *   - One-way (outbound) ONLY. `pull()` is STRUCTURALLY ABSENT — two-way is
 *     gated to a later phase and cannot be half-built. Do not add a `pull`
 *     method here; its absence is the contract.
 *   - `link` is NOT a provider method. Linking = a pure local write
 *     (`updateTask(rootDir, id, { external_ref })`). Providers create items;
 *     the loader records links.
 */

import type { Task } from '../utils/task-loader.js';

/** Provider-agnostic re-export of the loader's anchor shape. */
export type { ExternalRef } from '../utils/task-loader.js';
import type { ExternalRef } from '../utils/task-loader.js';

/**
 * What a provider can do. Declared per-provider so callers can branch without
 * probing the network. `pull` is present in the capability flag (always `false`
 * at Phase 2a) so the shape is honest about the gated two-way direction — but
 * NO `pull()` METHOD exists on the interface.
 */
export interface ProviderCapabilities {
  push: boolean;
  comment: boolean;
  /** Always false at Phase 2a — two-way/pull is gated. */
  pull: boolean;
  close: boolean;
}

/** The anchor a successful `push` records back onto the local task. */
export interface PushResult {
  /** Provider-native ref, e.g. `owner/repo#123`. */
  ref: string;
  /** Canonical URL of the created item, if the provider returns one. */
  url?: string;
}

/**
 * A provider-agnostic outbound sync target. GitHub is the only implementation
 * at Phase 2a. The interface is intentionally minimal — it is exactly what a
 * one-way GitHub push needs.
 *
 * NO `pull()` — two-way is gated; the method does not exist.
 */
export interface SyncProvider {
  /** Stable provider id, e.g. `'github'`. Matches `external_ref.provider`. */
  readonly id: string;

  /** Static declaration of what this provider supports. No network. */
  capabilities(): ProviderCapabilities;

  /**
   * Whether the provider is usable right now (auth present, CLI installed).
   * Best-effort and side-effect-free; callers treat a `false`/throw as
   * "stay local-only". MUST NOT throw for the un-authed case — return false.
   */
  isAvailable(): Promise<boolean>;

  /** Create an external item from a local task. Returns the anchor to record. */
  push(task: Task): Promise<PushResult>;

  /** Post a comment on an already-linked external item. */
  comment(ref: ExternalRef, message: string): Promise<void>;

  /** Close/resolve an external item. Optional — gated by `capabilities().close`. */
  close?(ref: ExternalRef): Promise<void>;
}
