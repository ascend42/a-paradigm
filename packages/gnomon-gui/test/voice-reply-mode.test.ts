/**
 * #voice-reply-mode in the GUI (founder 2026-10-23: "just type back and not speak … i love the speaking of how it
 * arranges what it says and what it shows"): Voice settings' replies row and the ladder's Speak and show | Show only,
 * the kernel request, and that Show only keeps the arrangement (the spoken part line over the body) while only the
 * tag says it was not played.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import { chatItems, type Row } from '../src/core/store.js';
import { REPLY_MODE_NAME, replyModeOf, replyModeRequest, sheetRows, SHEET_SECTIONS, voicePillOf } from '../src/core/voice-ladder.js';
import { saidTag } from '../src/core/voice-presets.js';
import { ladderEls } from '../src/ui/voice-settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };
const rows = (o: Partial<Parameters<typeof sheetRows>[0]> = {}) => sheetRows({ acked: false, sendWord: null, enrolled: ['matt'], reteach: false, micKeyBare: false, capture: 'open', delayMs: 3000, hotkey: '⌃⌥Space', attachable: true, ...o });

describe('G-VOX-22 #voice-reply-mode GUI', () => {
  it('reads status.voice.replyMode; anything else (an older kernel) is Speak and show', () => {
    expect(replyModeOf({ voice: { replyMode: 'show' } })).toBe('show');
    for (const s of [{ voice: { replyMode: 'speak' } }, { voice: {} }, null, { voice: { replyMode: 'mute' } }]) expect(replyModeOf(s)).toBe('speak');
    expect(REPLY_MODE_NAME).toEqual({ speak: 'Speak and show', show: 'Show only' });
  });
  it('the request is the human op the kernel persists', () => {
    expect(replyModeRequest('show')).toEqual({ kind: 'request.voice.client', payload: { op: 'reply-mode', mode: 'show' } });
  });
  it("Voice settings' replies row, after listen, toggles between the two", () => {
    expect(SHEET_SECTIONS.indexOf('replies')).toBe(SHEET_SECTIONS.indexOf('listen') + 1);
    expect(rows().find((r) => r.id === 'replies')).toEqual({ id: 'replies', label: 'replies', value: 'spoken and shown', tone: 'plain', action: { label: 'show only', act: 'reply.show' } });
    expect(rows({ replyMode: 'show' }).find((r) => r.id === 'replies')).toEqual({ id: 'replies', label: 'replies', value: 'shown only · not spoken · voice input stays on', tone: 'plain', action: { label: 'speak and show', act: 'reply.speak' } });
    expect(rows({ attachable: false }).find((r) => r.id === 'replies')!.action).toBeNull();
  });
  it('the ladder shows replies · Speak and show | Show only as menu radios (checked = the mode in force)', () => {
    const els = ladderEls(fdoc, [], 'foot', null, 'show') as unknown as FEl[];
    const group = els.find((e) => e.className === 'ladder-replies')!;
    expect(group.attrs.get('aria-label')).toBe('replies');
    const keys = group.all().filter((e) => e.tag === 'button');
    expect(keys.map((k) => [k.text, k.attrs.get('data-reply-mode'), k.attrs.get('aria-checked'), k.attrs.get('role')])).toEqual([
      ['Speak and show', 'speak', 'false', 'menuitemradio'],
      ['Show only', 'show', 'true', 'menuitemradio'],
    ]);
    expect((ladderEls(fdoc, [], 'foot') as unknown as FEl[]).some((e) => e.className === 'ladder-replies')).toBe(false);
  });
  it('Show only keeps the arrangement: the spoken part still stands over the body; only the tag says not played', () => {
    const text = '```speak\nTwo files changed. Ship it?\n```\n**A** ship\n**B** wait';
    const line = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
    const r: Row[] = [{ seq: 1, kind: 'turn.event', session: 'hs:1', view: 'full', payload: { type: 'assistant', line } }];
    const it0 = chatItems(r).items.find((x) => x.role === 'assistant')!;
    expect(it0.said).toBe('Two files changed. Ship it?');
    expect(it0.text).toContain('**A** ship');
    expect(saidTag('kernel', 'show')).toBe('voice · spoken part · not played');
    expect(saidTag('kernel')).toBe('voice · said aloud');
    expect(APP).toContain("saidTag(it.saidBy === 'kernel' ? 'kernel' : 'reply', replyModeOf(status))");
  });
  it('the page sends it only on a trusted press, from the sheet and the ladder', () => {
    expect(APP).toMatch(/async function setReplyMode\(mode: ReplyMode, trusted: boolean\): Promise<void> \{\n  if \(!trusted\) return;/);
    expect(APP).toContain("await client.call('log.append', replyModeRequest(mode));");
    expect(APP).toContain("void setReplyMode(value === 'reply.show' ? 'show' : 'speak', trusted)");
    expect(APP).toContain("void setReplyMode(rm.dataset.replyMode === 'show' ? 'show' : 'speak', e.isTrusted)");
  });
});

describe('G-VOX-22 Mika Delta 10: the pill names Show only; the ladder keeps focus; mounted replies repaint', () => {
  const base = { rung: 'dictate' as const, hotkey: '⌃⌥Space', sendWord: null, attached: true, target: 'billing', clientConnected: true, clientFact: null, capture: null, micKeyBare: false, heardAgoS: null };
  it('the resting fact leads with "show only"; the accessible name and title say it in words', () => {
    const p = voicePillOf({ ...base, replyMode: 'show' });
    expect(p.fact).toBe('show only');
    expect(voicePillOf({ ...base, rung: 'talk', replyMode: 'show' }).fact).toBe('show only · hold ⌃⌥Space');
    expect(voicePillOf({ ...base, rung: 'talk', replyMode: 'show' }).aria).toBe('Voice: Talk, mic closed, hold ⌃⌥Space, replies shown only, not spoken');
    expect(p.aria).toBe('Voice: Dictate, mic open, listening, replies shown only, not spoken');
    expect(p.title).toContain('Replies: show only (written, not spoken).');
    expect(voicePillOf({ ...base, replyMode: 'speak' }).fact).toBe('listening');
    expect(voicePillOf({ ...base, rung: 'off', attached: false, replyMode: 'show' }).fact).toBe('');
    expect(voicePillOf({ ...base, rung: 'off', attached: false, replyMode: 'show' }).aria).not.toContain('shown only');
  });
  it('a reply-mode press keeps focus on its key; said tags repaint', () => {
    expect(APP).toMatch(/#voice-menu \[data-reply-mode\]/);
    expect(APP).toMatch(/for \(const it of items\) if \(it\.said !== undefined\) remountItem\(it\.key\);/);
  });
});
