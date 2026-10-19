/**
 * @symbol #provisioner
 *
 * #provisioner (spec §3.1 "Provisioner"; T-2026-10-19-005 MVP-a) — the ONE
 * engine behind every surface that provisions this Mac's hardware identity:
 * `gnomon identity init | --rotate | --recover | purge-keys` (identity-cli.ts,
 * a thin renderer) and the guided first run `gnomon setup` (setup-cli.ts, and
 * the GUI setup phase in MVP-b). It renders NOTHING: it emits ProvisionEvents
 *
 *   step     { step, detail? }                    a boundary passed (detail: a journal line to show)
 *   presence { n, of, purpose, digest12, key?, gen? }   a Touch ID prompt is about to open
 *   done     { result }                           committed; result.output is the CLI's JSON line
 *   aborted  { reason, message, extra }           refused or failed; nothing half-done is kept
 *
 * and takes an AbortSignal (the first Ctrl-C) checked at every step.
 *
 * INVARIANTS (Aegis, falsified in test/setup.test.ts and test/identity-cli.test.ts):
 *   I1  no root signature is ACCEPTED unless the helper's own prompt line
 *       (reply.shown, the dialog's LAST line) names the digest the surface
 *       showed: `Gnomon Helper: root key signs 1: <digest12>`; a dropped or
 *       replaced line refuses (`helper-line-mismatch`) before anything commits;
 *   I5  the helper path comes from the caller's pinned default or identity.json
 *       and is ALWAYS signature-pinned (pinHelper); never from a cwd or a UI;
 *   I6  a generation this run did not create is never adopted; init refuses
 *       while one exists, and purging one takes presence per key (purgeGeneration);
 *   I7  a root-prompt budget per mode (init 2, rotate 3, recover 2, complete 1):
 *       one more root sign request throws before it reaches the helper;
 *   I8  an exclusive O_EXCL provisioning lock at `<home>.provisioning.lock`
 *       (a sibling of the home: the home itself may not exist yet), taken
 *       before key.list; a live holder → `provisioning-locked`, no key.create;
 *   I9  a failure before identity.json is written restores what it moved and
 *       deletes the keys it created (only helper-attestable ones: created by
 *       this helper process, or deleted with fresh presence);
 *   I10 after identity.json is written, keys are never deleted; a crash before
 *       the registry row leaves `device-unregistered`, which completeDevice()
 *       finishes as its own root-signed step (fresh presence, digest shown).
 */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pidAlive } from '../lifecycle/pidfile.js';
import { deviceKeyPath, loadDeviceKey, writeNewDeviceKey } from './device-key.js';
import { HardwareRootAuthority, p256FromX963, p256KeyIdOfPem, pemOf } from './hardware.js';
import { helperOnceSync, HelperProcess, pinHelper, type HelperTransport, type HelperVerifier, type PinnedHelper } from './helper.js';
import { APPROVALS_ROW_SCHEMA, appendIdentityJournal, helperPublicKey, IDENTITY_SCHEMA, identityPath, openHardwareIdentity, readIdentity, writeIdentity, type IdentityRecord } from './provision.js';
import { appendSignedRegistryRow, deviceRowFor, readRegistry, registryPath } from './registry.js';

export type ProvisionMode = 'init' | 'rotate' | 'recover';
export type PresencePurposeId = 'rotate-statement' | 'approvals-binding' | 'device-row' | 'complete-device' | 'purge-old' | 'purge';

export type ProvisionEvent =
  | { type: 'step'; step: string; detail?: Record<string, unknown> }
  | { type: 'presence'; n: number; of: number; purpose: PresencePurposeId; digest12: string | null; key?: string; gen?: string }
  | { type: 'done'; result: ProvisionDone }
  | { type: 'aborted'; reason: string; message: string; extra: Record<string, unknown> };

export interface ProvisionDone {
  ok: true;
  /** the JSON object `gnomon identity` prints on stdout */
  output: Record<string, unknown>;
  record?: IdentityRecord;
}
export interface ProvisionRefusal {
  ok: false;
  reason: string;
  message: string;
  extra: Record<string, unknown>;
}
export type ProvisionOutcome = ProvisionDone | ProvisionRefusal;

/** I7: the root prompts each mode may raise; one more is refused before it reaches the helper. */
export const ROOT_PROMPT_BUDGET: Readonly<Record<ProvisionMode | 'complete', number>> = Object.freeze({ init: 2, rotate: 3, recover: 2, complete: 1 });
export const PROVISION_LOCK_SUFFIX = '.provisioning.lock';

