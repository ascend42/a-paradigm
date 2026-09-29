/**
 * #frontmatter-parser — lenient vs strict parity (D8, 7.12.0).
 */
import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  FrontmatterError,
  FRONTMATTER_RE,
  FRONTMATTER_MISSING_MESSAGE,
  FRONTMATTER_NOT_MAPPING_MESSAGE,
} from './frontmatter.js';

const both = (raw: string) => ({
  lenient: parseFrontmatter(raw, { mode: 'lenient' }),
  strict: (() => {
    try { return parseFrontmatter(raw, { mode: 'strict' }); } catch (e) { return e as FrontmatterError; }
  })(),
});

describe('parseFrontmatter', () => {
  it('defaults to lenient', () => {
    expect(parseFrontmatter('no fence')).toEqual({ data: {}, body: 'no fence', hasFrontmatter: false });
  });

  it('LF: both modes agree on a well-formed mapping', () => {
    const { lenient, strict } = both('---\nname: a\nn: 2\n---\nbody\n');
    expect(lenient).toEqual({ data: { name: 'a', n: 2 }, body: 'body\n', hasFrontmatter: true });
    expect(strict).toEqual(lenient);
  });

  it('CRLF: both modes agree', () => {
    const { lenient, strict } = both('---\r\nname: a\r\n---\r\nbody\r\n');
    expect(lenient.data).toEqual({ name: 'a' });
    expect(lenient.body).toBe('body\r\n');
    expect(strict).toEqual(lenient);
  });

  it('empty body (closing fence at EOF): both modes agree', () => {
    const { lenient, strict } = both('---\nname: a\n---');
    expect(lenient).toEqual({ data: { name: 'a' }, body: '', hasFrontmatter: true });
    expect(strict).toEqual(lenient);
  });

  it('missing close fence: lenient → whole input as body; strict → missing error', () => {
    const raw = '---\nname: a\nbody without close\n';
    const { lenient, strict } = both(raw);
    expect(lenient).toEqual({ data: {}, body: raw, hasFrontmatter: false });
    expect(strict).toBeInstanceOf(FrontmatterError);
    expect((strict as FrontmatterError).message).toBe('missing YAML frontmatter (--- … ---)');
    expect((strict as FrontmatterError).reason).toBe('missing');
  });

  it('non-mapping (list / scalar / empty): lenient → {} + error; strict → not-mapping error', () => {
    for (const raw of ['---\n- a\n- b\n---\nb', '---\njust a string\n---\nb', '---\n\n---\nb']) {
      const { lenient, strict } = both(raw);
      expect(lenient.data).toEqual({});
      expect(lenient.hasFrontmatter).toBe(true);
      expect(lenient.error).toBe(FRONTMATTER_NOT_MAPPING_MESSAGE);
      expect(lenient.body).toBe('b');
      expect((strict as FrontmatterError).message).toBe('frontmatter is not a YAML mapping');
    }
  });

  it('malformed YAML: lenient keeps body + error; strict rethrows the YAML message verbatim', () => {
    const raw = '---\nname: [unterminated\n  bad: : yaml\n---\n\nreal body\n';
    const { lenient, strict } = both(raw);
    expect(lenient.data).toEqual({});
    expect(lenient.body).toBe('\nreal body\n');
    expect(lenient.error).toBeTruthy();
    expect(strict).toBeInstanceOf(FrontmatterError);
    expect((strict as FrontmatterError).reason).toBe('yaml');
    expect((strict as FrontmatterError).message).toBe(lenient.error);
  });

  it('adjacent fences (---\\n---\\n): lenient → present-but-empty; strict → missing (pre-7.12 skill-loader parity)', () => {
    expect(parseFrontmatter('---\n---\nbody\n')).toEqual({ data: {}, body: 'body\n', hasFrontmatter: true });
    expect(parseFrontmatter('---\r\n---\r\nb')).toEqual({ data: {}, body: 'b', hasFrontmatter: true });
    expect(parseFrontmatter('---\n---')).toEqual({ data: {}, body: '', hasFrontmatter: true });
    expect(() => parseFrontmatter('---\n---\nbody\n', { mode: 'strict' })).toThrow('missing YAML frontmatter (--- … ---)');
  });

  it('frontmatter must open the input', () => {
    const { lenient, strict } = both('\n---\na: 1\n---\nb');
    expect(lenient.hasFrontmatter).toBe(false);
    expect((strict as FrontmatterError).message).toBe(FRONTMATTER_MISSING_MESSAGE);
  });

  it('exports the canonical regex', () => {
    expect(FRONTMATTER_RE.source).toBe('^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)([\\s\\S]*)$');
  });
});
