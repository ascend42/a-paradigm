/**
 * #brain-health — broken links, loose notes, same-name notes (owner + agent views).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initBrain, addShare, setAgentAccess } from './config.js';
import { scanBrain, openBrainView } from './view.js';
import { brainHealth, computeHealth } from './health.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';

let sb: BrainSandbox;
let rootHash: string;

function w(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

beforeAll(() => {
  sb = makeSandbox('brain-health-');
  const root = path.join(sb.tmp, 'vault');
  fs.mkdirSync(root);
  w(root, 'Home/Lease.md', '# Lease\n[[Missing Note]] and [[Budget]] and [x](./nope.md)\n');
  w(root, 'Home/Budget.md', '# Budget\n[[Lease]]\n');
  w(root, 'Home/Loose.md', '# Loose\nnothing links here\n');
  w(root, 'Work/Lease.md', '# Work lease\n[[Budget]]\n');
  w(root, 'Work/Secret.md', '# Secret\n[[Health/Checkup]]\n');
  w(root, 'Health/Checkup.md', '# Checkup\n');
  w(root, 'Health/Loose.md', '# Hidden loose\n');
  rootHash = initBrain(root, sb.opts).rootHash;
  scanBrain(rootHash, sb.opts);
});
afterAll(() => sb.cleanup());

describe('brain health', () => {
  it('reports broken links (wikilink + markdown), never hidden targets', () => {
    const h = brainHealth(rootHash, 'owner', sb.opts);
    const broken = h.brokenLinks.map((b) => `${b.relpath}->${b.target}`).sort();
    expect(broken).toEqual(['Home/Lease.md->./nope.md', 'Home/Lease.md->Missing Note']);
    expect(JSON.stringify(h)).not.toContain('Checkup');
    expect(h.counts.brokenLinks).toBe(2);
  });

  it('reports loose notes from visible files only', () => {
    const h = brainHealth(rootHash, 'owner', sb.opts);
    expect(h.looseNotes.map((l) => l.relpath)).toEqual(['Home/Loose.md']);
  });

  it('groups same-name notes, excluding hidden zones', () => {
    const h = brainHealth(rootHash, 'owner', sb.opts);
    expect(h.sameNameNotes).toEqual([
      { name: 'lease', match: 'filename', files: expect.arrayContaining([expect.objectContaining({ relpath: 'Home/Lease.md' }), expect.objectContaining({ relpath: 'Work/Lease.md' })]) },
    ]);
    expect(h.sameNameNotes.some((g) => g.name === 'loose')).toBe(false);
  });

  it('agent view: empty unless shared + metadata access', () => {
    expect(brainHealth(rootHash, 'agent', sb.opts).notes).toBe(0);
    addShare(rootHash, 'Home/**', sb.opts);
    setAgentAccess(rootHash, 'metadata', sb.opts);
    const h = computeHealth(openBrainView(rootHash, 'agent', sb.opts));
    expect(h.notes).toBe(3);
    expect(JSON.stringify(h)).not.toContain('Work/');
  });

  it('groups notes that share a title, case-insensitively (H1 after frontmatter)', () => {
    const sb2 = makeSandbox('brain-health-title-');
    try {
      const root = path.join(sb2.tmp, 'vault');
      fs.mkdirSync(root);
      w(root, 'Home/Lease.md', '---\ntags: [home]\n---\n# Apartment Lease\nSigned 2025.\n');
      w(root, 'Work/lease-copy.md', '---\ntitle: "  apartment LEASE "\n---\nCopy for the office.\n');
      w(root, 'Work/Other.md', '# Something else\n');
      const rh = initBrain(root, sb2.opts).rootHash;
      scanBrain(rh, sb2.opts);
      const h = brainHealth(rh, 'owner', sb2.opts);
      expect(h.counts.sameNameNotes).toBe(1);
      expect(h.sameNameNotes).toEqual([
        { name: 'apartment lease', match: 'title', files: [
          expect.objectContaining({ relpath: 'Home/Lease.md' }),
          expect.objectContaining({ relpath: 'Work/lease-copy.md' }),
        ] },
      ]);
    } finally {
      sb2.cleanup();
    }
  });
});
