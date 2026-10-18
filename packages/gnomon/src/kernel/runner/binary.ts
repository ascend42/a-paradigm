/**
 * @symbol #session-runner
 *
 * The claude binary, pinned and privately copied (spec §3.3 Preflight
 * "refuse changed binary"; Aegis H1, M1.7 round 2). A session must never be
 * able to swap the binary the kernel runs next:
 *
 *   pin — `<home>/claude-pin.json` holds the expected sha256. First use pins
 *     it (the supervisor logs the pin); any other hash afterwards is refused
 *     `claude_binary_changed`. A human re-pins EXPLICITLY (repinClaudeBinary:
 *     the CLI / test seam until the M1.6 gate-class card exists); nothing
 *     re-pins on its own.
 *   private copy — the verified bytes (hashed from the SAME buffer that is
 *     written) go to `<home>/bin/claude-<sha>` (dir 0700, file 0500), which
 *     the `session` profile write-denies (all of `<home>/**`). The kernel
 *     executes that copy — preflight included — so there is no window between
 *     hashing the source and executing it. The copy is re-hashed before each
 *     use; a mismatch is refused.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PreflightRefusal } from './preflight.js';

export const CLAUDE_PIN_SCHEMA = 'gnomon-claude-pin:v1' as const;

export interface ClaudePin {
  schemaVersion: typeof CLAUDE_PIN_SCHEMA;
  sha256: string;
  source: string;
  pinnedAt: string;
  by: 'first-use' | 'repin';
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export const pinPath = (home: string): string => path.join(home, 'claude-pin.json');

export function readClaudePin(home: string): ClaudePin | null {
  try {
    const j = JSON.parse(fs.readFileSync(pinPath(home), 'utf8')) as ClaudePin;
    return j.schemaVersion === CLAUDE_PIN_SCHEMA && /^[0-9a-f]{64}$/.test(j.sha256) ? j : null;
  } catch {
    return null;
  }
}

function writePin(home: string, pin: ClaudePin): void {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const tmp = `${pinPath(home)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(pin, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, pinPath(home));
}

/** The explicit human re-pin (CLI / test seam until the gate-class card, M1.6). */
export function repinClaudeBinary(home: string, sha256: string, source: string): ClaudePin {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError('#session-runner: a pin is a sha256 hex digest');
  const pin: ClaudePin = { schemaVersion: CLAUDE_PIN_SCHEMA, sha256, source, pinnedAt: new Date().toISOString(), by: 'repin' };
  writePin(home, pin);
  return pin;
}

export interface PrivateClaude {
  /** the private copy the kernel executes */
  exec: string;
  sha256: string;
  pin: 'first-use' | 'match';
}

/** Read the source ONCE, check/establish the pin, write (or reuse) the private copy, re-verify it. */
export function privateClaude(home: string, sourceReal: string): PrivateClaude {
  const bytes = fs.readFileSync(sourceReal);
  const digest = sha(bytes);
  const pin = readClaudePin(home);
  let state: PrivateClaude['pin'] = 'match';
  if (!pin) {
    writePin(home, { schemaVersion: CLAUDE_PIN_SCHEMA, sha256: digest, source: sourceReal, pinnedAt: new Date().toISOString(), by: 'first-use' });
    state = 'first-use';
  } else if (pin.sha256 !== digest) {
    throw new PreflightRefusal('claude_binary_changed', 'the claude binary differs from the pinned sha256 (a human re-pins explicitly)', { expected: pin.sha256, found: digest });
  }
  const dir = path.join(home, 'bin');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const exec = path.join(dir, `claude-${digest.slice(0, 32)}`);
  let ok = false;
  try {
    ok = sha(fs.readFileSync(exec)) === digest;
  } catch {
    ok = false;
  }
  if (!ok) {
    const tmp = `${exec}.tmp-${process.pid}-${Date.now()}`;
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o700);
    try {
      fs.writeSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tmp, 0o500);
    fs.rmSync(exec, { force: true });
    fs.renameSync(tmp, exec);
    if (sha(fs.readFileSync(exec)) !== digest) throw new PreflightRefusal('claude_binary_changed', 'the private claude copy does not hash to the verified bytes', {});
  }
  return { exec, sha256: digest, pin: state };
}
