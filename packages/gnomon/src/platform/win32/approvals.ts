/**
 * @symbol #identity
 * @symbol #gnomon-helper
 *
 * The approvals key on Windows, W4 phase A (docs/plans/gnomon-windows.md, TD-2026-10-22-278 "approvals are hybrid").
 * gnomon-helper (approvals.rs) holds a P-256 key in the Microsoft Software KSP (per user, DPAPI-protected, not
 * exportable). The kernel drives it through the SAME HelperApprovalsKey as the darwin Secure Enclave key, over a
 * long-lived `gnomon-helper serve` (HelperProcess with the win32 env and info check), with `clickClass`: the cached
 * decision class (permission allow/deny, ask-user, plan) is a click, signed with no presence; fresh / root classes
 * need Windows Hello (phase B) and refuse until then.
 *
 * The binding (which human this key decides for) is a root-signed `gnomon-approvals-key:v1` row, as on darwin. A dev
 * home keeps it in DEV-ONLY-approvals.json, signed by the dev-test root (`ensureDevApprovals`, called by
 * `gnomon dev up` on win32): the first run creates the key and signs the row; every later run re-reads the helper's
 * public key and refuses a mismatch (a swapped key is not this human's). A click signature proves "this user's
 * session", never "a human was there" (any process of the user can use a DPAPI key): honest, and why the click
 * classes are the ROUTINE ones only. A dev home that is removed leaves its KSP key behind (named
 * gnomon-<gen>-approvals): `certutil -user -csp "Microsoft Software Key Storage Provider" -delkey <name>` removes it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HelperApprovalsKey, p256FromX963, p256KeyIdOfPem, pemOf } from '../../kernel/identity/hardware.js';
import { HelperProcess, HelperUnavailableError, SupervisedHelper, versionAtLeast, type HelperReply, type HelperTransport, type PinnedHelper } from '../../kernel/identity/helper.js';
import { APPROVALS_ROW_SCHEMA, helperPublicKey, type ApprovalsRow } from '../../kernel/identity/provision.js';
import type { RootAuthority } from '../../kernel/identity/root-authority.js';
import { kernelWin32Helper, type Win32HelperPin } from './helper-client.js';
import { isOwnerOnly } from '../owner-only.js';

/** The win32 helper's protocol and the first version with the approvals key ops. */
export const WIN32_HELPER_PROTOCOL = 'gnomon-helper:v2';
export const WIN32_APPROVALS_HELPER_VERSION = '0.3.0'; // 0.3.0: the Windows Hello presence key (W4 phase B)
export const DEV_APPROVALS_FILE = 'DEV-ONLY-approvals.json';

/** The win32 helper's handshake: protocol v2, platform win32, a version with the approvals ops. */
export function checkWin32HelperInfo(info: HelperReply): string {
  if (info.protocol !== WIN32_HELPER_PROTOCOL || info.platform !== 'win32') throw new HelperUnavailableError('version', `the helper speaks ${String(info.protocol)} on ${String(info.platform)}, not ${WIN32_HELPER_PROTOCOL} on win32`);
  if (!versionAtLeast(info.version, WIN32_APPROVALS_HELPER_VERSION)) throw new HelperUnavailableError('version', `helper ${String(info.version)} is older than ${WIN32_APPROVALS_HELPER_VERSION} (no approvals key ops)`);
  return info.version as string;
}

/** The helper's env: just what CNG and the loader need (SystemRoot, the profile dirs), nothing of the kernel's. */
export function win32HelperEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const pick = (k: string): string | undefined => Object.entries(from).find(([n]) => n.toUpperCase() === k)?.[1];
  const out: NodeJS.ProcessEnv = {};
  for (const k of ['SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SYSTEMDRIVE']) {
    const v = pick(k);
    if (v !== undefined) out[k === 'SYSTEMROOT' ? 'SystemRoot' : k] = v;
  }
  return out;
}

/** A PinnedHelper over the win32 sha256 pin (a dev kernel's unsigned helper; Authenticode is W7). */
function pinnedOf(pin: Win32HelperPin): PinnedHelper {
  return {
    exe: pin.exe,
    sha256: pin.sha256,
    verifier: { kind: 'dev-test', verify: () => pin.recheck(), verifyRunning: () => undefined },
    recheck: () => pin.recheck(),
  };
}

/** The long-lived win32 helper, restarted on demand (its stdin EOF ends it). */
export function win32HelperTransport(pin: Win32HelperPin = kernelWin32Helper()): HelperTransport {
  const p = pinnedOf(pin);
  return new SupervisedHelper(() => HelperProcess.start(p, { env: win32HelperEnv(), checkInfo: checkWin32HelperInfo }));
}

/** W4 phase B: the Windows Hello presence key's binding to the human (root-signed, beside the approvals row). */
export const PRESENCE_ROW_SCHEMA = 'gnomon-presence-key:v1' as const;
export interface PresenceRow {
  schemaVersion: typeof PRESENCE_ROW_SCHEMA;
  keyId: string;
  publicKeyPem: string;
  principalId: string;
  gen: string;
}

export interface Win32ApprovalsRecord {
  schemaVersion: 'gnomon-dev-approvals:v1';
  row: ApprovalsRow;
  signer: string;
  sig: string;
  /** W4 phase B: the Windows Hello presence key (absent: fresh / root classes stay refused) */
  presence?: { row: PresenceRow; signer: string; sig: string };
}

export class Win32ApprovalsError extends Error {
  constructor(message: string) {
    super(`#identity (win32 approvals): ${message}`);
    this.name = 'Win32ApprovalsError';
  }
}

