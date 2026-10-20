/**
 * #gui-voice-capture (T-2026-10-20-005 A1, TD-2026-10-20-086 V3/V4): the status.voice.capture adapter, the pill words,
 * the flash timing, the poll cadence and its lifecycle (Aegis L2 of 862ef85a), the ghost line and caption, and the
 * sanitised pill title (Aegis L1 of 862ef85a).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPTURE_DROP_REASONS, CAPTURE_FAST_POLL_MS, CAPTURE_IDLE_POLL_MS, CAPTURED_FLASH_MS, captureDisplayOf, capturePollMs, captureStatusOf, captureStep, DROP_LABEL, DROPPED_FLASH_MS } from '../src/core/capture.js';
import { clientOf, clientPillOf, oneLine } from '../src/core/voice-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src/ui/app.ts'), 'utf8');
const HTML = readFileSync(path.join(ROOT, 'static/index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');

const st = (capture: unknown) => ({ principalKind: 'human', voice: { attached: true, hsid: 'hs:A', ceiling: 'ptt', clientConnected: true, capture } });
const show = (capture: unknown, ageMs = 0) => {
  const cap = captureStatusOf(st(capture));
  return captureDisplayOf(captureStep(null, cap, 1_000), 1_000 + ageMs, true);
};

describe('captureStatusOf: the one adapter over status.voice.capture', () => {
  it('reads every state; level only while hearing (clamped), reason only on dropped', () => {
    expect(captureStatusOf(st({ state: 'hearing', segId: 's1', level: 0.4, at: 'x' }))).toEqual({ state: 'hearing', segId: 's1', reason: null, level: 0.4 });
    expect(captureStatusOf(st({ state: 'hearing', segId: 's1', level: 7 }))!.level).toBe(1);
    expect(captureStatusOf(st({ state: 'hearing', segId: 's1' }))!.level).toBe(0);
    expect(captureStatusOf(st({ state: 'transcribing', segId: 's1', level: 0.9 }))!.level).toBeNull();
    expect(captureStatusOf(st({ state: 'dropped', segId: 's1', reason: 'echo' }))!.reason).toBe('echo');
  });
  it('none, stale (null), or an unknown shape is null (the pill keeps its own label)', () => {
    for (const c of [undefined, null, {}, { state: 'listening', segId: 's1' }, { state: 'dropped', segId: 's1' }, { state: 'dropped', segId: 's1', reason: 'cosmic' }, { state: 'hearing' }]) expect(captureStatusOf(st(c)), JSON.stringify(c)).toBeNull();
    expect(captureStatusOf(null)).toBeNull();
  });
});

describe('the pill words (V4: a drop says its reason only)', () => {
  it('idle keeps the attached label (calm, meter still); hearing pulses with the real level; transcribing; captured', () => {
    expect(show({ state: 'idle', segId: 's1' })).toMatchObject({ label: null, className: 'capture-idle', meter: 0, ghost: false });
    expect(show({ state: 'hearing', segId: 's1', level: 0.6 })).toMatchObject({ label: 'Hearing you…', className: 'capture-hearing', meter: 0.6, ghost: true });
    expect(show({ state: 'transcribing', segId: 's1' })).toMatchObject({ label: 'Catching that…', meter: 0, ghost: true });
    expect(show({ state: 'captured', segId: 's1' })).toMatchObject({ label: 'Got it', ghost: false });
  });
  it('each drop reason has its plain words, never text or a count', () => {
    expect(show({ state: 'dropped', segId: 's1', reason: 'too-short' }).label).toBe('Too short, say it again');
    expect(show({ state: 'dropped', segId: 's1', reason: 'echo' }).label).toBe('Not sent: I was speaking');
    expect(show({ state: 'dropped', segId: 's1', reason: 'barge-in' }).label).toBe('Not sent: I was speaking');
    expect(show({ state: 'dropped', segId: 's1', reason: 'no-words' }).label).toBe('Heard no words');
    expect(show({ state: 'dropped', segId: 's1', reason: 'not-enrolled' }).label).toBe("Ignored a voice that isn't enrolled");
    for (const r of CAPTURE_DROP_REASONS) expect(DROP_LABEL[r]).not.toMatch(/\d/);
  });
  it('captured flashes for 1.2 s and dropped for 2.5 s, timed from when this page first saw them', () => {
    expect(show({ state: 'captured', segId: 's1' }, CAPTURED_FLASH_MS - 1).label).toBe('Got it');
    expect(show({ state: 'captured', segId: 's1' }, CAPTURED_FLASH_MS).label).toBeNull();
    expect(show({ state: 'dropped', segId: 's1', reason: 'echo' }, DROPPED_FLASH_MS - 1).flashLeftMs).toBe(1);
    expect(show({ state: 'dropped', segId: 's1', reason: 'echo' }, DROPPED_FLASH_MS).label).toBeNull();
    // the same report re-read keeps its clock; a new segment or state restarts it
    const a = captureStep(null, captureStatusOf(st({ state: 'captured', segId: 's1' })), 0);
    expect(captureStep(a, captureStatusOf(st({ state: 'captured', segId: 's1' })), 900).since).toBe(0);
    expect(captureStep(a, captureStatusOf(st({ state: 'captured', segId: 's2' })), 900).since).toBe(900);
    // a level update while hearing is not a new state
    const h = captureStep(null, captureStatusOf(st({ state: 'hearing', segId: 's3', level: 0.1 })), 0);
    expect(captureStep(h, captureStatusOf(st({ state: 'hearing', segId: 's3', level: 0.9 })), 500)).toMatchObject({ since: 0, cap: { level: 0.9 } });
  });
  it('not live (detached, the app gone, disconnected): nothing shows', () => {
    const t = captureStep(null, captureStatusOf(st({ state: 'hearing', segId: 's1', level: 1 })), 0);
    expect(captureDisplayOf(t, 0, false)).toMatchObject({ label: null, meter: 0, ghost: false, caption: '' });
  });
});

describe('V3: the status poll cadence and its lifecycle', () => {
  const on = { attached: true, clientConnected: true, attachable: true, connected: true };
  it('~1 s at rest, fast while hearing or transcribing, never when off, detached, the app gone, or disconnected', () => {
    expect(capturePollMs(on, null)).toBe(CAPTURE_IDLE_POLL_MS);
    expect(capturePollMs(on, captureStatusOf(st({ state: 'captured', segId: 's1' })))).toBe(CAPTURE_IDLE_POLL_MS);
    expect(capturePollMs(on, captureStatusOf(st({ state: 'hearing', segId: 's1' })))).toBe(CAPTURE_FAST_POLL_MS);
    expect(capturePollMs(on, captureStatusOf(st({ state: 'transcribing', segId: 's1' })))).toBe(CAPTURE_FAST_POLL_MS);
    expect(CAPTURE_FAST_POLL_MS).toBeGreaterThanOrEqual(150);
    expect(CAPTURE_FAST_POLL_MS).toBeLessThanOrEqual(200);
    for (const k of ['attached', 'attachable', 'connected'] as const) expect(capturePollMs({ ...on, [k]: false }, null)).toBeNull();
    expect(capturePollMs({ ...on, clientConnected: null }, null)).toBeNull();
    expect(capturePollMs({ ...on, clientConnected: false }, null)).toBeNull();
  });
  it('Aegis L2: the polls stop on disconnect (refreshStatus with no client stops them; onClose stops them)', () => {
    expect(APP).toMatch(/async function refreshStatus\(\): Promise<void> \{[\s\S]{0,200}if \(!client\) return stopStatusPolls\(\);/);
    expect(APP).toMatch(/c\.onClose\(\(\) => \{\s*client = null;\s*session = null;\s*stopStatusPolls\(\);/);
    const stop = APP.slice(APP.indexOf('function stopStatusPolls('), APP.indexOf('function stopStatusPolls(') + 600);
    for (const t of ['clearInterval(speakPoll)', 'clearInterval(clientPoll)', 'clearInterval(enrolPoll)', 'clearTimeout(captureFlash)']) expect(stop).toContain(t);
  });
});

describe('the page', () => {
  it('the ghost line is its own element (never the textarea) and the caption is polite', () => {
    expect(HTML).toMatch(/<div id="composer-ghost" class="composer-ghost meta" aria-hidden="true" hidden>…<\/div>/);
    expect(HTML).toMatch(/<span id="voice-caption" class="sr-only" aria-live="polite"><\/span>/);
    expect(APP).not.toMatch(/composer-text'\)[^;\n]*(ghost|capture)/);
    expect(APP).toMatch(/if \(d\.state !== captionState\) \{\s*captionState = d\.state;\s*put\(\$\('voice-caption'\), d\.caption\);/);
  });
  it('the meter is the real level only: no infinite meter animation, no row kick', () => {
    expect(CSS).not.toMatch(/\.voice-meter i \{[^}]*animation/);
    expect(CSS).not.toContain('@keyframes voice-meter');
    expect(APP).not.toContain('kickMeter');
    expect(APP).toContain("meter.style.setProperty('--level', String(d.meter));");
  });
});

describe('Aegis L1 (862ef85a): the pill title is sanitised before it is folded and capped', () => {
  it('bidi, escape and hidden characters in lastError never reach the title raw', () => {
    const evil = 'boom ‮gnp.exe‬ \u001b[31mred\u001b[0m ​zw';
    const status = { principalKind: 'human', voice: { attached: false, clientConnected: false, client: { phase: 'crashed', lastError: evil } } };
    const p = clientPillOf(clientOf(status), false, true);
    for (const s of [p.title, p.label ?? '']) {
      expect(s).not.toMatch(/[‪-‮⁦-⁩\u001b​]/);
    }
    const attached = clientPillOf(clientOf({ ...status, voice: { ...status.voice, attached: true } }), true, true);
    expect(attached.title).not.toMatch(/[‪-‮⁦-⁩\u001b]/);
    expect(attached.tail ?? '').not.toMatch(/[‪-‮⁦-⁩\u001b]/);
  });
  it('the cap never cuts a surrogate pair', () => {
    const s = `${'a'.repeat(8)}😀😀😀`;
    const out = oneLine(s, 10);
    expect(out).toBe(`${'a'.repeat(8)}😀…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });
});
