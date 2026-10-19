/**
 * @symbol #gnomon-voice
 *
 * Voice speaker enrolment and the voice device key (spec §14.4, §4.10 `voice.enrol` / `voice.forget`; voice slice
 * V1, T-2026-10-19-026).
 *
 *   - `gnomon voice setup` writes the voice device key (`<home>/keys/voice.key`, 0600, O_EXCL) and registers it with a
 *     ROOT-SIGNED registry row under `p:<ns>/voice`, principalKind `voice` (registry.ts already accepts it).
 *   - `gnomon voice enrol <name> --consent <text>` / `gnomon voice forget <name>` append ROOT-SIGNED rows to
 *     `<home>/voice/enrolments.jsonl`: `{schemaVersion, op: 'enrol'|'forget', speakerId, consent?, printRef?, at}`.
 *     A forget deletes the print file under `<home>/voice/prints/` (sensitivity secret; it never leaves the box).
 *   - Reading is fail-closed: a row whose signature the trust set does not verify, an unparseable line or a malformed
 *     row never counts; the LATEST verified row per speakerId wins (forget after enrol ⇒ not enrolled).
 *
 * The kernel log carries the matching `voice.enrol` / `voice.forget` events (written by the daemon when it sees a
 * new row; not in this slice) — the file is the authority the forwarding guard reads (VoiceControl.enrolled).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RootAuthority } from '../identity/root-authority.js';
import type { RowVerifier } from '../identity/registry.js';
import { appendSignedRegistryRow, deviceRowFor, type DeviceEntry } from '../identity/registry.js';
import { ensureKeysDir, keysDir, writeNewDeviceKey } from '../identity/device-key.js';

export const VOICE_ENROL_ROW_SCHEMA = 'voiceEnrolRow:v1' as const;
export const VOICE_KEY_FILE = 'voice.key';
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface VoiceEnrolRow {
  schemaVersion: typeof VOICE_ENROL_ROW_SCHEMA;
  op: 'enrol' | 'forget';
  speakerId: string;
  consent?: string;
  printRef?: string;
  at: string;
}

export function voiceDir(home: string): string {
  return path.join(home, 'voice');
}
export function enrolmentsPath(home: string): string {
  return path.join(voiceDir(home), 'enrolments.jsonl');
}
export function printsDir(home: string): string {
  return path.join(voiceDir(home), 'prints');
}
export function voiceKeyPath(home: string): string {
  return path.join(keysDir(home), VOICE_KEY_FILE);
}

/** `spk:<ns>/<name>` for a speaker name (lowercase, ≤ 64). Throws on a bad name. */
export function speakerIdFor(ns: string, name: string): string {
  if (!NAME.test(name)) throw new TypeError('#gnomon-voice: a speaker name is [a-z0-9][a-z0-9._-]{0,63}');
  return `spk:${ns}/${name}`;
}

async function sign(root: RootAuthority, row: unknown): Promise<{ signer: string; sig: string }> {
  return root.signRowAsync ? root.signRowAsync(row) : root.signRow(row);
}

function appendLine(home: string, line: unknown): void {
  fs.mkdirSync(voiceDir(home), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(enrolmentsPath(home), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(line)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Root-signed enrolment of a speaker (recorded consent). */
export async function enrolSpeaker(home: string, root: RootAuthority, p: { name: string; consent: string; printRef?: string; now?: Date }): Promise<VoiceEnrolRow> {
  if (root.ns === null) root.signRow(null); // refuses with the unprovisioned-root refusal
  if (typeof p.consent !== 'string' || p.consent.trim().length === 0 || p.consent.length > 1024) throw new TypeError('#gnomon-voice: enrolment needs recorded consent (1..1024 chars)');
  const row: VoiceEnrolRow = { schemaVersion: VOICE_ENROL_ROW_SCHEMA, op: 'enrol', speakerId: speakerIdFor(root.ns!, p.name), consent: p.consent, ...(p.printRef ? { printRef: p.printRef } : {}), at: (p.now ?? new Date()).toISOString() };
  appendLine(home, { row, ...(await sign(root, row)) });
  return row;
}

/** Root-signed deletion of a speaker; removes its print file (if any). */
export async function forgetSpeaker(home: string, root: RootAuthority, p: { name: string; now?: Date }): Promise<VoiceEnrolRow> {
  if (root.ns === null) root.signRow(null);
  const row: VoiceEnrolRow = { schemaVersion: VOICE_ENROL_ROW_SCHEMA, op: 'forget', speakerId: speakerIdFor(root.ns!, p.name), at: (p.now ?? new Date()).toISOString() };
  appendLine(home, { row, ...(await sign(root, row)) });
  fs.rmSync(path.join(printsDir(home), p.name), { recursive: true, force: true });
  return row;
}

/** The enrolled speakerIds (latest verified row per speaker wins). Never throws on content. */
export function readEnrolled(home: string, trust: RowVerifier): Set<string> {
  let text = '';
  try {
    text = fs.readFileSync(enrolmentsPath(home), 'utf8');
  } catch {
    return new Set();
  }
  const latest = new Map<string, 'enrol' | 'forget'>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const { row, signer, sig } = o as { row?: Partial<VoiceEnrolRow>; signer?: unknown; sig?: unknown };
    if (!row || row.schemaVersion !== VOICE_ENROL_ROW_SCHEMA || (row.op !== 'enrol' && row.op !== 'forget') || typeof row.speakerId !== 'string') continue;
    if (typeof signer !== 'string' || typeof sig !== 'string' || !trust.verifyRow(signer, row, sig)) continue;
    latest.set(row.speakerId, row.op);
  }
  return new Set([...latest].filter(([, op]) => op === 'enrol').map(([id]) => id));
}

/** `gnomon voice setup`: write the voice device key and register it (root-signed) as `p:<ns>/voice`. */
export async function setupVoiceDevice(home: string, root: RootAuthority, p: { host: string; now?: Date }): Promise<DeviceEntry> {
  if (root.ns === null) root.signRow(null);
  ensureKeysDir(home);
  const signer = writeNewDeviceKey(home, voiceKeyPath(home));
  const row = deviceRowFor(root.ns!, { host: `${p.host}-voice`.slice(0, 63), name: 'voice', principalKind: 'voice', publicKeyPem: signer.publicKeyPem, ...(p.now ? { now: p.now } : {}) });
  appendSignedRegistryRow(home, row, await sign(root, row));
  return { deviceId: row.deviceId!, principalId: row.principalId!, principalKind: row.principalKind!, keyId: row.keyId, publicKeyPem: row.publicKeyPem };
}
