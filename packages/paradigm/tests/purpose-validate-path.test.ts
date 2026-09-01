/**
 * purpose-validate-path.test — `paradigm purpose validate` path handling
 * (validate.ts), across the four path shapes the fix distinguishes:
 *   - a real .purpose FILE      → validates it directly ("Found 1"), no exit(1)
 *   - a DIRECTORY               → globs '**' /.purpose (unchanged), no exit(1)
 *   - a MISSING path            → exit(1), "path not found"
 *   - a non-.purpose FILE       → exit(1), "not a .purpose file"
 *
 * Runs the command in-process (importing purposeValidateCommand from source)
 * rather than spawning the built bundle: the paradigm suite also contains a test
 * that rebuilds dist (`npm run build`, tsup --clean), so spawning dist/index.js
 * races with that clean. In-process is hermetic. Absolute fixture paths are
 * passed so process.cwd() never matters (the command only uses cwd for cosmetic
 * path.relative display). process.exit is mocked to throw so exit(1) is
 * observable without killing the worker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { purposeValidateCommand } from '../src/commands/purpose/validate.js';

let root: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let cerrSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
const chunks: string[] = [];

const VALID_PURPOSE =
  'version: 2.0.0\ncomponents:\n  widget:\n    description: A well-formed component\n    tags: []\n';

/**
 * Invoke the command; capture ALL output and any exit code. The command's
 * messages go through console.log/console.error (which vitest intercepts, so we
 * spy the console methods directly), while the ora spinner's "Found N" line
 * goes through process.stderr.write.
 */
async function runValidate(absArg: string): Promise<{ out: string; exitCode: number | null }> {
  chunks.length = 0;
  exitSpy.mockClear();
  let exitCode: number | null = null;
  try {
    await purposeValidateCommand(absArg);
  } catch (e) {
    // process.exit mock throws to unwind; swallow.
    void e;
  }
  const call = exitSpy.mock.calls.at(-1);
  if (call) exitCode = call[0] as number;
  return { out: chunks.join('\n'), exitCode };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-validate-'));
  fs.writeFileSync(path.join(root, '.purpose'), VALID_PURPOSE);         // real .purpose FILE
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sub', '.purpose'), VALID_PURPOSE);  // dir containing a .purpose
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}\n');  // non-.purpose FILE
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  const push = ((...a: unknown[]) => { chunks.push(a.map(String).join(' ')); return true; }) as never;
  logSpy = vi.spyOn(console, 'log').mockImplementation(push);
  cerrSpy = vi.spyOn(console, 'error').mockImplementation(push);
  errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__exit__:${code ?? 0}`);
  }) as never);
});

afterEach(() => {
  logSpy.mockRestore();
  cerrSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
});

describe('paradigm purpose validate — path handling', () => {
  it('a real .purpose FILE validates directly (Found 1, no exit)', async () => {
    const r = await runValidate(path.join(root, '.purpose'));
    expect(r.out).toContain('Found 1 purpose file');
    expect(r.exitCode).toBeNull(); // success path never calls process.exit
  });

  it('a DIRECTORY globs its .purpose files (unchanged behavior, no exit)', async () => {
    const r = await runValidate(path.join(root, 'sub'));
    expect(r.out).toMatch(/Found 1 purpose file/);
    expect(r.exitCode).toBeNull();
  });

  it('a MISSING path → exit 1 with "path not found"', async () => {
    const r = await runValidate(path.join(root, 'does', 'not', 'exist'));
    expect(r.out).toContain('path not found');
    expect(r.exitCode).toBe(1);
  });

  it('a non-.purpose FILE (package.json) → exit 1 with "not a .purpose file"', async () => {
    const r = await runValidate(path.join(root, 'package.json'));
    expect(r.out).toContain('not a .purpose file');
    expect(r.exitCode).toBe(1);
  });
});
