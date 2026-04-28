import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  writeArchetypeDefaults,
  readAuthority,
  getActiveClaims,
  upsertClaim,
  removeClaim,
  type AuthorityClaim,
} from './authority.js';

describe('writeArchetypeDefaults', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paradigm-authority-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .paradigm/authority.yaml with the locked v0-experimental schema', async () => {
    await writeArchetypeDefaults(tmpDir, 'archetype-default');

    const authorityPath = path.join(tmpDir, '.paradigm', 'authority.yaml');
    const content = await fs.readFile(authorityPath, 'utf8');
    const parsed = yaml.load(content) as Record<string, unknown>;

    expect(parsed.version).toBe('1.0');
    expect(parsed.schema).toBe('v0-experimental');
    expect(parsed.claims).toBeDefined();
  });

  it('writes all three default claims with claimant=compliance and severity=advise', async () => {
    await writeArchetypeDefaults(tmpDir, 'archetype-default');

    const authorityPath = path.join(tmpDir, '.paradigm', 'authority.yaml');
    const content = await fs.readFile(authorityPath, 'utf8');
    const parsed = yaml.load(content) as { claims: Record<string, { claimant: string; severity: string; source: string; since: string }> };

    for (const claimId of ['aspect-coverage', 'aspect-drift', 'anchor-staleness']) {
      expect(parsed.claims[claimId]).toBeDefined();
      expect(parsed.claims[claimId].claimant).toBe('compliance');
      expect(parsed.claims[claimId].severity).toBe('advise');
      expect(parsed.claims[claimId].source).toBe('archetype-default');
      expect(parsed.claims[claimId].since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('records the supplied source on every claim', async () => {
    await writeArchetypeDefaults(tmpDir, 'explicit');

    const content = await fs.readFile(path.join(tmpDir, '.paradigm', 'authority.yaml'), 'utf8');
    const parsed = yaml.load(content) as { claims: Record<string, { source: string }> };

    expect(parsed.claims['aspect-coverage'].source).toBe('explicit');
    expect(parsed.claims['aspect-drift'].source).toBe('explicit');
    expect(parsed.claims['anchor-staleness'].source).toBe('explicit');
  });

  it('is idempotent — does not overwrite an existing authority.yaml', async () => {
    const authorityPath = path.join(tmpDir, '.paradigm', 'authority.yaml');
    await fs.mkdir(path.dirname(authorityPath), { recursive: true });
    const sentinel = 'version: "1.0"\nschema: user-customized\nclaims: {}\n';
    await fs.writeFile(authorityPath, sentinel, 'utf8');

    await writeArchetypeDefaults(tmpDir, 'archetype-default');

    const content = await fs.readFile(authorityPath, 'utf8');
    expect(content).toBe(sentinel);
  });

  it('creates .paradigm/ defensively when the directory is absent', async () => {
    // tmpDir contains no .paradigm/ — writer must mkdir -p
    await writeArchetypeDefaults(tmpDir, 'user');

    const stat = await fs.stat(path.join(tmpDir, '.paradigm'));
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('authority readers (v6.1)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paradigm-authority-readers-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('readAuthority returns null when file is absent', async () => {
    const result = await readAuthority(tmpDir);
    expect(result).toBeNull();
  });

  it('getActiveClaims returns empty object when file is absent', async () => {
    const claims = await getActiveClaims(tmpDir);
    expect(claims).toEqual({});
  });

  it('upsertClaim creates the file and inserts the claim', async () => {
    const claim: AuthorityClaim = {
      claimant: 'compliance',
      severity: 'block',
      since: new Date().toISOString(),
      source: 'explicit',
    };
    await upsertClaim(tmpDir, 'aspect-coverage', claim);

    const claims = await getActiveClaims(tmpDir);
    expect(claims['aspect-coverage']).toEqual(claim);
  });

  it('upsertClaim overwrites a prior claim on the same scope (single-claimant model)', async () => {
    await writeArchetypeDefaults(tmpDir, 'archetype-default');
    const replacement: AuthorityClaim = {
      claimant: 'compliance',
      severity: 'block',
      since: new Date().toISOString(),
      source: 'explicit',
    };
    await upsertClaim(tmpDir, 'aspect-coverage', replacement);

    const claims = await getActiveClaims(tmpDir);
    expect(claims['aspect-coverage'].severity).toBe('block');
    expect(claims['aspect-coverage'].source).toBe('explicit');
    // Sibling claims preserved
    expect(claims['aspect-drift']).toBeDefined();
  });

  it('removeClaim deletes the entry and returns true', async () => {
    await writeArchetypeDefaults(tmpDir, 'archetype-default');
    const removed = await removeClaim(tmpDir, 'aspect-coverage');
    expect(removed).toBe(true);

    const claims = await getActiveClaims(tmpDir);
    expect(claims['aspect-coverage']).toBeUndefined();
    expect(claims['aspect-drift']).toBeDefined();
  });

  it('removeClaim returns false when scope or file is absent', async () => {
    expect(await removeClaim(tmpDir, 'nope')).toBe(false);
    await writeArchetypeDefaults(tmpDir, 'archetype-default');
    expect(await removeClaim(tmpDir, 'nope')).toBe(false);
  });

  it('claim → release round-trip preserves an empty claims map', async () => {
    const claim: AuthorityClaim = {
      claimant: 'compliance',
      severity: 'advise',
      since: new Date().toISOString(),
      source: 'explicit',
    };
    await upsertClaim(tmpDir, 'tmp-scope', claim);
    await removeClaim(tmpDir, 'tmp-scope');

    const file = await readAuthority(tmpDir);
    expect(file).not.toBeNull();
    expect(file!.claims).toEqual({});
  });
});
