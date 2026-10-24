/**
 * #loop-templates (build plan step 14, LP9): each template validates under the 8.0 validator, compiles to
 * `.paradigm/loops/<id>.loop.json`, passes the kernel's compiled-form re-check, and its compiled hash is stable
 * (the same on every compile, and pinned here, so a template edit is a deliberate one). The act template's wording
 * fits approve-to-land (TD-2026-10-22-369): no template promises to land on its own.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loopContentHash, validateCompiledLoop, type CompiledLoop } from '@a-company/gnomon/loops';
import { compileLoopText, parseLoopYaml, validateLoopFile, writeLoop } from './loop-files.js';
import { checkTemplateDir, checkTemplateFlow, loopTemplate, LOOP_TEMPLATE_NAMES, LOOP_TEMPLATES, TemplateParamError, type LoopTemplateName } from './loop-templates.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-templates-'));
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const PARAMS = { flow: '$checkout-flow', dir: 'packages/app' };

/**
 * The pinned hashes for each template with id `t-<name>` and PARAMS: `source` is compiled.sourceHash (sha256 of
 * canonicalJson of the parsed YAML, what a call pin names) and `file` the sha256 of the compiled `.loop.json` bytes
 * (it also moves when a compile default changes). A change here means the template or the compiler changed: say
 * why in the commit.
 */
const PINNED: Record<LoopTemplateName, { source: string; file: string }> = {
  'flow-health': { source: 'c8169b8d20a99d160391458ba9c9feb29beb98f6a59769717edc15841ce632f6', file: '7ecc1b063734522265588481d9366842368e7c98ac0e4705efca06bf6b7a810b' },
  green: { source: 'c82814d5894ce243fb254a68fa13d13b6ca35807c54163336748ed92575255c9', file: 'b3dbb172bba6fa3743dc8b23696c6daeed844200e7e315fa571926c96147fa00' },
  watch: { source: '005ad30344bbb803c0684f1a4686bf49d7cde60d8c32cccbf0a4c58ef457981e', file: '081b077946eb2d62ec977b9308c36acdb28c9372ead02dce078a11ac02e95120' },
  tidy: { source: '177882e585a7898810519eead42e183ff96cf60d8fa4ae3f809885aa5979b840', file: '55c71d4e511442a6bd694457a1bf3f87f72290c65226bfaea09bf2b6c89a7583' },
};

/** Write a template into the temp repo and return the compiled JSON text and its parsed form. */
function create(name: LoopTemplateName): { id: string; text: string; json: string; compiled: CompiledLoop & { compiled: { sourceHash: string } } } {
  const id = `t-${name}`;
  const text = loopTemplate(id, name, PARAMS);
  const r = writeLoop(root, 'create', { id, yaml: text });
  if ('error' in r) throw new Error(r.error);
  expect(r.errors).toEqual([]);
  expect(r).toMatchObject({ ok: true, compiledFile: `.paradigm/loops/${id}.loop.json` });
  const json = fs.readFileSync(path.join(root, '.paradigm', 'loops', `${id}.loop.json`), 'utf8');
  return { id, text, json, compiled: JSON.parse(json) };
}

const PROMISES_AUTO_LAND = /auto-?land|lands? (alone|automatically|by itself|on its own)|without (asking|a card)/i;

describe.each(LOOP_TEMPLATE_NAMES.map((n) => [n] as const))('the %s template', (name) => {
  it('validates under the 8.0 validator and compiles to .paradigm/loops/<id>.loop.json', () => {
    const { id, compiled } = create(name);
    expect(compiled).toMatchObject({ schema: 'loop:v2', id, scope: 'repo' });
    // the kernel never trusts the JSON: it re-validates and re-compiles it (validateCompiledLoop)
    const again = validateCompiledLoop(compiled, { scope: 'repo', fileId: id });
    expect(again.errors).toEqual([]);
    expect(again.ok).toBe(true);
  });

  it('stays inside the 8.0 subset the runner can run: local models only, no write checks', () => {
    const { compiled } = create(name);
    for (const n of compiled.nodes) {
      if (n.type === 'check') expect(n.effect).toBe('read');
      if (n.type === 'model') expect(n.model).toMatchObject({ use: 'local', escalate: 'never' });
    }
  });

  it('has a stable compiled hash', () => {
    const { id, text, json, compiled } = create(name);
    expect(compiled.compiled.sourceHash).toBe(loopContentHash(parseLoopYaml(text).value));
    // compiling again gives the same bytes, and validate leaves the file as it was
    expect(compileLoopText(root, text, id).json).toBe(json);
    expect(validateLoopFile(root, path.join(root, '.paradigm', 'loops', `${id}.yaml`)).ok).toBe(true);
    expect(fs.readFileSync(path.join(root, '.paradigm', 'loops', `${id}.loop.json`), 'utf8')).toBe(json);
    // the same template rendered again hashes the same, and the hash is pinned
    expect(loopContentHash(parseLoopYaml(loopTemplate(id, name, PARAMS)).value)).toBe(compiled.compiled.sourceHash);
    expect(compiled.compiled.sourceHash).toBe(PINNED[name].source);
    expect(createHash('sha256').update(json).digest('hex')).toBe(PINNED[name].file);
  });

  it('never promises to land on its own (8.0 is approve-to-land)', () => {
    const { text } = create(name);
    expect(text).not.toMatch(PROMISES_AUTO_LAND);
    expect(LOOP_TEMPLATES[name].summary).not.toMatch(PROMISES_AUTO_LAND);
  });
});

