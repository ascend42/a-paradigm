/**
 * The §11.2 rule 6 CSP is byte-unchanged (boards S1.0 item 7; Aegis S1 merge condition "rules.ts:45-58
 * byte-unchanged by test"). The Excalidraw board loads under THIS policy; nothing about boards may loosen it:
 * no 'unsafe-eval', no 'wasm-unsafe-eval', no 'unsafe-inline', no data: in img-src, no second origin.
 * A deliberate CSP change must move the pinned digest here in the same commit, with its G-WEB-06 case.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/kernel/web/rules.js';
// @ts-expect-error plain .mjs (the zero-dependency probe helper)
import { gnomonCsp } from '../probes/_shared/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(path.join(HERE, '..', 'src', 'kernel', 'web', 'rules.ts'), 'utf8').replace(/\r\n/g, '\n').split('\n');
/** rules.ts lines 45-58 (1-based, inclusive), LF. */
const block = `${lines.slice(44, 58).join('\n')}\n`;
const POLICY = (port: number): string =>
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src ws://127.0.0.1:${port} http://127.0.0.1:${port}; worker-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

describe('G-WEB-06 the CSP rules are byte-unchanged (rules.ts:45-58)', () => {
  it('lines 45-58 are contentSecurityPolicy, byte for byte', () => {
    expect(lines[43]).toBe('/** §11.2 rule 6, verbatim. */');
    expect(lines[44]).toBe('export function contentSecurityPolicy(port: number): string {');
    expect(lines[57]).toBe("  ].join('; ');");
    expect(lines[58]).toBe('}');
    expect(block).toBe(
      [
        'export function contentSecurityPolicy(port: number): string {',
        '  return [',
        `    "default-src 'none'",`,
        `    "script-src 'self'",`,
        `    "style-src 'self'",`,
        `    "img-src 'self' blob:",`,
        `    "font-src 'self'",`,
        '    `connect-src ws://127.0.0.1:${port} http://127.0.0.1:${port}`,',
        `    "worker-src 'self'",`,
        `    "frame-src 'none'",`,
        `    "frame-ancestors 'none'",`,
        `    "base-uri 'none'",`,
        `    "form-action 'none'",`,
        "  ].join('; ');",
        '',
      ].join('\n'),
    );
    expect(createHash('sha256').update(block).digest('hex')).toBe('ef0a1d8a9ca82c36804363f3f57a7426a43f3818ae937e6c0f63a4194b4deea1');
  });

  it('the policy it returns is the spec sentence, with nothing loosened', () => {
    const csp = contentSecurityPolicy(49152);
    expect(csp).toBe(POLICY(49152));
    for (const loose of ["'unsafe-eval'", "'wasm-unsafe-eval'", "'unsafe-inline'", "'unsafe-hashes'", "'strict-dynamic'", 'data:', 'https:', 'http://*', '*.', ' * ', 'nonce-', 'sha256-']) expect(csp, loose).not.toContain(loose);
    expect(csp.split('; ').map((d) => d.split(' ')[0])).toEqual(['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'frame-ancestors', 'base-uri', 'form-action']);
    const spec = readFileSync(path.join(HERE, '..', '..', '..', 'docs', 'specs', 'gnomon.md'), 'utf8');
    expect(spec).toContain(`\`Content-Security-Policy: ${POLICY(0).replaceAll('127.0.0.1:0', '127.0.0.1:<port>')}\``);
  });

  it('the probes and G-DDL-06 serve the board under the same bytes (their copy cannot drift from the kernel)', () => {
    for (const port of [1, 8790, 65535]) expect(gnomonCsp(port)).toBe(contentSecurityPolicy(port));
  });
});
