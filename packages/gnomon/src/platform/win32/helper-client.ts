/**
 * @symbol #gnomon-helper
 *
 * The kernel's side of the Windows platform helper (`packages/gnomon-helper/win32`, Rust, P8-D71;
 * docs/plans/gnomon-windows.md W2/W3): owner-only DACLs on the home and the kernel pipe, the job-object launcher,
 * durable rename, the boot id and the ShellExecute hand-off. Same NDJSON envelope as the darwin helper
 * (`gnomon-helper:v2`). The approval-capable key ops (Windows Hello) are W4 and are NOT reached through this client.
 *
 * TRUST BEFORE SPAWN, as identity/helper.ts: the path is resolved once (realpathSync.native, never PATH), must be a
 * regular file named *.exe, is hashed, and is RE-HASHED before every spawn, so a binary swapped after the pin is
 * refused. Signature: a RELEASE kernel requires the Authenticode-signed helper its release manifest pins; until W7
 * (Trusted Signing) no Windows release pins one, so a release kernel refuses (`unsigned`). A DEV kernel (no release
 * manifest: the repo build, `gnomon dev …`) runs the repo-built helper pinned by sha256 only, and says so
 * (`pin.signed === false`, surfaced by status). Fail closed: a missing or changed helper throws Win32HelperError.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactPin, loadedReleasePins, type ReleasePins } from '../../kernel/lifecycle/release-pins.js';
import { win32SystemRoot } from './system-root.js';

export const WIN32_HELPER_PROTOCOL = 'gnomon-helper:v2';
export const WIN32_HELPER_EXE = 'gnomon-helper.exe';
const OP_TIMEOUT_MS = 15_000;
const MAX_REPLY_BYTES = 1 << 20;

export type Win32HelperErrorKind = 'missing' | 'not-a-file' | 'changed' | 'unsigned' | 'spawn' | 'timeout' | 'protocol' | 'refused';

export class Win32HelperError extends Error {
  constructor(
    readonly kind: Win32HelperErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(`gnomon-helper (win32): ${message}`);
    this.name = 'Win32HelperError';
  }
}

export type HelperReply = Record<string, unknown> & { ok: true };

export interface Win32HelperPin {
  readonly exe: string;
  readonly sha256: string;
  /** false: a dev kernel running the repo-built, unsigned helper (sha256 pin only). */
  readonly signed: boolean;
  /** Throws Win32HelperError('changed') unless the file still is the pinned bytes. */
  recheck(): void;
}

interface Facts {
  size: number;
  mtimeMs: number;
  sha256: string;
}

