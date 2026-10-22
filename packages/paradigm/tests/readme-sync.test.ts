import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACKAGE_README, ROOT_README, toNpmReadme } from '../scripts/sync-readme.mjs';

describe('README sync (TD-2026-10-22-220)', () => {
  it('packages/paradigm/README.md is the npm-ready copy of the root README', () => {
    const expected = toNpmReadme(readFileSync(ROOT_README, 'utf8'));
    const actual = readFileSync(PACKAGE_README, 'utf8');
    // On failure run: node packages/paradigm/scripts/sync-readme.mjs
    expect(actual).toBe(expected);
  });

  it('rewrites relative links to absolute GitHub URLs and leaves others alone', () => {
    const src = '[a](docs/x.md) [b](./y.md#z) ![i](/img.png) [c](https://e.com) [d](#anchor) [m](mailto:a@b.c)';
    expect(toNpmReadme(src)).toBe(
      '[a](https://github.com/ascend42/a-paradigm/blob/main/docs/x.md) ' +
        '[b](https://github.com/ascend42/a-paradigm/blob/main/y.md#z) ' +
        '![i](https://github.com/ascend42/a-paradigm/blob/main/img.png) ' +
        '[c](https://e.com) [d](#anchor) [m](mailto:a@b.c)',
    );
  });

  it('the npm copy has no relative links', () => {
    const actual = readFileSync(PACKAGE_README, 'utf8');
    const targets = [...actual.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t).toMatch(/^(https:|#)/);
  });
});
