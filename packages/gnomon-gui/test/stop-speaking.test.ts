/**
 * #gui Stop speaking (T-2026-10-19-026): the pure core (core/voice.ts, core/voice-client.ts) and the page wiring,
 * read from the source (the browser smoke drives the DOM).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { escStopsSpeaking, playbackPlaying, SPEAK_POLL_MS, speakPollWanted, stopSpeakingShown } from '../src/core/voice.js';
import { stopSpeakingRequest } from '../src/core/voice-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
const st = (voice: unknown, principalKind = 'human') => ({ principalKind, voice });
const playing = (more: Record<string, unknown> = {}) => st({ attached: null, clientConnected: true, playback: { playing: true, at: '2026-10-19T10:00:00Z' }, stopSpeakingSeq: 0, ...more });

describe('G-GUI-16 Stop speaking: the pure core', () => {
  it('playing is status.voice.playback.playing === true only', () => {
    expect(playbackPlaying(playing())).toBe(true);
    for (const p of [null, undefined, {}, { playing: false }, { playing: 'yes' }, { playing: 1 }]) expect(playbackPlaying(st({ playback: p })), JSON.stringify(p)).toBe(false);
    expect(playbackPlaying(null)).toBe(false);
    expect(playbackPlaying({})).toBe(false);
  });
  it('the button shows only for a human connection, the voice app connected, and speech playing', () => {
    expect(stopSpeakingShown(playing())).toBe(true);
    expect(stopSpeakingShown(playing({ clientConnected: false }))).toBe(false);
    expect(stopSpeakingShown(playing({ clientConnected: undefined }))).toBe(false); // unsure ⇒ hidden
    expect(stopSpeakingShown(playing({ playback: { playing: false } }))).toBe(false);
    expect(stopSpeakingShown(playing({ playback: null }))).toBe(false);
    expect(stopSpeakingShown({ ...playing(), principalKind: 'voice' })).toBe(false);
  });
  it('the 300 ms poll runs only while playing or within the watch window', () => {
    expect(SPEAK_POLL_MS).toBe(300);
    expect(speakPollWanted(playing(), null, 0)).toBe(true);
    expect(speakPollWanted(st({ playback: null }), null, 0)).toBe(false);
    expect(speakPollWanted(st({ playback: null }), 1000, 999)).toBe(true);
    expect(speakPollWanted(st({ playback: null }), 1000, 1000)).toBe(false);
  });
  it('Esc stops speaking only when shown and Esc has nothing nearer to do', () => {
    const base = { shown: true, menuOpen: false, dialogOpen: false, inComposer: false };
    expect(escStopsSpeaking(base)).toBe(true);
    expect(escStopsSpeaking({ ...base, shown: false })).toBe(false);
    expect(escStopsSpeaking({ ...base, menuOpen: true })).toBe(false);
    expect(escStopsSpeaking({ ...base, dialogOpen: true })).toBe(false);
    expect(escStopsSpeaking({ ...base, inComposer: true })).toBe(false);
  });
  it('the request is log.append request.voice.client{op:stop-speaking} (one key, as the kernel insists)', () => {
    expect(stopSpeakingRequest()).toEqual({ kind: 'request.voice.client', payload: { op: 'stop-speaking' } });
  });
});

describe('G-GUI-16 Stop speaking: the page wiring', () => {
  it('a hidden ⏹ button sits beside the mic pill, painted from status', () => {
    expect(HTML).toMatch(/<button id="voice-stop"[^>]*aria-label="Stop speaking"[^>]*hidden>Stop speaking<\/button>/);
    expect(APP).toContain("$('voice-stop').hidden = !stopSpeakingShown(status);");
    expect(APP).toContain("$('voice-stop').addEventListener('click', (e) => void stopSpeaking(e.isTrusted));");
  });
  it('the press is a trusted gesture that appends one stop-speaking request, then re-reads status', () => {
    expect(APP).toMatch(/async function stopSpeaking\(trusted: boolean\)[\s\S]{0,200}if \(!trusted \|\| !client \|\| !stopSpeakingShown\(status\)\) return;[\s\S]{0,200}client\.call\('log\.append', stopSpeakingRequest\(\)\)[\s\S]{0,300}await refreshStatus\(\);/);
  });
  it('Esc comes after the menus and dialogs, and is gated by escStopsSpeaking', () => {
    const esc = APP.indexOf("e.key === 'Escape' && escStopsSpeaking(");
    expect(APP.indexOf("e.key === 'Escape' && voiceSheet.isOpen()")).toBeGreaterThan(0);
    expect(esc).toBeGreaterThan(APP.indexOf("e.key === 'Escape' && voiceSheet.isOpen()")); // the Voice settings sheet (and its inline teaching) first
    expect(APP.slice(esc, esc + 600)).toMatch(/composer/);
  });
  it('the poll is an interval of SPEAK_POLL_MS, synced on every status read and started by a voice row', () => {
    expect(APP).toMatch(/function syncSpeakPoll\(\)[\s\S]{0,200}setInterval\(\(\) => void pollStatusOnce\(\), SPEAK_POLL_MS\)[\s\S]{0,120}clearInterval\(speakPoll\)/);
    // T-2026-10-20-005: the decorative meter kick is gone (the meter is the real level); a voice row only watches for speech
    expect(APP).toContain("if (w.has('voice-activity')) watchSpeech();");
    expect(APP).not.toContain('kickMeter');
  });
});
