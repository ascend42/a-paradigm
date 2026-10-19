#!/usr/bin/env node
/**
 * @symbol #gnomon-voice
 *
 * `gnomon-voice [run] | models fetch | enrol <name> | status` (V2c). Plain, friendly output. `run` is the client
 * loop; `enrol` stores a voiceprint and then points at the root-signed `gnomon voice enrol` (V1) step.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SpawnedAudioIO } from './audio-io.js';
import { recordEnrolment } from './enrol.js';
import { createSherpaEngines, loadSherpa } from './engines/sherpa.js';
import { GnomonKernelLink, nsOf, type VoiceConnectProfile } from './kernel-link.js';
import { fetchModel, loadManifest, ModelVerifyError, verifiedModelPaths } from './manifest.js';
import { readPrints } from './speaker.js';
import type { VoiceEngines, VoiceLogger } from './types.js';
import { VoiceClient, type ClientMode } from './voice-client.js';

export const VOICE_CLIENT_VERSION = '0.1.0';
const USAGE = `usage: gnomon-voice [run] [--mode ptt|ambient|off] [--io <gnomon-voice-io>] [--connect <profile.json>]
       gnomon-voice models fetch [--force]
       gnomon-voice enrol <name> [--io <gnomon-voice-io>]
       gnomon-voice status

  run          talk to the session voice is attached to (push-to-talk by default)
  models fetch download the pinned models into ~/.gnomon/voice/models and verify them
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

function parse(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (['mode', 'io', 'connect', 'home'].includes(k) && v !== undefined) (flags[k] = v), i++;
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function defaultIoBinary(): string {
  return process.env.GNOMON_VOICE_IO ?? 'gnomon-voice-io';
}

async function engines(home: string): Promise<VoiceEngines> {
  try {
    return (await createSherpaEngines(home)) as VoiceEngines;
  } catch (e) {
    if (e instanceof ModelVerifyError) throw new Error(`${e.message}\n  Run: gnomon-voice models fetch`);
    throw e;
  }
}

async function cmdFetch(home: string, force: boolean): Promise<number> {
  const m = loadManifest();
  for (const e of m.models) {
    out(`${e.id} (${(e.size / 1e6).toFixed(1)} MB)`);
    let last = 0;
    try {
      const r = await fetchModel(home, e, {
        force,
        progress: (_id, b, t) => {
          const pct = Math.floor((b / t) * 10);
          if (pct > last) (last = pct), process.stdout.write(`  ${pct * 10}%\r`);
        },
      });
      out(r === 'present' ? '  already here and verified' : '  downloaded and verified');
    } catch (x) {
      err(`  refused: ${x instanceof Error ? x.message : String(x)}`);
      return 1;
    }
  }
  out('All voice models are ready.');
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
  const profilePath = typeof flags.connect === 'string' ? flags.connect : path.join(home, 'voice', 'connect.json');
  let profile: VoiceConnectProfile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as VoiceConnectProfile;
  } catch {
    err(`No voice connect profile at ${profilePath}. Run \`gnomon voice setup\` first.`);
    return 1;
  }
  const mode = (typeof flags.mode === 'string' ? flags.mode : 'ptt') as ClientMode;
  if (!['ptt', 'ambient', 'off'].includes(mode)) return err('--mode is ptt, ambient or off'), 64;
  const eng = await engines(home);
  const link = await GnomonKernelLink.connect(profile, { version: VOICE_CLIENT_VERSION });
  const audio = new SpawnedAudioIO({ binary: typeof flags.io === 'string' ? flags.io : defaultIoBinary() });
  const client = new VoiceClient({
    audio, engines: eng, link, ns: nsOf(profile.principalId), prints: () => readPrints(home), mode,
    log: stderrLogger(flags.verbose === true),
    notice: (n) => (n.level === 'warn' ? err(n.text) : out(n.text)),
  });
  await client.start();
  out(mode === 'ptt' ? 'Listening. Hold the hotkey to talk; Ctrl-C to stop.' : 'Listening. Ctrl-C to stop.');
  await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
  await client.close();
  await link.close();
  out('Voice stopped.');
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { pos, flags } = parse(argv);
  const home = homeOf(typeof flags.home === 'string' ? flags.home : undefined);
  if (flags.help || flags.h) return out(USAGE), 0;
  const [cmd = 'run', sub] = pos;
  try {
    if (cmd === 'run') return await cmdRun(home, flags);
    if (cmd === 'models' && sub === 'fetch') return await cmdFetch(home, flags.force === true);
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
