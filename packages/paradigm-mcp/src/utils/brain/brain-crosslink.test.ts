/**
 * #brain-crosslink — brain→code staleness proof over a temp workspace:
 * valid → (delete symbol + reindex) provably-stale → (remove member) unknown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { initBrain, loadBrainConfig, saveBrainConfig } from './config.js';
import { scanBrain } from './view.js';
import { checkCrossLinks, resolveCrossLinkTarget } from './crosslink.js';
import { addDeclaredRelate } from './declared.js';
import { rebuildStaticFiles } from '../../tools/reindex.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';

let sb: BrainSandbox;
let rootHash: string;
let code: string;
let wsFile: string;

const purpose = (withSkill: boolean) => [
  'version: 2.0.0',
  'description: temp member',
  'components:',
  ...(withSkill ? ['  skill-loader:', '    description: Loads skills'] : []),
  '  other-thing:',
  '    description: Something else',
  '',
].join('\n');

beforeAll(async () => {
  sb = makeSandbox('brain-xlink-');
  code = path.join(sb.tmp, 'ws', 'code');
  fs.mkdirSync(path.join(code, '.paradigm'), { recursive: true });
  fs.writeFileSync(path.join(code, '.paradigm', 'config.yaml'), 'name: code\n');
  fs.writeFileSync(path.join(code, '.purpose'), purpose(true));
  await rebuildStaticFiles(code);
  wsFile = path.join(sb.tmp, 'ws', '.paradigm-workspace');
  fs.writeFileSync(wsFile, yaml.dump({ version: '1.0', name: 'ws', members: [{ name: 'a-paradigm', path: './code' }] }));

  const root = path.join(sb.tmp, 'vault');
  fs.mkdirSync(path.join(root, 'Dev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Dev', 'Skills.md'), "---\nrelates: ['a-paradigm/#skill-loader']\n---\n# Skills\n");
  fs.writeFileSync(path.join(root, 'Dev', 'Plain.md'), '# Plain\n');
  fs.mkdirSync(path.join(root, 'Health'));
  fs.writeFileSync(path.join(root, 'Health', 'Hidden.md'), "---\nrelates: ['a-paradigm/#other-thing']\n---\n# Hidden\n");
  rootHash = initBrain(root, sb.opts).rootHash;
  saveBrainConfig(rootHash, { ...loadBrainConfig(rootHash, sb.opts), workspace: wsFile }, sb.opts);
  scanBrain(rootHash, sb.opts);
}, 60_000);
afterAll(() => sb.cleanup());

describe('brain → code cross-links', () => {
  it('valid when the member index has the symbol; hidden files contribute nothing', () => {
    const links = checkCrossLinks(rootHash, 'owner', sb.opts);
    expect(links).toEqual([expect.objectContaining({ relpath: 'Dev/Skills.md', target: 'a-paradigm/#skill-loader', via: 'frontmatter', verdict: 'valid' })]);
  });

  it('declared relates are checked too', () => {
    const links0 = checkCrossLinks(rootHash, 'owner', sb.opts);
    addDeclaredRelate(rootHash, { file: links0[0].fileId, target: 'a-paradigm/#other-thing', via: 'confirm' }, sb.opts);
    const links = checkCrossLinks(rootHash, 'owner', sb.opts);
    expect(links.find((l) => l.target === 'a-paradigm/#other-thing')).toMatchObject({ via: 'confirm', verdict: 'valid' });
  });

  it('provably-stale after the symbol is deleted and the member reindexed', async () => {
    fs.writeFileSync(path.join(code, '.purpose'), purpose(false));
    await rebuildStaticFiles(code);
    const link = checkCrossLinks(rootHash, 'owner', sb.opts).find((l) => l.target === 'a-paradigm/#skill-loader');
    expect(link).toMatchObject({ verdict: 'provably-stale', reason: 'symbol-absent' });
  }, 60_000);

  it('unknown — never stale — without proof', () => {
    expect(resolveCrossLinkTarget('#skill-loader', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'bad-target' });
    expect(resolveCrossLinkTarget('nope/#skill-loader', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'member-missing' });
    expect(resolveCrossLinkTarget('a-paradigm/#x', undefined, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'no-workspace' });
    expect(resolveCrossLinkTarget('a-paradigm/#x', path.join(sb.tmp, 'missing.yaml'), sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'workspace-unreadable' });
    // Remove the member from the workspace → unknown.
    fs.writeFileSync(wsFile, yaml.dump({ version: '1.0', name: 'ws', members: [] }));
    const link = checkCrossLinks(rootHash, 'owner', sb.opts).find((l) => l.target === 'a-paradigm/#skill-loader');
    expect(link).toMatchObject({ verdict: 'unknown', reason: 'member-missing' });
    // Member listed but index unreadable → unknown.
    fs.writeFileSync(wsFile, yaml.dump({ version: '1.0', name: 'ws', members: [{ name: 'a-paradigm', path: './code' }] }));
    fs.writeFileSync(path.join(code, '.paradigm', 'scan-index.json'), '{not json');
    expect(resolveCrossLinkTarget('a-paradigm/#skill-loader', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'index-unreadable' });
  });

  it('exports filter: present-but-unexported is unknown, not valid', async () => {
    fs.writeFileSync(path.join(code, '.purpose'), purpose(true));
    await rebuildStaticFiles(code);
    fs.writeFileSync(wsFile, yaml.dump({ version: '1.0', name: 'ws', members: [{ name: 'a-paradigm', path: './code', exports: ['#other-*'] }] }));
    expect(resolveCrossLinkTarget('a-paradigm/#skill-loader', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'not-exported' });
    expect(resolveCrossLinkTarget('a-paradigm/#other-thing', wsFile, sb.opts)).toMatchObject({ verdict: 'valid' });
  }, 60_000);

  describe('never stale without proof (index-unreadable / index-outdated)', () => {
    const idx = () => path.join(code, '.paradigm', 'scan-index.json');
    const resetWs = () => fs.writeFileSync(wsFile, yaml.dump({ version: '1.0', name: 'ws', members: [{ name: 'a-paradigm', path: './code' }] }));

    it('index with none of the category keys → unknown index-unreadable', () => {
      resetWs();
      fs.writeFileSync(idx(), JSON.stringify({ $meta: { version: '1.0.0' }, symbolMap: {} }));
      expect(resolveCrossLinkTarget('a-paradigm/#gone', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'index-unreadable' });
    });

    it('index whose categories are arrays (wrong shape) → unknown index-unreadable', () => {
      resetWs();
      fs.writeFileSync(idx(), JSON.stringify({ components: [], flows: [] }));
      expect(resolveCrossLinkTarget('a-paradigm/#gone', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'index-unreadable' });
    });

    it('index with categories but zero symbols → unknown index-unreadable', () => {
      resetWs();
      fs.writeFileSync(idx(), JSON.stringify({ components: {}, flows: {}, gates: {}, signals: {}, aspects: {} }));
      expect(resolveCrossLinkTarget('a-paradigm/#gone', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'index-unreadable' });
    });

    it('a member .purpose newer than scan-index.json → unknown index-outdated (even for a missing symbol)', async () => {
      resetWs();
      fs.writeFileSync(path.join(code, '.purpose'), purpose(true));
      await rebuildStaticFiles(code);
      expect(resolveCrossLinkTarget('a-paradigm/#gone', wsFile, sb.opts)).toMatchObject({ verdict: 'provably-stale', reason: 'symbol-absent' });
      // Nested .purpose edited after indexing.
      const nested = path.join(code, 'sub', '.purpose');
      fs.mkdirSync(path.dirname(nested), { recursive: true });
      fs.writeFileSync(nested, 'version: 2.0.0\ncomponents:\n  gone:\n    description: new\n');
      // Age the index so the edit is unambiguously newer (no same-tick flake).
      const earlier = new Date(fs.statSync(nested).mtimeMs - 5_000);
      fs.utimesSync(idx(), earlier, earlier);
      expect(resolveCrossLinkTarget('a-paradigm/#gone', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'index-outdated' });
      expect(resolveCrossLinkTarget('a-paradigm/#skill-loader', wsFile, sb.opts)).toMatchObject({ verdict: 'unknown', reason: 'index-outdated' });
      // Reindex → proof restored (the new symbol is now present).
      await rebuildStaticFiles(code);
      expect(resolveCrossLinkTarget('a-paradigm/#gone', wsFile, sb.opts)).toMatchObject({ verdict: 'valid' });
      fs.rmSync(path.join(code, 'sub'), { recursive: true, force: true });
      await rebuildStaticFiles(code);
    }, 60_000);

    it('the scan-index shape `paradigm index` writes is the shape buildIndexFromScanData reads', async () => {
      await rebuildStaticFiles(code);
      const data = JSON.parse(fs.readFileSync(idx(), 'utf8'));
      expect(data.components && typeof data.components).toBe('object');
      expect(Array.isArray(data.components)).toBe(false);
      expect(data.components['skill-loader']).toMatchObject({ symbol: '#skill-loader' });
    }, 60_000);
  });
});
