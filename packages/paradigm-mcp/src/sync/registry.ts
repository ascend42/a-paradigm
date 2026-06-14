/**
 * SyncProvider registry (#sync-provider) — Phase 2a (TD-2026-06-13-768).
 *
 * A tiny id→factory map. The core (`task-loader.ts`) and CLI look a provider up
 * by id; `getProvider` returning `undefined` is the explicit local-only signal.
 *
 * Providers self-register on module load (the GitHub provider calls
 * `registerProvider('github', …)` at import time). Callers that want a concrete
 * provider import its module for its registration side-effect — the core never
 * does, preserving the "core never imports a concrete provider" tenet.
 *
 * Factories are lazy so registering a provider does not eagerly construct it.
 */

import { log } from '../utils/mcp-logger.js';
import type { SyncProvider } from './provider.js';

export type SyncProviderFactory = () => SyncProvider;

const REGISTRY = new Map<string, SyncProviderFactory>();
/** Memoized instances so repeated lookups reuse one provider object. */
const INSTANCES = new Map<string, SyncProvider>();

/** Register (or replace) a provider factory under `id`. Idempotent. */
export function registerProvider(id: string, factory: SyncProviderFactory): void {
  REGISTRY.set(id, factory);
  INSTANCES.delete(id);
  log.component('#sync-provider').info('Provider registered', { id });
}

/**
 * Resolve a provider by id. Returns `undefined` when no provider is registered
 * for `id` — the caller MUST treat that as "local-only, no sync". Never throws.
 */
export function getProvider(id: string): SyncProvider | undefined {
  const existing = INSTANCES.get(id);
  if (existing) return existing;
  const factory = REGISTRY.get(id);
  if (!factory) return undefined;
  const instance = factory();
  INSTANCES.set(id, instance);
  return instance;
}

/** Test-only: drop all registrations + instances. */
export function _resetRegistry(): void {
  REGISTRY.clear();
  INSTANCES.clear();
}
