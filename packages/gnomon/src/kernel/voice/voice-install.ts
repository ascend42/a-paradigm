/**
 * @symbol #gnomon-voice
 *
 * Installing the voice app before the kernel spawns it (voice slice V2e; Aegis V2c must-dos 6, 7).
 *
 *   - GnomonVoiceIO.app cannot run from ~/Documents (TCC), so the kernel copies it with `ditto` into its own 0700
 *     directory `<home>/bin/voice/` (staged, then renamed into place) and VERIFIES THE COPY before every spawn:
 *     `codesign --verify --strict --deep` against the designated requirement — Developer ID, identifier
 *     `gnomon.voice-io`, team `SW4BMQ8PNL`. An unsigned or mismatched binary is REFUSED. A dev build may run
 *     unsigned only with the explicit dev flag (daemon option voice.client.devUnsigned), which the GUI shows loud.
 *   - Models: the kernel runs the client's own `models fetch --json` (pinned manifest, sha256 of every archive and
 *     every member) as a short child with the same allow-list env, and turns its progress lines into the GUI phase
 *     "Downloading voice models (N MB)…". First start therefore needs no terminal step.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { DISABLE_SIGUSR1 } from '../lifecycle/env.js';
import { voiceChildEnv, type VoicePrepared } from './voice-child.js';

export const VOICE_IO_TEAM = 'SW4BMQ8PNL';
export const VOICE_IO_IDENTIFIER = 'gnomon.voice-io';
export const VOICE_IO_REQUIREMENT = `anchor apple generic and identifier "${VOICE_IO_IDENTIFIER}" and certificate leaf[subject.OU] = "${VOICE_IO_TEAM}"`;
export const VOICE_APP_NAME = 'GnomonVoiceIO.app';
export const VOICE_IO_IN_APP = 'Contents/MacOS/gnomon-voice-io';

export function voiceBinDir(home: string): string {
  return path.join(home, 'bin', 'voice');
}

/**
 * The client entry (gnomon-voice dist/cli.js), darwin only; null with a plain reason otherwise. Resolved LAZILY at
 * daemon start, never imported: @a-company/gnomon-voice is not a dependency of the kernel (G-SEC-01, zero runtime
 * dependencies). Looked for, in order: an installed package next to the kernel (node_modules/@a-company/gnomon-voice)
 * walking up from this file, then the workspace sibling (packages/gnomon-voice). Any other OS: unavailable.
 */
export function resolveVoiceClientEntry(platform: NodeJS.Platform = process.platform, from: string = fileURLToPath(import.meta.url)): { entry: string | null; reason?: string } {
  if (platform !== 'darwin') return { entry: null, reason: 'voice runs on macOS only for now' };
  let found: string | null = null;
  let packaged = false;
  for (let dir = path.dirname(from); ; dir = path.dirname(dir)) {
    for (const c of [path.join(dir, 'node_modules', '@a-company', 'gnomon-voice'), path.join(dir, 'gnomon-voice')]) {
      if (found === null && isVoicePackage(c)) {
        packaged = true;
        if (fs.existsSync(path.join(c, 'dist', 'cli.js'))) found = path.join(c, 'dist', 'cli.js');
      }
    }
    if (found !== null || path.dirname(dir) === dir) break;
  }
  if (found !== null) return { entry: found };
  return { entry: null, reason: packaged ? 'the voice client is not built' : 'the voice client is not installed' };
}

function isVoicePackage(dir: string): boolean {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown }).name === '@a-company/gnomon-voice';
  } catch {
    return false;
  }
}

export type CodesignCheck = (app: string, requirement: string) => { ok: boolean; detail: string };

export const codesignCheck: CodesignCheck = (app, requirement) => {
  const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', `-R=${requirement}`, app], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  return { ok: r.status === 0, detail: `${r.stderr ?? ''}`.trim().split('\n').at(-1) ?? '' };
};

