/**
 * The shared checks of the first-party Desk mods (#neurons-mod, #constellation-mod; TD-2026-10-20-812 slice S2):
 * view-less mods that declare one provides.mcp server with a per-user override surface, offer-spec:v1 offers and a
 * playbook skill. test/neurons-mod.test.ts and test/constellation-mod.test.ts call deskModSuite with their specifics.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTEXT_SOURCES, mcpServerName, OFFER_PHASES, OFFERS_PER_MOD_MAX, validateOfferSpecV1, type OfferSpecV1 } from '@a-company/gnomon-contracts';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { FIRST_PARTY_PACKAGE_HASHES } from '../src/kernel/manifest/install.js';
import { ManifestRefusal } from '../src/kernel/manifest/refusal.js';
import { FIRST_PARTY_MOD_NAMES, RESERVED_MOD_NAMES, resolveMcpLaunch, validateManifest, validateMcpUserConfig, type ManifestV2 } from '../src/kernel/manifest/manifest.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

export interface DeskModSpec {
  /** the mod id (S0b: gnomon.<name>) */
  name: string;
  /** the package folder under packages/gnomon-mods */
  dir: string;
  /** the kernel-derived MCP server name (mcpServerName(id)) */
  server: string;
  /** symbol id, for test titles */
  symbol: string;
  /** the real tool names of the mod's MCP server (read from its source; the handoffs must be among them) */
  serverTools: readonly string[];
  /** env names the user may set */
  env: readonly string[];
  /** fixtures: offer replies (golden carries a `shown`) and negatives (golden `shown: null`) */
  offerFixtures: readonly string[];
  negativeFixtures: readonly string[];
  /** the phases its offers cover, one offer each */
  phases: readonly string[];
  /** a realistic per-user override that must validate */
  override: { command: string; args: string[]; env: Record<string, string> };
}

type Golden = { offer: { mod: string; kind: string; question: string } | null; body?: string; shown: Record<string, unknown> | null };

