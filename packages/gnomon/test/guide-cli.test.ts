/**
 * #gnomon-guide (spec §5 "gnomon guide" paragraph, §9.7; T-2026-10-19-015).
 * Falsified here: every topic renders with the abiId and clientApiId stamp;
 * no topic lists the topics; an unknown topic (or extra arguments) is refused
 * BAD_REQUEST usage, exit 64, without echoing the argument; the guide modules
 * read nothing at runtime; and the BUILT binary prints a topic from a temp
 * cwd and a temp HOME with no docs anywhere (the text is in the bundle).
 * The descriptor honesty check (G-HON-08) is in test/honesty.test.ts.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLIENT_API_ID } from '@a-company/gnomon-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { GNOMON_HELP } from '../src/cli/bare-cli.js';
import { GUIDE_EXIT_OK, GUIDE_EXIT_USAGE, runGuideCommand } from '../src/cli/guide-cli.js';
import { GUIDE_TOPICS, GUIDE_TOPIC_IDS } from '../src/cli/guide-topics.js';
import { ABI_ID } from '../src/kernel/socket/dispatch.js';
import { PKG_ROOT } from './helpers.js';

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = runGuideCommand(argv, { stdout: { write: (c: string) => (out += c) }, stderr: { write: (c: string) => (err += c) } });
  return { code, out, err };
}

describe('gnomon guide', () => {
  it('ships the four agent-facing topics', () => {
    expect(GUIDE_TOPIC_IDS).toEqual(['spawn', 'claims', 'cards', 'refusals']);
  });

  it.each(GUIDE_TOPICS.map((t) => t.id))('renders %s with the abiId and clientApiId stamp', (id) => {
    const r = run([id]);
    expect(r.code).toBe(GUIDE_EXIT_OK);
    expect(r.err).toBe('');
    expect(r.out.startsWith(`GUIDE  ${id} · `)).toBe(true);
    expect(r.out).toMatch(new RegExp(`^  abiId +${ABI_ID}$`, 'm'));
    expect(r.out).toMatch(new RegExp(`^  clientApiId +${CLIENT_API_ID}$`, 'm'));
    expect(ABI_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.out).toContain(GUIDE_TOPICS.find((t) => t.id === id)!.body);
  });

  it('is listed in gnomon help and dispatched by gnomon.ts', () => {
    expect(GNOMON_HELP).toMatch(/^  guide +\S/m);
    expect(fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', 'gnomon.ts'), 'utf8')).toContain("} else if (argv[0] === 'guide') {");
  });

  it('lists the topics with no argument', () => {
    const r = run([]);
    expect(r.code).toBe(GUIDE_EXIT_OK);
    for (const id of GUIDE_TOPIC_IDS) expect(r.out).toMatch(new RegExp(`^  ${id} +\\S`, 'm'));
  });

  it('refuses an unknown topic with a usage exit, without echoing it', () => {
    const r = run(['secret-topic-zz9']);
    expect(r.code).toBe(GUIDE_EXIT_USAGE);
    expect(r.out).toBe('');
    expect(r.err.split('\n')[0]).toBe('REFUSED  BAD_REQUEST  usage');
    expect(r.err).toContain('unknown topic (16 chars)');
    expect(r.err).not.toContain('secret-topic-zz9');
    expect(run(['spawn', 'extra']).code).toBe(GUIDE_EXIT_USAGE);
    expect(run(['--help']).code).toBe(GUIDE_EXIT_OK);
  });

  it('the guide modules read nothing at runtime (no fs, env, cwd or dynamic import)', () => {
    for (const f of ['guide-cli.ts', 'guide-topics.ts']) {
      const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only
      expect(src, f).not.toMatch(/node:fs|from 'fs'|readFileSync|process\.env|process\.cwd|import\(/);
    }
  });
});

describe('gnomon guide: the built binary (the topics are in the bundle)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('prints a stamped topic from a temp cwd and a temp HOME with no docs', () => {
    const bin = path.join(PKG_ROOT, 'dist', 'cli', 'gnomon.js');
    expect(fs.existsSync(bin), 'run `npm run build` first').toBe(true);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-guide-'));
    dirs.push(cwd);
    const env = { PATH: process.env.PATH ?? '', HOME: cwd, USERPROFILE: cwd };
    const ok = spawnSync(process.execPath, [bin, 'guide', 'claims'], { cwd, env, encoding: 'utf8' });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain(`abiId        ${ABI_ID}`);
    expect(ok.stdout).toContain(GUIDE_TOPICS.find((t) => t.id === 'claims')!.body);
    expect(fs.readdirSync(cwd)).toEqual([]); // nothing read or written beside it
    const bad = spawnSync(process.execPath, [bin, 'guide', 'nope'], { cwd, env, encoding: 'utf8' });
    expect(bad.status).toBe(GUIDE_EXIT_USAGE);
    expect(bad.stderr.split('\n')[0]).toBe('REFUSED  BAD_REQUEST  usage');
  });
});
