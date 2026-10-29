/**
 * #gnomon-voice V2e item 3: the kernel's speakable reply row (KernelSpeakable) and the NARROWED voice reader
 * projection (redaction.ts case 'voice': voice.* rows of the attached session only; the kernel's speakable row in
 * full; never turn.* or a secret row). Plus the client's relayed reports (request.voice.report → status.voice).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inputChoicePath, readInputChoice, writeInputChoice } from '../src/kernel/voice/input-choice-store.js';
import { readReplyMode, replyModePath, writeReplyMode } from '../src/kernel/voice/reply-mode-store.js';
import { KernelSpeakable, SpeakableProjector, speakableSummary, isKernelSpeakable, ASK_WAITING } from '../src/kernel/voice/speakable.js';
import { mayBeVisible, projectForReader } from '../src/kernel/log/redaction.js';
import { voiceStatusFor, VoiceReports, VOICE_MIC_METER_TTL_MS, VOICE_REPORT_TTL_MS } from '../src/kernel/voice/voice-requests.js';
import { checkStatusNumbers } from '../src/kernel/socket/status-numbers.js';

const HSID = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
const line = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
const ev = (seq: number, kind: string, payload: Record<string, unknown>, session: string | undefined = HSID) => ({ seq, kind, session, payload });

describe('#gnomon-voice V2e: KernelSpeakable', () => {
  it('projects the attached session only: reply (gnome line / first paragraph), every ask, edits at turn end', () => {
    let attached: string | null = HSID;
    const k = new KernelSpeakable(() => attached);
    const diff = 'Done.\n\n```diff\n- a\n+ b\n```';
    expect(k.observe(ev(5, 'turn.event', { line: line([{ type: 'text', text: 'Here is the plan.\n\nSecond para.' }]) }))).toEqual({
      kind: 'voice.turn.agent',
      session: HSID,
      payload: { source: 'kernel-speakable', turnSeq: 5, items: [{ kind: 'reply', text: 'Here is the plan.', from: 'heuristic' }] },
    });
    expect(k.observe(ev(6, 'turn.event', { line: line([{ type: 'text', text: 'Long words.\ngnome: All tests pass.' }]) }))?.payload.items).toEqual([{ kind: 'reply', text: 'All tests pass.', from: 'heuristic' }]);
    expect(k.observe(ev(7, 'turn.event', { line: line([{ type: 'text', text: diff }, { type: 'tool_use', name: 'Edit', input: { file_path: '/a' } }, { type: 'tool_use', name: 'Write', input: { file_path: '/b' } }, { type: 'tool_use', name: 'Edit', input: { file_path: '/a' } }]) }))?.payload.items).toEqual([{ kind: 'reply', text: 'Done.', from: 'heuristic' }]);
    expect(k.observe(ev(8, 'turn.event', { line: line([{ type: 'tool_use', id: 'tu1', name: 'AskUserQuestion', input: { questions: [{ question: 'Ship it?', options: [{ label: 'yes' }, { label: 'no' }] }] } }]) }))?.payload.items).toEqual([{ kind: 'ask', text: 'Ship it? Options: yes, or no.' }]);
    // the turn.ask-user row for the same tool use is not said twice; an unseen one says a question is waiting
    expect(k.observe(ev(9, 'turn.ask-user', { toolUseId: 'tu1' }))).toBeNull();
    expect(k.observe(ev(10, 'turn.ask-user', { toolUseId: 'tu9' }))?.payload.items).toEqual([{ kind: 'ask', text: ASK_WAITING, from: 'kernel' }]);
    expect(k.observe(ev(11, 'turn.result', { tokens: 1 }))?.payload).toEqual({ source: 'kernel-speakable', turnSeq: 11, items: [{ kind: 'edits', text: 'Edited 2 files.', from: 'kernel' }] });
    // never: another session, a hashed line, tool output, an unrelated kind, nothing attached
    expect(k.observe(ev(12, 'turn.event', { line: line([{ type: 'text', text: 'hi' }]) }, 'hs:other'))).toBeNull();
    expect(k.observe(ev(13, 'turn.event', { lineHash: 'sha256:x', bytes: 99999 }))).toBeNull();
    expect(k.observe(ev(14, 'turn.event', { line: JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'secret output' }] } }) }))).toBeNull();
    expect(k.observe(ev(15, 'voice.turn.agent', { source: 'kernel-speakable' }))).toBeNull();
    attached = null;
    expect(k.observe(ev(16, 'turn.event', { line: line([{ type: 'text', text: 'hi' }]) }))).toBeNull();
  });
  it('re-attaching drops the old projector state (no edit count carries over)', () => {
    let attached = HSID;
    const k = new KernelSpeakable(() => attached);
    k.observe(ev(1, 'turn.event', { line: line([{ type: 'tool_use', name: 'Edit', input: { file_path: '/a' } }]) }));
    attached = 'hs:01JBBBBBBBBBBBBBBBBBBBBBBB';
    expect(k.observe(ev(2, 'turn.result', {}, attached))).toBeNull();
  });
  it('speakableSummary strips code and diffs; the projector says nothing for a pure diff', () => {
    expect(speakableSummary('```ts\nconst x = 1;\n```\n\n-removed\n+added')).toBe('');
    expect(new SpeakableProjector().push('turn.event', { line: line([{ type: 'text', text: 'diff --git a/x b/x\n@@ -1 +1 @@' }]) })).toEqual([]);
  });
});

describe('#gnomon-voice V2e: the voice reader sees voice.* only (narrowed)', () => {
  const reader = { class: 'voice' as const, hsid: HSID };
  const row = (kind: string, principal: string, payload: Record<string, unknown>, sensitivity = 'normal', session: string | undefined = HSID) =>
    ({ seq: 1, kind, session, sensitivity, payload, principal, id: 'ev:1', ts: '2026-10-19T00:00:00Z', hash: 'h' }) as never;
  it('the kernel speakable row is shown in full; a voice-written look-alike is not', () => {
    const k = row('voice.turn.agent', 'p:abcdefgh/kernel', { source: 'kernel-speakable', turnSeq: 4, items: [{ kind: 'reply', text: 'ok' }] }, 'sensitive');
    expect(isKernelSpeakable(k)).toBe(true);
    expect(projectForReader(k, reader)).toMatchObject({ view: 'full', event: { payload: { items: [{ kind: 'reply', text: 'ok' }] } } });
    const fake = row('voice.turn.agent', 'p:abcdefgh/voice', { source: 'kernel-speakable', items: [] }, 'sensitive');
    expect(isKernelSpeakable(fake)).toBe(false);
    expect(projectForReader(fake, reader)?.view).toBe('stub');
  });
  it('never turn.event, turn.result, turn.ask-user, approval, session rows or secret rows — even of the attached session', () => {
    for (const kind of ['turn.event', 'turn.result', 'turn.ask-user', 'approval.request', 'session.open', 'turn.sent']) {
      expect(projectForReader(row(kind, 'p:abcdefgh/kernel', { line: 'diff' }), reader), kind).toBeUndefined();
      expect(mayBeVisible(row(kind, 'p:abcdefgh/kernel', {}), reader), kind).toBe(false);
    }
    expect(projectForReader(row('voice.enrol', 'p:abcdefgh/kernel', {}, 'secret'), reader)).toBeUndefined();
    expect(projectForReader(row('voice.turn.agent', 'p:abcdefgh/kernel', { source: 'kernel-speakable' }, 'sensitive', 'hs:other'), reader)).toBeUndefined();
  });
});

describe('#gnomon-voice V2e: request.voice.report (relayed in status.voice, no kind)', () => {
  it('validates and relays enrolment progress and notices; stale past the TTL', () => {
    let t = 1_000_000;
    const r = new VoiceReports(() => t);
    expect(r.status()).toEqual({ enrolment: null, notice: null, dictation: null, playback: null, capture: null, prints: null, mic: null, inputChoice: { id: null, name: null }, micMeterOpen: false, stopSpeakingSeq: 0, micWanted: null, micToggleSeq: 0, micKeyBare: false, replyMode: 'speak' });
    r.report({ enrolment: { name: 'founder', phase: 'recording', phrase: 2, of: 5 } });
    r.report({ notice: { text: 'Microphone access is off.‮' } });
    const at = new Date(t).toISOString();
    expect(r.status()).toEqual({ enrolment: { name: 'founder', phase: 'recording', phrase: 2, of: 5, at }, notice: { text: 'Microphone access is off. ', at }, dictation: null, playback: null, capture: null, prints: null, mic: null, inputChoice: { id: null, name: null }, micMeterOpen: false, stopSpeakingSeq: 0, micWanted: null, micToggleSeq: 0, micKeyBare: false, replyMode: 'speak' });
    for (const bad of [null, {}, { x: 1 }, { enrolment: { name: 'Bad Name', phase: 'ready' } }, { enrolment: { name: 'a', phase: 'nope' } }, { enrolment: { name: 'a', phase: 'ready', phrase: -1 } }, { enrolment: { name: 'a', phase: 'ready', extra: 1 } }, { notice: { text: '' } }, { notice: { text: 'x', y: 1 } }]) {
      expect(() => r.report(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
    r.report({ notice: { text: 'Ambient is above this attachment', code: 'ambient-above-ceiling' } });
    expect(r.status().notice).toEqual({ text: 'Ambient is above this attachment', code: 'ambient-above-ceiling', at });
    expect(() => r.report({ notice: { text: 'x', code: 'Bad Code' } })).toThrow(TypeError);
    r.requested('founder');
    expect(r.status().enrolment).toEqual({ name: 'founder', phase: 'requested', at });
    expect(() => r.report({ enrolment: { name: 'founder', phase: 'requested' } })).toThrow(TypeError); // kernel-only phase
    r.report({ notice: { text: 'x'.repeat(1000) } });
    expect(r.status().notice!.text).toHaveLength(280);
    t += VOICE_REPORT_TTL_MS + 1;
    expect(r.status()).toEqual({ enrolment: null, notice: null, dictation: null, playback: null, capture: null, prints: null, mic: null, inputChoice: { id: null, name: null }, micMeterOpen: false, stopSpeakingSeq: 0, micWanted: null, micToggleSeq: 0, micKeyBare: false, replyMode: 'speak' });
  });

  it('2026-10-23: the mic report relays the input in use and a mic fault as status.voice.mic (a state, per connection)', () => {
    const t = 1_000_000;
    const r = new VoiceReports(() => t);
    const at = new Date(t).toISOString();
    r.report({ mic: { device: { name: 'Matthew’s AirPods Pro', transport: 'bluetooth', sampleRate: 24000 }, aec: 'headphones', fault: null } }, 'conn:V');
    expect(r.status().mic).toEqual({ device: { name: 'Matthew’s AirPods Pro', transport: 'bluetooth', sampleRate: 24000 }, aec: 'headphones', fault: null, at });
    r.report({ mic: { device: null, fault: { code: 'restart-loop', text: 'The mic kept restarting, so Gnomon turned it off.\u202e' } } }, 'conn:V');
    expect(r.status().mic).toEqual({ device: null, aec: null, fault: { code: 'restart-loop', text: 'The mic kept restarting, so Gnomon turned it off.' }, at });
    for (const bad of [{ mic: null }, { mic: { device: null, fault: null, x: 1 } }, { mic: { device: { name: '' }, fault: null } }, { mic: { device: { name: 'a', sampleRate: 12.5 }, fault: null } }, { mic: { device: null, aec: 'maybe', fault: null } }, { mic: { device: null, fault: { code: 'Bad Code', text: 'x' } } }, { mic: { device: null, fault: { code: 'x', text: ' ' } } }]) {
      expect(() => r.report(bad, 'conn:V'), JSON.stringify(bad)).toThrow(TypeError);
    }
    // the input-selection fields (founder request 2026-10-23)
    r.report({ mic: { device: { name: 'MacBook Pro Microphone', transport: 'built-in', sampleRate: 48000 }, aec: 'vpio', fault: null, on: true, inputs: [{ id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone', transport: 'built-in', sampleRate: 48000 }], selected: 'usb-mic', missing: true, level: 0.426 } }, 'conn:V');
    expect(r.status().mic).toMatchObject({ on: true, selected: 'usb-mic', missing: true, level: 0.43, inputs: [{ id: 'BuiltInMicrophoneDevice' }] });
    for (const bad of [{ inputs: 'x' }, { inputs: Array.from({ length: 17 }, (_, i) => ({ id: `d${i}`, name: 'n' })) }, { inputs: [{ name: 'no id' }] }, { selected: 5 }, { level: 2 }, { on: 'yes' }]) {
      expect(() => r.report({ mic: { device: null, fault: null, ...bad } }, 'conn:V'), JSON.stringify(bad)).toThrow(TypeError);
    }
    // Aegis L-2: the level and the device list reach a human on the gui credential only
    const st = { mic: r.status().mic } as Record<string, unknown>;
    expect(voiceStatusFor(st, 'gui', 'human').mic).toMatchObject({ level: 0.43, inputs: [{ id: 'BuiltInMicrophoneDevice' }] });
    for (const [cred, cls] of [['device', 'human'], ['gui', 'voice'], ['read-token', 'human'], [undefined, undefined]] as const) {
      const m = voiceStatusFor(st, cred, cls).mic as Record<string, unknown>;
      expect(m, `${cred} ${cls}`).not.toHaveProperty('level');
      expect(m).not.toHaveProperty('inputs');
      expect(m).toMatchObject({ on: true, missing: true });
    }
    r.connectionClosed('conn:other');
    expect(r.status().mic).not.toBeNull();
    r.connectionClosed('conn:V');
    expect(r.status().mic).toBeNull();
  });

  it('founder request 2026-10-23: the input choice is held, validated and persisted (0600), a missing file is the default', () => {
    const r = new VoiceReports(() => 1);
    expect(r.status().inputChoice).toEqual({ id: null, name: null });
    expect(r.inputChoice({ id: 'usb-mic', name: 'Shure MV7' })).toEqual({ inputChoice: { id: 'usb-mic', name: 'Shure MV7' } });
    expect(r.status().inputChoice).toEqual({ id: 'usb-mic', name: 'Shure MV7' });
    expect(r.inputChoice({ id: null, name: 'ignored' }).inputChoice).toEqual({ id: null, name: null });
    for (const bad of [null, {}, { id: 5 }, { id: '' }, { id: 'a\nb' }, { id: 'x', other: 1 }, { id: 'x', name: '' }]) expect(() => r.inputChoice(bad), JSON.stringify(bad)).toThrow(TypeError);
    // Aegis L-2: the meter-open signal lapses unless renewed
    let t = 1_000;
    const m = new VoiceReports(() => t);
    expect(m.status().micMeterOpen).toBe(false);
    expect(m.micMeter(true)).toEqual({ micMeterOpen: true });
    expect(m.status().micMeterOpen).toBe(true);
    t += VOICE_MIC_METER_TTL_MS;
    expect(m.status().micMeterOpen).toBe(false);
    m.micMeter(true);
    m.micMeter(false);
    expect(m.status().micMeterOpen).toBe(false);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'input-choice-'));
    expect(readInputChoice(home)).toBeNull();
    writeInputChoice(home, { id: 'usb-mic', name: 'Shure MV7' });
    expect(readInputChoice(home)).toEqual({ id: 'usb-mic', name: 'Shure MV7' });
    expect(fs.statSync(inputChoicePath(home)).mode & 0o777).toBe(0o600);
    fs.writeFileSync(inputChoicePath(home), '{"format":"other","id":"x"}');
    expect(readInputChoice(home)).toBeNull();
  });

  it('G-VOX-22 #voice-reply-mode: Speak and show by default; show only is held, validated, on status and persisted (0600) per home', () => {
    const r = new VoiceReports(() => 1);
    expect(r.status().replyMode).toBe('speak');
    expect(r.replyMode('show')).toEqual({ replyMode: 'show' });
    expect(r.status().replyMode).toBe('show');
    for (const bad of [null, '', 'silent', 1, { mode: 'show' }]) expect(() => r.replyMode(bad), JSON.stringify(bad)).toThrow(TypeError);
    expect(r.status().replyMode).toBe('show');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-mode-'));
    expect(readReplyMode(home)).toBeNull();
    writeReplyMode(home, 'show');
    expect(readReplyMode(home)).toBe('show');
    expect(fs.statSync(replyModePath(home)).mode & 0o777).toBe(0o600);
    writeReplyMode(home, 'speak');
    expect(readReplyMode(home)).toBe('speak');
    fs.writeFileSync(replyModePath(home), '{"format":"other","mode":"show"}');
    expect(readReplyMode(home)).toBeNull();
  });

  it('T-2026-10-19-026: playback edges relay as status.voice.playback; stop-speaking bumps a declared counter', () => {
    let t = 1_000_000;
    const r = new VoiceReports(() => t);
    r.report({ playback: { playing: true } });
    expect(r.status().playback).toEqual({ playing: true, at: new Date(t).toISOString() });
    for (const bad of [{ playback: null }, { playback: { playing: 1 } }, { playback: { playing: true, x: 1 } }, { playback: [] }]) expect(() => r.report(bad), JSON.stringify(bad)).toThrow(TypeError);
    expect(r.stopSpeaking()).toEqual({ stopSpeakingSeq: 1 });
    expect(r.stopSpeaking()).toEqual({ stopSpeakingSeq: 2 });
    expect(checkStatusNumbers({ voice: r.status() })).toEqual([]);
    t += VOICE_REPORT_TTL_MS + 1;
    expect(r.status()).toMatchObject({ playback: null, stopSpeakingSeq: 2 });
  });
});

describe('#gnomon-voice 2026-10-20: request.voice.report{prints} (stale voice prints)', () => {
  it('relays the stale names as status.voice.prints with no TTL, validates, and clears with the reporting connection', () => {
    let t = 1_000_000;
    const r = new VoiceReports(() => t);
    r.report({ prints: { stale: ['matt', 'founder', 'matt'] } }, 'c1');
    const at = new Date(t).toISOString();
    expect(r.status().prints).toEqual({ stale: ['founder', 'matt'], at });
    t += VOICE_REPORT_TTL_MS * 10; // a state, not an event: no TTL
    expect(r.status().prints).toEqual({ stale: ['founder', 'matt'], at });
    for (const bad of [{ prints: null }, { prints: {} }, { prints: { stale: 'matt' } }, { prints: { stale: ['Bad Name'] } }, { prints: { stale: [], x: 1 } }, { prints: { stale: Array.from({ length: 17 }, (_, i) => `n${i}`) } }]) {
      expect(() => r.report(bad, 'c1'), JSON.stringify(bad)).toThrow(TypeError);
    }
    r.report({ prints: { stale: [] } }, 'c1');
    expect(r.status().prints!.stale).toEqual([]);
    r.report({ prints: { stale: ['matt'] } }, 'c2');
    r.connectionClosed('c1'); // not the reporter: kept
    expect(r.status().prints!.stale).toEqual(['matt']);
    r.connectionClosed('c2');
    expect(r.status().prints).toBeNull();
  });
});
