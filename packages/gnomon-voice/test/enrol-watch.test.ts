/**
 * @symbol #gnomon-voice
 *
 * V2e kernel-decided enrolment, client side: status.voice.enrolment 'requested' → three phrases through AudioIO →
 * print stored 0600 under a 0700 dir → request.voice.report{enrolment} ready → recording → recorded … → done; a mic
 * that cannot be turned on reports failed; the voice loop is paused while recording; the GUI shows the same phrases.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ENROL_PHRASES } from '../src/enrol.js';
import { EnrolWatch, requestedEnrolment, VOICE_REPORT_REQUEST } from '../src/enrol-watch.js';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { printsDir, readPrints } from '../src/speaker.js';
import { VoiceClient } from '../src/voice-client.js';
import { FakeLink, stubEngines, tone } from './stubs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const settle = () => new Promise((r) => setTimeout(r, 5));
const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

class StatusLink extends FakeLink {
  enrolment: Record<string, unknown> | null = null;
  async status(): Promise<unknown> {
    return { voice: { principal: 'p:abcd1234/voice', enrolment: this.enrolment } };
  }
  reports(): Array<Record<string, unknown>> {
    return this.appends
      .filter((a) => a.kind === VOICE_REPORT_REQUEST)
      .map((a) => a.payload.enrolment as Record<string, unknown>)
      .filter(Boolean);
  }
}

async function until(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) await settle();
  expect(cond()).toBe(true);
}

function setup(o: { micOn?: boolean } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-enrol-'));
  homes.push(home);
  const link = new StatusLink();
  link.att = { voiceSessionId: 'vs:01TEST', hsid: 'hs:01TEST', mode: 'conversation' };
  const audio = new FakeAudioIO();
  if (o.micOn === false) audio.micOn = false;
  const engines = stubEngines();
  const client = new VoiceClient({
    audio,
    engines,
    link,
    ns: 'abcd1234',
    prints: () => readPrints(home),
    mode: 'ambient',
  });
  const watch = new EnrolWatch({
    link,
    audio,
    vad: engines.vad,
    speaker: engines.speaker,
    model: 'stub-campplus',
    home,
    pause: (on) => client.pause(on),
    pollMs: 60_000,
    timeoutMs: 2000,
  });
  return { home, link, audio, engines, client, watch };
}

describe('enrolment phrases', () => {
  it('the GUI enrol dialog shows exactly the client phrases (the kernel report carries no text)', () => {
    const gui = fs.readFileSync(
      path.join(here, '../../gnomon-gui/src/core/voice-client.ts'),
      'utf8'
    );
    const block =
      /export const ENROL_PHRASES[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(gui)?.[1] ?? '';
    const guiPhrases = [...block.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(guiPhrases).toEqual([...ENROL_PHRASES]);
    expect(ENROL_PHRASES).toHaveLength(3);
  });
  it('the phrases are natural sentences that never ask anyone to say the product name', () => {
    for (const p of ENROL_PHRASES) {
      expect(p).not.toMatch(/gnomon/i);
      expect(p.split(' ').length).toBeGreaterThanOrEqual(6);
    }
  });
  it('requestedEnrolment reads only phase requested', () => {
    expect(
      requestedEnrolment({ voice: { enrolment: { name: 'matt', phase: 'requested', at: 'T' } } })
    ).toEqual({ name: 'matt', at: 'T' });
    expect(
      requestedEnrolment({ voice: { enrolment: { name: 'matt', phase: 'done', at: 'T' } } })
    ).toBeNull();
    expect(requestedEnrolment({ voice: { enrolment: null } })).toBeNull();
    expect(requestedEnrolment(undefined)).toBeNull();
  });
});

describe('EnrolWatch', () => {
  it("records three phrases on 'requested', stores the print 0600/0700, reports each phase, and sends no turn", async () => {
    const { home, link, audio, client, watch } = setup();
    await client.start();
    link.enrolment = { name: 'matt', phase: 'requested', at: '2026-10-19T00:00:00.000Z' };
    const done = watch.poll();
    for (let i = 0; i < 3; i++) {
      await until(() => link.reports().some((r) => r.phase === 'recording' && r.phrase === i));
      audio.capture(tone(1500, 0.5));
      audio.silence(400);
    }
    await done;
    expect(link.reports().map((r) => `${r.phase}${r.phrase ?? ''}`)).toEqual([
      'ready0',
      'recording0',
      'recorded0',
      'recording1',
      'recorded1',
      'recording2',
      'recorded2',
      'done2',
    ]);
    expect(link.reports().every((r) => r.name === 'matt' && r.of === 3)).toBe(true);
    const prints = readPrints(home);
    expect(prints.map((p) => [p.name, p.phrases, p.model])).toEqual([['matt', 3, 'stub-campplus']]);
    // POSIX modes (on Windows the home is an ACL; the stored print is checked above on every platform)
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(printsDir(home), 'matt', 'print.json')).mode & 0o777).toBe(
        0o600
      );
      expect(fs.statSync(path.join(printsDir(home), 'matt')).mode & 0o777).toBe(0o700);
      expect(fs.statSync(printsDir(home)).mode & 0o777).toBe(0o700);
    }
    // the phrases were never turns (the loop was paused), and the loop is live again afterwards
    await client.idle();
    expect(link.appends.some((a) => a.kind === 'voice.turn.user')).toBe(false);
    expect(link.sends).toHaveLength(0);
    // the same request is handled once
    await watch.poll();
    expect(link.reports().filter((r) => r.phase === 'ready')).toHaveLength(1);
    await watch.stop();
    await client.close();
  });

  it('turns an off mic on for the recording and back off after', async () => {
    const { link, audio, watch } = setup({ micOn: false });
    link.enrolment = { name: 'ana', phase: 'requested', at: 'T1' };
    const done = watch.poll();
    for (let i = 0; i < 3; i++) {
      await until(() => link.reports().some((r) => r.phase === 'recording' && r.phrase === i));
      audio.capture(tone(1500, 0.5));
      audio.silence(400);
    }
    await done;
    expect(link.reports().at(-1)).toMatchObject({ name: 'ana', phase: 'done' });
    expect(audio.micOn).toBe(false);
  });

  it('a mic that cannot be turned on reports failed with the reason (nothing recorded)', async () => {
    const { home, link, audio, watch } = setup({ micOn: false });
    audio.setMic = async () => {
      throw new Error('microphone access denied');
    };
    link.enrolment = { name: 'ana', phase: 'requested', at: 'T2' };
    await watch.poll();
    expect(link.reports()).toEqual([
      {
        name: 'ana',
        phase: 'failed',
        error: expect.stringMatching(/mic is off.*microphone access denied/),
      },
    ]);
    expect(readPrints(home)).toHaveLength(0);
  });

  it('no speech heard reports failed', async () => {
    const { link, watch } = setup();
    link.enrolment = { name: 'ana', phase: 'requested', at: 'T3' };
    await watch.poll();
    expect(link.reports().at(-1)).toMatchObject({
      name: 'ana',
      phase: 'failed',
      error: expect.stringMatching(/no speech heard/),
    });
  });
});
