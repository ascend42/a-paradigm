import { describe, expect, it } from 'vitest';
import { attachmentFromStatus, GnomonKernelLink, nsOf, type GnomonClientLike } from '../src/kernel-link.js';
import { decodePcm, encodeFrame, encodePcm, FRAME_JSON, FRAME_PCM, FrameReader } from '../src/audio-io.js';

describe('GnomonKernelLink (structural client)', () => {
  it('reads the attachment from status.voice and the V1 send contract content: [{text}]', async () => {
    const calls: Array<[string, unknown]> = [];
    const client: GnomonClientLike = {
      call: async (m, p) => (calls.push([m, p]), m === 'status' ? { voice: { attached: { voiceSessionId: 'vs:1', hsid: 'hs:1', mode: 'ptt', turns: 0 } } } : { seq: 7 }),
      subscribe: async () => ({}),
      close: async () => undefined,
    };
    const link = new GnomonKernelLink(client);
    expect(await link.attachment()).toEqual({ voiceSessionId: 'vs:1', hsid: 'hs:1', mode: 'ptt' });
    await link.send('hs:1', 'hello');
    await link.interrupt('hs:1');
    expect(await link.append('voice.turn.user', { a: 1 })).toEqual({ seq: 7 });
    expect(calls.slice(1)).toEqual([
      ['session.send', { hsid: 'hs:1', content: [{ text: 'hello' }] }],
      ['session.stop', { hsid: 'hs:1', interrupt: true }],
      ['log.append', { kind: 'voice.turn.user', payload: { a: 1 } }],
    ]);
  });
  it('no attachment ⇒ null; ns comes from p:<ns>/voice only', () => {
    expect(attachmentFromStatus({ voice: { attached: null } })).toBeNull();
    expect(attachmentFromStatus({})).toBeNull();
    expect(nsOf('p:abcd1234/voice')).toBe('abcd1234');
    expect(() => nsOf('p:abcd1234/human')).toThrow();
  });
});

describe('gnomon-voice-io framing (assumed V2b wire)', () => {
  it('round-trips PCM and JSON frames split across chunks', () => {
    const pcm = encodePcm(1234.5, Float32Array.from([0, 0.5, -0.5]));
    const js = encodeFrame(FRAME_JSON, Buffer.from('{"ev":"hotkey","down":true}'));
    const all = Buffer.concat([pcm, js]);
    const got: Array<[number, Buffer]> = [];
    const r = new FrameReader();
    r.push(all.subarray(0, 7), (t, p) => got.push([t, p]));
    r.push(all.subarray(7), (t, p) => got.push([t, p]));
    expect(got.map((g) => g[0])).toEqual([FRAME_PCM, FRAME_JSON]);
    const d = decodePcm(got[0]![1]);
    expect(d.t0).toBe(1234.5);
    expect(Math.abs(d.samples[1]! - 0.5)).toBeLessThan(1e-3);
  });
  it('refuses an oversize frame', () => {
    const h = Buffer.alloc(5);
    h.writeUInt32BE(64 * 1024 * 1024, 1);
    expect(() => new FrameReader().push(h, () => undefined)).toThrow(/cap/);
  });
});
