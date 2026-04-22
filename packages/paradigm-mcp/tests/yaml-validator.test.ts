/**
 * Regression tests for yaml-validator.ts
 *
 * Covers the v5.37.12 fail-closed YAML loader:
 *   - Missing file → { status: 'missing' }
 *   - Duplicate-key YAML → { status: 'unparseable', errorClass: 'duplicate-key' }
 *   - Syntax error → { status: 'unparseable', errorClass: 'syntax' }
 *   - Valid YAML → { status: 'ok', data }
 *   - Invalid schema → { status: 'invalid' }
 *
 * Critical security assertion: the `detail` string MUST NOT contain raw
 * file contents, gate names, or route paths. This guards against the
 * 2026-04-22 security audit risk (§4a) that YAMLException.toString()
 * leaks file context into logs/telemetry/LLM context.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { z } from 'zod';
import { safeLoad, classifyYamlError, formatLoadFailure } from '../src/utils/yaml-validator.js';
import * as yaml from 'js-yaml';

describe('safeLoad', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-validator-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns { status: "missing" } when the file does not exist', () => {
    const result = safeLoad(path.join(tmpDir, 'nope.yaml'));
    expect(result.status).toBe('missing');
  });

  it('returns { status: "ok" } with parsed data for valid YAML', () => {
    const p = path.join(tmpDir, 'ok.yaml');
    fs.writeFileSync(p, 'version: "2.0"\nname: valid\n');
    const result = safeLoad<{ version: string; name: string }>(p);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.version).toBe('2.0');
      expect(result.data.name).toBe('valid');
    }
  });

  it('classifies duplicate mapping key as duplicate-key', () => {
    const p = path.join(tmpDir, 'dupe.yaml');
    fs.writeFileSync(
      p,
      'gates:\n  gate-with-secret-name:\n    description: a\n  gate-with-secret-name:\n    description: b\n',
    );
    const result = safeLoad(p);
    expect(result.status).toBe('unparseable');
    if (result.status === 'unparseable') {
      expect(result.errorClass).toBe('duplicate-key');
    }
  });

  it('SECURITY: unparseable detail does NOT leak file contents, gate names, or route paths', () => {
    // Craft a portal.yaml whose duplicate-key YAML error would, if rendered
    // via YAMLException.toString(), include the gate name and route path in
    // the user-visible context lines.
    const leakyContent = [
      'version: "2.0"',
      'gates:',
      '  gate-with-secret-name:',
      '    description: DO_NOT_LEAK_SECRET_VALUE',
      '    check: req.user.role === "admin-12345"',
      'routes:',
      '  "GET /api/internal/super-secret-path":',
      '    - ^authenticated',
      '  "GET /api/internal/super-secret-path":',
      '    - ^admin',
      '',
    ].join('\n');

    const p = path.join(tmpDir, 'leaky.yaml');
    fs.writeFileSync(p, leakyContent);

    const result = safeLoad(p);
    expect(result.status).toBe('unparseable');
    if (result.status === 'unparseable') {
      // The detail is a short classifier string.
      expect(result.detail).toBe('duplicate mapping key');
      // It MUST NOT contain any of these identifiers that appeared in the file.
      const forbidden = [
        'gate-with-secret-name',
        'DO_NOT_LEAK_SECRET_VALUE',
        'admin-12345',
        'super-secret-path',
        '/api/internal',
        '^admin',
        '^authenticated',
      ];
      for (const f of forbidden) {
        expect(result.detail).not.toContain(f);
      }
      // Format helper must also be leak-free.
      const formatted = formatLoadFailure(result);
      for (const f of forbidden) {
        expect(formatted).not.toContain(f);
      }
    }
  });

  it('classifies generic syntax error as syntax', () => {
    const p = path.join(tmpDir, 'bad.yaml');
    // Invalid block mapping
    fs.writeFileSync(p, '  :\n:::bad\n');
    const result = safeLoad(p);
    expect(result.status).toBe('unparseable');
    if (result.status === 'unparseable') {
      expect(['syntax', 'other']).toContain(result.errorClass);
    }
  });

  it('returns { status: "invalid" } when zod schema does not match', () => {
    const p = path.join(tmpDir, 'schema.yaml');
    fs.writeFileSync(p, 'version: 42\n'); // version should be a string

    const schema = z.object({ version: z.string() });
    const result = safeLoad(p, { schema });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.errorClass).toBe('schema');
      // Count-only — not leaking field values.
      expect(result.detail).toMatch(/\d+ issue/);
    }
  });

  it('returns { status: "ok" } when zod schema matches', () => {
    const p = path.join(tmpDir, 'good-schema.yaml');
    fs.writeFileSync(p, 'version: "2.0"\nname: hello\n');

    const schema = z.object({ version: z.string(), name: z.string() });
    const result = safeLoad(p, { schema });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.version).toBe('2.0');
    }
  });
});

describe('classifyYamlError', () => {
  it('recognizes duplicate key variants', () => {
    const err = new yaml.YAMLException('duplicated mapping key (line 5)');
    (err as unknown as { reason: string }).reason = 'duplicated mapping key';
    const { errorClass } = classifyYamlError(err);
    expect(errorClass).toBe('duplicate-key');
  });

  it('recognizes mapping values scanning errors as syntax', () => {
    const err = new yaml.YAMLException('bad');
    (err as unknown as { reason: string }).reason = 'mapping values are not allowed here';
    const { errorClass } = classifyYamlError(err);
    expect(errorClass).toBe('syntax');
  });

  it('unknown error types classify as other', () => {
    const { errorClass } = classifyYamlError(new Error('something unrelated'));
    expect(errorClass).toBe('other');
  });
});

describe('formatLoadFailure redaction', () => {
  it('produces a short classifier-only message', () => {
    expect(
      formatLoadFailure({ status: 'unparseable', errorClass: 'duplicate-key', detail: 'anything' }),
    ).toBe("portal.yaml unparseable: duplicate mapping key detected — run 'paradigm doctor' for details");

    expect(
      formatLoadFailure({ status: 'unparseable', errorClass: 'syntax', detail: 'anything' }),
    ).toBe("portal.yaml unparseable: YAML syntax error — run 'paradigm doctor' for details");
  });
});
