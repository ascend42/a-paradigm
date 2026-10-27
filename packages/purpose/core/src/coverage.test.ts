import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  resolvePurposeCoverage,
  isPlaceholderPurposeContent,
  filterGitIgnored,
} from './coverage.js';
import { findPurposeFiles } from './aggregator.js';

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

const CID_STUB = `# Auto-generated .purpose stub — created by Cid (captain debrief)
# Delegate to Scribe (Documentor) for rich documentation
name: cli
description: "TODO: describe what this directory/module does"
context:
  - "Stub created by Cid during coverage audit — update with real context"
components:
  cli:
    description: "TODO: describe this component"
    tags: []
`;

const HOOK_STUB = `# Auto-generated .purpose stub — update with real descriptions
components:
  core:
    description: "TODO: describe this component"
    tags: []
`;

const PKG_PURPOSE = `version: "2.0"
description: The widget package, a real description of what it does.
components:
  widget-cli:
    description: >-
      The command line. src/cli/main.ts parses argv. Tests: test/cli.test.ts.
    tags: [cli]
  widget-kernel:
    description: The kernel modules.
    path: src/kernel
  widget-anchor:
    description: Anchored component.
    anchors:
      - src/anchored/thing.ts:1-20
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'purpose-coverage-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('isPlaceholderPurposeContent', () => {
  it('recognises the Cid stub and the stop-hook stub', () => {
    expect(isPlaceholderPurposeContent(CID_STUB)).toBe(true);
    expect(isPlaceholderPurposeContent(HOOK_STUB)).toBe(true);
  });

  it('recognises an all-TODO file without the header', () => {
    expect(
      isPlaceholderPurposeContent(
        'description: "TODO: fill me in later please"\ncomponents:\n  x:\n    description: "TODO: describe x"\n',
      ),
    ).toBe(true);
  });

  it('treats very short content as a placeholder and real docs as documentation', () => {
    expect(isPlaceholderPurposeContent('components: {}')).toBe(true);
    expect(isPlaceholderPurposeContent(PKG_PURPOSE)).toBe(false);
  });

  it('documentation that quotes the stub header is not a placeholder', () => {
    expect(
      isPlaceholderPurposeContent(
        'components:\n  captain:\n    description: >-\n      Cid no longer writes the "# Auto-generated .purpose stub" header or "Stub created by Cid" lines.\n',
      ),
    ).toBe(false);
  });

  it('a TODO top-level description with a real component is not a placeholder', () => {
    expect(
      isPlaceholderPurposeContent(
        'description: "TODO: write the summary"\ncomponents:\n  x:\n    description: Real behaviour lives here.\n',
      ),
    ).toBe(false);
  });
});

describe('resolvePurposeCoverage', () => {
  it('own non-placeholder .purpose covers', () => {
    write('pkg/src/a/.purpose', PKG_PURPOSE);
    write('pkg/src/a/x.ts', '');
    const c = resolvePurposeCoverage(root, 'pkg/src/a');
    expect(c).toMatchObject({ covered: true, via: 'own', purposeFile: 'pkg/src/a/.purpose' });
  });

  it('ancestor covers via file mentions, tests, path containment and anchors', () => {
    write('pkg/.purpose', PKG_PURPOSE);
    expect(resolvePurposeCoverage(root, 'pkg/src/cli')).toMatchObject({ covered: true, via: 'ancestor', purposeFile: 'pkg/.purpose' });
    expect(resolvePurposeCoverage(root, 'pkg/test').covered).toBe(true);
    expect(resolvePurposeCoverage(root, 'pkg/src/kernel/broker').covered).toBe(true);
    expect(resolvePurposeCoverage(root, 'pkg/src/anchored').covered).toBe(true);
  });

  it('an ancestor that does not name the directory does not cover it', () => {
    write('pkg/.purpose', PKG_PURPOSE);
    const c = resolvePurposeCoverage(root, 'pkg/scripts');
    expect(c.covered).toBe(false);
    expect(c.via).toBeNull();
  });

  it('a placeholder never counts, own or ancestor', () => {
    write('pkg/src/cli/.purpose', CID_STUB);
    let c = resolvePurposeCoverage(root, 'pkg/src/cli');
    expect(c.covered).toBe(false);
    expect(c.placeholders).toEqual(['pkg/src/cli/.purpose']);

    // An ancestor stub that happens to mention the dir still does not count.
    write('pkg/.purpose', HOOK_STUB + '# src/cli/main.ts\n');
    c = resolvePurposeCoverage(root, 'pkg/src/cli');
    expect(c.covered).toBe(false);
    expect(c.placeholders).toContain('pkg/.purpose');
  });

  it('a placeholder own .purpose falls through to a documenting ancestor', () => {
    write('pkg/.purpose', PKG_PURPOSE);
    write('pkg/src/cli/.purpose', CID_STUB);
    const c = resolvePurposeCoverage(root, 'pkg/src/cli');
    expect(c).toMatchObject({ covered: true, via: 'ancestor', purposeFile: 'pkg/.purpose' });
    expect(c.placeholders).toEqual(['pkg/src/cli/.purpose']);
  });

  it('does not match a mention that is only a suffix of a longer name', () => {
    write('pkg/.purpose', 'description: The package mentions mysrc/cli/main.ts only, nothing else.\n');
    expect(resolvePurposeCoverage(root, 'pkg/src/cli').covered).toBe(false);
  });
});

describe('gitignore-aware discovery', () => {
  const hasGit = spawnSync('git', ['--version']).status === 0;

  it('findPurposeFiles({respectGitignore}) skips gitignored release output', async () => {
    if (!hasGit) return;
    spawnSync('git', ['init', '-q'], { cwd: root });
    write('.gitignore', 'pkg/release/\nout-*/\n');
    write('pkg/.purpose', PKG_PURPOSE);
    write('pkg/release/App.app/Contents/Resources/.purpose', PKG_PURPOSE);
    write('out-x/.purpose', PKG_PURPOSE);

    const all = (await findPurposeFiles(root)).map((f) => path.relative(root, f).split(path.sep).join('/'));
    expect(all).toContain('pkg/release/App.app/Contents/Resources/.purpose');

    const kept = (await findPurposeFiles(root, { respectGitignore: true })).map((f) =>
      path.relative(root, f).split(path.sep).join('/'),
    );
    expect(kept).toEqual(['pkg/.purpose']);
  });

  it('outside a git work tree falls back to skipping release/', async () => {
    write('pkg/.purpose', PKG_PURPOSE);
    write('pkg/release/App.app/.purpose', PKG_PURPOSE);
    // mkdtemp under os.tmpdir() is not inside a git work tree.
    expect(filterGitIgnored(root, [path.join(root, 'pkg/.purpose')])).toBeNull();
    const kept = (await findPurposeFiles(root, { respectGitignore: true })).map((f) =>
      path.relative(root, f).split(path.sep).join('/'),
    );
    expect(kept).toEqual(['pkg/.purpose']);
  });
});
