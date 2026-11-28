/**
 * Agent-entry fence (performance audit 2026-11-24, finding 8). `@a-company/gnomon/agent` (src/agent/index.ts) is the
 * loop-ops client that paradigm-mcp bundles: the Paradigm CLI carries it in two code-split chunks and in the
 * single-file MCP bundle. It serves no GUI, so it must not carry the daemon, WebEndpoint or the embedded GUI bundle
 * (src/kernel/web/gui-bundle.ts, megabytes of base64). It did: it imported `kernelPinOf` from cli/daemon-cli.ts,
 * `homeTrust` from cli/mod-cli.ts and two helpers through the kernel/lifecycle/index.ts barrel, each of which
 * reaches kernel/lifecycle/daemon.ts → kernel/web/endpoint.ts → gui-pin.ts → gui-bundle.ts.
 *
 * This file proves, on the source import graph and on the built dist/:
 *   - the agent entry's import closure holds no file under src/kernel/web/, nor the daemon, nor a CLI verb family
 *     that reaches them (a failure prints the import chain that re-added it);
 *   - the walker is live: the same closure taken from the daemon CLI DOES reach gui-bundle.ts, and the three
 *     pre-fix specifiers each reach it, so re-adding any of them fails here;
 *   - dist/agent.js has no `GUI_BUNDLE_FILES_B64` definition and no long base64 run, while dist/cli/gnomon.js and
 *     dist/cli/gnomond.js (which serve the GUI) each keep exactly one definition.
 * The closure follows what the bundler follows: a whole-statement `import type … from` / `export type … from` is
 * erased at build time and is not an edge (src/kernel/internal-seams.ts names WebEndpoint and DaemonHandle by type
 * only, and the identity modules import it). The agent entry and the two leaves are held to the stricter rule:
 * they name nothing under kernel/web/ at all, type or value.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractSpecifiers, PKG_ROOT, rel, walk } from './helpers.js';

const SRC = path.join(PKG_ROOT, 'src');
const AGENT_ENTRY = 'src/agent/index.ts';
const GUI_BUNDLE = 'src/kernel/web/gui-bundle.ts';
const WEB_DIR = 'src/kernel/web/';
/** Modules the agent entry reached before the fix; each one leads to the GUI bundle. */
const DAEMON_SIDE = ['src/kernel/lifecycle/daemon.ts', 'src/kernel/lifecycle/index.ts', 'src/cli/daemon-cli.ts', 'src/cli/mod-cli.ts'];
/** The leaves that replaced them. */
const LEAVES = ['src/cli/home-trust.ts', 'src/cli/kernel-pin.ts', 'src/kernel/lifecycle/home.ts', 'src/kernel/lifecycle/endpoint.ts'];
/** The definition as tsup emits it (`var GUI_BUNDLE_FILES_B64 = Object.freeze({`); a reference alone is not it. */
const GUI_DEFINITION = /\bGUI_BUNDLE_FILES_B64 = /g;
/** Any embedded file of the GUI bundle is far longer than this; nothing else the agent client carries is base64 at all. */
const LONG_BASE64 = /[A-Za-z0-9+/]{100000,}/;

const files = walk(SRC, (f) => /\.ts$/.test(f) && !f.endsWith('.d.ts'));
const keys = new Set(files.map(rel));

/** Resolve a relative specifier to a graph key (posix, relative to the package root). */
function resolveSpec(fromAbs: string, spec: string): string | undefined {
  const base = rel(path.resolve(path.dirname(fromAbs), spec));
  return [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}/index.ts`].find((c) => keys.has(c));
}

/** Whole-statement type-only imports and re-exports: erased by the compiler, so never bundled. */
const TYPE_ONLY = /\b(?:import|export)\s+type\s+[^'"`;]*?\bfrom\s*['"][^'"]+['"]\s*;?/g;