export interface ProvisionerOptions {
  home: string;
  /** the helper executable: the caller's pinned default, `--helper`, or identity.json's (I5) */
  helperPath: string;
  verifier?: HelperVerifier;
  start?: (pin: PinnedHelper) => HelperTransport;
  once?: (pin: PinnedHelper) => (req: Record<string, unknown>) => Record<string, unknown>;
  signal?: AbortSignal;
  /** tests: report an interrupt at the next step boundary */
  interrupt?: () => boolean;
  /** tests (I9): throw at the named step boundary */
  fault?: (step: string) => void;
}

export interface ProvisionRequest {
  mode: ProvisionMode;
  existing: IdentityRecord | null;
  name: string;
  host: string;
  /** after a successful rotate: purge the old generation now? (absent = never asked) */
  confirmPurgeOld?: () => Promise<boolean>;
}

class Interrupted extends Error {
  constructor() {
    super('interrupted (Ctrl-C)');
    this.name = 'Interrupted';
  }
}

export class ProvisionStop extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ProvisionStop';
  }
}

type KeyEntry = { gen: string; key: string };

export async function listHelperKeys(helper: HelperTransport): Promise<KeyEntry[]> {
  const r = await helper.request({ op: 'key.list' });
  return Array.isArray(r.keys) ? (r.keys as KeyEntry[]).filter((k) => typeof k?.gen === 'string' && typeof k?.key === 'string') : [];
}

export const gensOf = (keys: readonly KeyEntry[]): string[] => [...new Set(keys.map((k) => k.gen))].sort();

const GEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newGeneration(): string {
  return Array.from(randomBytes(12), (b) => GEN_ALPHABET[b % 36]).join('');
}

/** I1: the helper's own line (the prompt's last line) names exactly this one digest for this key. */
export function helperLineShows(shown: unknown, key: 'root' | 'approvals', digest12: string): boolean {
  if (typeof shown !== 'string' || /[\r\n]/.test(shown)) return false;
  return shown.split('; ')[0] === `Gnomon Helper: ${key} key signs 1: ${digest12}`;
}

/** I8: the provisioning lock path, a sibling of the home. */
export function provisionLockPath(home: string): string {
  return `${home}${PROVISION_LOCK_SUFFIX}`;
}

/** I8: take the lock (O_EXCL); a dead holder's lock is removed once and re-raced. Returns the release. */
export function acquireProvisionLock(home: string): () => void {
  const p = provisionLockPath(home);
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number | null = null;
    try {
      fd = fs.openSync(p, 'wx', 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new ProvisionStop('provisioning-lock', `the provisioning lock ${p} cannot be created: ${(e as Error).message}`);
    }
    if (fd !== null) {
      try {
        fs.writeSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
      } finally {
        fs.closeSync(fd);
      }
      const ino = fs.lstatSync(p).ino;
      return () => {
        try {
          if (fs.lstatSync(p).ino === ino) fs.unlinkSync(p);
        } catch {
          /* already gone */
        }
      };
    }
    let holder: number | undefined;
    try {
      const st = fs.lstatSync(p);
      if (!st.isFile()) throw new ProvisionStop('provisioning-locked', `${p} exists and is not a lock file; remove it by hand`);
      const v = JSON.parse(fs.readFileSync(p, 'utf8')) as { pid?: unknown };
      holder = typeof v.pid === 'number' ? v.pid : undefined;
    } catch (e) {
      if (e instanceof ProvisionStop) throw e;
      // unreadable: a racer mid-write, treated as live
      throw new ProvisionStop('provisioning-locked', `another provisioning run holds ${p}`, { lock: p });
    }
    if (holder !== undefined && pidAlive(holder)) throw new ProvisionStop('provisioning-locked', `another provisioning run (pid ${holder}) holds ${p}`, { lock: p });
    try {
      fs.unlinkSync(p); // a crashed holder: re-race once
    } catch {
      /* re-race */
    }
  }
  throw new ProvisionStop('provisioning-locked', `the provisioning lock ${p} keeps being taken`, { lock: p });
}

export class Provisioner extends EventEmitter {
  readonly #o: ProvisionerOptions;
  #rootPrompts = 0;
  #budget = 0;

  constructor(o: ProvisionerOptions) {
    super();
    this.#o = o;
  }

