/**
 * #desk-guidance (TD-2026-10-20-812 A1, S1): the frozen DESK_BODY, the kernel-composed roster (manifest fields only,
 * A7), and composeGuidance — ONE block under one guidanceHash that `gnomon trace` accepts (extrasAgree, Aegis M2).
 */
import { describe, expect, it } from 'vitest';
import { composeGuidance, DESK_BODY, DESK_BODY_HASH, deskGuidance, rosterLines } from '../src/kernel/desk/desk-guidance.js';
import { TABLE_TALK_GUIDANCE, TABLE_TALK_GUIDANCE_HASH, guidanceHashOf } from '../src/kernel/voice/table-talk.js';
import { extrasAgree, promptExtraHashes, promptText } from '../src/cli/trace-cli.js';
import { turnContentHash } from '../src/kernel/supervisor/supervisor.js';
import { userMessageLine } from '../src/adapters/claude-code/adapter.js';

const ROSTER = [
  { name: 'neurons', offers: [{ kind: 'recall-notes', phase: 'diverge' as const, title: 'Recall related notes' }] },
  { name: 'constellation', offers: [{ kind: 'map-the-idea', phase: 'diverge' as const, title: 'Map it on the board' }, { kind: 'pull-together', phase: 'synthesize' as const, title: 'Pull it together' }] },
];

describe('#desk-guidance', () => {
  it('DESK_BODY is frozen (a change is a protocol change) and about 150 tokens', () => {
    expect(DESK_BODY_HASH).toMatchInlineSnapshot(`"sha256:4f988ce2e68e2b497bff6bb483d59c7119db34a62267cc1c4bd79de3448e74f6"`);
    const words = DESK_BODY.split(/\s+/).length;
    expect(words).toBeGreaterThan(70);
    expect(words).toBeLessThan(140);
  });

  it('the roster is kernel-composed from manifest fields only, sorted, one line per mod', () => {
    expect(rosterLines(ROSTER)).toEqual([
      '- constellation: map-the-idea (diverge) "Map it on the board"; pull-together (synthesize) "Pull it together"',
      '- neurons: recall-notes (diverge) "Recall related notes"',
    ]);
    expect(rosterLines([{ name: 'quiet', offers: [] }])).toEqual([]);
    expect(deskGuidance([])).toBeNull();
    const g = deskGuidance(ROSTER)!;
    expect(g.startsWith('<gnomon-desk>\n')).toBe(true);
    expect(g.endsWith('\n</gnomon-desk>')).toBe(true);
    expect(guidanceHashOf(g)).toMatchInlineSnapshot(`"sha256:dd0a6d91e1c6067c219194cc40f68c50e6c5e99bbab5b1373acd2a89d37ed394"`);
  });

  it('composeGuidance: voice alone is exactly TABLE_TALK_GUIDANCE (its hash does not move); both join into ONE block', () => {
    expect(composeGuidance(null, null)).toBeNull();
    expect(composeGuidance(TABLE_TALK_GUIDANCE, null)).toBe(TABLE_TALK_GUIDANCE);
    expect(guidanceHashOf(composeGuidance(TABLE_TALK_GUIDANCE, null)!)).toBe(TABLE_TALK_GUIDANCE_HASH);
    const desk = deskGuidance(ROSTER)!;
    expect(composeGuidance(null, desk)).toBe(desk);
    expect(composeGuidance(TABLE_TALK_GUIDANCE, desk)).toBe(`${TABLE_TALK_GUIDANCE}\n\n${desk}`);
  });

  it('gnomon trace accepts the composite: one extra block whose hash is turn.sent.guidanceHash', () => {
    const both = composeGuidance(TABLE_TALK_GUIDANCE, deskGuidance(ROSTER))!;
    const content = JSON.parse(userMessageLine('hello', both)).message.content;
    expect(content).toHaveLength(2);
    expect(promptText(content)).toBe('hello');
    const extras = promptExtraHashes(content);
    expect(extras).toEqual([turnContentHash(both)]);
    expect(extrasAgree(extras, guidanceHashOf(both))).toBe(true);
    // two separate blocks would be refused (why the Desk never writes its own block)
    const two = [{ type: 'text', text: 'hello' }, { type: 'text', text: TABLE_TALK_GUIDANCE }, { type: 'text', text: deskGuidance(ROSTER)! }];
    expect(extrasAgree(promptExtraHashes(two), guidanceHashOf(both))).toBe(false);
  });
});
