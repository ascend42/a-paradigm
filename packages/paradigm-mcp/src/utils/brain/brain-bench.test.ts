/**
 * Bench: generated corpus (avg ~4KB, 30% with wikilinks). Full scan, then
 * touch 10 + add 2 → incremental p95 over 5 runs. CI: 1k files < 2s.
 * BENCH=1: 3k files, figures logged via the Paradigm logger.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../mcp-logger.js';
import { initBrain } from './config.js';
import { scanBrain } from './view.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';

const N = process.env.BENCH === '1' ? 3000 : 1000;
const WORDS = 'alpha beta gamma delta project meeting notes idea review plan garden travel recipe budget reading'.split(' ');

function para(seed: number, len: number): string {
  let s = '';
  let x = seed;
  while (s.length < len) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += WORDS[x % WORDS.length] + ' '; }
  return s;
}

function generate(root: string, n: number): string[] {
  const rels: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `area-${i % 20}/topic-${i % 7}/note-${i}.md`;
    const links = i % 10 < 3 ? `\nSee [[note-${(i * 7) % n}]] and [[note-${(i * 13) % n}#Section 1]].\n` : '\n';
    const text = `---\ntags: [t${i % 11}]\n---\n# Note ${i}\n\n${para(i, 1300)}\n## Section 1\n${para(i + 1, 1300)}${links}## Section 2\n${para(i + 2, 1300)}\n`;
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    rels.push(rel);
  }
  return rels;
}

let sb: BrainSandbox;
afterAll(() => sb?.cleanup());

describe('brain bench', () => {
  it(`incremental rescan of ${N} files (touch 10 + add 2) p95 < 2000ms`, () => {
    sb = makeSandbox('brain-bench-');
    const root = path.join(sb.tmp, 'corpus');
    const rels = generate(root, N);
    const { rootHash } = initBrain(root, sb.opts);
    const full = scanBrain(rootHash, sb.opts);
    expect(full.files).toBe(N);
    expect(full.quarantined).toBe(0);
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      for (let k = 0; k < 10; k++) {
        const abs = path.join(root, rels[(run * 97 + k * 31) % rels.length]);
        fs.appendFileSync(abs, `\nedit ${run}\n`);
        const t = new Date(Date.now() + (run + 1) * 1000);
        fs.utimesSync(abs, t, t);
      }
      for (let k = 0; k < 2; k++) {
        const rel = `new/run-${run}-${k}.md`;
        fs.mkdirSync(path.join(root, 'new'), { recursive: true });
        fs.writeFileSync(path.join(root, rel), `# New ${run} ${k}\n[[note-1]]\n`);
      }
      const t0 = performance.now();
      const r = scanBrain(rootHash, sb.opts);
      times.push(performance.now() - t0);
      expect(r.changed).toBe(10);
      expect(r.added).toBe(2);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
    log.component('#brain-bench').info('Brain bench', {
      files: N, fullScanMs: full.durationMs, incrementalMs: times.map((t) => Math.round(t)), p95Ms: Math.round(p95),
    });
    expect(p95).toBeLessThan(2000);
  }, 120_000);
});
