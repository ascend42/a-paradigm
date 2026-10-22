/**
 * Tests for #loop-cli: `paradigm loop new|validate|list` over a temp repo (root option, no cwd change).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loopNewCommand, loopValidateCommand, loopListCommand } from './index.js';
import { LOOP_EXAMPLE_NAMES } from '../../../../paradigm-mcp/src/utils/loop-files.js';

let root: string;
let stdout: string;
let stderr: string;
const loops = (f = '') => path.join(root, '.paradigm', 'loops', f);
const lastJson = () => JSON.parse(stdout.slice(stdout.indexOf('{')));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-cli-'));
  fs.mkdirSync(path.join(root, '.paradigm'));
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => { stdout += String(c); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((c: any) => { stderr += String(c); return true; });
  process.exitCode = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('paradigm loop new', () => {
  it('writes the YAML and the compiled JSON, and says nothing runs until trusted', async () => {
    await loopNewCommand('nightly', { root, example: 'green' });
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Created .paradigm/loops/nightly.yaml from the green example');
    expect(stdout).toContain('Nothing runs until you trust this exact definition in Gnomon');
    expect(fs.readFileSync(loops('nightly.yaml'), 'utf8')).toContain('id: nightly');
    expect(JSON.parse(fs.readFileSync(loops('nightly.loop.json'), 'utf8'))).toMatchObject({ id: 'nightly', schema: 'loop:v2' });
  });

  it.each(LOOP_EXAMPLE_NAMES.map((n) => [n]))('--example %s produces a valid loop', async (name) => {
    await loopNewCommand(`ex-${name}`, { root, example: name, json: true });
    expect(process.exitCode).toBe(0);
    expect(lastJson()).toMatchObject({ ok: true, id: `ex-${name}` });
  });

  it('refuses a bad id, an unknown example and an existing loop', async () => {
    await loopNewCommand('Bad_Id', { root });
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('kebab-case');
    process.exitCode = 0;
    await loopNewCommand('x', { root, example: 'nope' });
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    await loopNewCommand('dup', { root });
    expect(process.exitCode).toBe(0);
    await loopNewCommand('dup', { root });
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('already exists');
  });
});

describe('paradigm loop validate', () => {
  it('validates all loops, writing compiled JSON; reports precise issues and exits 1 on a bad loop', async () => {
    await loopNewCommand('good', { root });
    fs.rmSync(loops('good.loop.json'));
    fs.writeFileSync(loops('bad.yaml'), 'schema: loop:v2\nid: bad\nstart: a\nnodes:\n  - { id: a, type: check, run: [bash, -c, "true"] }\n');
    await loopValidateCommand(undefined, { root });
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(loops('good.loop.json'))).toBe(true);
    expect(fs.existsSync(loops('bad.loop.json'))).toBe(false);
    expect(stdout).toContain('nodes[0].run[0]: ARGV0_INTERPRETER');
    expect(stdout).toContain('.paradigm/loops/good.yaml is valid → .paradigm/loops/good.loop.json');
  });

  it('validates one loop by id or by file path; --json gives the results', async () => {
    await loopNewCommand('one', { root, example: 'tidy' });
    stdout = '';
    await loopValidateCommand('one', { root, json: true });
    expect(lastJson()).toMatchObject({ ok: true, results: [{ id: 'one', ok: true }] });
    stdout = '';
    await loopValidateCommand('.paradigm/loops/one.yaml', { root, json: true });
    expect(lastJson().results[0].id).toBe('one');
    stdout = '';
    await loopValidateCommand('missing', { root, json: true });
    expect(lastJson().results[0].errors[0].code).toBe('NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });

  it('an 8.1 feature is refused with "lands in 8.1"', async () => {
    fs.mkdirSync(loops(), { recursive: true });
    fs.writeFileSync(loops('later.yaml'), "schema: loop:v2\nid: later\ntriggers: [{ schedule: { cron: '0 * * * *' } }]\nstart: a\nnodes:\n  - { id: a, type: check, builtin: git.clean }\n");
    await loopValidateCommand('later', { root });
    expect(stdout).toContain('triggers[0].schedule.cron: LANDS_IN_8_1: the cron trigger lands in 8.1');
  });
});

describe('Aegis LP1 review (CLI)', () => {
  it('validate <path> accepts only files in .paradigm/loops/', async () => {
    fs.mkdirSync(path.join(root, 'elsewhere'));
    fs.writeFileSync(path.join(root, 'elsewhere', 'x.yaml'), 'schema: loop:v2\nid: x\nstart: a\nnodes:\n  - { id: a, type: check, builtin: git.clean }\n');
    await loopValidateCommand('elsewhere/x.yaml', { root, json: true });
    expect(lastJson().results[0].errors[0].code).toBe('NOT_IN_LOOPS_DIR');
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(root, 'elsewhere', 'x.loop.json'))).toBe(false);
  });

  it('list warns about orphan compiled JSON and validate --all removes it', async () => {
    await loopNewCommand('gone', { root });
    fs.rmSync(loops('gone.yaml'));
    stdout = '';
    await loopListCommand({ root });
    expect(stdout).toContain('.paradigm/loops/gone.loop.json has no YAML');
    stdout = '';
    await loopValidateCommand(undefined, { root, all: true, json: true });
    expect(lastJson().removedOrphans).toEqual(['.paradigm/loops/gone.loop.json']);
    expect(fs.existsSync(loops('gone.loop.json'))).toBe(false);
  });

  it('a symlinked loops dir is refused with a plain error', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-cli-else-'));
    try {
      fs.symlinkSync(elsewhere, loops().replace(/\/$/, ''));
      await loopListCommand({ root });
      expect(process.exitCode).toBe(1);
      expect(stderr).toContain('symlink');
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('paradigm loop list', () => {
  it('lists loops with their state', async () => {
    await loopListCommand({ root });
    expect(stdout).toContain('No loops');
    await loopNewCommand('watcher', { root, example: 'watch' });
    stdout = '';
    await loopListCommand({ root });
    expect(stdout).toContain('watcher');
    expect(stdout).toContain('valid');
    stdout = '';
    await loopListCommand({ root, json: true });
    expect(lastJson().loops[0]).toMatchObject({ id: 'watcher', ok: true, compiled: 'fresh', triggers: ['file.changed $example-flow'] });
  });
});
