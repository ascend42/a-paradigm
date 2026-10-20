/**
 * T-2026-10-19-026 (founder dogfood 2026-10-20): spoken replies — pipelined TTS, warm-up, the stop paths (⌃⌥. hotkey,
 * the GUI's ⏹ / Esc via status.voice.stopSpeakingSeq, detach), the speaking flag, and the "scrolling stopped it"
 * regression (a status re-read, a failed read, a follow end or quiet VAD-latched noise never stop speech).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWav, FakeAudioIO } from '../src/fake-audio-io.js';
import { PRINT_SCHEMA, type VoicePrint } from '../src/speaker.js';
import { BARGE_IN_MIN_DBFS, VoiceClient, type ClientMode } from '../src/voice-client.js';
import { runVoice } from '../src/run.js';
import { PassThrough } from 'node:stream';
import { FakeLink, stubEngines, SR, toneWav } from './stubs.js';
import type { TtsEngine } from '../src/types.js';

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** A TTS whose syntheses resolve only when the test says so (records the order calls START). */
class GatedTts implements TtsEngine {
  readonly voice = 'gated';
  readonly started: string[] = [];
  readonly gates: Array<() => void> = [];
  warmed = 0;
  inFlight = 0;
  maxInFlight = 0;
  constructor(readonly msPerSentence = 1000, readonly withWarmUp = false) {
    if (!withWarmUp) (this as { warmUp?: unknown }).warmUp = undefined;
  }
  async synthesize(sentence: string): Promise<{ samples: Float32Array; sampleRate: number }> {
    this.started.push(sentence);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise<void>((r) => this.gates.push(r));
    this.inFlight--;
    return { samples: new Float32Array(Math.round((SR * this.msPerSentence) / 1000)), sampleRate: SR };
  }
  async warmUp(): Promise<void> {
    this.warmed++;
    this.started.push('<warm>');
    await new Promise<void>((r) => this.gates.push(r));
  }
  release(): void {
    this.gates.shift()?.();
  }
}

let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(o: { mode?: ClientMode; attachMode?: string; tts?: TtsEngine } = {}) {
  const audio = new FakeAudioIO();
  const engines = stubEngines([]);
  if (o.tts) (engines as { tts: TtsEngine }).tts = o.tts;
  const link = new FakeLink();
  if (o.attachMode) link.att = { ...link.att!, mode: o.attachMode };
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], mode: o.mode ?? 'ptt', delivery: 'direct', now: () => audio.clock });
  clients.push(client);
  await client.start();
  return { audio, engines, link, client };
}

describe('pipelined TTS', () => {
  it('synthesizes sentence 2 while sentence 1 plays, plays them in order, one synthesis at a time', async () => {
    const tts = new GatedTts();
    const { audio, link, client } = await setup({ tts });
    link.speakable([{ kind: 'reply', text: 'One here. Two here. Three here.' }]);
    await settle();
    expect(tts.started).toEqual(['One here.']);
    tts.release();
    await settle();
    // sentence 1 is playing and sentence 2 is ALREADY synthesizing (no synthesis gap after sentence 1)
    expect(audio.isPlaying).toBe(true);
    expect(tts.started).toEqual(['One here.', 'Two here.']);
    tts.release(); // sentence 2 ready before sentence 1 ends
    await settle();
    audio.tick(1000); // sentence 1 ends → sentence 2 starts at once (no wait on synthesis)
    await settle();
    expect(audio.isPlaying).toBe(true);
    expect(audio.played).toHaveLength(1);
    expect(tts.started).toEqual(['One here.', 'Two here.', 'Three here.']);
    tts.release();
    await settle();
    audio.tick(1000);
    await settle();
    audio.tick(1000);
    await client.idle();
    const spoken = link.appends.filter((a) => a.kind === 'voice.turn.agent').map((a) => a.payload.textSpoken);
    expect(spoken).toEqual(['One here.', 'Two here.', 'Three here.']);
    // the second chunk started the moment the first ended (gapless with respect to synthesis)
    expect(audio.played[1]!.t0).toBe(audio.played[0]!.t1);
    expect(tts.maxInFlight).toBe(1);
    expect(client.lastLatency).toMatchObject({ sentences: 3 });
  });

  it('warms the TTS once at start; the first reply queues behind the warm-up, never in parallel', async () => {
    const tts = new GatedTts(1000, true);
    const { link } = await setup({ tts });
    expect(tts.warmed).toBe(1);
    link.speakable([{ kind: 'reply', text: 'Hello.' }]);
    await settle();
    expect(tts.started).toEqual(['<warm>']);
    tts.release();
    await settle();
    expect(tts.started).toEqual(['<warm>', 'Hello.']);
    expect(tts.maxInFlight).toBe(1);
    tts.release();
  });

  it('a failed warm-up is logged and never blocks speech', async () => {
    const engines = stubEngines([]);
    (engines.tts as TtsEngine).warmUp = () => Promise.reject(new Error('cold'));
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], now: () => audio.clock });
    clients.push(client);
    await client.start();
    link.speakable([{ kind: 'reply', text: 'Still speaks.' }]);
    await settle();
    expect(audio.isPlaying).toBe(true);
  });
});

