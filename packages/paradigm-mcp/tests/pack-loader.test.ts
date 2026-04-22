/**
 * pack-loader.test.ts — v5.39.0 / v6.0 University sub-phase 3 (regression).
 *
 * Covers `packages/paradigm-mcp/src/utils/pack-loader.ts`:
 *   - loadPackManifest: valid + missing-required-field + malformed YAML +
 *     missing-pack.yaml directory all surface with classifier-only errors.
 *   - discoverPacks: three discovery sources (first-party node_modules,
 *     npm dep with paradigm.universityPack pointer, local project pack +
 *     discipline sub-packs). Precedence order preserved. parentPackId wired.
 *     Cache at `.paradigm/cache/packs.json` invalidates on mtime change.
 *   - resolveEntryAddress: bare id vs <pack-id>:<entry-id> forms; ambiguous
 *     bare id across packs throws with candidate list.
 *
 * Safety property preserved:
 *   PackLoadError `message` / `detail` MUST NOT leak manifest body or gate
 *   strings into the error surface. This test plants a distinctive sentinel
 *   string in a bad manifest and asserts it never appears in thrown errors.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadPackManifest,
  discoverPacks,
  resolveEntryAddress,
  PackLoadError,
} from '../src/utils/pack-loader.js';

const SECRET_SENTINEL = 'SECRET-GATE-DO-NOT-LEAK';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-pack-loader-'));
}

function writePackYaml(dir: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.yaml'), body, 'utf8');
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

describe('pack-loader — loadPackManifest', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it('parses a valid pack.yaml and returns a PackManifest', () => {
    tmpDir = mktemp();
    writePackYaml(
      tmpDir,
      [
        'id: example-pack',
        'name: Example Pack',
        'version: 1.0.0',
        'schema_version: "1"',
        'tenant_kind: project',
        'description: A test pack.',
      ].join('\n'),
    );

    const m = loadPackManifest(tmpDir);
    expect(m.id).toBe('example-pack');
    expect(m.tenant_kind).toBe('project');
    expect(m.version).toBe('1.0.0');
  });

  it('throws PackLoadError with errorClass="missing-manifest" when pack.yaml is absent', () => {
    tmpDir = mktemp();  // empty dir
    expect(() => loadPackManifest(tmpDir!)).toThrow(PackLoadError);
    try {
      loadPackManifest(tmpDir);
    } catch (err) {
      expect(err).toBeInstanceOf(PackLoadError);
      expect((err as PackLoadError).errorClass).toBe('missing-manifest');
    }
  });

  it('throws PackLoadError with errorClass="missing-required-field" when a required field is missing', () => {
    tmpDir = mktemp();
    writePackYaml(
      tmpDir,
      // Missing tenant_kind
      [
        'id: incomplete',
        'name: Incomplete',
        'version: 1.0.0',
        'schema_version: "1"',
        'description: missing tenant_kind',
      ].join('\n'),
    );
    expect(() => loadPackManifest(tmpDir!)).toThrow(PackLoadError);
    try {
      loadPackManifest(tmpDir);
    } catch (err) {
      expect((err as PackLoadError).errorClass).toBe('missing-required-field');
    }
  });

  it('rejects an invalid tenant_kind value with missing-required-field classifier', () => {
    tmpDir = mktemp();
    writePackYaml(
      tmpDir,
      [
        'id: bad-tenant',
        'name: Bad',
        'version: 1.0.0',
        'schema_version: "1"',
        'tenant_kind: rogue-kind',
        'description: Invalid tenant kind.',
      ].join('\n'),
    );
    try {
      loadPackManifest(tmpDir);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PackLoadError);
      expect((err as PackLoadError).errorClass).toBe('missing-required-field');
    }
  });

  it('throws PackLoadError with errorClass="manifest-unparseable" on malformed YAML', () => {
    tmpDir = mktemp();
    // Duplicate mapping keys under js-yaml strict is a classic unparseable case
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pack.yaml'),
      'id: dupe\nid: dupe2\nname: X\nversion: 1.0.0\nschema_version: "1"\ntenant_kind: project\ndescription: d\n',
      'utf8',
    );
    try {
      loadPackManifest(tmpDir);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PackLoadError);
      expect((err as PackLoadError).errorClass).toBe('manifest-unparseable');
    }
  });

  it('SECURITY: error messages do NOT contain manifest body strings', () => {
    tmpDir = mktemp();
    // Plant a distinctive SECRET string inside what would be a valid-looking
    // manifest, then corrupt it to force an error. We then scan the thrown
    // error surface for the sentinel — it must not have leaked.
    writePackYaml(
      tmpDir,
      [
        'id: "leaky"',
        'name: Leaky',
        'version: 1.0.0',
        'schema_version: "1"',
        // Distinctive string + a missing required field so load throws
        `description: "innocent body containing ${SECRET_SENTINEL} marker"`,
        // tenant_kind intentionally omitted to trigger missing-required-field
      ].join('\n'),
    );

    try {
      loadPackManifest(tmpDir);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PackLoadError);
      const msg = (err as Error).message;
      const detail = (err as PackLoadError).detail;
      const klass = (err as PackLoadError).errorClass;
      expect(msg).not.toContain(SECRET_SENTINEL);
      expect(detail).not.toContain(SECRET_SENTINEL);
      expect(klass).not.toContain(SECRET_SENTINEL);
    }
  });

  it('SECURITY: unparseable detail is a classifier, not raw content', () => {
    tmpDir = mktemp();
    // Bad YAML that happens to include the sentinel in the bad context
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pack.yaml'),
      `id: x\n\tillegal-tab: ${SECRET_SENTINEL}\n`,
      'utf8',
    );
    try {
      loadPackManifest(tmpDir);
    } catch (err) {
      const msg = (err as Error).message;
      const detail = (err as PackLoadError).detail;
      expect(msg).not.toContain(SECRET_SENTINEL);
      expect(detail).not.toContain(SECRET_SENTINEL);
    }
  });
});

describe('pack-loader — discoverPacks', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it('returns an empty list on a bare project with no packs anywhere', () => {
    tmpDir = mktemp();
    writeJson(path.join(tmpDir, 'package.json'), { name: 'host', version: '0.0.0' });
    const packs = discoverPacks(tmpDir);
    expect(packs).toEqual([]);
  });

  it('discovers first-party pack from node_modules/@a-company/university', () => {
    tmpDir = mktemp();
    writeJson(path.join(tmpDir, 'package.json'), { name: 'host', version: '0.0.0' });
    const fpRoot = path.join(tmpDir, 'node_modules', '@a-company', 'university');
    writePackYaml(
      fpRoot,
      [
        'id: paradigm',
        'name: Paradigm University',
        'version: 6.0.0',
        'schema_version: "1"',
        'tenant_kind: first-party',
        'description: First-party pack.',
      ].join('\n'),
    );

    const packs = discoverPacks(tmpDir);
    const fp = packs.find(p => p.source === 'first-party');
    expect(fp).toBeDefined();
    expect(fp!.manifest.id).toBe('paradigm');
    expect(fp!.manifest.tenant_kind).toBe('first-party');
  });

  it('discovers npm dep with paradigm.universityPack pointer field', () => {
    tmpDir = mktemp();
    writeJson(path.join(tmpDir, 'package.json'), {
      name: 'host',
      version: '0.0.0',
      dependencies: { '@vendor/onboarding': '1.0.0' },
    });
    const vendorDir = path.join(tmpDir, 'node_modules', '@vendor', 'onboarding');
    writeJson(path.join(vendorDir, 'package.json'), {
      name: '@vendor/onboarding',
      version: '1.0.0',
      paradigm: { universityPack: './pack' },
    });
    writePackYaml(
      path.join(vendorDir, 'pack'),
      [
        'id: vendor-onboarding',
        'name: Vendor Onboarding',
        'version: 1.0.0',
        'schema_version: "1"',
        'tenant_kind: external',
        'description: External pack via pointer.',
      ].join('\n'),
    );

    const packs = discoverPacks(tmpDir);
    const npm = packs.find(p => p.source === 'npm');
    expect(npm).toBeDefined();
    expect(npm!.manifest.id).toBe('vendor-onboarding');
    expect(npm!.manifest.tenant_kind).toBe('external');
  });

  it('discovers local project pack + discipline sub-packs and wires parentPackId', () => {
    tmpDir = mktemp();
    writeJson(path.join(tmpDir, 'package.json'), { name: 'host', version: '0.0.0' });
    const localRoot = path.join(tmpDir, '.paradigm', 'university');
    writePackYaml(
      localRoot,
      [
        'id: acme-project',
        'name: Acme Onboarding',
        'version: 0.1.0',
        'schema_version: "1"',
        'tenant_kind: project',
        'description: Project pack.',
      ].join('\n'),
    );
    const designSub = path.join(localRoot, 'design');
    writePackYaml(
      designSub,
      [
        'id: acme-project-design',
        'name: Acme Design',
        'version: 0.1.0',
        'schema_version: "1"',
        'tenant_kind: project',
        'description: Design sub-pack.',
      ].join('\n'),
    );

    const packs = discoverPacks(tmpDir);
    const project = packs.find(p => p.manifest.id === 'acme-project');
    const sub = packs.find(p => p.manifest.id === 'acme-project-design');
    expect(project?.source).toBe('local');
    expect(sub?.source).toBe('local');
    expect(sub?.parentPackId).toBe('acme-project');
  });

  it('preserves precedence order: first-party → npm → local', () => {
    tmpDir = mktemp();
    writeJson(path.join(tmpDir, 'package.json'), {
      name: 'host',
      version: '0.0.0',
      dependencies: { '@vendor/onboarding': '1.0.0' },
    });
    // First-party
    writePackYaml(
      path.join(tmpDir, 'node_modules', '@a-company', 'university'),
      'id: paradigm\nname: FP\nversion: 1\nschema_version: "1"\ntenant_kind: first-party\ndescription: fp\n',
    );
    // npm
    const vendorDir = path.join(tmpDir, 'node_modules', '@vendor', 'onboarding');
    writeJson(path.join(vendorDir, 'package.json'), {
      name: '@vendor/onboarding',
      version: '1.0.0',
      paradigm: { universityPack: './pack' },
    });
    writePackYaml(
      path.join(vendorDir, 'pack'),
      'id: vendor-onboarding\nname: V\nversion: 1\nschema_version: "1"\ntenant_kind: external\ndescription: v\n',
    );
    // local
    writePackYaml(
      path.join(tmpDir, '.paradigm', 'university'),
      'id: local-project\nname: L\nversion: 1\nschema_version: "1"\ntenant_kind: project\ndescription: l\n',
    );

    const packs = discoverPacks(tmpDir);
    const sourcesOrder = packs.map(p => p.source);
    // first-party before npm, npm before local
    const fpIdx = sourcesOrder.indexOf('first-party');
    const npmIdx = sourcesOrder.indexOf('npm');
    const localIdx = sourcesOrder.indexOf('local');
    expect(fpIdx).toBeGreaterThanOrEqual(0);
    expect(npmIdx).toBeGreaterThan(fpIdx);
    expect(localIdx).toBeGreaterThan(npmIdx);
  });

  it('writes a discovery cache at .paradigm/cache/packs.json and invalidates on mtime change', () => {
    tmpDir = mktemp();
    writeJson(path.join(tmpDir, 'package.json'), { name: 'host', version: '0.0.0' });
    writePackYaml(
      path.join(tmpDir, '.paradigm', 'university'),
      'id: p\nname: P\nversion: 1\nschema_version: "1"\ntenant_kind: project\ndescription: p\n',
    );

    const first = discoverPacks(tmpDir);
    expect(first).toHaveLength(1);

    const cachePath = path.join(tmpDir, '.paradigm', 'cache', 'packs.json');
    expect(fs.existsSync(cachePath)).toBe(true);

    // Second call hits the cache; to verify that, delete the project pack's
    // manifest while preserving the directory mtime (no mtime change → cache
    // wins; we still see the cached pack).
    const localRoot = path.join(tmpDir, '.paradigm', 'university');
    const beforeStat = fs.statSync(localRoot);

    // Parse cache, confirm structure, and roundtrip the pack id
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      version: number;
      packs: Array<{ manifest: { id: string } }>;
      local_university_mtime_ms?: number;
    };
    expect(cached.version).toBe(1);
    expect(cached.packs[0].manifest.id).toBe('p');

    // Touch .paradigm/university (bump mtime) so the cache invalidates, then
    // re-discover. Expect fresh discovery; our new pack id should appear.
    const newTime = new Date(beforeStat.mtime.getTime() + 5000);
    fs.utimesSync(localRoot, newTime, newTime);

    // Replace the manifest to prove cache is not used
    writePackYaml(
      localRoot,
      'id: p2\nname: P2\nversion: 1\nschema_version: "1"\ntenant_kind: project\ndescription: p2\n',
    );
    // Bump again to guarantee >= older recorded mtime (kernel granularity paranoia)
    const evenNewer = new Date(Date.now() + 10000);
    fs.utimesSync(localRoot, evenNewer, evenNewer);

    const second = discoverPacks(tmpDir);
    expect(second).toHaveLength(1);
    expect(second[0].manifest.id).toBe('p2');
  });
});

describe('pack-loader — resolveEntryAddress', () => {
  it('resolves a bare id to the activePack', () => {
    const r = resolveEntryAddress('N-symbol-basics', { activePack: 'paradigm' });
    expect(r).toEqual({ packId: 'paradigm', entryId: 'N-symbol-basics' });
  });

  it('parses <pack-id>:<entry-id> form', () => {
    const r = resolveEntryAddress('paradigm:N-symbol-basics', { activePack: 'other' });
    expect(r).toEqual({ packId: 'paradigm', entryId: 'N-symbol-basics' });
  });

  it('throws on malformed <pack-id>:<entry-id> (missing pack or entry)', () => {
    expect(() => resolveEntryAddress(':entry', { activePack: 'p' })).toThrow();
    expect(() => resolveEntryAddress('pack:', { activePack: 'p' })).toThrow();
  });

  it('throws on empty address', () => {
    expect(() => resolveEntryAddress('', { activePack: 'p' })).toThrow();
  });

  it('throws ambiguity error with candidate list when bare id exists in multiple active packs', () => {
    const ctx = {
      activePack: 'paradigm',
      candidatePacks: ['paradigm', 'acme-project'],
      entryExistsIn: (_pack: string, entry: string) => entry === 'N-shared',
    };
    try {
      resolveEntryAddress('N-shared', ctx);
      throw new Error('expected throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('ambiguous');
      expect(msg).toContain('paradigm:N-shared');
      expect(msg).toContain('acme-project:N-shared');
    }
  });

  it('returns unambiguous pack when bare id exists in exactly one candidate pack', () => {
    const ctx = {
      activePack: 'paradigm',
      candidatePacks: ['paradigm', 'acme-project'],
      entryExistsIn: (pack: string, _entry: string) => pack === 'acme-project',
    };
    const r = resolveEntryAddress('N-only-in-acme', ctx);
    expect(r).toEqual({ packId: 'acme-project', entryId: 'N-only-in-acme' });
  });
});
