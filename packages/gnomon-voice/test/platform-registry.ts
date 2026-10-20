/**
 * G-WIN-05 registry for @a-company/gnomon-voice (the packages/gnomon pattern): every test file marked
 * `// @gnomon-platform: <p>[, <p>]` needs a row with a sibling or an `na` reason; vitest.config.ts excludes a
 * marked file on every platform it does not list. Zero imports beyond node builtins (vitest.config.ts loads it).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type Platform = 'darwin' | 'win32' | 'linux';
export interface PlatformRow {
  test: string;
  platforms: Platform[];
  sibling?: string;
  na?: string;
}
export const PLATFORM_MARKER = /^\s*\/\/\s*@gnomon-platform:\s*([a-z0-9, ]+)$/m;

export function parsePlatformMarker(source: string): string[] | null {
  const m = PLATFORM_MARKER.exec(source);
  return m ? m[1]!.split(',').map((s) => s.trim()).filter(Boolean) : null;
}

export function excludedTestFiles(pkgRoot: string, platform: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (name.endsWith('.test.ts')) {
        const marked = parsePlatformMarker(readFileSync(full, 'utf8'));
        if (marked && !marked.includes(platform)) out.push(path.relative(pkgRoot, full).split(path.sep).join('/'));
      }
    }
  };
  visit(path.join(pkgRoot, 'test'));
  return out.sort();
}

export const PLATFORM_REGISTRY: PlatformRow[] = [
  {
    test: 'test/engines-integration.test.ts',
    platforms: ['darwin'],
    sibling: 'test/pipeline.test.ts',
    na: 'the real sherpa-onnx engines are native and need the ~600 MB of fetched models; the pipeline logic runs on every platform in the sibling with stub engines (this file also skips itself when the models are absent)',
  },
];