function importsOf(fileAbs: string, source: string, o: { typeOnly: boolean } = { typeOnly: false }): string[] {
  return extractSpecifiers(o.typeOnly ? source : source.replace(TYPE_ONLY, ''))
    .filter((s) => s.startsWith('./') || s.startsWith('../'))
    .flatMap((s) => {
      const r = resolveSpec(fileAbs, s);
      return r === undefined ? [] : [r];
    });
}

const graph = new Map<string, string[]>(files.map((f) => [rel(f), importsOf(f, readFileSync(f, 'utf8'))]));

/** Every file reachable from `roots`, each mapped to the file that first imported it (breadth first: shortest chains). */
function closureFrom(roots: readonly string[]): Map<string, string | null> {
  const from = new Map<string, string | null>(roots.map((r) => [r, null]));
  const queue = [...roots];
  while (queue.length) {
    const f = queue.shift()!;
    for (const dep of graph.get(f) ?? []) {
      if (from.has(dep)) continue;
      from.set(dep, f);
      queue.push(dep);
    }
  }
  return from;
}

/** `entry -> … -> file`, for the failure message. */
function chainTo(from: Map<string, string | null>, file: string): string {
  const chain: string[] = [];
  for (let c: string | null | undefined = file; c; c = from.get(c)) chain.unshift(c);
  return chain.join(' -> ');
}

const agent = closureFrom([AGENT_ENTRY]);

describe('agent-entry fence: the source import closure', () => {
  it('the agent entry is a tsup entry and the graph found it', () => {
    const tsup = readFileSync(path.join(PKG_ROOT, 'tsup.config.ts'), 'utf8');
    expect(tsup).toMatch(/\bagent:\s*'src\/agent\/index\.ts'/);
    expect(graph.has(AGENT_ENTRY)).toBe(true);
    expect(graph.has(GUI_BUNDLE)).toBe(true);
    // a closure that found nothing would pass every "does not contain" below
    expect(agent.size).toBeGreaterThan(20);
    for (const leaf of [...LEAVES, 'src/kernel/socket/client.ts', 'src/kernel/identity/registry.ts']) expect([...agent.keys()]).toContain(leaf);
  });

  it('reaches no file under kernel/web/, and not gui-bundle.ts', () => {
    const web = [...agent.keys()].filter((f) => f.startsWith(WEB_DIR));
    expect(web.map((f) => chainTo(agent, f))).toEqual([]);
    expect(agent.has(GUI_BUNDLE)).toBe(false);
  });

  it('reaches neither the daemon nor a module that re-exports it', () => {
    expect(DAEMON_SIDE.filter((f) => agent.has(f)).map((f) => chainTo(agent, f))).toEqual([]);
  });

  it('the leaf modules import no CLI verb family and nothing under kernel/web/', () => {
    for (const leaf of ['src/cli/home-trust.ts', 'src/cli/kernel-pin.ts']) {
      const direct = graph.get(leaf) ?? [];
      expect(direct.length, leaf).toBeGreaterThan(0);
      expect(direct.filter((d) => /^src\/cli\/.*-cli\.ts$/.test(d) || d.startsWith(WEB_DIR)), leaf).toEqual([]);
      const c = closureFrom([leaf]);
      expect([...c.keys()].filter((f) => f.startsWith(WEB_DIR)).map((f) => chainTo(c, f)), leaf).toEqual([]);
    }
  });

  it('the agent entry and the leaves name nothing under kernel/web/, not even by type', () => {
    for (const f of [AGENT_ENTRY, 'src/cli/home-trust.ts', 'src/cli/kernel-pin.ts']) {
      const abs = path.join(PKG_ROOT, ...f.split('/'));
      expect(importsOf(abs, readFileSync(abs, 'utf8'), { typeOnly: true }).filter((d) => d.startsWith(WEB_DIR)), f).toEqual([]);
    }
  });

  it('the CLI modules still export the moved helpers (callers unchanged)', async () => {
    const [daemonCli, modCli, pin, trust] = await Promise.all([import('../src/cli/daemon-cli.js'), import('../src/cli/mod-cli.js'), import('../src/cli/kernel-pin.js'), import('../src/cli/home-trust.js')]);
    expect(daemonCli.kernelPinOf).toBe(pin.kernelPinOf);
    expect(modCli.homeTrust).toBe(trust.homeTrust);
  });
});

