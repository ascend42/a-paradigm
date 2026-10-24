/**
 * #gui-voice-ladder copy (T-2026-10-21-016): the retired voice vocabulary ("Ambient", "push-to-talk") and emoji never
 * reach a user-facing string in core/. Walks every string and template literal (comments are not strings), so the
 * kernel's lowercase wire values ('ambient', 'ptt', 'conversation') and internal identifiers stay as they are.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GUI_COMMANDS } from '../src/core/commands.js';
import { AMBIENT_DRAFT_NOTE } from '../src/core/dictation.js';
import { voiceTagOf } from '../src/core/render.js';
import { idleNoteOf, voiceRefusalNote, VOICE_TITLE } from '../src/core/voice.js';
import { rungNameOf } from '../src/core/voice-ladder.js';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
/** The emoji set the gnomon cli-voice rule forbids (pictographs, the variation selector, and the voice glyphs we used). */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{FE0F}🔊🎙🗣⚠]/u;

/** "Ambient" / "push-to-talk" in prose; the bare wire value 'ambient' and hyphenated ids (voice-ambient, ambient-idle) are not copy. */
const RETIRED = /Ambient|[Pp]ush-to-talk|(?<![-\w])ambient(?![-\w])/;

function literals(file: string): { text: string; line: number }[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push({ text: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    }
    n.forEachChild(walk);
  };
  walk(sf);
  return out;
}

describe('core/ copy uses the ladder vocabulary and words, never emoji', () => {
  const files = readdirSync(CORE).filter((f) => f.endsWith('.ts')).map((f) => path.join(CORE, f));
  it('no string literal in core/ says "Ambient" or "push-to-talk", or carries an emoji', () => {
    expect(files.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const f of files) for (const l of literals(f)) if ((RETIRED.test(l.text) && l.text !== 'ambient') || EMOJI.test(l.text)) bad.push(`${path.basename(f)}:${l.line}: ${l.text}`);
    expect(bad).toEqual([]);
  });
  it('the rung words stand in: palette, draft note, store markers, card tags, refusals, titles', () => {
    expect(GUI_COMMANDS.filter((c) => c.id.startsWith('voice.preset.')).map((c) => c.title.split(' (')[0])).toEqual(['Voice: Off', 'Voice: Talk', 'Voice: Dictate', 'Voice: Send word', 'Voice: Pieces']);
    expect(AMBIENT_DRAFT_NOTE).toBe('draft · Enter sends (an open-mic draft never sends itself)');
    expect(voiceTagOf({ eligible: 'reversible', label: 'card 3' })?.text).toBe('voice · reversible · card 3');
    expect(voiceTagOf({ eligible: 'gate', label: 'LANTERN' })?.text).toBe('voice · gate');
    expect(voiceRefusalNote('voice-off', { cause: 'aec' })).toBe('an open mic needs echo cancellation in the voice app (voice-off · aec)');
    expect(voiceRefusalNote('voice-off', { cause: 'presence' })).toBe('an open mic needs Touch ID first (voice-off · presence)');
    expect(Object.values(VOICE_TITLE)).toEqual(['Off', 'Talk', 'Dictate']);
    expect([rungNameOf('off', null), rungNameOf('ptt', null), rungNameOf('ambient', null), rungNameOf('ambient', 'key'), rungNameOf('ambient', 'word'), rungNameOf('ambient', 'pieces')]).toEqual(['Off', 'Talk', 'Dictate', 'Dictate', 'Send word', 'Pieces']);
    expect(idleNoteOf('voice.session.end', { reason: 'idle', idleMinutes: 10 }, null, 'Dictate')).toBe('Dictate turned off after 10 min idle');
  });
});
