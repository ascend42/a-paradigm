/**
 * @symbol #gnomon-voice
 *
 * `gnomon voice setup | enrol <name> --consent <text> | forget <name>` (spec §14.4; voice slice V1,
 * T-2026-10-19-026). All three are ROOT-SIGNED, human-only CLI acts: `setup` writes the voice device key and
 * registers it as `p:<ns>/voice`; `enrol` / `forget` append root-signed rows to `<home>/voice/enrolments.jsonl`
 * (enrolment.ts). Refused from a kernel-spawned shell (GNOMON_HSID) like every root-signed verb. Never by voice.
 */
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

  setup   write the voice device key and register it (root-signed, Touch ID)
          as this home's voice principal p:<ns>/voice
  enrol   enrol a speaker with recorded consent (root-signed); only enrolled
          speakers' push-to-talk turns are sent to a session
  forget  delete a speaker's enrolment and voiceprint (root-signed)

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
