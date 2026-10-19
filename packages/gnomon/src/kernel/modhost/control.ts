/**
 * @symbol #mod-cli
 * @symbol #mod-host
 *
 * The on-disk control surface between the `gnomon mod` CLI and the running
 * kernel (spec §12.4, §12.5; M1.11 slice 3). §5 names no wire verb for
 * install / pause / start, and adding one moves clientApiId, so the CLI and
 * the kernel meet in the home directory instead:
 *
 *   - STAGED CARDS. `gnomon mod install|link` runs #manifest-loader's
 *     stageInstall in the CLI process (snapshot + pending card record under
 *     `<home>/mods/<name>/staged/`). It signs nothing. The kernel's
 *     StagedCardPickup scans those records and raises every pending one
 *     through #approval-broker's raiseInstallCard — the REAL broker path,
 *     which re-derives the card from the pinned snapshot (never from the
 *     writable staged file) and needs fresh presence + the root key to
 *     install. A decided `install` starts the mod. Bounded: at most
 *     MAX_PICKUP_CARDS pending cards are raised; a record the broker refuses
 *     is remembered (bounded) and not retried until its file changes.
 *   - PAUSE. `gnomon mod pause <name>` writes `<home>/mods/<name>/paused`;
 *     the host refuses to start a paused mod (ModRefusal PAUSED, why 'user')
 *     and the pickup stops a running one. Pausing only narrows, so any
 *     process of the OS user may do it (§15.1: the OS user is the boundary).
 *   - UNINSTALL. `gnomon mod uninstall <name>` writes `uninstall.request`
 *     naming the pin it removes; the pickup raises a ROOT-class `grant` card
 *     (fresh presence + the root key, §3.1 I3) whose `allow` appends a
 *     root-signed `grant.uninstall` row, stops the mod and logs
 *     `manifest.uninstall{name, diff}` (+ `mod.unlinked` for a linked
 *     folder). Snapshots are kept (rollback). A request whose pin is no
 *     longer the effective one is dropped. `deny` drops the request.
 *   - WHO MAY WRITE THESE FILES. Any process of the OS user (§15.1: the OS
 *     user is the stage-1 boundary). A kernel-spawned session may NOT: the
 *     `session` profile (SBPL on darwin) denies writes under the home, which
 *     is the real boundary; the CLI's GNOMON_HSID refusal is advisory hygiene.
 *     Nothing a file says is trusted: install cards are re-derived from the
 *     pinned snapshot, and requestedBy / hsid / attended are shown on the card
 *     as claims of the staged record.
 *   - START. `gnomon mod start <name>` removes the marker and writes
 *     `start.request`; the pickup consumes it and runs the operator start
 *     (which also lifts a restart-cap `down`). Starting never widens: what
 *     loads is still decided by the root-signed grant rows.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RootAuthority } from '../identity/root-authority.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { raiseInstallCard } from '../broker/install-card.js';
import type { ManifestEventSink } from '../manifest/refusal.js';
import { STAGED_RECORD_SCHEMA, type StagedRecord } from '../manifest/install.js';
import { appendGrantRow, effectiveInstall, readGrants } from '../manifest/grants.js';

const MOD_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const STAGED_FILE = /^card-[0-9A-HJKMNP-TV-Z]{26}\.json$/;
export const PAUSE_MARKER = 'paused';
export const START_REQUEST = 'start.request';
export const UNINSTALL_REQUEST = 'uninstall.request';
/** Pending install cards the pickup raises at once (the staged dir is writable by the OS user: bounded). */
export const MAX_PICKUP_CARDS = 32;
/** Refused staged records remembered so they are not retried every scan. */
export const MAX_PICKUP_REFUSED = 256;
/** Mod directories looked at per scan. */
export const MAX_PICKUP_MODS = 256;
export const PICKUP_SCAN_MS = 2_000;

export function modsRoot(home: string): string {
  return path.join(home, 'mods');
}

function modDirOf(home: string, name: string): string {
  if (!MOD_NAME.test(name)) throw new Error(`malformed mod name ${JSON.stringify(name.slice(0, 64))}`);
  return path.join(modsRoot(home), name);
}

/** Is `name` paused by the user (`gnomon mod pause`)? A marker that is not a plain file still counts (fail closed). */
export function isUserPaused(home: string, name: string): boolean {
  try {
    fs.lstatSync(path.join(modDirOf(home, name), PAUSE_MARKER));
    return true;
  } catch {
    return false;
  }
}

export function writePause(home: string, name: string, at = new Date()): void {
  const d = modDirOf(home, name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(d, PAUSE_MARKER), `${JSON.stringify({ at: at.toISOString() })}\n`, { mode: 0o600 });
  try {
    fs.rmSync(path.join(d, START_REQUEST), { force: true });
  } catch {
    /* nothing to cancel */
  }
}

