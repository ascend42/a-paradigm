/** Stub engines and a fake kernel link for the pipeline tests (no models, no network, no audio device). */
import { encodeWav } from '../src/fake-audio-io.js';
import { SpeakableProjector } from '../src/speakable.js';
import type { KernelLink, KernelRow, PcmFrame, SpeakerEngine, SttEngine, TtsEngine, VadEngine, VadSegment, VoiceAttachment, VoiceEngines } from '../src/types.js';

export const SR = 16_000;
/** the fake kernel's principal (the tests' voice namespace is abcd1234) */
export const KERNEL_PRINCIPAL = 'p:abcd1234/kernel';

/** A tone of `ms` at amplitude `amp` (the amplitude stands in for "who is speaking"). */
export function tone(ms: number, amp: number, sr = SR): Float32Array {
  const n = Math.round((sr * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / sr);
  return out;
}
export function toneWav(ms: number, amp: number): Buffer {
  return encodeWav(tone(ms, amp), SR);
}

function peak(s: Float32Array): number {
  let p = 0;
  for (const x of s) p = Math.max(p, Math.abs(x));
  return p;
}

/** Energy VAD: speech = peak > 0.05; a segment closes after `hangMs` of silence. */
export class StubVad implements VadEngine {
  readonly sampleRate = SR;
  #open: { frames: PcmFrame[] } | null = null;
  #silentMs = 0;
  #speaking = false;
  resets = 0;
  constructor(readonly hangMs = 200) {}
  accept(f: PcmFrame): VadSegment[] {
    const ms = (f.samples.length / f.sampleRate) * 1000;
    this.#speaking = peak(f.samples) > 0.05;
    if (this.#speaking) {
      this.#open ??= { frames: [] };
      this.#open.frames.push(f);
      this.#silentMs = 0;
      return [];
    }
    if (!this.#open) return [];
    this.#silentMs += ms;
    if (this.#silentMs < this.hangMs) return [];
    return this.flush();
  }
  speaking(): boolean {
    return this.#speaking;
  }
  reset(): void {
    this.resets++;
    this.#open = null;
    this.#silentMs = 0;
  }
  flush(): VadSegment[] {
    const o = this.#open;
    this.#open = null;
    this.#silentMs = 0;
    if (!o || !o.frames.length) return [];
    const n = o.frames.reduce((s, f) => s + f.samples.length, 0);
    const samples = new Float32Array(n);
    let off = 0;
    for (const f of o.frames) (samples.set(f.samples, off), (off += f.samples.length));
    const t0 = o.frames[0]!.t0;
    return [{ samples, sampleRate: SR, t0, t1: t0 + (n / SR) * 1000 }];
  }
}

export class StubStt implements SttEngine {
  readonly model = 'stub-stt';
  readonly heard: number[] = [];
  constructor(readonly texts: string[]) {}
  async transcribe(samples: Float32Array): Promise<string> {
    this.heard.push(samples.length);
    return this.texts.shift() ?? 'hello';
  }
}

export class StubTts implements TtsEngine {
  readonly voice = 'stub';
  readonly said: string[] = [];
  /** table talk S4: the voice each sentence was asked in */
  readonly voices: Array<'model' | 'system'> = [];
  constructor(public msPerSentence = 1000) {}
  async synthesize(sentence: string, o?: { voice?: 'model' | 'system' }): Promise<{ samples: Float32Array; sampleRate: number }> {
    this.said.push(sentence);
    this.voices.push(o?.voice ?? 'model');
    return { samples: new Float32Array(Math.round((SR * this.msPerSentence) / 1000)), sampleRate: SR };
  }
}

/** Embedding by amplitude: ≥ 0.4 → [1, 0] (the enrolled "matt"), else [0, 1] (a stranger). */
export class StubSpeaker implements SpeakerEngine {
  readonly dim = 2;
  async embed(samples: Float32Array): Promise<Float32Array> {
    return peak(samples) >= 0.4 ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]);
  }
}

export function stubEngines(texts: string[] = []): VoiceEngines & { vad: StubVad; stt: StubStt; tts: StubTts } {
  return { vad: new StubVad(), stt: new StubStt(texts), tts: new StubTts(), speaker: new StubSpeaker() };
}

export class FakeLink implements KernelLink {
  att: VoiceAttachment | null = { voiceSessionId: 'vs:01TEST', hsid: 'hs:01TEST', mode: 'ptt' };
  readonly appends: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  readonly sends: Array<{ hsid: string; text: string }> = [];
  readonly interrupts: string[] = [];
  sendError: unknown;
  appendError: unknown;
  row: ((r: KernelRow) => void) | undefined;
  end: ((reason: string) => void) | undefined;
  #seq = 0;
  #turnSeq = 0;
  readonly #kernel = new SpeakableProjector();
  /** status.voice.stopSpeakingSeq (null ⇒ the kernel does not report it) */
  stopSeq: number | null = null;
  attachmentError: unknown;
  async attachment(): Promise<VoiceAttachment | null> {
    if (this.attachmentError) throw this.attachmentError;
    return this.att;
  }
  stopSpeakingSeq(): number | null {
    return this.stopSeq;
  }
  /** request.voice.report{playback} edges */
  readonly playback: boolean[] = [];
  /** request.voice.report{dictation} edges (TD-2026-10-20-262), kept apart from the log rows */
  readonly dictation: Array<{ activity: string; holdToggles: number }> = [];
  /** request.voice.report{capture} reports (T-2026-10-20-005 A1), kept apart from the log rows */
  readonly capture: Array<{ state: string; segId: string; reason?: string; level?: number }> = [];
  async append(kind: string, payload: Record<string, unknown>): Promise<{ seq: number }> {
    if (this.appendError) throw this.appendError;
    if (kind === 'request.voice.report' && payload.playback) {
      this.playback.push((payload.playback as { playing: boolean }).playing);
      return { seq: 0 };
    }
    if (kind === 'request.voice.report' && payload.capture) {
      this.capture.push(payload.capture as { state: string; segId: string; reason?: string; level?: number });
      return { seq: 0 };
    }
    if (kind === 'request.voice.report' && payload.dictation) {
      this.dictation.push(payload.dictation as { activity: string; holdToggles: number });
      return { seq: 0 };
    }
    this.appends.push({ kind, payload });
    return { seq: ++this.#seq };
  }
  async send(hsid: string, text: string): Promise<unknown> {
    if (this.sendError) throw this.sendError;
    this.sends.push({ hsid, text });
    return { ok: true };
  }
  async interrupt(hsid: string): Promise<unknown> {
    this.interrupts.push(hsid);
    return {};
  }
  async follow(_hsid: string, row: (r: KernelRow) => void, end: (reason: string) => void): Promise<() => void> {
    this.row = row;
    this.end = end;
    return () => {
      this.row = undefined;
    };
  }
  async close(): Promise<void> {}
  /**
   * The fake KERNEL: an assistant reply arrives as a turn.event (which the voice reader must ignore), and the
   * kernel's speakable projection (the reference SpeakableProjector) is delivered as
   * voice.turn.agent{source:'kernel-speakable', turnSeq, items}.
   */
  reply(text: string, tools: Array<{ name: string; input: Record<string, unknown> }> = []): void {
    const content = [{ type: 'text', text }, ...tools.map((t) => ({ type: 'tool_use', ...t }))];
    const payload = { type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { content } }) };
    this.row?.({ seq: ++this.#seq, kind: 'turn.event', payload });
    this.speakable(this.#kernel.push('turn.event', payload));
  }
  /** The turn ended: the kernel says the edit count. */
  endTurn(): void {
    this.row?.({ seq: ++this.#seq, kind: 'turn.result', payload: {} });
    this.speakable(this.#kernel.push('turn.result', {}));
  }
  speakable(items: Array<{ kind: string; text: string; from?: string }>, turnSeq = ++this.#turnSeq): void {
    if (!items.length) return;
    this.row?.({ seq: ++this.#seq, kind: 'voice.turn.agent', principal: KERNEL_PRINCIPAL, payload: { source: 'kernel-speakable', turnSeq, items: items.map((i) => ({ kind: i.kind === 'question' ? 'ask' : i.kind, text: i.text, ...(i.from !== undefined ? { from: i.from } : {}) })) } });
  }
}

export function refusal(reason: string): Error {
  return Object.assign(new Error(`refused: ${reason}`), { refusal: { code: 'FORBIDDEN', data: { reason } } });
}
