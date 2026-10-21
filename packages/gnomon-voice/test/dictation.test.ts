/**
 * $voice-turn dictation (TD-2026-10-20-262) with FakeAudioIO + stub engines + a fake kernel link: composer delivery
 * never sends, the request.voice.report{dictation} activity edges, the hold-toggle counter.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAudioIO } from '../src/fake-audio-io.js';
import { PRINT_SCHEMA, type VoicePrint } from '../src/speaker.js';
import { VoiceClient, type ClientMode, type Delivery } from '../src/voice-client.js';
import { FakeLink, stubEngines, toneWav } from './stubs.js';

const MATT: VoicePrint = { schemaVersion: PRINT_SCHEMA, name: 'matt', model: 'stub', dim: 2, phrases: 3, embedding: [1, 0], createdAt: '2026-10-19T00:00:00Z' };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

let clients: VoiceClient[] = [];
afterEach(async () => {
  for (const c of clients) await c.close();
  clients = [];
});

async function setup(o: { mode?: ClientMode; attachMode?: string; texts?: string[]; delivery?: Delivery } = {}) {
  const audio = new FakeAudioIO();
  const engines = stubEngines(o.texts ?? []);
  const link = new FakeLink();
  if (o.attachMode) link.att = { ...link.att!, mode: o.attachMode };
  const client = new VoiceClient({ audio, engines, link, ns: 'abcd1234', prints: () => [MATT], ...(o.mode ? { mode: o.mode } : {}), ...(o.delivery ? { delivery: o.delivery } : {}), now: () => audio.clock });
  clients.push(client);
  await client.start();
  return { audio, engines, link, client };
}

function ptt(audio: FakeAudioIO, ms: number, amp: number): void {
  audio.hotkey(true);
  audio.captureWav(toneWav(ms, amp));
  audio.hotkey(false);
}

describe('$voice-turn dictation (TD-2026-10-20-262): composer delivery', () => {
  it('composer mode (the default) never calls session.send; turns are appended forwarded:false', async () => {
    const { audio, link, client } = await setup({ texts: ['run the tests', 'and commit'] });
    expect(client.delivery).toBe('composer');
    ptt(audio, 800, 0.5);
    audio.silence(100);
    ptt(audio, 800, 0.5);
    await client.idle();
    expect(link.sends).toEqual([]);
    expect(link.appends.map((a) => a.payload)).toMatchObject([
      { speakerEnrolled: true, forwarded: false, text: 'run the tests' },
      { speakerEnrolled: true, forwarded: false, text: 'and commit' },
    ]);
    expect(link.appends.every((a) => !('forwardable' in a.payload))).toBe(true); // the kernel stamps it
  });

  it('PTT edges: speaking while held, transcribing at segment end, idle after the append (edges only)', async () => {
    const { audio, link, client } = await setup({ texts: ['hello'] });
    audio.hotkey(true);
    audio.captureWav(toneWav(600, 0.5));
    await settle();
    expect(client.activity).toBe('speaking');
    audio.hotkey(false);
    await client.idle();
    expect(link.dictation.map((d) => d.activity)).toEqual(['speaking', 'transcribing', 'idle']);
    expect(link.appends).toHaveLength(1);
    expect(link.sends).toEqual([]);
  });

  it('AMBIENT edges: speaking at VAD start, transcribing at segment end, idle after the append', async () => {
    const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', texts: ['what changed'] });
    audio.silence(100);
    audio.captureWav(toneWav(700, 0.5));
    audio.silence(400);
    await client.idle();
    expect(link.dictation.map((d) => d.activity)).toEqual(['speaking', 'transcribing', 'idle']);
    expect(link.appends).toHaveLength(1);
    expect(link.sends).toEqual([]);
  });

  it('TD-2026-10-21-514: send-now (⌃⌥Return) is counted and reported; a system event turns the mic off and reports micWanted', async () => {
    const { audio, link, client } = await setup();
    audio.control('send-now');
    await client.idle();
    expect(link.dictation.at(-1)).toMatchObject({ sendNows: 1, micWanted: true });
    audio.control('mic-off');
    await client.idle();
    expect(audio.micOn).toBe(false);
    expect(link.dictation.at(-1)).toMatchObject({ micWanted: false });
    audio.control('mic-toggle');
    await client.idle();
    expect(audio.micOn).toBe(true);
  });

  it('TD-2026-10-21-514: the GUI in-app key toggles the mic (a changed micToggleSeq); the Mic key switch re-binds; micWanted:false is restored', async () => {
    const { audio, link, client } = await setup();
    link.micSeq = 3;
    await client.refresh(); // the baseline
    expect(audio.micOn).toBe(true);
    link.micSeq = 4;
    await client.refresh();
    await client.idle();
    expect(audio.micOn).toBe(false);
    link.micBare = true;
    await client.refresh();
    await client.idle();
    expect(audio.hotkeyOps.at(-1)).toEqual({ bindings: { 'mic-toggle': '\`' }, allowBare: true });
    const b = await setup();
    b.link.micWant = false;
    await b.client.refresh();
    await b.client.idle();
    expect(b.audio.micOn).toBe(false);
  });

  it('TD-2026-10-21-514: toggle capture starts with the mic off unless the kernel holds micWanted:true', async () => {
    const audio = new FakeAudioIO();
    const link = new FakeLink();
    const c = new VoiceClient({ audio, engines: stubEngines([]), link, ns: 'abcd1234', prints: () => [], mode: 'ambient', capture: 'toggle', now: () => audio.clock });
    await c.start();
    expect(audio.micOn).toBe(false); // unknown ⇒ off
    link.micWant = true;
    const audio2 = new FakeAudioIO();
    const d = new VoiceClient({ audio: audio2, engines: stubEngines([]), link, ns: 'abcd1234', prints: () => [], mode: 'ambient', capture: 'toggle', now: () => 0 });
    await d.start();
    await d.idle();
    expect(audio2.micOn).toBe(true); // the kernel held micWanted:true ⇒ back on
    await c.close();
    await d.close();
  });

  it('the hold-toggle hotkey increments holdToggles and reports it (monotone)', async () => {
    const { audio, link, client } = await setup();
    audio.control('hold-toggle');
    audio.control('hold-toggle');
    await client.idle();
    expect(client.holdToggles).toBe(2);
    expect(link.dictation).toEqual([
      { activity: 'idle', holdToggles: 1, sendNows: 0, micWanted: true },
      { activity: 'idle', holdToggles: 2, sendNows: 0, micWanted: true },
    ]);
    ptt(audio, 600, 0.5);
    await client.idle();
    expect(link.dictation.length).toBeGreaterThan(2);
    expect(link.dictation.slice(2).every((d) => d.holdToggles === 2)).toBe(true);
  });

  it('direct delivery keeps the old forward (headless --delivery direct)', async () => {
    const { audio, link, client } = await setup({ delivery: 'direct', texts: ['ship it'] });
    ptt(audio, 600, 0.5);
    await client.idle();
    expect(link.appends[0]!.payload).toMatchObject({ forwarded: true });
    expect(link.sends).toEqual([{ hsid: 'hs:01TEST', text: 'ship it' }]);
  });

  it('TD-2026-10-20-125: ambient speech never auto-sends, under either delivery; it is dictated for the composer', async () => {
    for (const delivery of ['composer', 'direct'] as const) {
      const { audio, link, client } = await setup({ mode: 'ambient', attachMode: 'conversation', delivery, texts: ['delete the branch'] });
      audio.captureWav(toneWav(700, 0.5));
      audio.silence(3_500); // well past any silence countdown
      await client.idle();
      const turns = link.appends.filter((a) => a.kind === 'voice.turn.user');
      expect(turns.map((t) => t.payload), delivery).toEqual([expect.objectContaining({ mode: 'conversation', speakerEnrolled: true, forwarded: false, text: 'delete the branch' })]);
      expect(link.sends, delivery).toEqual([]); // (a PTT turn under direct still sends: the test above)
    }
  });
});