describe('what each template does', () => {
  it('flow-health (Example A) observes one flow and changes no file', () => {
    const { compiled } = create('flow-health');
    expect(compiled).toMatchObject({ autonomy: 'observe', flows: ['$checkout-flow'], goal: { node: 'drift' } });
    expect(compiled.land).toBeUndefined();
    expect(compiled.nodes.some((n) => n.type === 'model' && n.role === 'act')).toBe(false);
  });

  it('green (Example B, local) acts, proposes and says nothing lands until the human accepts', () => {
    const { text, compiled } = create('green');
    expect(compiled).toMatchObject({ autonomy: 'act', land: { paths: ['packages/app/src/**'] }, goal: { node: 'tsc', inputs: ['packages/app/tsconfig*.json', 'tsconfig*.json'] } });
    expect(compiled.nodes.find((n) => n.id === 'fix')).toMatchObject({ type: 'model', role: 'act', tools: ['read', 'edit'] });
    expect(text).toMatch(/propose card/);
    expect(text.replace(/\n#\s*/g, ' ')).toMatch(/nothing lands on your branch until you accept it/);
    expect(compiled.land!.message).not.toContain('{{');
    // the check names the tsconfig FILE: a path a check names is protected from act edits, and a protected glob
    // with no wildcard covers everything beneath it, so naming the directory would protect the land paths
    for (const p of compiled.protected) {
      if (/[*?{]/.test(p)) continue;
      expect(`packages/app/src/x.ts`.startsWith(`${p}/`)).toBe(false);
    }
    expect(compiled.protected).toContain('packages/app/tsconfig.json');
  });

  it('green defaults to the repo root', () => {
    const r = compileLoopText(root, loopTemplate('g', 'green'), 'g');
    expect(r.errors).toEqual([]);
    expect(r.compiled).toMatchObject({ land: { paths: ['src/**'] }, goal: { inputs: ['tsconfig*.json'] } });
    expect(r.compiled!.nodes[0]).toMatchObject({ run: ['node_modules/.bin/tsc', '-p', 'tsconfig.json', '--noEmit'] });
  });

  it('tidy (Example D, 8.0 form) reports only: no act node, no land, no write check', () => {
    const { compiled } = create('tidy');
    expect(compiled).toMatchObject({ autonomy: 'observe', triggers: [{ type: 'schedule', daily: '18:30', catchUp: 'once' }] });
    expect(compiled.land).toBeUndefined();
    expect(compiled.nodes.map((n) => n.id)).toEqual(['reindex', 'purpose', 'digest', 'tell']);
  });
});

describe('template parameters', () => {
  it('accepts plain flows and repo-relative directories', () => {
    expect(checkTemplateFlow('$loop-run')).toBe('$loop-run');
    expect(checkTemplateDir('packages/gnomon/')).toBe('packages/gnomon');
    expect(checkTemplateDir('.')).toBe('.');
  });

  it.each([['$Bad'], ['checkout'], ['$x]\nautonomy: act'], ['$a b']])('refuses the flow %j (it is written into YAML)', (flow) => {
    expect(() => loopTemplate('x', 'flow-health', { flow })).toThrow(TemplateParamError);
  });

  it.each([['/abs'], ['../up'], ['a/../b'], ['a b'], ['src/*'], ['x"y'], ['a/node_modules']])('refuses the directory %j', (dir) => {
    expect(() => loopTemplate('x', 'green', { dir })).toThrow(TemplateParamError);
  });
});