  #emit(e: ProvisionEvent): void {
    this.emit('event', e);
    this.emit(e.type, e);
  }

  #step(name: string): void {
    if (this.#o.signal?.aborted || this.#o.interrupt?.()) throw new Interrupted();
    this.#o.fault?.(name);
    this.#emit({ type: 'step', step: name });
  }

  #refuse(reason: string, message: string, extra: Record<string, unknown> = {}): ProvisionRefusal {
    this.#emit({ type: 'aborted', reason, message, extra });
    return { ok: false, reason, message, extra };
  }

  #done(output: Record<string, unknown>, record?: IdentityRecord): ProvisionDone {
    const result: ProvisionDone = { ok: true, output, ...(record ? { record } : {}) };
    this.#emit({ type: 'done', result });
    return result;
  }

  #pin(): PinnedHelper | ProvisionRefusal {
    try {
      return pinHelper(this.#o.helperPath, this.#o.verifier ? { verifier: this.#o.verifier } : {});
    } catch (e) {
      return this.#refuse('helper-unavailable', e instanceof Error ? e.message : 'the helper could not be pinned', { helperPath: this.#o.helperPath });
    }
  }

  #startHelper(pin: PinnedHelper): HelperTransport {
    return this.#o.start ? this.#o.start(pin) : HelperProcess.start(pin);
  }

  /** I1 + I7: one root signature with fresh presence, accepted only if the helper line names the digest shown. */
  async #rootSign(root: HardwareRootAuthority, row: unknown, p: { n: number; of: number; purpose: PresencePurposeId }): Promise<{ signer: string; sig: string; statement: string; helperSig: string }> {
    if (++this.#rootPrompts > this.#budget) throw new ProvisionStop('root-prompt-budget', `refusing root prompt ${this.#rootPrompts}: this run may raise only ${this.#budget}`);
    const digest12 = root.digestFor(row);
    this.#emit({ type: 'presence', n: p.n, of: p.of, purpose: p.purpose, digest12 });
    this.#step(`sign-${p.purpose}`);
    const r = await root.signRowShown(row);
    if (!helperLineShows(r.shown, 'root', digest12)) throw new ProvisionStop('helper-line-mismatch', `the helper's prompt line did not name ${digest12}; the signature is not used`);
    return r;
  }

  /** init | rotate | recover (the body of `gnomon identity init`): pre-checks on the record are the caller's. */
  async provision(req: ProvisionRequest): Promise<ProvisionOutcome> {
    const { mode, existing, name, host } = req;
    const home = this.#o.home;
    this.#budget = ROOT_PROMPT_BUDGET[mode];
    const pin = this.#pin();
    if ('ok' in pin) return pin;
    let helper = this.#startHelper(pin);
    const once = this.#o.once ? this.#o.once(pin) : helperOnceSync(pin);
    const gen = newGeneration();
    const created: Array<'root' | 'approvals'> = [];
    const moved: Array<{ from: string; to: string }> = [];
    let recordWritten = false;
    let release: (() => void) | null = null;
    try {
      release = acquireProvisionLock(home); // I8
      let now: IdentityRecord | null;
      try {
        now = readIdentity(home);
      } catch {
        now = null;
      }
      if ((now?.gen ?? null) !== (existing?.gen ?? null)) return this.#refuse('provisioning-raced', 'the identity of this home changed while this run was starting; run it again');
      // H4: what the Secure Enclave already holds decides what may happen
      const keys = await listHelperKeys(helper);
      const others = gensOf(keys.filter((k) => k.gen !== existing?.gen));
      if (others.length) return this.#refuse('keys-exist', `the Secure Enclave already holds Gnomon keys of generation(s) ${others.join(', ')}; remove them first: gnomon identity purge-keys --gen <gen>`, { gens: others });
      const oldRootHeld = existing ? keys.some((k) => k.gen === existing.gen && k.key === 'root') : false;
      let oldRoot: HardwareRootAuthority | null = null;
      if (mode === 'rotate') {
        if (!oldRootHeld) return this.#refuse('old-root-missing', `the old root (${existing!.rootKeyId}) is not in the Secure Enclave, so it cannot sign the rotation; if it is lost use: gnomon identity init --recover`);
        const pem = await helperPublicKey(helper, 'root', existing!.gen);
        if (!pem || p256KeyIdOfPem(pem) !== existing!.rootKeyId) return this.#refuse('old-root-mismatch', 'the Secure Enclave root of this generation does not match identity.json');
        oldRoot = new HardwareRootAuthority({ gen: existing!.gen, rootPublicKeyPem: existing!.rootPublicKeyPem }, { helper, once });
      }
      if (mode === 'recover' && keys.some((k) => k.gen === existing!.gen)) {
        return this.#refuse('old-root-present', `keys of the old generation ${existing!.gen} are still in the Secure Enclave: use --rotate (root present) or purge-keys --gen ${existing!.gen}`);
      }

      // rotate (H4/H2): the OLD root signs the statement that lets the helper create the new generation
      let rotation: { row: Record<string, unknown>; statement: string; sig: string } | null = null;
      if (oldRoot) {
        const row = { schemaVersion: 'gnomon-root-rotate:v1', fromKeyId: existing!.rootKeyId, fromGen: existing!.gen, toGen: gen, at: new Date().toISOString() };
        const s = await this.#rootSign(oldRoot, row, { n: 1, of: 1, purpose: 'rotate-statement' });
        rotation = { row, statement: s.statement, sig: s.helperSig };
      }

      // the Secure Enclave keys of the new generation (no prompt)
      const pubs: Record<'root' | 'approvals', string> = { root: '', approvals: '' };
      for (const k of ['root', 'approvals'] as const) {
        this.#step(`create-${k}`);
        const r = await helper.request({ op: 'key.create', key: k, gen, ...(rotation ? { rotate: { fromGen: existing!.gen, statement: rotation.statement, sig: rotation.sig } } : {}) });
        created.push(k);
        pubs[k] = pemOf(p256FromX963(String(r.publicKey)));
      }
      const root = new HardwareRootAuthority({ gen, rootPublicKeyPem: pubs.root }, { helper, once });
      const principalId = `p:${root.ns}/${name}`;

      // two root signatures, each with presence; nothing is written yet
      const row = { schemaVersion: APPROVALS_ROW_SCHEMA, keyId: p256KeyIdOfPem(pubs.approvals), publicKeyPem: pubs.approvals, principalId, gen };
      const b = await this.#rootSign(root, row, { n: 1, of: 2, purpose: 'approvals-binding' });
      const binding = { signer: b.signer, sig: b.sig };
      let device;
      try {
        device = loadDeviceKey(home);
      } catch {
        device = writeNewDeviceKey(home);
      }
      const deviceRow = deviceRowFor(root.ns, { host, name, principalKind: 'human', publicKeyPem: device.publicKeyPem });
      const d = await this.#rootSign(root, deviceRow, { n: 2, of: 2, purpose: 'device-row' });
      const deviceSig = { signer: d.signer, sig: d.sig };
      this.#step('commit');

      // commit: move the old record aside, write the new one, THEN the registry row (R3: no orphan row)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (existing) {
        for (const f of [identityPath(home), registryPath(home)]) {
          if (!fs.existsSync(f)) continue;
          const to = `${f}.${mode === 'rotate' ? 'rotated' : 'recovered'}-${stamp}`;
          fs.renameSync(f, to);
          moved.push({ from: f, to });
        }
      }
      const rec: IdentityRecord = {
        schemaVersion: IDENTITY_SCHEMA,
        gen,
        rootKeyId: root.rootKeyId,
        rootPublicKeyPem: pubs.root,
        ns: root.ns,
        approvals: { row, ...binding },
        principalId,
        deviceId: deviceRow.deviceId!,
        helperPath: pin.exe,
        createdAt: new Date().toISOString(),
        ...(existing && mode === 'rotate' ? { rotatedFrom: existing.rootKeyId } : {}),
        ...(existing && mode === 'recover' ? { recoveredFrom: existing.rootKeyId } : {}),
      };
      writeIdentity(home, rec);
      recordWritten = true; // I10: from here on, keys are never deleted (R2): the record names them
      this.#o.fault?.('registry');
      appendSignedRegistryRow(home, deviceRow, deviceSig);
      if (rotation) {
        appendIdentityJournal(home, { op: 'rotate', row: rotation.row, signer: existing!.rootKeyId, statement: rotation.statement, sig: rotation.sig });
        this.#emit({ type: 'step', step: 'logged', detail: { logged: 'identity.rotate', from: existing!.rootKeyId, to: root.rootKeyId, signedByOldRoot: true } });
      }
      if (mode === 'recover') {
        appendIdentityJournal(home, { op: 'recover', lostRoot: existing!.rootKeyId, lostNs: existing!.ns, newRoot: root.rootKeyId, newNs: root.ns, signedByLostRoot: false, at: rec.createdAt });
        this.#emit({ type: 'step', step: 'logged', detail: { logged: 'identity.recover', lost: existing!.rootKeyId, newRoot: root.rootKeyId, newNamespace: root.ns, signedByLostRoot: false } });
      }
      appendIdentityJournal(home, { op: mode === 'init' ? 'init' : mode === 'rotate' ? 'rotated' : 'recovered', gen, rootKeyId: root.rootKeyId, approvalsKeyId: row.keyId, principalId, deviceId: rec.deviceId, at: rec.createdAt });
      // Aegis round 3 (optional): retire the old generation's keys in the same run. Never automatic:
      // each delete is a fresh touch, and a decline or failure leaves the rotate itself done.
      let purgedOld: string[] | null = null;
      if (mode === 'rotate' && req.confirmPurgeOld && (await req.confirmPurgeOld())) {
        purgedOld = [];
        for (const k of ['approvals', 'root'] as const) {
          try {
            this.#emit({ type: 'presence', n: purgedOld.length + 1, of: 2, purpose: 'purge-old', digest12: null, key: k, gen: existing!.gen });
            await helper.request({ op: 'key.delete', key: k, gen: existing!.gen, reason: `Gnomon: delete the old ${k} key of generation ${existing!.gen}` }, 120_000);
            purgedOld.push(k);
          } catch {
            break; // reported: the remaining key stays, purge-keys can remove it later
          }
        }
        appendIdentityJournal(home, { op: 'purge', gen: existing!.gen, deleted: purgedOld, at: new Date().toISOString() });
      }
      return this.#done(
        {
          provisioned: true,
          home,
          rootKeyId: root.rootKeyId,
          ns: root.ns,
          principalId,
          deviceId: rec.deviceId,
          approvalsKeyId: row.keyId,
          helper: pin.exe,
          deviceKey: deviceKeyPath(home),
          mode,
          ...(mode === 'rotate' ? { retiredGen: existing!.gen, ...(purgedOld?.length === 2 ? { purgedOld } : { purge: `gnomon identity purge-keys --gen ${existing!.gen}`, ...(purgedOld ? { purgedOld } : {}) }) } : {}),
        },
        rec,
      );
    } catch (e) {
      if (e instanceof ProvisionStop && e.reason === 'provisioning-locked') return this.#refuse(e.reason, e.message, e.extra);
      let leftover: string | null = null;
      if (!recordWritten) {
        // R2: put the old record back exactly as it was
        for (const m of moved.reverse()) {
          try {
            fs.renameSync(m.to, m.from);
          } catch {
            /* reported below */
          }
        }
        // R4 / I9: remove the keys this attempt created — through the live helper (no prompt: it created them),
        // else through a FRESH helper, which asks for presence (H2)
        if (created.length) {
          if (!helper.alive) {
            try {
              helper = this.#startHelper(pin);
            } catch {
              /* reported below */
            }
          }
          let ok = true;
          for (const k of [...created].reverse()) {
            try {
              await helper.request({ op: 'key.delete', key: k, gen, reason: 'Gnomon: remove the keys of a failed identity init' });
            } catch {
              ok = false;
            }
          }
          if (!ok) leftover = gen;
        }
      }
      const reason = e instanceof Interrupted ? 'interrupted' : 'provision-failed';
      return this.#refuse(reason, e instanceof Error ? e.message : 'provisioning failed', {
        recordWritten,
        restored: !recordWritten && moved.length > 0,
        ...(leftover ? { leftoverGen: leftover, purge: `gnomon identity purge-keys --gen ${leftover}` } : { createdKeysDeleted: recordWritten ? [] : created }),
        ...(e instanceof ProvisionStop ? { stop: e.reason } : {}),
      });
    } finally {
      release?.();
      await helper.close().catch(() => undefined);
    }
  }

  /** I6: delete one generation's SE keys, each with fresh presence (H2). Never the live identity's (the caller checks). */
  async purgeGeneration(gen: string): Promise<ProvisionOutcome> {
    const pin = this.#pin();
    if ('ok' in pin) return pin;
    const helper = this.#startHelper(pin);
    let release: (() => void) | null = null;
    try {
      release = acquireProvisionLock(this.#o.home);
      const held = (await listHelperKeys(helper)).filter((k) => k.gen === gen);
      if (!held.length) return this.#refuse('not-found', `no Gnomon keys of generation ${gen} in the Secure Enclave`);
      const deleted: string[] = [];
      // approvals first, so the root of the generation is still there to sign the root's own delete statement
      const order = ['approvals', 'root'].filter((x) => held.some((h) => h.key === x));
      for (const k of order) {
        this.#emit({ type: 'presence', n: deleted.length + 1, of: order.length, purpose: 'purge', digest12: null, key: k, gen });
        await helper.request({ op: 'key.delete', key: k, gen, reason: `Gnomon: delete the ${k} key of generation ${gen}` }, 120_000);
        deleted.push(k);
      }
      appendIdentityJournal(this.#o.home, { op: 'purge', gen, deleted, at: new Date().toISOString() });
      return this.#done({ purged: true, gen, deleted });
    } catch (e) {
      if (e instanceof ProvisionStop) return this.#refuse(e.reason, e.message, e.extra);
      return this.#refuse('purge-failed', e instanceof Error ? e.message : 'purge failed');
    } finally {
      release?.();
      await helper.close().catch(() => undefined);
    }
  }

  /**
   * I10: finish a commit that crashed between identity.json and its registry
   * row. Opens the identity exactly as the daemon does (helper from
   * identity.json, pinned; SE keys and approvals binding verified), rebuilds
   * the device row from the record and the device key on disk (its deviceId
   * must be the record's), and signs it with ONE fresh root presence whose
   * digest the surface showed. Never deletes, never re-keys.
   */
  async completeDevice(): Promise<ProvisionOutcome> {
    const home = this.#o.home;
    this.#budget = ROOT_PROMPT_BUDGET.complete;
    let release: (() => void) | null = null;
    let hw: Awaited<ReturnType<typeof openHardwareIdentity>> = null;
    try {
      release = acquireProvisionLock(home);
      hw = await openHardwareIdentity(home, { ...(this.#o.verifier ? { verifier: this.#o.verifier } : {}), ...(this.#o.start ? { start: this.#o.start } : {}) });
      if (!hw) return this.#refuse('unprovisioned', `${home} has no identity to complete`);
      const rec = hw.record;
      const device = loadDeviceKey(home);
      const reg = readRegistry(home, hw.root);
      if (reg.rejected.length) return this.#refuse('registry-damaged', `${reg.rejected.length} registry row(s) do not verify against this home's root; not completing over them`);
      const have = reg.devices.get(rec.deviceId);
      if (have && have.keyId === device.keyId && have.principalId === rec.principalId && have.principalKind === 'human') return this.#refuse('nothing-to-complete', 'this device already has its registry row');
      if (have) return this.#refuse('device-conflict', 'a different registry row already names this device; re-provision with gnomon identity init --rotate');
      const name = rec.principalId.slice(`p:${rec.ns}/`.length);
      const host = rec.deviceId.slice(`dev:${rec.ns}/`.length);
      const row = deviceRowFor(rec.ns, { host, name, principalKind: 'human', publicKeyPem: device.publicKeyPem });
      if (row.deviceId !== rec.deviceId || row.principalId !== rec.principalId) return this.#refuse('device-conflict', 'the device row rebuilt from identity.json does not match it');
      const s = await this.#rootSign(hw.root as HardwareRootAuthority, row, { n: 1, of: 1, purpose: 'complete-device' });
      this.#step('commit');
      appendSignedRegistryRow(home, row, { signer: s.signer, sig: s.sig });
      appendIdentityJournal(home, { op: 'complete-device', deviceId: rec.deviceId, rootKeyId: rec.rootKeyId, at: new Date().toISOString() });
      return this.#done({ completed: true, home, deviceId: rec.deviceId, rootKeyId: rec.rootKeyId }, rec);
    } catch (e) {
      if (e instanceof ProvisionStop) return this.#refuse(e.reason, e.message, e.extra);
      return this.#refuse(e instanceof Interrupted ? 'interrupted' : 'complete-failed', e instanceof Error ? e.message : 'completing the device failed');
    } finally {
      release?.();
      await hw?.helper.close().catch(() => undefined);
    }
  }
}

/** The home's leftover generations: what the helper holds that is not this home's live identity (I6). */
export function leftoverGens(keys: readonly KeyEntry[], live: IdentityRecord | null): string[] {
  return gensOf(keys.filter((k) => k.gen !== live?.gen));
}

/** True when <home>/keys/identity.json exists in any form (lstat; a malformed one counts: shown, never replaced). */
export function hasIdentityFile(home: string): boolean {
  try {
    fs.lstatSync(path.join(home, 'keys', 'identity.json'));
    return true;
  } catch {
    return false;
  }
}
