/**
 * @symbol #session-runner
 *
 * The claude binary, pinned and privately copied (spec §3.3 Preflight
 * "refuse changed binary"; Aegis H1/N1, M1.7 rounds 2–3). A session must
 * never be able to swap the binary the kernel runs next.
 *
 *   TRUST ON FIRST USE: `<home>/claude-pin.json` holds the expected sha256.
 *     The first open whose sandboxed preflight PASSES pins it (commitPin, the
 *     supervisor logs `session.sandbox{phase:'binary-pin', by:'first-use'}`).
 *     Any other hash afterwards is refused `claude_binary_changed`; the human
 *     re-pins with `gnomon session repin-claude` (attended CLI: a terminal, a
 *     typed confirmation and a stopped daemon, until M1.3 presence). The
 *     re-pin record carries `{from, to, logged:false}`; the supervisor logs it
 *     `session.sandbox{phase:'binary-pin', by:'repin', from, to}` at the next
 *     open and marks it logged.
 *   PRIVATE COPY: the source is copied to `<home>/bin/` (dir 0700, file 0500;
 *     the `session` profile write-denies all of `<home>/**`) and the COPY is
 *     hashed — the bytes hashed are the bytes executed, preflight included.
 *     The copy is not re-hashed when its size and mtime match the pin record.
 *     Hashing streams (no event-loop stall on a 200 MB binary).
 *   KIND: only a self-contained native executable (Mach-O, ELF, PE) is
 *     accepted. A script (`#!`, e.g. the npm-installed cli.js with vendor/
 *     siblings) is refused `claude_binary_unsupported` — copying one file of a
 *     package would run without its siblings. `allowScripts` exists for the
 *     test rig's fake claude only (a kernel construction option, never wired
 *     by the daemon).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PreflightRefusal } from './preflight.js';

export const CLAUDE_PIN_SCHEMA = 'gnomon-claude-pin:v1' as const;
export const REPIN_COMMAND = 'gnomon session repin-claude';
/** TD-2026-10-19-063: the refusal's `next` while a daemon runs — the kernel pre-staged a re-pin card. */
export const REPIN_NEXT = 'approve the re-pin card';

export interface ClaudePin {
  schemaVersion: typeof CLAUDE_PIN_SCHEMA;
  sha256: string;
  source: string;
  pinnedAt: string;
  by: 'first-use' | 'repin';
  /** a re-pin: the previous sha */
  from?: string | null;
  /** the re-pin row has been written to the log */
  logged?: boolean;
  /** the private copy's identity (skip re-hashing when both match) */
  copy?: { path: string; size: number; mtimeMs: number };
  /** TD-2026-10-19-063: the publisher team the pinned copy's signature named (null: unsigned / unverified) */
  signer?: { team: string | null; verified: boolean };
  /** TD-2026-10-19-063: the re-pin card whose approval wrote this pin (its approval.decide row carries the cardId) */
  approval?: { cardId: string; contentHash: string; decisionSig?: string; rootSig?: { signer: string; sig: string } };
}

export const pinPath = (home: string): string => path.join(home, 'claude-pin.json');

export function readClaudePin(home: string): ClaudePin | null {
  try {
    const j = JSON.parse(fs.readFileSync(pinPath(home), 'utf8')) as ClaudePin;
    return j.schemaVersion === CLAUDE_PIN_SCHEMA && /^[0-9a-f]{64}$/.test(j.sha256) ? j : null;
  } catch {
    return null;
  }
}

