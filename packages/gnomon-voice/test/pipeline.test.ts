/**
 * $voice-turn with FakeAudioIO + stub engines + a fake kernel link (no models, no audio, no network):
 * VAD → STT → append → send, the attachment/ceiling gate, half-duplex + tail, barge-in, refusals, G-VOX-05.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { PRINT_SCHEMA, readPrints, type VoicePrint } from '../src/speaker.js';
import { VoiceClient, type ClientMode, type Delivery, type Notice } from '../src/voice-client.js';
import { recordEnrolment } from '../src/enrol.js';
import { FakeLink, refusal, stubEngines, StubSpeaker, StubVad, tone, toneWav } from './stubs.js';

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(o: { mode?: ClientMode; attachMode?: string | null; texts?: string[]; delivery?: Delivery } = {}) {
  const audio = new FakeAudioIO();
  const engines = stubEngines(o.texts ?? []);
  const link = new FakeLink();
  if (o.attachMode === null) link.att = null;
  else if (o.attachMode) link.att = { ...link.att!, mode: o.attachMode };
  const notices: Notice[] = [];
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], mode: o.mode ?? 'ptt', delivery: o.delivery ?? 'direct', now: () => audio.clock, notice: (n) => notices.push(n) });
  clients.push(client);
  await client.start();
  return { audio, engines, link, client, notices };
}

function ptt(audio: FakeAudioIO, ms: number, amp: number): void {
  audio.hotkey(true);
  audio.captureWav(toneWav(ms, amp));
  audio.hotkey(false);
}

describe('$voice-turn user side', () => {
  it('PTT: STT → voice.turn.user (enrolled) → session.send with the same text', async () => {
    const { audio, engines, link, client } = await setup({ texts: ['run the tests'] });
    audio.silence(100);
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(engines.stt.heard).toHaveLength(1);
    expect(link.appends).toHaveLength(1);
    const p = link.appends[0]!;
    expect(p.kind).toBe('voice.turn.user');
    expect(p.payload).toMatchObject({ speakerId: 'spk:abcd1234/matt', speakerEnrolled: true, forwarded: true, mode: 'ptt', aec: 'headphones', aecTransport: 'wired', text: 'run the tests' });
    expect(p.payload.t1 as number).toBeGreaterThan(p.payload.t0 as number);
    expect(String(p.payload.turnId)).toMatch(/^u\d{13}-\d{4}$/);
    expect(link.sends).toEqual([{ hsid: 'hs:01TEST', text: 'run the tests' }]);
  });

  it('AMBIENT: a VAD segment is a turn (when the ceiling allows ambient)', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['what changed'] });
    audio.captureWav(toneWav(700, 0.5));
    audio.silence(400);
    await client.idle();
    expect(link.appends[0]!.payload).toMatchObject({ mode: 'conversation', text: 'what changed' });
    expect(link.sends).toHaveLength(1);
  });

  it('turn ids are monotone (the kernel order: length, then lexical)', async () => {
    const { audio, link, client } = await setup({ texts: ['one', 'two'] });
    ptt(audio, 600, 0.5);
    audio.silence(100);
    ptt(audio, 600, 0.5);
    await client.idle();
    const [a, b] = link.appends.map((x) => String(x.payload.turnId));
    expect(a!.length === b!.length && b! > a!).toBe(true);
  });

  it('an unknown speaker is logged without text and never sent', async () => {
    const { audio, link, client, notices } = await setup({ texts: ['secret words'] });
    ptt(audio, 800, 0.2);
    await client.idle();
    expect(link.appends[0]!.payload).toMatchObject({ speakerId: 'spk:unknown-1', speakerEnrolled: false, forwarded: false, text: '', textWithheld: true });
    expect(JSON.stringify(link.appends)).not.toContain('secret words');
    expect(link.sends).toHaveLength(0);
    expect(notices.at(-1)!.text).toMatch(/not enrolled/);
  });

  it('never forwards when not attached (no append, no send)', async () => {
    const { audio, link, client, notices } = await setup({ attachMode: null, mode: 'ambient' });
    expect(client.mode).toBe('off');
    ptt(audio, 800, 0.5);
    audio.captureWav(toneWav(800, 0.5));
    audio.silence(400);
    await client.idle();
    expect(link.appends).toHaveLength(0);
    expect(link.sends).toHaveLength(0);
    expect(notices[0]!.text).toMatch(/not attached/);
  });

  it('the human ceiling bounds the mode: ambient asked under a ptt attachment narrows to ptt', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'ptt' });
    expect(client.mode).toBe('ptt');
    audio.captureWav(toneWav(800, 0.5)); // no hotkey: continuous speech is not a turn under ptt
    audio.silence(400);
    await client.idle();
    expect(link.appends).toHaveLength(0);
    expect(client.setMode('ambient')).toBe('ptt');
    expect(client.setMode('off')).toBe('off');
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(link.appends).toHaveLength(0);
  });

  it('an unknown ceiling name fails closed to off', async () => {
    const { client } = await setup({ attachMode: 'telepathy' });
    expect(client.mode).toBe('off');
  });

  it('a refusal is shown and never retried', async () => {
    const { audio, link, client, notices } = await setup({ texts: ['hi'] });
    link.sendError = refusal('voice-echo');
    ptt(audio, 800, 0.5);
    await client.idle();
    await settle();
    expect(link.appends).toHaveLength(1);
    expect(link.sends).toHaveLength(0);
    const n = notices.find((x) => x.refusal)!;
    expect(n.refusal).toMatchObject({ code: 'FORBIDDEN', reason: 'voice-echo' });
    expect(n.text).toMatch(/while I was speaking/);
  });

  it('a follow that ends (attachment change) re-reads status and re-follows', async () => {
    const { link, client } = await setup();
    const first = link.row;
    link.att = { voiceSessionId: 'vs:02NEXT', hsid: 'hs:02NEXT', mode: 'ptt' };
    link.end!('attachment-changed');
    await settle();
    expect(link.row).toBeDefined();
    expect(link.row).not.toBe(first);
    expect(client.attachment?.hsid).toBe('hs:02NEXT');
  });
});

describe('$voice-turn agent side + half-duplex', () => {
  it('speaks the reply summary per sentence and logs voice.turn.agent windows', async () => {
    const { audio, engines, link, client } = await setup();
    link.reply('Tests pass. Two were flaky.\n\n```diff\n- a\n+ b\n```');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.tick(1000);
    await settle();
    audio.tick(1000);
    await client.idle();
    expect(engines.tts.said).toEqual(['Tests pass.', 'Two were flaky.']);
    const agent = link.appends.filter((a) => a.kind === 'voice.turn.agent');
    expect(agent).toHaveLength(2);
    expect(agent[0]!.payload).toMatchObject({ textPlanned: 'Tests pass.', textSpoken: 'Tests pass.' });
    expect((agent[0]!.payload.t1 as number) - (agent[0]!.payload.t0 as number)).toBe(1000);
  });

  it('never forwards speech during playback or the 750 ms tail; forwards after', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['late enough'] });
    link.reply('One sentence only.');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.captureWav(toneWav(250, 0.5)); // < 300 ms: not a barge-in, but inside playback
    audio.silence(900); // the 1000 ms playback ends inside this window
    await settle();
    expect(audio.isPlaying).toBe(false);
    audio.captureWav(toneWav(400, 0.5)); // starts within the 750 ms tail
    audio.silence(400);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(0);
    audio.silence(800);
    audio.captureWav(toneWav(500, 0.5)); // after the tail
    audio.silence(400);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(1);
    expect(link.sends).toEqual([{ hsid: 'hs:01TEST', text: 'late enough' }]);
  });

  it('barge-in: VAD speech ≥ 300 ms during playback stops it and drops the rest; the speech is not forwarded', async () => {
    const { audio, engines, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    engines.tts.msPerSentence = 3000;
    link.reply('First long sentence here. Second sentence never said.');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.captureWav(toneWav(400, 0.5));
    await settle();
    expect(audio.isPlaying).toBe(false);
    expect(audio.played[0]!.completed).toBe(false);
    audio.silence(400);
    await client.idle();
    // pipelined: the second sentence was synthesized during the first, but the barge-in dropped it unplayed
    expect(engines.tts.said).toEqual(['First long sentence here.', 'Second sentence never said.']);
    expect(audio.played).toHaveLength(1);
    const agent = link.appends.filter((a) => a.kind === 'voice.turn.agent');
    expect(agent[0]!.payload).toMatchObject({ textSpoken: '', interrupted: true });
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(0);
    expect(link.sends).toHaveLength(0);
  });

  it('speech under 300 ms during playback is not a barge-in', async () => {
    const { audio, link } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    link.reply('Keep talking.');
    await settle();
    audio.captureWav(toneWav(200, 0.5));
    expect(audio.isPlaying).toBe(true);
  });

  it('barge-in: pressing the PTT hotkey during playback stops it', async () => {
    const { audio, link } = await setup();
    link.reply('Something to say.');
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.hotkey(true);
    expect(audio.isPlaying).toBe(false);
    audio.hotkey(false);
  });

  it('edits are summarized as "edited N files" at the end of the turn; questions are always read', async () => {
    const { audio, engines, link, client } = await setup();
    link.reply('I fixed it.', [
      { name: 'Edit', input: { file_path: '/r/a.ts' } },
      { name: 'Write', input: { file_path: '/r/b.ts' } },
      { name: 'Edit', input: { file_path: '/r/a.ts' } },
      { name: 'AskUserQuestion', input: { questions: [{ question: 'Ship it now?', options: [{ label: 'Yes' }, { label: 'No' }] }] } },
    ]);
    link.endTurn();
    for (let i = 0; i < 6; i++) {
      await settle();
      audio.tick(1000);
    }
    await client.idle();
    expect(engines.tts.said).toEqual(['I fixed it.', 'Ship it now?', 'Options: Yes, or No.', 'Edited 2 files.']);
  });
});

describe('G-VOX-05: no audio on disk', () => {
  it('a full run (capture, STT, playback, barge-in) creates no file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-novox-'));
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['x', 'y'] });
      audio.captureWav(toneWav(700, 0.5));
      audio.silence(400);
      link.reply('Hello there. More words.');
      await settle();
      audio.captureWav(toneWav(400, 0.5));
      audio.silence(2000);
      await client.idle();
      expect(fs.readdirSync(tmp)).toEqual([]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the capture/STT/playback modules never import the filesystem', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    for (const f of ['voice-client.ts', 'audio-io.ts', 'fake-audio-io.ts', 'speakable.ts', 'types.ts', 'engines/sherpa.ts']) {
      const text = fs.readFileSync(path.join(src, f), 'utf8');
      expect(text, f).not.toMatch(/from 'node:fs'|require\('fs'\)|from 'fs'|writeWave/);
    }
  });
});

describe('enrolment', () => {
  it('records 3 phrases, averages the embeddings and stores only the print (0600 under 0700)', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-enrol-'));
    try {
      const audio = new FakeAudioIO();
      const prompts: string[] = [];
      const r = await recordEnrolment({
        audio, vad: new StubVad(), speaker: new StubSpeaker(), model: 'stub', home, name: 'matt',
        prompt: (phrase) => {
          prompts.push(phrase);
          audio.capture(tone(1500, 0.5));
          audio.silence(400);
        },
      });
      expect(prompts).toHaveLength(3);
      expect(r.print.embedding).toEqual([1, 0]);
      expect(readPrints(home).map((p) => p.name)).toEqual(['matt']);
      expect(fs.readdirSync(path.join(home, 'voice', 'prints', 'matt'))).toEqual(['print.json']);
      if (typeof process.getuid === 'function') {
        expect(fs.statSync(r.file).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.join(home, 'voice', 'prints')).mode & 0o777).toBe(0o700);
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
