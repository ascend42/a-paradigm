/**
 * @symbol #update-watch
 *
 * The gnomon build stamp (TD-2026-10-19-063, flow 2 "detect"). The build
 * writes dist/build-id.json (scripts/build-stamp.mjs); at boot the kernel
 * records what it LOADED in `<home>/kernel-build.json` (0600) so a launcher
 * (`gnomon`, bare-cli.ts) can tell a stale kernel from a current one, and
 * #update-watch polls the on-disk stamp for a change.
 *
 * A stamp is DATA, never authority: a changed stamp only raises the upgrade
 * card, which the human accepts with fresh presence (F3). A missing or
 * malformed stamp is `null` (a dev tree, a test run): nothing is watched.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildStamp {
  schemaVersion: 'gnomon-build:v1';
  version: string;
  commit: string;
  distHash: string;
  guiBundleHash: string | null;
  /** Aegis V2e M2: sha256 of the gnomon-voice dist/voice-client.manifest.json this build was made with */
  voiceClientManifest?: string | null;
}

export const KERNEL_BUILD_FILE = 'kernel-build.json';
const MAX_STAMP_BYTES = 4096;
const SHORT = /^[\x20-\x7e]{1,80}$/;

/** Where the running bundle's stamp lives: dist/cli/<entry>.js → dist/build-id.json (src under tests: absent ⇒ null). */
export function defaultBuildStampPath(): string {
  return fileURLToPath(new URL('../build-id.json', import.meta.url));
}

export function parseBuildStamp(raw: unknown): BuildStamp | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 'gnomon-build:v1') return null;
  if (typeof o.version !== 'string' || !SHORT.test(o.version)) return null;
  if (typeof o.commit !== 'string' || !SHORT.test(o.commit)) return null;
  if (typeof o.distHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(o.distHash)) return null;
  const g = o.guiBundleHash ?? null;
  if (g !== null && (typeof g !== 'string' || !SHORT.test(g))) return null;
  const v = o.voiceClientManifest;
  if (v !== undefined && v !== null && (typeof v !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(v))) return null;
  return { schemaVersion: 'gnomon-build:v1', version: o.version, commit: o.commit, distHash: o.distHash, guiBundleHash: g, ...(typeof v === 'string' ? { voiceClientManifest: v } : {}) };
}

/** Read a stamp file; null when absent, oversized or malformed (never throws). */
export function readBuildStamp(file: string): BuildStamp | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_STAMP_BYTES) return null;
    return parseBuildStamp(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** Two stamps name the same build (the shipped bytes are equal). null never equals anything. The voice client's
 * manifest counts too: the kernel pins the client at boot, so a rebuilt client is picked up only by a restart
 * (founder dogfood 2026-10-19: a voice-only fix raised no upgrade card). */
export function sameBuild(a: BuildStamp | null, b: BuildStamp | null): boolean {
  return a !== null && b !== null && buildKey(a) === buildKey(b);
}

/** The identity of a build for change detection: kernel dist, GUI bundle and voice client manifest. */
export function buildKey(s: BuildStamp): string {
  return `${s.distHash}|${s.guiBundleHash ?? '-'}|${s.voiceClientManifest ?? '-'}`;
}

/** The card line's summary: `v→v′ (commit)`. */
export function describeUpdate(from: BuildStamp | null, to: BuildStamp): string {
  return `${from?.version ?? 'unknown'}→${to.version} (${to.commit})`;
}

export interface KernelBuildRecord {
  schemaVersion: 'gnomon-kernel-build:v1';
  stamp: BuildStamp | null;
  pid: number;
  startedAt: string;
}

/** Write `<home>/kernel-build.json` at 0600 (tmp + rename; the mode is re-applied, never left to a umask). */
export function writeKernelBuild(home: string, rec: Omit<KernelBuildRecord, 'schemaVersion'>): void {
  const file = path.join(home, KERNEL_BUILD_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 'gnomon-kernel-build:v1', ...rec })}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function readKernelBuild(home: string): KernelBuildRecord | null {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(home, KERNEL_BUILD_FILE), 'utf8')) as Record<string, unknown>;
    if (o.schemaVersion !== 'gnomon-kernel-build:v1' || typeof o.pid !== 'number' || typeof o.startedAt !== 'string') return null;
    return { schemaVersion: 'gnomon-kernel-build:v1', stamp: parseBuildStamp(o.stamp), pid: o.pid, startedAt: o.startedAt };
  } catch {
    return null;
  }
}
