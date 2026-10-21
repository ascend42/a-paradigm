/**
 * @symbol #gnomon-voice
 *
 * `gnomon voice setup | enrol <name> --consent <text> | forget <name>` (spec §14.4; voice slice V1,
 * T-2026-10-19-026). All three are ROOT-SIGNED, human-only CLI acts: `setup` writes the voice device key and
 * registers it as `p:<ns>/voice`; `enrol` / `forget` append root-signed rows to `<home>/voice/enrolments.jsonl`
 * (enrolment.ts). Refused from a kernel-spawned shell (GNOMON_HSID) like every root-signed verb. Never by voice.
 */
import { acceptableVariant, validateSendWord } from '@a-company/gnomon-contracts';
import { writeSendWord } from '../kernel/voice/send-word-store.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { IdentityError, openHardwareIdentity } from '../kernel/identity/index.js';
import type { RootAuthority } from '../kernel/identity/root-authority.js';
import { enrolSpeaker, forgetSpeaker, setupVoiceDevice } from '../kernel/voice/enrolment.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const VOICE_EXIT_OK = 0;
export const VOICE_EXIT_REFUSED = 1;
export const VOICE_EXIT_USAGE = 64;

export const VOICE_USAGE = `usage: gnomon voice setup [--home <abs>]
       gnomon voice enrol <name> --consent <text> [--home <abs>]
       gnomon voice forget <name> [--home <abs>]
       gnomon voice send-word set <word> [--variant <heard>]... [--home <abs>]
       gnomon voice send-word clear [--home <abs>]

  setup   write the voice device key and register it (root-signed, Touch ID)
          as this home's voice principal p:<ns>/voice
  enrol   enrol a speaker with recorded consent (root-signed); only enrolled
          speakers' push-to-talk turns are sent to a session
  forget  delete a speaker's enrolment and voiceprint (root-signed)
  send-word
          set or clear the spoken send word (1-3 words, never an approval
          phrase); the GUI's "Teach Gnomon your send word" is the guided form.
          A voice-sent turn asks before every edit (TD-2026-10-21-514).

  Speaker recognition is not authentication. Voice is talk-only: it never
  approves anything.
`;

export interface VoiceCliDeps {
  /** The root authority to sign with (tests: a DevTestRootAuthority). Default: this home's hardware root. */
  root?: (home: string) => Promise<{ root: RootAuthority; close?: () => void } | null>;
  env?: NodeJS.ProcessEnv;
  host?: string;
}

async function hardwareRoot(home: string): Promise<{ root: RootAuthority; close?: () => void } | null> {
  const hw = await openHardwareIdentity(home);
  if (!hw) return null;
  return { root: hw.root, close: () => void hw.helper.close().catch(() => undefined) };
}

