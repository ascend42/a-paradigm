/**
 * B1 live words (T-2026-10-20-005; V1–V5 in TD-2026-10-20-086): the LocalAgreement-2 unit (scripted decodes, spelling
 * flips, anchoring) and the voice client's partial loop with scripted engines (no models, no audio device).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAudioIO, encodeWav } from '../src/fake-audio-io.js';
import { capPartial, LiveAgreement, PARTIAL_FULL_WINDOW_MS, PARTIAL_MAX_WINDOW_MS, PARTIAL_TAIL_WINDOW_MS, sanitizeWords, stripTrailingPunct, wordsOfResult, type PartialWord } from '../src/partials.js';
import { PRINT_SCHEMA, type VoicePrint } from '../src/speaker.js';
import { VoiceClient, type ClientMode, type Delivery } from '../src/voice-client.js';
import { FakeLink, SR, stubEngines, StubStt, toneWav } from './stubs.js';

const W = (s: string, starts?: number[]): PartialWord[] => s.split(' ').filter(Boolean).map((text, i) => ({ text, ...(starts ? { start: starts[i] } : {}) }));

describe('LiveAgreement (LocalAgreement-2)', () => {
  it('commits what two consecutive decodes agree on; committed words never shrink; the rest is the tail', () => {
    const a = new LiveAgreement();
    expect(a.push(W('Run the'))).toEqual({ committed: '', tail: 'Run the' });
    expect(a.push(W('Run the tests.'))).toEqual({ committed: 'Run the', tail: 'tests' });
    expect(a.push(W('Run the test is'))).toEqual({ committed: 'Run the', tail: 'test is' });
    expect(a.push(W('Run the tests in'))).toEqual({ committed: 'Run the', tail: 'tests in' });
    expect(a.push(W('Run the tests in main.'))).toEqual({ committed: 'Run the tests in', tail: 'main' });
    // a decode that drops words never shrinks what is committed
    expect(a.push(W('Run'))).toEqual({ committed: 'Run the tests in', tail: '' });
    expect(a.committedCount).toBe(4);
  });

  it('a tokenisation flip inside the committed region (river bank ↔ riverbank) retracts nothing', () => {
    const a = new LiveAgreement();
    a.push(W('down by the river bank'));
    expect(a.push(W('down by the river bank she'))).toEqual({ committed: 'down by the river bank', tail: 'she' });
    // the flip is aligned by characters: the tail is still right, and agreement continues
    expect(a.push(W('down by the riverbank she sat'))).toEqual({ committed: 'down by the river bank she', tail: 'sat' });
    expect(a.push(W('down by the river bank she sat.'))).toEqual({ committed: 'down by the river bank she sat', tail: '' });
  });

  it('a real disagreement inside the committed region (Phebe ↔ Phoebe) commits nothing that round and never retracts', () => {
    const a = new LiveAgreement();
    a.push(W('observed Phebe'));
    a.push(W('observed Phebe quietly'));
    expect(a.text().committed).toBe('observed Phebe');
    expect(a.push(W('observed Phoebe quietly then'))).toEqual({ committed: 'observed Phebe', tail: 'quietly then' });
    // the next decode back in agreement resumes committing (against the last consistent one only)
    a.push(W('observed Phebe quietly then left'));
    expect(a.push(W('observed Phebe quietly then left.')).committed).toBe('observed Phebe quietly then left');
  });

  it('strips the trailing punctuation of the shown line and of a word committed at a decode end', () => {
    const a = new LiveAgreement();
    a.push(W('Hello, world.'));
    expect(a.push(W('Hello, world.'))).toEqual({ committed: 'Hello, world', tail: '' });
    expect(a.push(W('Hello, world. How are'))).toEqual({ committed: 'Hello, world', tail: 'How are' });
    expect(stripTrailingPunct('tests?!')).toBe('tests');
    expect(stripTrailingPunct("don't")).toBe("don't");
  });

  it('boundaries are committed word starts; reanchor freezes the words before the head and keeps agreeing', () => {
    const a = new LiveAgreement();
    a.push(W('one two three four', [0.1, 0.6, 1.1, 1.6]));
    a.push(W('one two three four five', [0.1, 0.6, 1.1, 1.6, 2.1]));
    expect(a.text()).toEqual({ committed: 'one two three four', tail: 'five' });
    const b = a.boundaries();
    expect(b.map((x) => x.word)).toEqual([1, 2, 3, 4]);
    expect(b[2]).toEqual({ word: 3, committed: 3, start: 1.6 });
    a.reanchor(b[2]!);
    expect(a.boundaries()).toEqual([]); // the old timings are stale until the next decode
    // the next window starts at "four"
    expect(a.push(W('four five six', [0.05, 0.55, 1.05]))).toEqual({ committed: 'one two three four five', tail: 'six' });
    expect(a.boundaries()[0]).toMatchObject({ word: 1, committed: 1, start: 0.55 });
  });

  it('after a reanchor, a leading fragment of the last frozen word (the head margin) is dropped for that window', () => {
    const a = new LiveAgreement();
    a.push(W('run the tests now', [0.1, 0.5, 0.9, 1.4]));
    a.push(W('run the tests now please', [0.1, 0.5, 0.9, 1.4, 1.8]));
    a.reanchor(a.boundaries().find((b) => b.committed === 3)!); // head at "now": "tests" is frozen
    expect(a.push(W('s now please go'))).toEqual({ committed: 'run the tests now please', tail: 'go' });
    expect(a.push(W('s now please go home'))).toEqual({ committed: 'run the tests now please go', tail: 'home' });
    expect(a.text().committed.split(' ').filter((w) => w === 'tests' || w === 's')).toEqual(['tests']);
  });

  it('wordsOfResult splits sherpa tokens at a leading space and keeps each word start', () => {
    const r = { text: ' Well, I don’t', tokens: [' Well', ',', ' I', ' don', "'", 't'], timestamps: [0.4, 0.64, 0.72, 0.8, 0.96, 1.04] };
    expect(wordsOfResult(r)).toEqual([{ text: 'Well,', start: 0.4 }, { text: 'I', start: 0.72 }, { text: "don't", start: 0.8 }]);
    expect(wordsOfResult({ text: 'no tokens here' })).toEqual([{ text: 'no' }, { text: 'tokens' }, { text: 'here' }]);
  });

  it('capPartial sanitises and keeps the NEWEST words within the cap', () => {
    expect(capPartial({ committed: 'a\u0000b‮c', tail: ' d​e ' })).toEqual({ committed: 'a b c', tail: 'd e' });
    const long = capPartial({ committed: Array.from({ length: 200 }, (_, i) => `w${i}`).join(' '), tail: 'last words' });
    expect(long.tail).toBe('last words');
    expect(long.committed.endsWith('w199')).toBe(true);
    expect(long.committed.length + 1 + long.tail.length).toBeLessThanOrEqual(600);
    expect(sanitizeWords('  x \n\t y ')).toBe('x y');
    // Aegis L3: tag characters, variation selectors and Hangul fillers
    expect(sanitizeWords('a\u{E0041}\u{E007F}b\uFE0Fc\u{E0100}d\u115Fe\u3164f\uFFA0g')).toBe('a b c d e f g');
  });
});

/* ── the client loop ───────────────────────────────────────────────────────────────────────────────────────────── */

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const BLOCK = SR / 2;