export function requestStart(home: string, name: string, at = new Date()): void {
  const d = modDirOf(home, name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.rmSync(path.join(d, PAUSE_MARKER), { force: true });
  fs.writeFileSync(path.join(d, START_REQUEST), `${JSON.stringify({ at: at.toISOString() })}\n`, { mode: 0o600 });
}

export function requestUninstall(home: string, name: string, packageHash: string, at = new Date()): void {
  const d = modDirOf(home, name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(d, UNINSTALL_REQUEST), `${JSON.stringify({ packageHash, at: at.toISOString() })}\n`, { mode: 0o600 });
}

export function uninstallRequested(home: string, name: string): { packageHash: string } | null {
  try {
    const p = path.join(modDirOf(home, name), UNINSTALL_REQUEST);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 4096) return null;
    const v = JSON.parse(fs.readFileSync(p, 'utf8')) as { packageHash?: unknown };
    return typeof v.packageHash === 'string' && /^sha256:[0-9a-f]{64}$/.test(v.packageHash) ? { packageHash: v.packageHash } : null;
  } catch {
    return null;
  }
}

function dropUninstall(home: string, name: string): void {
  try {
    fs.rmSync(path.join(modDirOf(home, name), UNINSTALL_REQUEST), { force: true });
  } catch {
    /* already gone */
  }
}

/** Consume a start request (true if there was one). */
export function takeStartRequest(home: string, name: string): boolean {
  const p = path.join(modDirOf(home, name), START_REQUEST);
  try {
    fs.lstatSync(p);
  } catch {
    return false;
  }
  fs.rmSync(p, { force: true });
  return true;
}

/** Mod names that have a directory under `<home>/mods/` (bounded, sorted). */
export function modNames(home: string): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(modsRoot(home));
  } catch {
    return [];
  }
  return names.filter((n) => MOD_NAME.test(n)).sort().slice(0, MAX_PICKUP_MODS);
}

export interface PendingStaged {
  name: string;
  cardId: string;
  record: StagedRecord;
  /** a fingerprint of the file (size + mtime) so a refused record is retried only after it changes */
  stamp: string;
}

/** Every still-pending staged install card on disk (bounded per mod by MAX_PICKUP_CARDS). */
export function pendingStaged(home: string): PendingStaged[] {
  const out: PendingStaged[] = [];
  for (const name of modNames(home)) {
    const dir = path.join(modsRoot(home), name, 'staged');
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => STAGED_FILE.test(f)).sort().slice(0, MAX_PICKUP_CARDS);
    } catch {
      continue;
    }
    for (const f of files) {
      const p = path.join(dir, f);
      try {
        const st = fs.lstatSync(p);
        if (!st.isFile() || st.size > 4 * 1024 * 1024) continue;
        const rec = JSON.parse(fs.readFileSync(p, 'utf8')) as StagedRecord;
        const cardId = f.slice(0, -5).replace('-', ':');
        if (rec?.schemaVersion !== STAGED_RECORD_SCHEMA || rec.card?.state !== 'pending' || rec.card.cardId !== cardId || rec.detail?.name !== name) continue;
        out.push({ name, cardId, record: rec, stamp: `${st.size}:${st.mtimeMs}` });
      } catch {
        /* unreadable: never raised */
      }
    }
  }
  return out;
}

export interface PickupHost {
  running(): string[];
  start(name: string): Promise<unknown>;
  stop(name: string, reason?: string): Promise<void>;
}

export interface PickupOptions {
  home: string;
  broker: ApprovalBroker;
  authority: RootAuthority;
  host: PickupHost;
  emit?: ManifestEventSink;
  /** cardIds whose manifest.staged row the kernel already wrote (staged in-process) */
  alreadyLogged?: (cardId: string) => boolean;
}

/**
 * The kernel half of `gnomon mod install|link|pause|start`: raises staged
 * cards through the broker, honours pause markers and start requests.
 */
export class StagedCardPickup {
  readonly #o: PickupOptions;
  readonly #raised = new Set<string>();
  /** mod name → the uninstall card raised for its request */
  readonly #uninstallCards = new Map<string, string>();
  readonly #refused = new Map<string, string>();
  #timer: NodeJS.Timeout | null = null;
  #scanning: Promise<void> | null = null;

  constructor(o: PickupOptions) {
    this.#o = o;
  }

