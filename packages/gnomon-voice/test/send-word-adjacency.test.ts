/**
 * TD-2026-10-21-514 short words by adjacency (client half; the kernel re-checks in packages/gnomon/test/voice-send-word.test.ts):
 * a segment too short to verify that IS the held send word is appended for the draft speaker with speakerBasis
 * 'adjacent' and the canonical word as its text; anything else short and unknown stays withheld.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { PRINT_SCHEMA, type VoicePrint } from '../src/speaker.js';
import { VoiceClient } from '../src/voice-client.js';
import { sendWordFileSource, trialWordFileSource } from '../src/send-word.js';
import { FakeLink, stubEngines, toneWav } from './stubs.js';

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const WORD = { text: 'over and out', variants: ['over an out'] };
let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(texts: string[], word: typeof WORD | null = WORD, trial: { text: string; variants: string[] } | null = null) {
  const audio = new FakeAudioIO();
  const link = new FakeLink();
  const notices: string[] = [];
  const client = new VoiceClient({ audio, engines: stubEngines(texts), link, ns: 'abcd1234', prints: () => [MATT], mode: 'ptt', delivery: 'composer', now: () => audio.clock, sendWord: () => word, sendWordTrial: () => trial, notice: (n) => notices.push(n.text) });
  clients.push(client);
  await client.start();
  return { audio, link, client, notices };
}
const ptt = (audio: FakeAudioIO, ms: number, amp: number): void => {
  audio.hotkey(true);
  audio.captureWav(toneWav(ms, amp));
  audio.hotkey(false);
  audio.silence(100);
};

describe('short send word by adjacency (client)', () => {
  it('a short unknown segment that is the send word goes to the draft speaker, marked adjacent', async () => {
    const { audio, link, client } = await setup(['fix the bug', 'Over and out!']);
    ptt(audio, 800, 0.5);
    ptt(audio, 600, 0.2);
    await client.idle();
    expect(link.appends[1]!.payload).toMatchObject({ speakerId: 'spk:abcd1234/matt', speakerEnrolled: true, speakerBasis: 'adjacent', text: 'over and out' });
  });

  it('not the word, too long, no draft speaker yet, or no word held: withheld as unknown', async () => {
    const a = await setup(['fix the bug', 'ship it']);
    ptt(a.audio, 800, 0.5);
    ptt(a.audio, 600, 0.2);
    await a.client.idle();
    expect(a.link.appends[1]!.payload).toMatchObject({ speakerId: 'spk:unknown-1', textWithheld: true });
    const b = await setup(['fix the bug', 'over and out']);
    ptt(b.audio, 800, 0.5);
    ptt(b.audio, 1700, 0.2);
    await b.client.idle();
    expect(b.link.appends[1]!.payload).not.toHaveProperty('speakerBasis');
    const c = await setup(['over and out']);
    ptt(c.audio, 600, 0.2);
    await c.client.idle();
    expect(c.link.appends[0]!.payload).toMatchObject({ textWithheld: true });
    const d = await setup(['fix the bug', 'over and out'], null);
    ptt(d.audio, 800, 0.5);
    ptt(d.audio, 600, 0.2);
    await d.client.idle();
    expect(d.link.appends[1]!.payload).not.toHaveProperty('speakerBasis');
  });

  it('reads the kernel-held file; a broken file holds no word', () => {
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gv-sw-')));
    try {
      const src = sendWordFileSource(home);
      expect(src()).toBeNull();
      fs.mkdirSync(path.join(home, 'voice'), { recursive: true });
      fs.writeFileSync(path.join(home, 'voice', 'send-word.json'), `${JSON.stringify({ format: 'gnomon-send-word:v1', text: 'Ship it', variants: [] })}\n`);
      expect(src()).toEqual({ text: 'ship it', variants: [] });
      fs.writeFileSync(path.join(home, 'voice', 'send-word.json'), '{"format":"gnomon-send-word:v1","text":"deny me now ok"}\n');
      expect(src()).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('reads the trial file until its expiry; a broken or expired file is no trial', () => {
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gv-swt-')));
    try {
      let now = 1000;
      const src = trialWordFileSource(home, () => now);
      expect(src()).toBeNull();
      fs.mkdirSync(path.join(home, 'voice'), { recursive: true });
      fs.writeFileSync(path.join(home, 'voice', 'send-word-trial.json'), `${JSON.stringify({ format: 'gnomon-send-word:v1', text: 'send', variants: [], until: 5000 })}\n`);
      expect(src()).toEqual({ text: 'send', variants: [] });
      now = 6000;
      expect(src()).toBeNull();
      // the held source never reads the trial
      expect(sendWordFileSource(home)()).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the attended send-word trial (client; spec §14.7 trial semantics)', () => {
  it('an unknown short take sends its cleaned text with no adjacency and no "not enrolled" notice; a sentence stays withheld', async () => {
    const { audio, link, client, notices } = await setup(['Send.', 'I am teaching my send word now'], null, { text: 'send', variants: [] });
    link.turnVerdict = { trialTake: true };
    ptt(audio, 400, 0.2); // 0.4 s, never speaker-verified, no draft speaker: still a take
    ptt(audio, 900, 0.2);
    await client.idle();
    expect(link.appends[0]!.payload).toMatchObject({ speakerId: 'spk:unknown-1', speakerEnrolled: false, text: 'send', forwarded: false });
    expect(link.appends[0]!.payload).not.toHaveProperty('speakerBasis');
    expect(link.appends[0]!.payload).not.toHaveProperty('textWithheld');
    expect(link.appends[1]!.payload).toMatchObject({ textWithheld: true, text: '' });
    expect(notices.some((n) => /not enrolled/.test(n))).toBe(false);
    expect(link.sends).toHaveLength(0);
  });
});