/**
 * Speech whose 0.5 s blocks carry their index in the amplitude (0.5 + k/1000): the scripted STT "hears" word wK for
 * block K, with its start, from any window, so anchoring can be checked end to end. Amplitude ≥ 0.4 = the enrolled
 * speaker for StubSpeaker; < 0.4 = a stranger.
 */
function blocks(fromBlock: number, ms: number, base = 0.5): Float32Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = base + (fromBlock + Math.floor(i / BLOCK)) / 1000;
  return out;
}

class ScriptStt extends StubStt {
  readonly windows: number[] = [];
  inFlight = 0;
  maxInFlight = 0;
  hold: Promise<void> | undefined;
  constructor(final: string[]) {
    super(final);
  }
  async transcribeWords(samples: Float32Array): Promise<PartialWord[]> {
    this.windows.push(samples.length);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.hold) await this.hold;
    this.inFlight--;
    const out: PartialWord[] = [];
    let k = -1;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i]! < 0.3) continue; // silence (the pre-roll): no word
      const kk = Math.round((samples[i]! - 0.5) * 1000);
      if (kk !== k) {
        k = kk;
        out.push({ text: `w${k}`, start: i / SR });
      }
    }
    if (out.length) out[out.length - 1]!.text += '.';
    return out;
  }
}