  /** Cards raised and not yet settled (status / tests). */
  raised(): string[] {
    return [...this.#raised].sort();
  }

  start(everyMs = PICKUP_SCAN_MS): void {
    if (this.#timer) return;
    void this.scan();
    this.#timer = setInterval(() => void this.scan(), everyMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One pass (serialized). */
  scan(): Promise<void> {
    this.#scanning ??= this.#scan().finally(() => (this.#scanning = null));
    return this.#scanning;
  }

  async #uninstalls(emit: ManifestEventSink): Promise<void> {
    const { home, host, broker, authority } = this.#o;
    for (const [name, id] of [...this.#uninstallCards]) {
      const c = broker.card(id);
      if (!c || c.state !== 'pending' || !uninstallRequested(home, name)) this.#uninstallCards.delete(name);
    }
    for (const name of modNames(home)) {
      const req = uninstallRequested(home, name);
      if (!req || this.#uninstallCards.has(name)) continue;
      if (this.#uninstallCards.size >= MAX_PICKUP_CARDS) break;
      const row = effectiveInstall(readGrants(home, authority), name);
      if (!row || row.packageHash !== req.packageHash) {
        dropUninstall(home, name); // stale: the pin it named is not the effective one
        continue;
      }
      const source = row.source;
      const card = await broker
        .raise({
          kind: 'grant',
          requestedBy: `p:${authority.ns ?? '00000000'}/cli`,
          attended: true,
          detail: { action: 'mod.uninstall', name, packageHash: row.packageHash, manifestHash: row.manifestHash, source },
          lines: [`Uninstall mod ${name}`, `packageHash ${row.packageHash}`, `source ${source}`, 'removes its install grant; its snapshots are kept for rollback'],
          decisions: ['allow', 'deny'],
          effect: async (decision) => {
            dropUninstall(home, name);
            if (decision !== 'allow') return;
            const now = effectiveInstall(readGrants(home, authority), name);
            if (!now || now.packageHash !== row.packageHash) return; // re-pinned meanwhile: nothing to remove
            appendGrantRow(home, authority, { kind: 'grant.uninstall', name, packageHash: row.packageHash, cardId: this.#uninstallCards.get(name) ?? row.cardId });
            await host.stop(name, 'uninstalled').catch(() => undefined);
            emit('manifest.uninstall', { name, diff: { removed: [row.packageHash] }, manifestHash: row.manifestHash });
            if (source.startsWith('linked:')) emit('mod.unlinked', { name });
          },
        })
        .catch(() => null);
      if (card) {
        this.#uninstallCards.set(name, card.cardId);
      }
    }
  }

  async #scan(): Promise<void> {
    const { home, host } = this.#o;
    const emit = this.#o.emit ?? (() => undefined);
    // pause markers: a running paused mod is stopped
    for (const name of host.running()) {
      if (isUserPaused(home, name)) {
        await host.stop(name, 'paused').catch(() => undefined);
        emit('mod.paused', { name, reason: 'user', files: [] });
      }
    }
    // start requests
    for (const name of modNames(home)) {
      if (!isUserPaused(home, name) && takeStartRequest(home, name)) await host.start(name).catch(() => undefined);
    }
    await this.#uninstalls(emit);
    // staged cards
    const pending = pendingStaged(home);
    const live = new Set(pending.map((p) => p.cardId));
    for (const id of [...this.#raised]) if (!live.has(id) && !this.#o.broker.card(id)) this.#raised.delete(id);
    for (const id of [...this.#raised]) {
      const c = this.#o.broker.card(id);
      if (c && c.state !== 'pending') this.#raised.delete(id);
    }
    for (const [id] of this.#refused) if (!live.has(id)) this.#refused.delete(id);
    for (const p of pending) {
      if (this.#raised.has(p.cardId) || this.#o.broker.card(p.cardId)) continue;
      if (this.#refused.get(p.cardId) === p.stamp) continue;
      if (this.#raised.size >= MAX_PICKUP_CARDS) break;
      try {
        await raiseInstallCard(this.#o.broker, {
          home,
          name: p.name,
          cardId: p.cardId,
          authority: this.#o.authority,
          emit: (kind, payload) => {
            emit(kind, payload);
            // a decided install starts the mod (unless the user paused it)
            if (kind === 'mod.installed' && typeof payload.name === 'string' && !isUserPaused(home, payload.name)) {
              const n = payload.name;
              void host.stop(n, 'repinned').then(() => host.start(n)).catch(() => undefined);
            }
          },
        });
        this.#raised.add(p.cardId);
        if (!this.#o.alreadyLogged?.(p.cardId)) {
          const d = p.record.detail;
          emit('manifest.staged', { name: d.name, cardId: p.cardId, manifestHash: d.manifestHash, packageHash: d.packageHash, source: d.source, by: d.stagedBy, ...(d.hsid ? { hsid: d.hsid } : {}), via: 'cli' });
        }
      } catch (err) {
        if (this.#refused.size >= MAX_PICKUP_REFUSED) this.#refused.delete(this.#refused.keys().next().value!);
        this.#refused.set(p.cardId, p.stamp);
        emit('manifest.refuse', { name: p.name, cardId: p.cardId, code: 'INTEGRITY', via: 'pickup', reason: (err as Error)?.message?.slice(0, 200) ?? 'refused' });
      }
    }
  }
}