/**
 * A dev home's approvals key: create it (first run: a fresh gen, the root-signed binding row) or reopen it (the
 * helper's public key must be the bound one). W4 phase B: with `presence`, the Windows Hello presence key of the same
 * gen is bound too (its creation is a Hello prompt; a cancelled or unavailable Hello leaves it unbound and the fresh /
 * root classes refused, logged in `presenceState`). Returns the HelperApprovalsKey (clickClass) and its transport.
 */
export async function ensureDevApprovals(
  home: string,
  root: Pick<RootAuthority, 'signRow' | 'verifyRow'>,
  principalId: string,
  helper: HelperTransport = win32HelperTransport(),
  o: { presence?: boolean } = {},
): Promise<{ approvals: HelperApprovalsKey; helper: HelperTransport; created: boolean; presenceState: 'bound' | 'created' | 'off' | `unavailable: ${string}` }> {
  const file = path.join(home, DEV_APPROVALS_FILE);
  let rec: Win32ApprovalsRecord | null = null;
  // Aegis W4-A L1: only ABSENT means "create": a record that cannot be read or parsed refuses (never a silent rebind)
  let text: string | null = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE} cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  if (text !== null) {
    if (!isOwnerOnly(file)) throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE} is not owner-only (the home's DACL must cover it)`);
    try {
      rec = JSON.parse(text) as Win32ApprovalsRecord;
    } catch {
      throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE} does not parse (remove it to bind a new key)`);
    }
  }
  let created = false;
  if (rec) {
    const r = rec.row;
    if (rec.schemaVersion !== 'gnomon-dev-approvals:v1' || r?.schemaVersion !== APPROVALS_ROW_SCHEMA || r.principalId !== principalId || !root.verifyRow(rec.signer, r, rec.sig)) throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE} is not this root's binding for ${principalId}`);
    if (p256KeyIdOfPem(r.publicKeyPem) !== r.keyId) throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE}: the approvals row's key and keyId disagree`); // Aegis W4-B L3
    const pem = await helperPublicKey(helper, 'approvals', r.gen);
    if (!pem || p256KeyIdOfPem(pem) !== r.keyId) throw new Win32ApprovalsError(`the helper's approvals key ${r.gen} is ${pem ? 'not the bound one' : 'missing'}`);
  } else {
    const gen = `dev-${randomBytes(6).toString('hex')}`;
    const reply = await helper.request({ op: 'key.create', key: 'approvals', gen });
    const pem = pemOf(p256FromX963(String(reply.publicKey)));
    const row: ApprovalsRow = { schemaVersion: APPROVALS_ROW_SCHEMA, keyId: p256KeyIdOfPem(pem), publicKeyPem: pem, principalId, gen };
    const { signer, sig } = root.signRow(row);
    rec = { schemaVersion: 'gnomon-dev-approvals:v1', row, signer, sig };
    // 'wx': two dev kernels racing never both bind; the home's owner-only DACL (ensureGnomonHome) is the file's ACL
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, { flag: 'wx' });
    created = true;
  }
  // W4 phase B: the presence key (a separate Passport-KSP key, same gen)
  let presenceState: 'bound' | 'created' | 'off' | `unavailable: ${string}` = 'off';
  if (rec.presence) {
    const pr = rec.presence.row;
    if (pr?.schemaVersion !== PRESENCE_ROW_SCHEMA || pr.principalId !== principalId || pr.gen !== rec.row.gen || !root.verifyRow(rec.presence.signer, pr, rec.presence.sig)) throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE}: the presence binding is not this root's for ${principalId}`);
    if (p256KeyIdOfPem(pr.publicKeyPem) !== pr.keyId) throw new Win32ApprovalsError(`${DEV_APPROVALS_FILE}: the presence row's key and keyId disagree`); // Aegis W4-B L3
    const r = await helper.request({ op: 'key.public', key: 'presence', gen: pr.gen }).catch((e: unknown) => e);
    const pem = r instanceof Error ? null : pemOf(p256FromX963(String((r as HelperReply).publicKey)));
    if (!pem || p256KeyIdOfPem(pem) !== pr.keyId) throw new Win32ApprovalsError(`the helper's presence key ${pr.gen} is ${pem ? 'not the bound one' : 'missing'}`);
    presenceState = 'bound';
  } else if (o.presence) {
    try {
      const reply = await helper.request({ op: 'key.create', key: 'presence', gen: rec.row.gen, reason: 'Gnomon: set up Windows Hello for sensitive approvals' }, 300_000);
      const pem = pemOf(p256FromX963(String(reply.publicKey)));
      const row: PresenceRow = { schemaVersion: PRESENCE_ROW_SCHEMA, keyId: p256KeyIdOfPem(pem), publicKeyPem: pem, principalId, gen: rec.row.gen };
      const { signer, sig } = root.signRow(row);
      rec = { ...rec, presence: { row, signer, sig } };
      // replace the record atomically (the approvals binding in it is unchanged)
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, { flag: 'wx' });
        fs.renameSync(tmp, file);
      } finally {
        fs.rmSync(tmp, { force: true }); // the tmp never outlives a failure
      }
      presenceState = 'created';
    } catch (e) {
      // Aegis W4-B L2: a key created but not bound (a crash, a failed rename) answers `exists` on every retry: say how to clear it
      const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
      presenceState = `unavailable: ${msg}${/exists/.test(msg) ? ` (an unbound Windows Hello key //gnomon.local/${rec.row.gen}/presence exists: remove it with certutil -user -csp "Microsoft Passport Key Storage Provider" -delkey, then restart)` : ''}`;
    }
  }
  const approvals = new HelperApprovalsKey({ gen: rec.row.gen, approvalsPublicKeyPem: rec.row.publicKeyPem }, principalId, helper, {
    clickClass: true,
    ...(rec.presence ? { presencePublicKeyPem: rec.presence.row.publicKeyPem } : {}),
  });
  return { approvals, helper, created, presenceState };
}