let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(o: { mode?: ClientMode; attachMode?: string; final?: string[]; delivery?: Delivery; prints?: VoicePrint[] } = {}) {
  const audio = new FakeAudioIO();
  const engines = stubEngines();
  const stt = new ScriptStt(o.final ?? ['the final words']);
  engines.stt = stt;
  const link = new FakeLink();
  if (o.attachMode) link.att = { ...link.att!, mode: o.attachMode };
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => o.prints ?? [MATT], mode: o.mode ?? 'ptt', delivery: o.delivery ?? 'composer', now: () => audio.clock });
  clients.push(client);
  await client.start();
  return { audio, engines, stt, link, client };
}

/** hold PTT for `ms`, feeding 600 ms at a time and letting each decode finish */
async function speak(audio: FakeAudioIO, ms: number, base = 0.5): Promise<void> {
  audio.hotkey(true);
  for (let t = 0; t < ms; t += 600) {
    audio.capture(blocks(t / 500, Math.min(600, ms - t), base));
    await settle();
  }
}
const texts = (link: FakeLink) => link.capture.map((c) => (c as { text?: { committed: string; tail: string } }).text).filter(Boolean) as Array<{ committed: string; tail: string }>;

describe('the voice client: live words', () => {
  it('an enrolled speaker: words appear after the V1 gate, committed grows and never shrinks; the final is the full-segment decode', async () => {
    const { audio, stt, link, client, engines } = await setup({ final: ['run the tests now'] });
    audio.silence(400);
    await speak(audio, 3_600);
    // V1: nothing before the provisional match on the first 1.5 s
    expect(client.partialStats.gatedIn).toBe(1);
    const seen = texts(link);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.committed.startsWith(seen[i - 1]!.committed)).toBe(true);
    expect(seen.at(-1)!.committed).toMatch(/^w\d+( w\d+)*$/); // no trailing period
    audio.hotkey(false);
    await client.idle();
    // the final: one full-segment transcribe (the PTT span), its text in voice.turn.user
    expect(engines.stt.heard).toEqual([Math.round((SR * 3_600) / 1000)]);
    const turns = link.appends.filter((a) => a.kind === 'voice.turn.user');
    expect(turns).toHaveLength(1);
    expect(turns[0]!.payload.text).toBe('run the tests now');
    // partials never reach append, send or the log
    expect(JSON.stringify(link.appends)).not.toMatch(/\bw\d+\b/);
    expect(link.sends).toEqual([]);
    // terminal reports carry no words; the transcribing report may carry the last ones
    for (const c of link.capture) if (c.state !== 'hearing' && c.state !== 'transcribing') expect(c).not.toHaveProperty('text');
    expect(stt.windows.length).toBe(client.partialStats.decodes);
  });

  it('V1/V4: an unknown speaker gets no words in any report (and no partial decode at all)', async () => {
    const { audio, stt, link, client } = await setup();
    await speak(audio, 3_000, 0.2);
    audio.hotkey(false);
    await client.idle();
    expect(client.partialStats).toMatchObject({ gatedOut: 1, gatedIn: 0, decodes: 0 });
    expect(stt.windows).toEqual([]);
    expect(texts(link)).toEqual([]);
    expect(link.capture.at(-1)).toMatchObject({ state: 'dropped', reason: 'not-enrolled' });
  });

  it('V1: nobody enrolled ⇒ no words; a segment shorter than the gate ⇒ no words', async () => {
    const a = await setup({ prints: [] });
    await speak(a.audio, 2_400);
    a.audio.hotkey(false);
    await a.client.idle();
    expect(texts(a.link)).toEqual([]);
    const b = await setup();
    await speak(b.audio, 1_000);
    b.audio.hotkey(false);
    await b.client.idle();
    expect(texts(b.link)).toEqual([]);
    expect(b.client.partialStats.decodes).toBe(0);
  });

  it('AMBIENT works the same way (VAD start opens the segment, with pre-roll)', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation' });
    for (let t = 0; t < 3_000; t += 600) {
      audio.capture(blocks(t / 500, 600));
      await settle();
    }
    expect(texts(link).length).toBeGreaterThan(0);
    audio.silence(400);
    await client.idle();
    expect(link.appends.filter((a) => a.kind === 'voice.turn.user')).toHaveLength(1);
  });

  it('ONE decode in flight: ticks during a running decode are skipped, never queued', async () => {
    const { audio, stt, client } = await setup();
    let release!: () => void;
    stt.hold = new Promise((r) => (release = r));
    audio.hotkey(true);
    for (let t = 0; t < 1_800; t += 600) {
      audio.capture(blocks(t / 500, 600));
      await settle(); // the third tick passes the gate; its first decode starts and blocks
    }
    expect(stt.windows).toHaveLength(1);
    audio.capture(blocks(3.6, 3_000)); // 5 ticks while busy
    await settle();
    expect(stt.windows).toHaveLength(1);
    expect(client.partialStats.skipped).toBeGreaterThanOrEqual(4);
    release();
    stt.hold = undefined;
    await settle();
    expect(stt.windows).toHaveLength(1); // nothing was queued behind it
    audio.capture(blocks(10, 600));
    await settle();
    expect(stt.windows).toHaveLength(2);
    expect(stt.maxInFlight).toBe(1);
    audio.hotkey(false);
    await client.idle();
  });

  it('the window: from the start up to 6 s, then about 4 s anchored at a committed boundary (never past 8 s); the words stay contiguous', async () => {
    const { audio, stt, link, client } = await setup();
    await speak(audio, 12_000);
    const ms = stt.windows.map((n) => (n / SR) * 1000);
    expect(Math.max(...ms)).toBeLessThanOrEqual(PARTIAL_MAX_WINDOW_MS);
    expect(ms.some((x) => x > PARTIAL_FULL_WINDOW_MS - 600)).toBe(true);
    // after the switch the windows shrink back to about the tail length
    expect(ms.at(-1)!).toBeLessThanOrEqual(PARTIAL_TAIL_WINDOW_MS + 700);
    // re-anchoring never duplicates or drops a word: w0 w1 … wN, in order
    const last = texts(link).at(-1)!;
    const all = `${last.committed} ${last.tail}`.trim().split(' ');
    all.forEach((w, i) => expect(w).toBe(`w${i}`));
    expect(all.length).toBeGreaterThanOrEqual(20);
    audio.hotkey(false);
    await client.idle();
  });

  it('dictation (composer delivery) never inserts partials: the turn carries the final words only, nothing is sent', async () => {
    const { audio, link, client } = await setup({ delivery: 'composer', final: ['final only'] });
    await speak(audio, 3_000);
    expect(texts(link).length).toBeGreaterThan(0);
    audio.hotkey(false);
    await client.idle();
    const turn = link.appends.find((a) => a.kind === 'voice.turn.user')!;
    expect(turn.payload).toMatchObject({ text: 'final only', forwarded: false });
    expect(link.sends).toEqual([]);
    expect(link.appends.every((a) => !JSON.stringify(a.payload).includes('w1'))).toBe(true);
  });

  it('an STT without transcribeWords (and partials:false) produces no live words', async () => {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const client = new VoiceClient({ audio, engines: stubEngines(['hi']), link, ns: 'abcd1234', prints: () => [MATT], mode: 'ptt', now: () => audio.clock });
    clients.push(client);
    await client.start();
    audio.hotkey(true);
    audio.captureWav(toneWav(3_000, 0.5));
    await settle();
    audio.hotkey(false);
    await client.idle();
    expect(texts(link)).toEqual([]);
    expect(client.partialStats.decodes).toBe(0);
    expect(encodeWav).toBeTypeOf('function');
  });
});
