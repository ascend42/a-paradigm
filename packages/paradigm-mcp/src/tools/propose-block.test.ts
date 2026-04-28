/**
 * v6.1 Sprint 1 Wave 5 — Case A: propose-block writer integration test.
 *
 * Mirrors the writer-side coverage pattern established by
 * aspect-roundtrip.test.ts (the missing pattern that uncovered the v6.0.5
 * cross-directory anchor bug). Spawns a tmpdir project, calls the MCP
 * handler directly, asserts the YAML side effect:
 *   - File exists at .paradigm/remediations/<id>.yaml
 *   - YAML parses
 *   - All required schema fields present per spec §2
 *   - id matches `rmd-[a-z0-9]+` shape
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { handleProposeBlockTool, getProposeBlockToolsList } from './propose-block.js';
import { loadProjectContext, type ProjectContext } from '../utils/index-loader.js';

let tmpRoot: string;

async function loadCtx(): Promise<ProjectContext> {
  return loadProjectContext(tmpRoot);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-block-'));
  fs.mkdirSync(path.join(tmpRoot, '.paradigm'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, '.paradigm', 'config.yaml'),
    'version: 2.0.0\nproject:\n  name: propose-block-test\n',
    'utf8',
  );
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('paradigm_propose_block — writer integration (Case A)', () => {
  it('A.1: writes a valid YAML file with all required schema fields', async () => {
    const ctx = await loadCtx();
    const result = await handleProposeBlockTool(
      'paradigm_propose_block',
      {
        claimant: 'compliance',
        severity: 'guard',
        reason: '#payment-form imports stripe → suggested ~payment-pii aspect',
        unblock_hint:
          'Add ~payment-pii to packages/web/src/components/payment-form/.purpose',
      },
      ctx,
    );
    expect(result.handled).toBe(true);

    const payload = JSON.parse(result.text);
    expect(payload.error).toBeUndefined();
    expect(typeof payload.id).toBe('string');
    expect(payload.id).toMatch(/^rmd-[a-z0-9]+$/);
    expect(payload.path).toBe(`.paradigm/remediations/${payload.id}.yaml`);

    // File side effect — exists at the documented path.
    const filePath = path.join(tmpRoot, payload.path);
    expect(fs.existsSync(filePath)).toBe(true);

    // YAML parses cleanly.
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed.id).toBe(payload.id);
    expect(parsed.claimant).toBe('compliance');
    expect(parsed.severity).toBe('guard');
    expect(parsed.reason).toContain('#payment-form');
    expect(parsed.unblock_hint).toContain('~payment-pii');
    expect(typeof parsed.created).toBe('string');
    // ISO 8601 UTC stamp.
    expect(String(parsed.created)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('A.2: rejects missing required fields with an error payload', async () => {
    const ctx = await loadCtx();
    const result = await handleProposeBlockTool(
      'paradigm_propose_block',
      {
        claimant: 'compliance',
        // missing severity/reason/unblock_hint
      },
      ctx,
    );
    expect(result.handled).toBe(true);
    const payload = JSON.parse(result.text);
    expect(payload.error).toBeDefined();
    // No file written.
    const dir = path.join(tmpRoot, '.paradigm', 'remediations');
    if (fs.existsSync(dir)) {
      expect(fs.readdirSync(dir).filter((e) => e.endsWith('.yaml'))).toEqual([]);
    }
  });

  it('A.3: optional expires_at + target are persisted when provided', async () => {
    const ctx = await loadCtx();
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const result = await handleProposeBlockTool(
      'paradigm_propose_block',
      {
        claimant: 'security',
        severity: 'advise',
        reason: 'Time-bounded notice',
        unblock_hint: 'Resolve before EOD',
        expires_at: expiresAt,
        target: { file: 'src/foo.ts', symbol: '#foo', line: 42 },
      },
      ctx,
    );
    const payload = JSON.parse(result.text);
    expect(payload.expires_at).toBe(expiresAt);

    const filePath = path.join(tmpRoot, payload.path);
    const parsed = yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    // js-yaml may parse ISO strings into Date — accept either form, but
    // ensure round-trip equivalence at ISO precision.
    const stored = parsed.expires_at;
    const storedIso =
      stored instanceof Date ? stored.toISOString() : String(stored);
    expect(storedIso).toBe(expiresAt);

    expect(parsed.target).toEqual({ file: 'src/foo.ts', symbol: '#foo', line: 42 });
  });

  it('A.4: tools list exposes paradigm_propose_block with required-field schema', () => {
    const tools = getProposeBlockToolsList();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('paradigm_propose_block');
    expect(tools[0].inputSchema.required).toEqual([
      'claimant',
      'severity',
      'reason',
      'unblock_hint',
    ]);
    expect(tools[0].inputSchema.properties.severity.enum).toEqual([
      'advise',
      'auto-author',
      'guard',
    ]);
  });
});
