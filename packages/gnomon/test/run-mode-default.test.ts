/**
 * TD-2026-10-20-086 F3 (#approval-broker run modes, #budget-fuse root config): a root-signed `runModes.default`
 * (auto-edits) applies to every repo with no mode of its own whose folder is not the user's home, an ancestor of it
 * or `/` (the M3 refusal stays); the repo ceiling still applies; an explicit mode wins; status shows it; an invalid
 * or unsigned config answers no default (fail closed).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFuseConfig, parseRunModesSection, writeSignedConfig } from '../src/kernel/budget/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { ASK_GUI, controlRig, HSID_A } from './run-mode-helpers.js';

const HOME = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-home-')));
const PROJ = path.join(HOME, 'proj');
fs.mkdirSync(PROJ, { recursive: true });
const HSID_B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const auto = () => 'auto-edits' as const;

describe('F3: the root-signed config section', () => {
  it('runModes.default is a run mode or absent; anything else is invalid', () => {
    expect(parseRunModesSection(undefined)).toEqual({ default: null });
    expect(parseRunModesSection({ default: 'auto-edits' })).toEqual({ default: 'auto-edits' });
    expect(parseRunModesSection({ default: null })).toEqual({ default: null });
    expect(parseRunModesSection({ default: 'yolo' })).toBeNull();
    expect(parseRunModesSection({ default: 'ask', extra: 1 })).toBeNull();
    expect(parseRunModesSection([])).toBeNull();
  });

  it('read only from the root-signed config; an unsigned, invalid or missing config gives no default', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-cfg-'));
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    expect(loadFuseConfig(home, root).runModes).toEqual({ default: null });
    fs.writeFileSync(path.join(home, 'config.signed.json'), JSON.stringify({ row: { schemaVersion: 'gnomon-root-config:v1', config: { runModes: { default: 'auto-edits' } } }, signer: 'x', sig: 'y' }));
    expect(loadFuseConfig(home, root).runModes).toEqual({ default: null }); // unsigned
    writeSignedConfig(home, root, { runModes: { default: 'auto-edits' } }, 1);
    expect(loadFuseConfig(home, root).runModes).toEqual({ default: 'auto-edits' });
    writeSignedConfig(home, root, { runModes: { default: 'everything' } }, 2);
    expect(loadFuseConfig(home, root).runModes).toEqual({ default: null }); // invalid ⇒ fail closed
  });
});

describe('F3: the default in the run-mode control', () => {
  it('a project folder with no mode takes the default (source config), and status shows it', () => {
    const r = controlRig({ userHome: HOME, configDefault: auto, sessions: [{ hsid: HSID_A, repoKey: repoKeyOf([PROJ]), cwd: PROJ }] });
    expect(r.control.view(HSID_A, repoKeyOf([PROJ]))).toMatchObject({ chosen: 'auto-edits', source: 'config', effective: 'auto-edits' });
    const st = r.control.status() as { configDefault: unknown; sessions: Array<Record<string, unknown>> };
    expect(st.configDefault).toBe('auto-edits');
    expect(st.sessions[0]).toMatchObject({ source: 'config', chosen: 'auto-edits' });
  });

  it('FALSIFIER: the home folder, an ancestor of it and / are refused the default (M3 stays)', () => {
    for (const dir of [HOME, path.dirname(HOME), path.parse(HOME).root]) {
      const r = controlRig({ userHome: HOME, configDefault: auto, sessions: [{ hsid: HSID_B, repoKey: repoKeyOf([dir]), cwd: dir }] });
      expect(r.control.view(HSID_B, repoKeyOf([dir])), dir).toMatchObject({ chosen: 'ask', source: 'default' });
      expect(() => r.control.admitOpen(dir, 'auto-edits'), dir).toThrow(); // and an explicit auto-edits stays refused
    }
  });

  it('a repo named only by its key, with no live session, takes no default (fail safe)', () => {
    const r = controlRig({ userHome: HOME, configDefault: auto });
    expect(r.control.repoView(repoKeyOf([PROJ])).mode).toBe('ask');
  });

  it('the ceiling still applies, and an explicit mode wins over the default', async () => {
    const key = repoKeyOf([PROJ]);
    const c = controlRig({ userHome: HOME, configDefault: auto, level: () => 'L2', sessions: [{ hsid: HSID_A, repoKey: key, cwd: PROJ }] });
    expect(c.control.view(HSID_A, key)).toMatchObject({ chosen: 'auto-edits', ceiling: 'ask', effective: 'ask' });
    const r = controlRig({ userHome: HOME, configDefault: auto, sessions: [{ hsid: HSID_A, repoKey: key, cwd: PROJ }] });
    const out = await r.control.request(ASK_GUI, { repo: key, to: 'manual' });
    expect(out).toMatchObject({ changed: true, from: 'auto-edits', to: 'manual', presence: 'none' }); // a tighten, no presence
    expect(r.control.view(HSID_A, key)).toMatchObject({ chosen: 'manual', source: 'repo' });
  });

  it('no configured default: every repo with no mode is ask, as before', () => {
    const r = controlRig({ userHome: HOME, sessions: [{ hsid: HSID_A, repoKey: repoKeyOf([PROJ]), cwd: PROJ }] });
    expect(r.control.view(HSID_A, repoKeyOf([PROJ]))).toMatchObject({ chosen: 'ask', source: 'default' });
    expect((r.control.status() as { configDefault: unknown }).configDefault).toBeNull();
  });
});
