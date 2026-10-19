import { describe, expect, it } from 'vitest';
import { askQuestions, sentences, SpeakableProjector, speakableSummary } from '../src/speakable.js';

describe('speakable summary', () => {
  it('is the first prose paragraph, markdown stripped', () => {
    expect(speakableSummary('**Done.** I updated `foo` in [the docs](http://x).\n\nSecond paragraph is not read.')).toBe('Done. I updated foo in the docs.');
  });
  it('prefers the gnome line', () => {
    expect(speakableSummary('Long technical preamble.\n\ngnome: All green, two files changed.\n\nMore.')).toBe('All green, two files changed.');
  });
  it('never reads diffs, code fences or tool output', () => {
    const t = '```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n```\n\nThe fix is in.';
    expect(speakableSummary(t)).toBe('The fix is in.');
    expect(speakableSummary('diff --g' + 'it a/x b/x\n+added\n-removed')).toBe('');
    expect(speakableSummary('```\nnpm test\nPASS 12\n```')).toBe('');
  });
  it('clips very long paragraphs at a sentence end', () => {
    const s = speakableSummary('This is a sentence. '.repeat(60));
    expect(s.length).toBeLessThanOrEqual(600);
    expect(s.endsWith('.')).toBe(true);
  });
  it('splits sentences for per-sentence TTS', () => {
    expect(sentences('One. Two? Three! four')).toEqual(['One.', 'Two?', 'Three!', 'four']);
  });
  it('reads every ask-user question with its options', () => {
    expect(askQuestions({ questions: [{ question: 'Which branch?', options: ['main', 'dev', 'test'] }, { question: 'Push?' }] })).toEqual(['Which branch? Options: main, dev, or test.', 'Push?']);
  });
  it('projector: text then the edit count at turn end; hashed, unparseable and tool-result lines say nothing', () => {
    const p = new SpeakableProjector();
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Patched.' }, { type: 'tool_use', name: 'MultiEdit', input: { file_path: '/a' } }] } });
    expect(p.push('turn.event', { line })).toEqual([{ kind: 'reply', text: 'Patched.' }]);
    expect(p.push('turn.event', { lineHash: 'abc', bytes: 9 })).toEqual([]);
    expect(p.push('turn.event', { line: '{not json' })).toEqual([]);
    const tool = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'SECRET OUTPUT' }] } });
    expect(p.push('turn.event', { line: tool })).toEqual([]);
    expect(p.push('turn.event', { line: JSON.stringify({ type: 'result' }) })).toEqual([{ kind: 'edits', files: 1, text: 'Edited 1 file.' }]);
    expect(p.push('turn.result', {})).toEqual([]);
  });
});