function facts(exe: string): Facts {
  const st = fs.statSync(exe);
  return { size: st.size, mtimeMs: st.mtimeMs, sha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex') };
}

/**
 * The helper next to this kernel: the release layout (`<app>\helper\gnomon-helper.exe`, W6) first, then the monorepo
 * / install (`packages/gnomon-helper/bin/win32`, built by packages/gnomon-helper/scripts/build-win32.mjs).
 */
export function defaultWin32HelperPath(metaUrl: string = import.meta.url): string {
  const dir = path.dirname(fileURLToPath(metaUrl));
  const cands: string[] = [];
  // Aegis L6: only the layouts that exist: the release app (<app>\kernel\dist → <app>\helper), the monorepo
  // (packages/gnomon/dist[/chunks] or src/platform/win32 → packages/gnomon-helper/bin/win32), an npm install
  for (const up of ['..', '../..', '../../..']) {
    cands.push(path.resolve(dir, up, '..', 'helper', WIN32_HELPER_EXE));
    cands.push(path.resolve(dir, up, '..', 'gnomon-helper', 'bin', 'win32', WIN32_HELPER_EXE));
    cands.push(path.resolve(dir, up, 'node_modules', '@a-company', 'gnomon-helper', 'bin', 'win32', WIN32_HELPER_EXE));
  }
  return cands.find((c) => fs.existsSync(c)) ?? path.resolve(dir, '../../..', 'gnomon-helper', 'bin', 'win32', WIN32_HELPER_EXE);
}

export function pinWin32Helper(exePath: string, o: { pins?: ReleasePins } = {}): Win32HelperPin {
  let exe: string;
  try {
    exe = fs.realpathSync.native(exePath);
  } catch {
    throw new Win32HelperError('missing', `no helper at ${exePath} (build it: node packages/gnomon-helper/scripts/build-win32.mjs)`);
  }
  if (!fs.statSync(exe).isFile() || !exe.toLowerCase().endsWith('.exe')) throw new Win32HelperError('not-a-file', `${exe} is not an .exe file`);
  const pin = artifactPin(o.pins ?? loadedReleasePins(), 'gnomon-helper', process.arch);
  if (pin.kind !== 'dev') {
    // W7: a release pins the Authenticode-signed helper; none does yet, so a release kernel never runs an unsigned one
    throw new Win32HelperError('unsigned', pin.kind === 'refuse' ? pin.why : 'Windows releases do not ship a signed helper yet (W7)');
  }
  const pinned = facts(exe);
  return Object.freeze({
    exe,
    sha256: pinned.sha256,
    signed: false,
    recheck(): void {
      let now: Facts;
      try {
        if (fs.realpathSync.native(exePath) !== exe) throw new Error('moved');
        now = facts(exe);
      } catch {
        throw new Win32HelperError('changed', `${exe} moved or vanished after it was pinned`);
      }
      if (now.sha256 !== pinned.sha256 || now.size !== pinned.size) throw new Win32HelperError('changed', `${exe} changed after it was pinned`);
    },
  });
}

/** The env a helper runs with: only what Windows needs to load a process (no GNOMON_*, no NODE_OPTIONS). */
function helperEnv(): NodeJS.ProcessEnv {
  const sys = win32SystemRoot();
  return { SystemRoot: sys, PATH: path.win32.join(sys, 'System32') };
}

function parse(line: string): HelperReply {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    throw new Win32HelperError('protocol', 'the helper answered something that is not JSON');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Win32HelperError('protocol', 'the helper answered a non-object');
  const o = v as Record<string, unknown>;
  if (o.ok !== true) {
    const code = typeof o.error === 'string' ? o.error.slice(0, 64) : 'unknown';
    throw new Win32HelperError('refused', `${code}: ${typeof o.message === 'string' ? o.message.slice(0, 300) : ''}`, code);
  }
  return o as HelperReply;
}

/** One op through `gnomon-helper once`, synchronously (start-up paths: home ACL, boot id). */
export function helperOpSync(pin: Win32HelperPin, op: string, args: Record<string, unknown> = {}, timeoutMs = OP_TIMEOUT_MS): HelperReply {
  pin.recheck();
  const r = spawnSync(pin.exe, ['once'], { input: `${JSON.stringify({ id: 1, op, ...args })}\n`, encoding: 'utf8', timeout: timeoutMs, env: helperEnv(), windowsHide: true, maxBuffer: MAX_REPLY_BYTES });
  if (r.error) throw new Win32HelperError((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : 'spawn', r.error.message);
  return parse((r.stdout ?? '').split('\n').find((l) => l.trim() !== '') ?? '');
}

/** One op, asynchronously: the event loop keeps running (pipe.secure connects to the kernel's own pipe). */
export function helperOp(pin: Win32HelperPin, op: string, args: Record<string, unknown> = {}, timeoutMs = OP_TIMEOUT_MS): Promise<HelperReply> {
  return new Promise((resolve, reject) => {
    try {
      pin.recheck();
    } catch (e) {
      reject(e);
      return;
    }
    const child = spawn(pin.exe, ['once'], { env: helperEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Win32HelperError('timeout', `${op} took longer than ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (out.length < MAX_REPLY_BYTES) out += d;
    });
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(new Win32HelperError('spawn', e.message));
    });
    child.once('close', () => {
      clearTimeout(timer);
      try {
        resolve(parse(out.split('\n').find((l) => l.trim() !== '') ?? ''));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.on('error', () => {}); // Aegis L7: an early helper exit must not crash the kernel with EPIPE
    child.stdin.end(`${JSON.stringify({ id: 1, op, ...args })}\n`);
  });
}

/** argv for running `exe` under the job-object launcher (`gnomon-helper exec -- <exe> …`, G-RUN-03). */
export function jobLaunch(pin: Win32HelperPin, exe: string, args: readonly string[]): { command: string; args: string[] } {
  pin.recheck();
  return { command: pin.exe, args: ['exec', '--', exe, ...args] };
}

let processPin: Win32HelperPin | null = null;
/** The kernel process's helper, pinned on first use (default path; tests pass their own pin to the functions above). */
export function kernelWin32Helper(): Win32HelperPin {
  processPin ??= pinWin32Helper(defaultWin32HelperPath());
  return processPin;
}
/** Test seam: replace (or clear) the process pin. */
export function setKernelWin32HelperForTests(pin: Win32HelperPin | null): void {
  processPin = pin;
}