describe('the speaking flag (request.voice.report{playback})', () => {
  it('reports playing on the first sentence and not playing once the reply drained (edges only)', async () => {
    const { audio, link, client } = await setup();
    link.speakable([{ kind: 'reply', text: 'One. Two.' }]);
    await settle();
    expect(client.speaking).toBe(true);
    audio.tick(1000);
    await settle();
    audio.tick(1000);
    await client.idle();
    expect(client.speaking).toBe(false);
    expect(link.playback).toEqual([true, false]);
  });
});

describe('stop speaking', () => {
  it('⌃⌥. (control stop-speaking) stops the chunk now and drops the rest, including the prefetched sentence', async () => {
    const { audio, engines, link, client } = await setup();
    engines.tts.msPerSentence = 3000;
    link.speakable([{ kind: 'reply', text: 'First sentence. Second sentence. Third.' }]);
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.control('stop-speaking');
    expect(audio.isPlaying).toBe(false); // synchronous: play.stop goes out on the key-down event itself
    audio.tick(5000);
    await client.idle();
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]!.completed).toBe(false);
    expect(client.stops).toBe(1);
    expect(client.speaking).toBe(false);
    expect(link.playback).toEqual([true, false]);
  });

  it('a stop drops queued items of both voices: no earcon and no system speech plays after it (table talk x playback)', async () => {
    const { audio, engines, link, client } = await setup();
    engines.tts.msPerSentence = 3000;
    link.speakable([{ kind: 'reply', text: 'Model words.', from: 'block' }, { kind: 'edits', text: 'Edited 2 files. Done.', from: 'kernel' }]);
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.control('stop-speaking');
    audio.tick(10_000);
    for (let i = 0; i < 4; i++) {
      await settle();
      audio.tick(5000);
    }
    await client.idle();
    expect(audio.played).toHaveLength(1);
    expect(audio.played[0]!.completed).toBe(false);
    expect(client.speaking).toBe(false);
  });

  it('pipelined system speech: the earcon rides the first system sentence only, in the system speaker', async () => {
    const { audio, engines, link, client } = await setup();
    const lens: number[] = [];
    const play = audio.play.bind(audio);
    audio.play = (p) => (lens.push(p.samples.length), play(p));
    link.speakable([{ kind: 'edits', text: 'Edited 2 files. Done.', from: 'kernel' }]);
    for (let i = 0; i < 8; i++) {
      await settle();
      audio.tick(1500);
    }
    await client.idle();
    expect(engines.tts.voices).toEqual(['system', 'system']);
    expect(lens).toHaveLength(2);
    expect(lens[0]! - lens[1]!).toBeGreaterThan(0); // first carries the earcon prefix
  });

  it('the GUI ⏹ / Esc: a changed status.voice.stopSpeakingSeq on the next re-read stops speech (the first read is the baseline)', async () => {
    const { audio, link, client } = await setup();
    link.stopSeq = 4; // presses before this client started never stop anything
    await client.refresh();
    link.speakable([{ kind: 'reply', text: 'Talking away.' }]);
    await settle();
    await client.refresh();
    expect(audio.isPlaying).toBe(true);
    link.stopSeq = 5;
    await client.refresh();
    expect(audio.isPlaying).toBe(false);
    expect(client.stops).toBe(1);
  });

  it('a stop while the first sentence is still synthesizing plays nothing', async () => {
    const tts = new GatedTts();
    const { audio, link, client } = await setup({ tts });
    link.speakable([{ kind: 'reply', text: 'Never heard.' }]);
    await settle();
    expect(client.stopSpeaking('hotkey')).toBe(true);
    tts.release();
    await client.idle();
    expect(audio.played).toHaveLength(0);
  });

  it('a detach (a successful read with no attachment) stops speech', async () => {
    const { audio, link, client } = await setup();
    link.speakable([{ kind: 'reply', text: 'Talking away.' }]);
    await settle();
    link.att = null;
    await client.refresh();
    expect(audio.isPlaying).toBe(false);
  });

  it('nothing to stop: stopSpeaking is a no-op', async () => {
    const { client } = await setup();
    expect(client.stopSpeaking('hotkey')).toBe(false);
    expect(client.stops).toBe(0);
  });

  it('runVoice re-reads status every 300 ms while speaking: the GUI stop lands within one fast poll', async () => {
    const audio = new FakeAudioIO();
    const engines = stubEngines([]);
    engines.tts.msPerSentence = 60_000;
    const link = Object.assign(new FakeLink(), { status: async () => ({ voice: { principal: 'p:abcd1234/voice' } }), onClose: () => undefined });
    const stdin = new PassThrough();
    let client!: VoiceClient;
    const done = runVoice({ link, audio, engines, prints: () => [MATT], stdin, attachPollMs: 10_000, started: (c) => (client = c) });
    for (let i = 0; i < 50 && !client; i++) await new Promise((r) => setTimeout(r, 5));
    link.stopSeq = 0;
    await client.refresh();
    link.speakable([{ kind: 'reply', text: 'A long reply.' }]);
    await settle();
    expect(audio.isPlaying).toBe(true);
    const t0 = Date.now();
    link.stopSeq = 1;
    while (audio.isPlaying && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    const ms = Date.now() - t0;
    expect(audio.isPlaying).toBe(false);
    stdin.end();
    await done;
    // the idle cadence is 10 s here; while speaking the re-read runs every 300 ms
    expect(ms).toBeLessThan(700);
  });
});

