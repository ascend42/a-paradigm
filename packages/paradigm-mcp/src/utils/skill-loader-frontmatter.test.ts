/**
 * #skill-loader splitFrontmatter — now a strict wrapper over premise-core's
 * shared #frontmatter-parser (D8, 7.12.0). Signature + error strings are a contract.
 */
import { describe, it, expect } from 'vitest';
import * as yaml from 'js-yaml';
import { splitFrontmatter, parseSkill, SkillParseError } from './skill-loader.js';

describe('splitFrontmatter (strict wrapper)', () => {
  it('returns exactly { data, body }', () => {
    expect(splitFrontmatter('---\nname: a\n---\nbody')).toEqual({ data: { name: 'a' }, body: 'body' });
    expect(splitFrontmatter('---\r\nname: a\r\n---\r\nbody')).toEqual({ data: { name: 'a' }, body: 'body' });
  });

  it('keeps the missing-frontmatter message', () => {
    expect(() => splitFrontmatter('no frontmatter')).toThrow(/^missing YAML frontmatter \(--- … ---\)$/);
    expect(() => splitFrontmatter('---\nname: a\nno close')).toThrow('missing YAML frontmatter (--- … ---)');
  });

  it('keeps the non-mapping message', () => {
    expect(() => splitFrontmatter('---\n- a\n---\nb')).toThrow(/^frontmatter is not a YAML mapping$/);
  });

  it('surfaces the YAML parser message verbatim', () => {
    const bad = 'name: [unterminated\n  bad: : yaml';
    let expected = '';
    try { yaml.load(bad); } catch (e) { expected = (e as Error).message; }
    expect(expected).not.toBe('');
    expect(() => splitFrontmatter(`---\n${bad}\n---\nb`)).toThrow(expected);
  });

  it('parseSkill wraps the same message in SkillParseError', () => {
    try {
      parseSkill('no frontmatter', '/tmp/x', 'project');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SkillParseError);
      expect((e as Error).message).toBe('missing YAML frontmatter (--- … ---)');
    }
  });
});