export function deskModSuite(spec: DeskModSpec): void {
  const DIR = path.resolve(PKG_ROOT, '..', 'gnomon-mods', spec.dir);
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'gnomon-manifest.json'), 'utf8')) as ManifestV2;
  const offers = (raw.provides?.offers ?? []) as OfferSpecV1[];
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  describe(`${spec.symbol} manifest`, () => {
    it('validates at the first-party tier only: a first-party mod name, never reserved, with the reserved floor intact', () => {
      const v = validateManifest(raw, { tier: 'first-party' });
      expect(`${v.publisher}.${v.name}`).toBe(spec.name);
      expect(raw.manifest).toBe(2);
      expect(raw.kind).toBe('mod');
      expect(FIRST_PARTY_MOD_NAMES.has(raw.name)).toBe(true);
      expect(RESERVED_MOD_NAMES.has(raw.name)).toBe(false);
      for (const n of ['kernel', 'gnomon', 'system']) expect(RESERVED_MOD_NAMES.has(n)).toBe(true);
      // Aegis L5: a first-party name belongs to the first-party tier, so a local install of the same manifest is refused
      expect(() => validateManifest(raw, { tier: 'local' })).toThrow(ManifestRefusal);
    });

    it('is view-less and effect-less: egress none, no capability, no view, tool, command, hook or keybinding', () => {
      expect(raw.requires).toEqual({ egress: 'none' });
      for (const k of ['views', 'tools', 'commands', 'hooks', 'keybindings', 'events', 'knowledge'] as const) expect(raw.provides?.[k], k).toBeUndefined();
      // no process of its own: the kernel validator needs none, and the MCP server is the only thing that runs
      for (const e of ['index.mjs', 'index.js']) expect(fs.existsSync(path.join(DIR, e))).toBe(false);
    });

    it('declares one MCP server with a generic default launch (no personal path) and a closed per-user override surface', () => {
      const mcp = raw.provides!.mcp!;
      expect(mcp.length).toBe(1);
      const s = mcp[0]!;
      expect('name' in s, 'a manifest:2 server entry carries no name').toBe(false);
      expect(mcpServerName(spec.name)).toBe(spec.server);
      expect(s.config).toEqual({ command: true, args: true, env: [...spec.env] });
      for (const part of [s.command, ...(s.args ?? [])]) {
        expect(part, 'a committed manifest names no absolute path').not.toMatch(/^([/\\~]|[A-Za-z]:)/);
        expect(part).not.toMatch(/Users|home|ascend/i);
      }
      // the user's own launch goes through the override, validated against what config permits
      const launch = resolveMcpLaunch(s, spec.override);
      expect(launch).toEqual(spec.override);
      expect(resolveMcpLaunch(s)).toEqual({ command: s.command, args: s.args ?? [], env: {} });
      // M1: the default is a placeholder that fails closed: it is not absolute, so it is never an acceptable launch command
      expect(s.command).not.toMatch(/^(?:\/|[A-Za-z]:[\\/])/);
      expect(() => validateMcpUserConfig(s, { command: s.command })).toThrow(ManifestRefusal);
      // M2: an override command is an absolute path; a bare `node` (a PATH lookup) is refused
      expect(() => validateMcpUserConfig(s, { command: 'node' })).toThrow(ManifestRefusal);
      expect(() => validateMcpUserConfig(s, { env: { NODE_OPTIONS: '--require x' } })).toThrow(ManifestRefusal);
      expect(() => validateMcpUserConfig(s, { env: { NOT_DECLARED: '1' } })).toThrow(ManifestRefusal);
    });

    it('offers validate as offer-spec:v1: diverge, synthesize and commit each once, contextIn from CONTEXT_SOURCES, real handoff tools', () => {
      expect(offers.length).toBeGreaterThanOrEqual(2);
      expect(offers.length).toBeLessThanOrEqual(Math.min(4, OFFERS_PER_MOD_MAX));
      for (const o of offers) {
        expect(validateOfferSpecV1(o), o.kind).toEqual([]);
        for (const c of o.contextIn) expect(CONTEXT_SOURCES).toContain(c);
        expect(spec.serverTools, `${o.kind} hands off to a tool the server registers`).toContain(o.handoffTool);
        // related names this mod's own offers only
        for (const r of o.related) expect(offers.map((x) => x.kind)).toContain(r);
        expect(o.restraint.length).toBeGreaterThan(20);
      }
      const phases = offers.map((o) => o.phase);
      expect(new Set(phases).size).toBe(phases.length);
      for (const ph of phases) expect(OFFER_PHASES).toContain(ph);
      expect([...phases].sort()).toEqual([...spec.phases].sort());
    });

    it('ships a playbook skill that degrades to plain suggestions outside Gnomon', () => {
      const skills = raw.provides!.skills as Array<{ name: string; path: string }>;
      expect(skills.length).toBe(1);
      const md = fs.readFileSync(path.join(DIR, skills[0]!.path), 'utf8');
      expect(md.startsWith(`---\nname: ${skills[0]!.name}\n`)).toBe(true);
      expect(md).toContain('## Outside Gnomon');
      expect(md).toContain('## When NOT to offer');
      for (const o of offers) expect(md).toContain(`\`${o.kind}\``);
      expect(md).toContain('end that reply with at most one offer block (never more than one per reply across all mods)');
    });

    it('every ```offer example in the playbook resolves to a declared offer of this mod', async () => {
      const { offerGolden } = (await import(pathToFileURL(path.join(PKG_ROOT, 'scripts', 'offer-golden.mjs')).href)) as { offerGolden: (m: unknown, reply: string) => Golden };
      const skills = raw.provides!.skills as Array<{ name: string; path: string }>;
      const md = fs.readFileSync(path.join(DIR, skills[0]!.path), 'utf8');
      const blocks = [...md.matchAll(/^```offer\n[^\n]*\n```$/gm)].map((m) => m[0]);
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(offerGolden(raw, `An example reply.\n\n${b}\n`).shown, b).not.toBeNull();
    });
  });

  describe(`${spec.symbol} offer fixtures`, async () => {
    const { offerGolden } = (await import(pathToFileURL(path.join(PKG_ROOT, 'scripts', 'offer-golden.mjs')).href)) as { offerGolden: (m: unknown, reply: string) => Golden };
    const fixtures = fs.readdirSync(path.join(DIR, 'fixtures')).filter((n) => n.endsWith('.json') && !n.endsWith('.golden.json')).map((n) => n.slice(0, -5)).sort();

    it('lists exactly the expected fixtures, each with a golden', () => {
      expect(fixtures).toEqual([...spec.offerFixtures, ...spec.negativeFixtures].sort());
      for (const f of fixtures) expect(fs.existsSync(path.join(DIR, 'fixtures', `${f}.golden.json`)), f).toBe(true);
      expect([...spec.offerFixtures].sort()).toEqual(offers.map((o) => o.kind).sort());
    });

    for (const f of [...spec.offerFixtures, ...spec.negativeFixtures]) {
      it(`${f}: the reply resolves to its golden`, () => {
        const fx = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', `${f}.json`), 'utf8')) as { reply: string };
        const golden = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', `${f}.golden.json`), 'utf8')) as Golden;
        expect(offerGolden(raw, fx.reply)).toEqual(golden);
        if (spec.offerFixtures.includes(f)) {
          expect(golden.shown?.kind).toBe(f);
          expect(golden.body).not.toContain('```');
        } else expect(golden.shown).toBeNull();
      });
    }
  });

  describe(`${spec.symbol} first-party pin`, () => {
    it('its packageHash is the pinned first-party hash (an edit to the package is a new install card)', () => {
      const h = hashSourceTree(DIR, spec.name, () => undefined).packageHash;
      if (process.env.GNOMON_PRINT_PINS) process.stdout.write(`PIN ${spec.dir} ${h}\n`);
      expect([...FIRST_PARTY_PACKAGE_HASHES], `the ${spec.name} tree now hashes to ${h}: pin it in FIRST_PARTY_PACKAGE_HASHES (src/kernel/manifest/install.ts)`).toContain(h);
    });

    it('stages as tier first-party with its MCP server and offers on the install card', async () => {
      const root = fs.mkdtempSync(path.join(privateTmpRoot(), 'gdk-'));
      cleanups.push(() => removeTree(root));
      const home = path.join(root, 'home');
      fs.mkdirSync(home, { mode: 0o700 });
      const out: string[] = [];
      const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
      expect(await runModCommand(['install', DIR, '--home', home], io, { trust: new DevTestRootAuthority(DEV_TEST_ROOT_ACK) })).toBe(0);
      const text = out.join('');
      expect(text).toContain(`│ Install mod ${spec.name} 1.1.0 (mod) by gnomon from package, tier first-party`);
      expect(text).toContain(`version: first install of ${spec.name} 1.1.0`);
      expect(text).toContain(`mcp server name: ${spec.server}`);
      for (const o of offers) expect(text).toContain(o.kind);
    });
  });
}