export async function runVoiceCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, deps: VoiceCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const usage = (msg: string): number => {
    refused(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon voice --help']);
    return VOICE_EXIT_USAGE;
  };
  const sub = argv[0];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    io.stdout.write(`gnomon ${GNOMON_VERSION}\n${VOICE_USAGE}`);
    return sub === undefined ? VOICE_EXIT_USAGE : VOICE_EXIT_OK;
  }
  if (sub === 'send-word') return sendWordCommand(argv.slice(1), io, env, usage);
  if (sub !== 'setup' && sub !== 'enrol' && sub !== 'forget') return usage(`unknown voice command ${JSON.stringify(sub.slice(0, 32))}`);
  let name: string | undefined;
  let consent: string | undefined;
  let home: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--home') {
      const h = argv[++i];
      if (h === undefined || !path.isAbsolute(h)) return usage('--home takes an absolute path');
      home = h;
    } else if (a === '--consent') {
      const c = argv[++i];
      if (c === undefined) return usage('--consent takes the recorded consent text');
      consent = c;
    } else if (!a.startsWith('-') && name === undefined && sub !== 'setup') name = a;
    else return usage(`unexpected argument ${JSON.stringify(a.slice(0, 32))}`);
  }
  if (sub !== 'setup' && name === undefined) return usage(`gnomon voice ${sub} needs a speaker name`);
  if (sub === 'enrol' && consent === undefined) return usage('gnomon voice enrol needs --consent <text> (recorded consent, §14.4)');
  if (env.GNOMON_HSID) {
    refused(io.stderr, 'FORBIDDEN', 'forbidden', `gnomon voice ${sub} is a human-only, root-signed verb; it is refused from a kernel-spawned shell`);
    return VOICE_EXIT_REFUSED;
  }
  const h = path.resolve(home ?? resolveGnomonHome({ env }));
  let opened: { root: RootAuthority; close?: () => void } | null;
  try {
    opened = await (deps.root ?? hardwareRoot)(h);
  } catch (e) {
    refused(io.stderr, 'FORBIDDEN', 'root-unavailable', e instanceof IdentityError ? e.message : String(e instanceof Error ? e.message : e), ['gnomon identity init']);
    return VOICE_EXIT_REFUSED;
  }
  if (!opened) {
    refused(io.stderr, 'FORBIDDEN', 'root-unprovisioned', `${h} has no root; voice ${sub} is root-signed`, ['gnomon identity init']);
    return VOICE_EXIT_REFUSED;
  }
  try {
    if (sub === 'setup') {
      const d = await setupVoiceDevice(h, opened.root, { host: deps.host ?? (os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63) || 'host') });
      heading(io.stdout, 'registered', 'voice device');
      readout(io.stdout, [
        ['principal', d.principalId],
        ['device', d.deviceId],
        ['key', d.keyId],
      ]);
    } else if (sub === 'enrol') {
      const r = await enrolSpeaker(h, opened.root, { name: name!, consent: consent! });
      heading(io.stdout, 'enrolled', r.speakerId);
    } else {
      const r = await forgetSpeaker(h, opened.root, { name: name! });
      heading(io.stdout, 'forgotten', r.speakerId);
    }
    return VOICE_EXIT_OK;
  } catch (e) {
    refused(io.stderr, 'FORBIDDEN', 'refused', e instanceof Error ? e.message : String(e));
    return VOICE_EXIT_REFUSED;
  } finally {
    opened.close?.();
  }
}

/** TD-2026-10-21-514: `gnomon voice send-word set <word> [--variant <heard>]… | clear` — the raw form of the GUI dialog. */
function sendWordCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }, env: NodeJS.ProcessEnv, usage: (m: string) => number): number {
  const op = argv[0];
  if (op !== 'set' && op !== 'clear') return usage('gnomon voice send-word set <word> | clear');
  let home: string | undefined;
  const words: string[] = [];
  const variants: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--home') {
      const h = argv[++i];
      if (h === undefined || !path.isAbsolute(h)) return usage('--home takes an absolute path');
      home = h;
    } else if (a === '--variant') {
      const v = argv[++i];
      if (v === undefined) return usage('--variant takes a heard form of the word');
      variants.push(v);
    } else if (!a.startsWith('-') && op === 'set') words.push(a);
    else return usage(`unexpected argument ${JSON.stringify(a.slice(0, 32))}`);
  }
  if (op === 'set' && words.length === 0) return usage('gnomon voice send-word set needs the word');
  if (env.GNOMON_HSID) {
    refused(io.stderr, 'FORBIDDEN', 'forbidden', 'gnomon voice send-word is a human-only verb; it is refused from a kernel-spawned shell');
    return VOICE_EXIT_REFUSED;
  }
  const h = path.resolve(home ?? resolveGnomonHome({ env }));
  if (op === 'clear') {
    writeSendWord(h, null);
    heading(io.stdout, 'cleared', 'send word');
    return VOICE_EXIT_OK;
  }
  const text = words.join(' ');
  const v = validateSendWord(text);
  if (!v.ok) {
    refused(io.stderr, 'BAD_REQUEST', 'bad-params', `not a usable send word (${v.reason}): 1-3 words, never an approval or command phrase`);
    return VOICE_EXIT_REFUSED;
  }
  const w = writeSendWord(h, { text, variants: variants.filter((x) => acceptableVariant(x, text)) });
  heading(io.stdout, 'set', 'send word');
  readout(io.stdout, [
    ['word', w!.text],
    ['variants', w!.variants.join(', ') || '-'],
    ...(v.warn === 'common' ? ([['note', 'a very common word: it may send by accident']] as const) : []),
  ]);
  return VOICE_EXIT_OK;
}