export function writeClaudePin(home: string, pin: ClaudePin): void {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const tmp = `${pinPath(home)}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(pin, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, pinPath(home));
}

/**
 * The re-pin the CLI (offline) or the approved re-pin card (TD-2026-10-19-063) writes; logged by the
 * supervisor at the next open. `extra` carries the card's private copy, signer and approval record.
 */
export function repinClaudeBinary(home: string, sha256: string, source: string, extra: Pick<ClaudePin, 'copy' | 'signer' | 'approval'> = {}): ClaudePin {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError('#session-runner: a pin is a sha256 hex digest');
  const prev = readClaudePin(home);
  const pin: ClaudePin = { schemaVersion: CLAUDE_PIN_SCHEMA, sha256, source, pinnedAt: new Date().toISOString(), by: 'repin', from: prev?.sha256 ?? null, logged: false, ...extra };
  writeClaudePin(home, pin);
  return pin;
}

export async function sha256File(p: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export type BinaryKind = 'native' | 'script' | 'unknown';

/** Mach-O (incl. fat), ELF, PE ⇒ native; `#!` ⇒ script. */
export function binaryKind(p: string): BinaryKind {
  const fd = fs.openSync(p, 'r');
  try {
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    const hex = b.toString('hex');
    if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', '7f454c46'].includes(hex) || hex.startsWith('4d5a')) return 'native';
    if (hex.startsWith('2321')) return 'script';
    return 'unknown';
  } finally {
    fs.closeSync(fd);
  }
}

export interface PreparedClaude {
  /** the private copy the kernel executes */
  exec: string;
  sha256: string;
  source: string;
  pin: 'first-use' | 'match' | 'repin';
  /** a re-pin waiting for its log row (cardId: the re-pin card that approved it) */
  repin?: { from: string | null; to: string; cardId?: string };
}

/**
 * Copy the source to a private file, hash THE COPY, check kind and pin.
 * Writes no pin: commitPin does, after the sandboxed preflight passed (N1).
 */
export async function prepareClaude(home: string, sourceReal: string, opts: { allowScripts?: boolean } = {}): Promise<PreparedClaude> {
  const kind = binaryKind(sourceReal);
  if (kind !== 'native' && !(kind === 'script' && opts.allowScripts)) {
    throw new PreflightRefusal('claude_binary_unsupported', `the claude at ${sourceReal} is not a self-contained native executable (${kind}); install the native build (an npm cli.js needs its package)`, { kind });
  }
  const pin = readClaudePin(home);
  const dir = path.join(home, 'bin');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // fast path: the pinned private copy is unchanged on disk (size + mtime), and the source still hashes to the pin
  if (pin?.copy && fs.existsSync(pin.copy.path)) {
    const st = fs.statSync(pin.copy.path);
    if (st.size === pin.copy.size && st.mtimeMs === pin.copy.mtimeMs && (await sha256File(sourceReal)) === pin.sha256) {
      return { exec: pin.copy.path, sha256: pin.sha256, source: sourceReal, pin: pin.by === 'repin' && !pin.logged ? 'repin' : 'match', ...(pin.by === 'repin' && !pin.logged ? { repin: { from: pin.from ?? null, to: pin.sha256, ...(pin.approval ? { cardId: pin.approval.cardId } : {}) } } : {}) };
    }
  }
  const tmp = path.join(dir, `.claude-tmp-${process.pid}-${Date.now()}`);
  await fs.promises.copyFile(sourceReal, tmp, fs.constants.COPYFILE_EXCL);
  await fs.promises.chmod(tmp, 0o500);
  const digest = await sha256File(tmp); // the bytes hashed are the bytes executed
  if (pin && pin.sha256 !== digest) {
    await fs.promises.rm(tmp, { force: true });
    // TD-2026-10-19-063: the daemon pre-stages a re-pin card (the supervisor adds its cardId); offline the CLI is the raw form
    throw new PreflightRefusal('claude_binary_changed', `the claude binary differs from the pinned sha256 — approve the re-pin card in the Gnomon window (offline: \`${REPIN_COMMAND}\`)`, { expected: pin.sha256, found: digest, next: REPIN_NEXT });
  }
  const exec = path.join(dir, `claude-${digest.slice(0, 32)}`);
  await fs.promises.rm(exec, { force: true });
  await fs.promises.rename(tmp, exec);
  const state: PreparedClaude['pin'] = !pin ? 'first-use' : pin.by === 'repin' && !pin.logged ? 'repin' : 'match';
  return { exec, sha256: digest, source: sourceReal, pin: state, ...(state === 'repin' ? { repin: { from: pin!.from ?? null, to: digest, ...(pin!.approval ? { cardId: pin!.approval.cardId } : {}) } } : {}) };
}

/** After the sandboxed preflight passed: write the first-use pin / mark a re-pin logged; record the copy's identity. */
export function commitPin(home: string, p: PreparedClaude): void {
  const prev = readClaudePin(home);
  const st = fs.statSync(p.exec);
  const copy = { path: p.exec, size: st.size, mtimeMs: st.mtimeMs };
  if (!prev) writeClaudePin(home, { schemaVersion: CLAUDE_PIN_SCHEMA, sha256: p.sha256, source: p.source, pinnedAt: new Date().toISOString(), by: 'first-use', copy });
  else writeClaudePin(home, { ...prev, logged: true, copy });
}
