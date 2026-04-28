/**
 * v6.1 Sprint 1 Wave 5 — Case G: authority claim/release round-trip.
 *
 * Tests `paradigm_authority_claim` ↔ `paradigm_authority_release` on a
 * tmpdir project. The single-claimant-per-scope model is load-bearing for
 * v6.1 — re-claiming a scope must overwrite (idempotent), and releasing
 * an explicit claim must remove the entry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { handleAuthorityTool, getAuthorityToolsList } from './authority.js';
import { loadProjectContext, type ProjectContext } from '../utils/index-loader.js';

let tmpRoot: string;

async function loadCtx(): Promise<ProjectContext> {
  return loadProjectContext(tmpRoot);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-roundtrip-'));
  fs.mkdirSync(path.join(tmpRoot, '.paradigm'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, '.paradigm', 'config.yaml'),
    'version: 2.0.0\nproject:\n  name: authority-test\n',
    'utf8',
  );
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface AuthorityFile {
  version: string;
  schema: string;
  claims: Record<
    string,
    { claimant: string; severity: string; since: string; source: string }
  >;
}

function readAuthorityYaml(): AuthorityFile | null {
  const p = path.join(tmpRoot, '.paradigm', 'authority.yaml');
  if (!fs.existsSync(p)) return null;
  return yaml.load(fs.readFileSync(p, 'utf8')) as AuthorityFile;
}

describe('paradigm_authority_claim ↔ paradigm_authority_release (Case G)', () => {
  it('G.1: claim then release round-trips cleanly on a fresh project', async () => {
    const ctx = await loadCtx();

    // Pre-state: no authority.yaml yet.
    expect(readAuthorityYaml()).toBeNull();

    // Claim.
    const claimResult = await handleAuthorityTool(
      'paradigm_authority_claim',
      { claimant: 'compliance', scope: 'aspect-coverage', severity: 'block' },
      ctx,
    );
    expect(claimResult.handled).toBe(true);
    const claimPayload = JSON.parse(claimResult.text);
    expect(claimPayload.scope).toBe('aspect-coverage');
    expect(claimPayload.claimant).toBe('compliance');
    expect(claimPayload.severity).toBe('block');
    expect(claimPayload.source).toBe('explicit');

    // YAML side-effect.
    const afterClaim = readAuthorityYaml();
    expect(afterClaim).not.toBeNull();
    expect(afterClaim!.claims['aspect-coverage']).toBeDefined();
    expect(afterClaim!.claims['aspect-coverage'].claimant).toBe('compliance');
    expect(afterClaim!.claims['aspect-coverage'].severity).toBe('block');
    expect(afterClaim!.claims['aspect-coverage'].source).toBe('explicit');

    // Release.
    const releaseResult = await handleAuthorityTool(
      'paradigm_authority_release',
      { claimant: 'compliance', scope: 'aspect-coverage' },
      ctx,
    );
    expect(releaseResult.handled).toBe(true);
    const releasePayload = JSON.parse(releaseResult.text);
    expect(releasePayload.released).toBe(true);
    expect(releasePayload.previousClaimant).toBe('compliance');

    // Scope absent after release.
    const afterRelease = readAuthorityYaml();
    expect(afterRelease).not.toBeNull();
    expect(afterRelease!.claims['aspect-coverage']).toBeUndefined();
  });

  it('G.2: release on absent scope returns released:false (no-op)', async () => {
    const ctx = await loadCtx();
    const result = await handleAuthorityTool(
      'paradigm_authority_release',
      { claimant: 'compliance', scope: 'never-claimed' },
      ctx,
    );
    expect(result.handled).toBe(true);
    const payload = JSON.parse(result.text);
    expect(payload.released).toBe(false);
  });

  it('G.3: re-claiming the same scope overwrites severity (idempotent)', async () => {
    const ctx = await loadCtx();
    await handleAuthorityTool(
      'paradigm_authority_claim',
      { claimant: 'compliance', scope: 'aspect-drift', severity: 'advise' },
      ctx,
    );
    await handleAuthorityTool(
      'paradigm_authority_claim',
      { claimant: 'compliance', scope: 'aspect-drift', severity: 'block' },
      ctx,
    );
    const file = readAuthorityYaml();
    expect(file!.claims['aspect-drift'].severity).toBe('block');
    // Only one entry — no duplication.
    expect(Object.keys(file!.claims).filter((k) => k === 'aspect-drift')).toHaveLength(1);
  });

  it('G.4: claim defaults severity to advise when omitted', async () => {
    const ctx = await loadCtx();
    const result = await handleAuthorityTool(
      'paradigm_authority_claim',
      { claimant: 'compliance', scope: 'anchor-staleness' },
      ctx,
    );
    const payload = JSON.parse(result.text);
    expect(payload.severity).toBe('advise');
  });

  it('G.5: claim rejects missing required fields', async () => {
    const ctx = await loadCtx();
    const result = await handleAuthorityTool(
      'paradigm_authority_claim',
      { claimant: 'compliance' }, // missing scope
      ctx,
    );
    const payload = JSON.parse(result.text);
    expect(payload.error).toBeDefined();
  });

  it('G.6: tools list exposes both claim and release with correct schemas', () => {
    const tools = getAuthorityToolsList();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['paradigm_authority_claim', 'paradigm_authority_release']);
    const claim = tools.find((t) => t.name === 'paradigm_authority_claim')!;
    expect(claim.inputSchema.properties.severity.enum).toEqual(['advise', 'warn', 'block']);
    expect(claim.inputSchema.required).toEqual(['claimant', 'scope']);
  });
});
