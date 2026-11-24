/**
 * A key that already carries its section's symbol prefix (`flows: { $x: … }`)
 * is read as the plain id, with a warning, for each of the five symbol kinds.
 */
import { describe, it, expect } from 'vitest';
import { parsePurposeContent, normalizeSymbolKeys } from './parser.js';

const KINDS = [
  { section: 'components', prefix: '#', key: `'#cart-store'` },
  { section: 'flows', prefix: '$', key: '$cart-store' },
  { section: 'gates', prefix: '^', key: '^cart-store' },
  { section: 'signals', prefix: '!', key: `'!cart-store'` },
  { section: 'aspects', prefix: '~', key: '~cart-store' },
] as const;

describe('redundant section prefix on a key', () => {
  for (const { section, prefix, key } of KINDS) {
    it(`${section}: "${prefix}cart-store" is the id "cart-store"`, () => {
      const result = parsePurposeContent(
        ['version: "2.0"', `${section}:`, `  ${key}:`, '    description: A thing', ''].join('\n'),
      );

      expect(result.errors).toEqual([]);
      const block = (result.data as unknown as Record<string, Record<string, unknown>>)[section];
      expect(Object.keys(block)).toEqual(['cart-store']);
      expect(block['cart-store']).toEqual({ description: 'A thing' });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0].type).toBe('redundant-prefix');
      expect(result.warnings![0].path).toBe(`${section}.${prefix}cart-store`);
      expect(result.warnings![0].message).toContain(`symbol ${prefix}cart-store`);
      expect(result.warnings![0].message).toContain('Write the key as "cart-store"');
    });
  }

  it('features are components: a "#" key under features loses the prefix', () => {
    const data = { features: { '#login': { description: 'x' } } };
    const warnings = normalizeSymbolKeys(data);
    expect(Object.keys(data.features)).toEqual(['login']);
    expect(warnings).toHaveLength(1);
  });

  it('a plain key gets no warning and is left alone', () => {
    const result = parsePurposeContent(
      ['flows:', '  checkout:', '    description: Pay', 'gates:', '  authenticated:', '    description: Logged in', ''].join('\n'),
    );
    expect(result.warnings).toEqual([]);
    expect(Object.keys(result.data!.flows as object)).toEqual(['checkout']);
  });

  it('only the section\'s own prefix is redundant', () => {
    // "!urgent" under flows is not a doubled flow prefix; it is left as written
    const data = { flows: { '!urgent': { description: 'x' } } };
    expect(normalizeSymbolKeys(data)).toEqual([]);
    expect(Object.keys(data.flows)).toEqual(['!urgent']);
  });

  it('a repeated prefix is stripped whole', () => {
    const data = { components: { '##docs-scaffold': { description: 'x' } } };
    const warnings = normalizeSymbolKeys(data);
    expect(Object.keys(data.components)).toEqual(['docs-scaffold']);
    expect(warnings).toHaveLength(1);
  });

  it('keeps the written order of a section', () => {
    const data = { flows: { a: {}, $b: {}, c: {} } as Record<string, unknown> };
    normalizeSymbolKeys(data);
    expect(Object.keys(data.flows)).toEqual(['a', 'b', 'c']);
  });

  it('when both spellings are present the plain key wins and the warning says so', () => {
    const data = {
      flows: { $checkout: { description: 'prefixed' }, checkout: { description: 'plain' } } as Record<string, unknown>,
    };
    const warnings = normalizeSymbolKeys(data);
    expect(data.flows).toEqual({ checkout: { description: 'plain' } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('is also defined in this section');
  });

  it('array format: a prefixed id or flow name loses the prefix', () => {
    const data = {
      components: [{ id: '#cart', description: 'x' }],
      flows: [{ name: '$pay', steps: [] }],
    };
    const warnings = normalizeSymbolKeys(data);
    expect(data.components[0].id).toBe('cart');
    expect(data.flows[0].name).toBe('pay');
    expect(warnings.map((w) => w.path)).toEqual(['components.#cart', 'flows.$pay']);
  });

  it('a prefixed top-level key still moves into its section, without a warning', () => {
    const result = parsePurposeContent(['"#MCPServer":', '  description: Server', ''].join('\n'));
    expect(Object.keys(result.data!.components as object)).toEqual(['MCPServer']);
    expect(result.warnings).toEqual([]);
  });
});
