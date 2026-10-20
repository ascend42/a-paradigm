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
 *   - The CLIENT (Aegis V2e M2): the workspace's gnomon-voice dist/cli.js is session-writable, so the kernel never
 *     runs it from there. On the first prepare of a daemon it copies the client (dist/cli.js, a {"type":"module"}
 *     package.json, and the optional native sherpa-onnx-node with its platform packages when resolvable) into
 *     `<home>/bin/voice/client/` (0700 dirs, 0600 files; staged, then renamed), pins a sha256 of every copied file
 *     IN MEMORY (the manifest file beside it is informational only), and re-verifies the pin at the end of every
 *     prepare, right before the spawn. Any added, missing or changed file refuses the spawn: VoiceClientRefused,
 *     which the supervisor shows as phase 'unavailable' with the reason. The model fetch runs the COPY too.
 *     Assumption (spec §14.4.1): sessions cannot write `<home>/bin/voice` (the session sandbox denies the home).
 *   - Models: the kernel runs the client's own `models fetch --json` (pinned manifest, sha256 of every archive and
 *     every member) as a short child with the same allow-list env, and turns its progress lines into the GUI phase
 *     "Downloading voice models (N MB)…". First start therefore needs no terminal step.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
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

/** A copied client that no longer matches the kernel's pin (or cannot be copied): the spawn is refused, not retried. */
export class VoiceClientRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceClientRefused';
  }
}

export interface VoiceClientPin {
  /** the installed copy's directory (`<home>/bin/voice/client`) */
  dir: string;
  /** the copy's entry: `<dir>/dist/cli.js` */
  entry: string;
  /** relative path → sha256 hex of every file in the copy */
  files: Readonly<Record<string, string>>;
}

export function voiceClientDir(home: string): string {
  return path.join(voiceBinDir(home), 'client');
}

const sha256File = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Every regular file under `dir` (relative, sorted). A symlink or special file anywhere is refused. */
function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else if (e.isFile()) out.push(r);
    else throw new VoiceClientRefused(`the installed voice client holds something that is not a plain file (${r}); refusing to start it`);
  }
  return out.sort();
}

function lockDown(dir: string): void {
  fs.chmodSync(dir, 0o700);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) lockDown(p);
    else fs.chmodSync(p, 0o600);
  }
}

/** The optional native engine package and the platform packages it names, resolved from the source client. */
function nativeDeps(sourcePkg: string): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = [];
  let sherpa: string;
  try {
    sherpa = path.dirname(createRequire(path.join(sourcePkg, 'package.json')).resolve('sherpa-onnx-node/package.json'));
  } catch {
    return out; // not installed: the client runs without real engines (it says so)
  }
  out.push({ name: 'sherpa-onnx-node', dir: sherpa });
  const pj = JSON.parse(fs.readFileSync(path.join(sherpa, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  for (const name of Object.keys({ ...pj.dependencies, ...pj.optionalDependencies })) {
    try {
      out.push({ name, dir: path.dirname(createRequire(path.join(sherpa, 'package.json')).resolve(`${name}/package.json`)) });
    } catch {
      /* another platform's package: not installed here */
    }
  }
  return out;
}

/**
 * Copy the client from its source (`entry` = <pkg>/dist/cli.js) into `<home>/bin/voice/client/` and pin every file.
 * The source is read once, here; nothing runs from it.
 */
export function installVoiceClient(o: { home: string; entry: string }): VoiceClientPin {
  if (!fs.existsSync(o.entry)) throw new VoiceClientRefused('the voice client is not built');
  const sourcePkg = path.dirname(path.dirname(o.entry));
  const bin = voiceBinDir(o.home);
  ensurePrivateDir(path.dirname(bin));
  ensurePrivateDir(bin);
  const dir = voiceClientDir(o.home);
  const staging = path.join(bin, '.client.staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, 'dist'), { recursive: true, mode: 0o700 });
  fs.copyFileSync(o.entry, path.join(staging, 'dist', 'cli.js'));
  fs.writeFileSync(path.join(staging, 'package.json'), `${JSON.stringify({ name: '@a-company/gnomon-voice', private: true, type: 'module' })}\n`, { mode: 0o600 });
  for (const d of nativeDeps(sourcePkg)) fs.cpSync(d.dir, path.join(staging, 'node_modules', ...d.name.split('/')), { recursive: true, dereference: true });
  lockDown(staging);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);
  const files: Record<string, string> = {};
  for (const r of filesUnder(dir)) files[r] = sha256File(path.join(dir, r));
  // informational only: the pin that counts is the one returned here, held in the kernel's memory
  fs.writeFileSync(path.join(bin, 'client.manifest.json'), `${JSON.stringify({ files }, null, 1)}\n`, { mode: 0o600 });
  return { dir, entry: path.join(dir, 'dist', 'cli.js'), files: Object.freeze(files) };
}

/** Re-check the copy against the kernel's pin; throws VoiceClientRefused on any added, missing or changed file. */
export function verifyVoiceClient(pin: VoiceClientPin): void {
  let now: string[];
  try {
    now = filesUnder(pin.dir);
  } catch (e) {
    if (e instanceof VoiceClientRefused) throw e;
    throw new VoiceClientRefused('the installed voice client is missing; refusing to start it');
  }
  const want = Object.keys(pin.files).sort();
  const extra = now.find((f) => !(f in pin.files));
  const missing = want.find((f) => !now.includes(f));
  const changed = now.find((f) => f in pin.files && sha256File(path.join(pin.dir, f)) !== pin.files[f]);
  const bad = changed ?? extra ?? missing;
  if (bad !== undefined) throw new VoiceClientRefused(`the installed voice client changed since the kernel copied it (${bad}); refusing to start it`);
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
/**
 * The daemon's prepare (one per daemon): the FIRST call copies and pins the client; every call installs and verifies
 * the io app copy, fetches the models with the client COPY, and re-verifies the pin last, right before the spawn.
 */
export function createVoicePrepare(o: {
  home: string;
  entry: string;
  devUnsigned: boolean;
  installApp?: typeof installVoiceApp;
  fetchModels?: typeof fetchVoiceModels;
}): (report: (phase: 'installing' | 'downloading-models', mb?: number) => void) => Promise<VoicePrepared> {
  let pin: VoiceClientPin | null = null;
  return async (report) => {
    report('installing');
    pin ??= installVoiceClient({ home: o.home, entry: o.entry });
    verifyVoiceClient(pin);
    const sourceApp = path.resolve(path.dirname(o.entry), '..', 'bin', 'darwin', VOICE_APP_NAME);
    const prepared = (o.installApp ?? installVoiceApp)({ home: o.home, sourceApp, devUnsigned: o.devUnsigned });
    await (o.fetchModels ?? fetchVoiceModels)({ home: o.home, entry: pin.entry, report: (mb) => report('downloading-models', mb) });
    verifyVoiceClient(pin);
    return { ...prepared, clientEntry: pin.entry };
  };
}