function ensurePrivateDir(d: string): void {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(d);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`${d} is not a directory`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`${d} is not owned by this user`);
  fs.chmodSync(d, 0o700);
}

/**
 * Copy `sourceApp` into `<home>/bin/voice/` with ditto (staged + renamed) and verify the COPY. Returns the binary
 * inside the copy. Throws a plain-words Error when the signature or designated requirement does not hold and the
 * dev flag is off.
 */
export function installVoiceApp(o: { home: string; sourceApp: string; devUnsigned: boolean; check?: CodesignCheck; ditto?: (src: string, dst: string) => void }): VoicePrepared {
  if (!fs.existsSync(path.join(o.sourceApp, VOICE_IO_IN_APP))) throw new Error('The voice app is not built yet (GnomonVoiceIO.app is missing).');
  const dir = voiceBinDir(o.home);
  ensurePrivateDir(path.dirname(dir));
  ensurePrivateDir(dir);
  const dest = path.join(dir, VOICE_APP_NAME);
  const staging = path.join(dir, `.${VOICE_APP_NAME}.staging`);
  fs.rmSync(staging, { recursive: true, force: true });
  const ditto = o.ditto ?? ((src, dst) => {
    const r = spawnSync('/usr/bin/ditto', [src, dst], { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
    if (r.status !== 0) throw new Error(`could not copy the voice app (${String(r.stderr).trim()})`);
  });
  ditto(o.sourceApp, staging);
  const check = (o.check ?? codesignCheck)(staging, VOICE_IO_REQUIREMENT);
  if (!check.ok && !o.devUnsigned) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`The voice app is not signed by Gnomon's team (${VOICE_IO_TEAM}, ${VOICE_IO_IDENTIFIER}); refusing to start it. ${check.detail}`.trim());
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
  return { ioBinary: path.join(dest, VOICE_IO_IN_APP), devUnsigned: !check.ok };
}

/** Parse one `models fetch --json` progress line: {"total":N,"bytes":M} (bytes over every model). */
export function parseFetchProgress(line: string): { total: number; bytes: number } | null {
  try {
    const o = JSON.parse(line) as { total?: unknown; bytes?: unknown };
    return typeof o.total === 'number' && typeof o.bytes === 'number' ? { total: o.total, bytes: o.bytes } : null;
  } catch {
    return null;
  }
}

/** Run the client's `models fetch --json`; reports the download size once bytes are moving. */
export function fetchVoiceModels(o: { home: string; entry: string; report: (mb: number) => void; execPath?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(o.execPath ?? process.execPath, [DISABLE_SIGUSR1, o.entry, 'models', 'fetch', '--json', '--home', o.home], { stdio: ['ignore', 'pipe', 'pipe'], env: voiceChildEnv(process.env, o.home) });
    let buf = '';
    let err = '';
    let reported = false;
    child.stdout.on('data', (b: Buffer) => {
      buf += b.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const p = parseFetchProgress(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (p && !reported && p.bytes > 0) {
          reported = true;
          o.report(Math.max(1, Math.round(p.total / 1e6)));
        }
      }
    });
    child.stderr.on('data', (b: Buffer) => void (err = `${err}${b.toString('utf8')}`.slice(-1000)));
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`The voice models could not be downloaded and verified. ${err.trim().split('\n').at(-1) ?? ''}`.trim()))));
  });
}

/** The daemon's default prepare: install + verify the app copy, then make sure the models are present and verified. */
export async function defaultVoicePrepare(o: { home: string; entry: string; devUnsigned: boolean; report: (phase: 'installing' | 'downloading-models', mb?: number) => void }): Promise<VoicePrepared> {
  o.report('installing');
  const sourceApp = path.resolve(path.dirname(o.entry), '..', 'bin', 'darwin', VOICE_APP_NAME);
  const prepared = installVoiceApp({ home: o.home, sourceApp, devUnsigned: o.devUnsigned });
  await fetchVoiceModels({ home: o.home, entry: o.entry, report: (mb) => o.report('downloading-models', mb) });
  return prepared;
}
