// @gnomon-platform: darwin, linux
/**
 * #gnomon-voice V1: root-signed enrolment rows and the voice device key (gnomon voice setup | enrol | forget, §14.4).
 * Writes 0600 key files, so POSIX modes apply; Windows keys are ACL'd via the helper (P8-D78).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DevTestRootAuthority, DEV_TEST_ROOT_ACK } from '../src/kernel/identity/root-authority.js';
import { readRegistry } from '../src/kernel/identity/registry.js';
import { enrolmentsPath, enrolSpeaker, forgetSpeaker, readEnrolled } from '../src/kernel/voice/enrolment.js';
import { runVoiceCommand } from '../src/cli/voice-cli.js';
import { tempHome } from './daemon-helpers.js';

const homes: Array<() => void> = [];
afterEach(() => homes.splice(0).forEach((c) => c()));
const sink = () => {
  let s = '';
  return { write: (c: string) => (s += c), text: () => s };
};

describe('#gnomon-voice enrolment (root-signed)', () => {
  it('enrol then forget; a row the root did not sign never counts', async () => {
    const { home, cleanup } = tempHome('gv-');
    homes.push(cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const row = await enrolSpeaker(home, root, { name: 'founder', consent: 'I consent to local voice enrolment' });
    expect(readEnrolled(home, root).has(row.speakerId)).toBe(true);
    const other = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    await enrolSpeaker(home, other, { name: 'intruder', consent: 'x' });
    expect([...readEnrolled(home, root)]).toEqual([row.speakerId]);
    fs.appendFileSync(enrolmentsPath(home), 'not json\n');
    await forgetSpeaker(home, root, { name: 'founder' });
    expect(readEnrolled(home, root).size).toBe(0);
    await expect(enrolSpeaker(home, root, { name: 'founder', consent: ' ' })).rejects.toThrow(/consent/);
    // L1: order is the signed seq, not file position — replaying the old enrol line does not resurrect the speaker
    const lines = fs.readFileSync(enrolmentsPath(home), 'utf8').split('\n').filter(Boolean);
    fs.appendFileSync(enrolmentsPath(home), `${lines[0]}\n`);
    expect(readEnrolled(home, root).size).toBe(0);
    await enrolSpeaker(home, root, { name: 'founder', consent: 'again' });
    expect(readEnrolled(home, root).has(row.speakerId)).toBe(true);
  });

  it('CLI: setup registers p:<ns>/voice (principalKind voice); enrol needs --consent; refused from a kernel-spawned shell', async () => {
    const { home, cleanup } = tempHome('gv-');
    homes.push(cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const deps = { root: async () => ({ root }), env: {}, host: 'mac' };
    const out = sink();
    const err = sink();
    expect(await runVoiceCommand(['setup', '--home', home], { stdout: out, stderr: err }, deps)).toBe(0);
    const voice = [...readRegistry(home, root).devices.values()].find((d) => d.principalKind === 'voice');
    expect(voice?.principalId).toBe(`p:${root.ns}/voice`);
    expect(fs.existsSync(path.join(home, 'keys', 'voice.key'))).toBe(true);
    expect(await runVoiceCommand(['enrol', 'founder', '--home', home], { stdout: out, stderr: err }, deps)).toBe(64);
    expect(await runVoiceCommand(['enrol', 'founder', '--consent', 'yes', '--home', home], { stdout: out, stderr: err }, deps)).toBe(0);
    expect(await runVoiceCommand(['forget', 'founder', '--home', home], { stdout: out, stderr: err }, { ...deps, env: { GNOMON_HSID: 'hs:x' } })).toBe(1);
    expect(readEnrolled(home, root).size).toBe(1);
  });
});