describe('agent-entry fence: falsifiers (the walker catches a re-added import)', () => {
  it('the daemon CLI and both bins DO reach gui-bundle.ts through this same walker', () => {
    for (const entry of ['src/cli/daemon-cli.ts', 'src/cli/gnomon.ts', 'src/cli/gnomond.ts']) expect(closureFrom([entry]).has(GUI_BUNDLE), entry).toBe(true);
  });

  it.each([
    ["import { kernelPinOf } from '../cli/daemon-cli.js';"],
    ["import { homeTrust } from '../cli/mod-cli.js';"],
    ["import { resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';"],
    ["import { WebEndpoint } from '../kernel/web/endpoint.js';"],
    ["export * from '../kernel/web/gui-pin.js';"],
    ["const { GUI_BUNDLE_FILES_B64 } = await import('../kernel/web/gui-bundle.js');"],
  ])('the agent entry plus `%s` reaches the GUI bundle', (line) => {
    const entryAbs = path.join(PKG_ROOT, ...AGENT_ENTRY.split('/'));
    const added = importsOf(entryAbs, line);
    expect(added.length).toBe(1);
    expect(closureFrom([AGENT_ENTRY, ...added]).has(GUI_BUNDLE)).toBe(true);
  });

  it('a type-only import is not an edge of the bundle graph, and is still seen by the strict check', () => {
    const entryAbs = path.join(PKG_ROOT, ...AGENT_ENTRY.split('/'));
    const line = "import type { WebEndpoint } from '../kernel/web/endpoint.js';";
    expect(importsOf(entryAbs, line)).toEqual([]);
    expect(importsOf(entryAbs, line, { typeOnly: true })).toEqual(['src/kernel/web/endpoint.ts']);
    // a mixed statement is a value import to the bundler
    expect(importsOf(entryAbs, "import { type WebEndpointOptions, WebEndpoint } from '../kernel/web/endpoint.js';")).toEqual(['src/kernel/web/endpoint.ts']);
  });
});

describe('agent-entry fence: dist/ (what ships, and what paradigm-mcp bundles)', () => {
  const dist = path.join(PKG_ROOT, 'dist');
  const agentJs = path.join(dist, 'agent.js');
  const definitions = (file: string): number => (readFileSync(file, 'utf8').match(GUI_DEFINITION) ?? []).length;

  it('dist/agent.js exists (run `npm run build` first — never skip silently)', () => {
    expect(existsSync(agentJs), 'dist/agent.js missing: build before testing (npm run test:gnomon does)').toBe(true);
  });

  it('dist/agent.js holds no GUI_BUNDLE_FILES_B64 definition and no embedded base64 file', () => {
    if (!existsSync(agentJs)) return; // the test above already failed loudly
    const built = readFileSync(agentJs, 'utf8');
    expect((built.match(GUI_DEFINITION) ?? []).length).toBe(0);
    expect(built.includes('GUI_BUNDLE_FILES_B64')).toBe(false);
    expect(LONG_BASE64.test(built)).toBe(false);
    expect(built.includes('WebEndpoint')).toBe(false);
  });

  it('the bins that serve the GUI keep exactly one definition each (the needle is the right one)', () => {
    for (const bin of ['gnomon.js', 'gnomond.js']) {
      const file = path.join(dist, 'cli', bin);
      if (!existsSync(file)) continue; // reported by the fence tests that own the bins
      expect(definitions(file), bin).toBe(1);
      expect(LONG_BASE64.test(readFileSync(file, 'utf8')), bin).toBe(true);
    }
  });
});