describe('scroll regression: only an explicit stop, barge-in or detach stops speech', () => {
  it('a status re-read with the same attachment, a failed status read and a follow end do not stop playback', async () => {
    const { audio, link, client } = await setup();
    link.speakable([{ kind: 'reply', text: 'Keep going while I scroll.' }]);
    await settle();
    expect(audio.isPlaying).toBe(true);
    await client.refresh(); // the 1.5 s re-read
    expect(audio.isPlaying).toBe(true);
    link.attachmentError = new Error('status timeout');
    await client.refresh(); // a transient failure is not a detach
    expect(audio.isPlaying).toBe(true);
    link.attachmentError = undefined;
    await client.refresh();
    expect(audio.isPlaying).toBe(true);
    link.end!('reader-class-ended'); // the kernel ends voice readers on any attachment change (onAttachmentChange)
    await settle();
    expect(audio.isPlaying).toBe(true);
    expect(link.row).toBeDefined(); // followed again: the next reply is still heard
  });

  it('the same attachment whose follow ended is followed again (the client never goes deaf)', async () => {
    const { audio, link, client } = await setup();
    const first = link.row;
    link.end!('reader-class-ended');
    await settle();
    expect(link.row).toBeDefined();
    expect(link.row).not.toBe(first);
    link.speakable([{ kind: 'reply', text: 'Heard after the re-follow.' }]);
    await settle();
    expect(audio.isPlaying).toBe(true);
    expect(client.attachment?.voiceSessionId).toBe('vs:01TEST');
  });

  it('quiet VAD-latched noise (a trackpad, clicks, residual echo) during playback is not a barge-in; loud speech still is', async () => {
    const { audio, engines, link } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    engines.tts.msPerSentence = 5000;
    link.speakable([{ kind: 'reply', text: 'A long sentence to talk over.' }]);
    await settle();
    // a click train: one 0.3 spike per 32 ms frame — "speech" to the latched VAD (peak > 0.05), quiet in energy
    const clicks = new Float32Array(Math.round(SR * 0.8));
    for (let i = 0; i < clicks.length; i += 512) clicks[i] = 0.1;
    const rms = 20 * Math.log10(Math.sqrt(0.01 / 512));
    expect(rms).toBeLessThan(BARGE_IN_MIN_DBFS);
    audio.captureWav(encodeWav(clicks, SR));
    await settle();
    expect(audio.isPlaying).toBe(true);
    audio.captureWav(toneWav(400, 0.5));
    await settle();
    expect(audio.isPlaying).toBe(false);
  });
});
