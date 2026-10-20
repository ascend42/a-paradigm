#!/usr/bin/env node
/**
 * @symbol #gnomon-voice
 *
 * `gnomon-voice run --fd N --home H --io P | models fetch [--json] [--from <dir>] | enrol <name> | status` (V2e).
 * `run` is spawned BY THE KERNEL with fd N = an already-authenticated socketpair (no hello, no auth, no key on
 * this side) and exits when stdin ends or the link closes. Plain, friendly output for humans; `--json` for the
 * kernel/GUI (models fetch: `{"total":N,"bytes":M}` lines, then `{"done":true}`).
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { DARWIN_IO_BINARY, SpawnedAudioIO } from './audio-io.js';
import { fileURLToPath } from 'node:url';
import { recordEnrolment } from './enrol.js';
import { createSherpaEngines, loadSherpa } from './engines/sherpa.js';
import { GnomonKernelLink } from './kernel-link.js';
import { fetchModel, loadManifest, localFetch, ModelVerifyError, verifiedModelPaths } from './manifest.js';
import { runVoice } from './run.js';
import { readPrints } from './speaker.js';
import type { VoiceEngines, VoiceLogger } from './types.js';
import type { ClientMode } from './voice-client.js';

export const VOICE_CLIENT_VERSION = '0.1.0';
const USAGE = `usage: gnomon-voice run --fd <n> [--home <abs>] [--io <gnomon-voice-io>] [--mode ptt|ambient|off]
       gnomon-voice models fetch [--force] [--json] [--from <dir>]
       gnomon-voice enrol <name> [--io <gnomon-voice-io>]
       gnomon-voice status

  run          started by Gnomon: talk to the session voice is attached to (push-to-talk by default)
               ⌃⌥M turns the mic on/off; ⌃⌥A switches ambient/push-to-talk within what Gnomon allows
  models fetch download the pinned models into ~/.gnomon/voice/models and verify them
               (--from <dir> installs from files you already downloaded)
  enrol        record three phrases and store your voiceprint on this computer
  status       show models, voiceprints and the engine runtime

  Every option also takes --home <abs>. Audio never touches the disk.
`;

const out = (s: string): void => void process.stdout.write(`${s}\n`);
const err = (s: string): void => void process.stderr.write(`${s}\n`);

function stderrLogger(verbose: boolean): VoiceLogger {
  const mk = (id: string) => ({
    info: (m: string, d?: Record<string, unknown>) => verbose && err(`  [${id}] ${m}${d ? ` ${JSON.stringify(d)}` : ''}`),
    warn: (m: string, d?: Record<string, unknown>) => err(`  [${id}] ${m}${d ? ` ${JSON.stringify(d)}` : ''}`),
  });
  return { component: mk, flow: mk };
}

function homeOf(flag: string | undefined): string {
  if (flag) return flag;
  const env = process.env.GNOMON_HOME;
  return env && path.isAbsolute(env) ? env : path.join(os.homedir(), '.gnomon');
}

const VALUED = ['mode', 'io', 'home', 'fd', 'from'];
export function parse(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (VALUED.includes(k) && v !== undefined) (flags[k] = v), i++;
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function defaultIoBinary(): string {
  return process.env.GNOMON_VOICE_IO ?? fileURLToPath(new URL(`../${DARWIN_IO_BINARY}`, import.meta.url));
}

async function engines(home: string): Promise<VoiceEngines> {
  try {
    return (await createSherpaEngines(home)) as VoiceEngines;
  } catch (e) {
    if (e instanceof ModelVerifyError) throw new Error(`${e.message}\n  Run: gnomon-voice models fetch`);
    throw e;
  }
}

async function cmdFetch(home: string, o: { force: boolean; json: boolean; from?: string }): Promise<number> {
  const m = loadManifest();
  const total = m.models.reduce((s, e) => s + e.size, 0);
  let done = 0;
  let lastJson = -1;
  const jsonLine = (v: unknown): void => out(JSON.stringify(v));
  if (o.json) jsonLine({ total, bytes: 0 });
  for (const e of m.models) {
    if (!o.json) out(`${e.id} (${(e.size / 1e6).toFixed(1)} MB)`);
    let last = 0;
    try {
      const r = await fetchModel(home, e, {
        force: o.force,
        ...(o.from ? { fetch: localFetch(o.from) } : {}),
        progress: (_id, b, t) => {
          if (o.json) {
            const pct = Math.floor(((done + b) / total) * 100);
            if (pct > lastJson) (lastJson = pct), jsonLine({ total, bytes: done + b });
            return;
          }
          const pct = Math.floor((b / t) * 10);
          if (pct > last) (last = pct), process.stdout.write(`  ${pct * 10}%\r`);
        },
      });
      done += e.size;
      if (o.json) jsonLine({ total, bytes: done });
      else out(r === 'present' ? '  already here and verified' : '  installed and verified');
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      if (o.json) jsonLine({ error: msg, model: e.id });
      else err(`  refused: ${msg}`);
      return 1;
    }
  }
  if (o.json) jsonLine({ done: true });
  else out('All voice models are ready.');
  return 0;
}

async function cmdStatus(home: string): Promise<number> {
  out(`Voice home: ${path.join(home, 'voice')}`);
  for (const e of loadManifest().models) {
    let state = 'ready';
    try {
      verifiedModelPaths(home, e);
    } catch (x) {
      state = x instanceof ModelVerifyError && x.reason === 'missing' ? 'not downloaded' : 'DOES NOT VERIFY';
    }
    out(`  ${e.role.padEnd(8)} ${e.id}: ${state}`);
  }
  const prints = readPrints(home);
  out(`Voiceprints: ${prints.length ? prints.map((p) => p.name).join(', ') : 'none (gnomon-voice enrol <name>)'}`);
  try {
    await loadSherpa();
    out('Engine runtime: sherpa-onnx-node 1.13.8 loaded');
  } catch {
    out(`Engine runtime: sherpa-onnx-node is not available on ${process.platform}-${process.arch}`);
  }
  return 0;
}

async function cmdEnrol(home: string, name: string, io: string): Promise<number> {
  const e = await createSherpaEngines(home, { roles: ['vad', 'speaker'] });
  const audio = new SpawnedAudioIO({ binary: io });
  await audio.start();
  try {
    const r = await recordEnrolment({
      audio, vad: e.vad!, speaker: e.speaker!, model: loadManifest().models.find((m) => m.role === 'speaker')!.id, home, name,
      prompt: (phrase, i, n) => out(`(${i}/${n}) Please read aloud:\n    "${phrase}"`),
    });
    out(`Saved ${name}'s voiceprint (${r.print.dim} numbers, no audio) at ${r.file}.`);
    out('Last step, on this computer (Touch ID; records your consent, root-signed):');
    out(`    gnomon voice enrol ${name} --consent "<what you agree to>"`);
    return 0;
  } finally {
    await audio.close();
  }
}

async function cmdRun(home: string, flags: Record<string, string | true>): Promise<number> {
  const fd = typeof flags.fd === 'string' ? Number(flags.fd) : NaN;
  if (!Number.isInteger(fd) || fd < 3) return err('gnomon-voice run is started by Gnomon with --fd <n> (an inherited, authenticated descriptor).'), 64;
  const mode = (typeof flags.mode === 'string' ? flags.mode : 'ptt') as ClientMode;
  if (!['ptt', 'ambient', 'off'].includes(mode)) return err('--mode is ptt, ambient or off'), 64;
  const link = GnomonKernelLink.fromFd(fd);
  const ac = new AbortController();
  process.once('SIGINT', () => ac.abort());
  process.once('SIGTERM', () => ac.abort());
  const eng = await engines(home);
  const audio = new SpawnedAudioIO({ binary: typeof flags.io === 'string' ? flags.io : defaultIoBinary() });
  const r = await runVoice({
    link, audio, engines: eng, prints: () => readPrints(home), stdin: process.stdin, mode, signal: ac.signal,
    enrol: { home, model: loadManifest().models.find((m) => m.role === 'speaker')!.id },
    log: stderrLogger(flags.verbose === true),
    notice: (n) => (n.level === 'warn' ? err(n.text) : out(n.text)),
    started: () => out(mode === 'ptt' ? 'Listening. Hold the talk hotkey to talk.' : 'Listening.'),
  });
  out(`Voice stopped (${r.reason}).`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { pos, flags } = parse(argv);
  const home = homeOf(typeof flags.home === 'string' ? flags.home : undefined);
  if (flags.help || flags.h) return out(USAGE), 0;
  const [cmd = 'run', sub] = pos;
  try {
    if (cmd === 'run') return await cmdRun(home, flags);
    if (cmd === 'models' && sub === 'fetch') return await cmdFetch(home, { force: flags.force === true, json: flags.json === true, ...(typeof flags.from === 'string' ? { from: flags.from } : {}) });
    if (cmd === 'status') return await cmdStatus(home);
    if (cmd === 'enrol') {
      if (!sub) return err('gnomon-voice enrol needs a name'), 64;
      return await cmdEnrol(home, sub, typeof flags.io === 'string' ? flags.io : defaultIoBinary());
    }
  } catch (x) {
    err(x instanceof Error ? x.message : String(x));
    return 1;
  }
  err(USAGE);
  return 64;
}

const invoked = process.argv[1] && /gnomon-voice(\.js)?$|cli\.js$/.test(process.argv[1]);
if (invoked) void main(process.argv.slice(2)).then((c) => process.exit(c));
