/**
 * Aegis S0b M1 at the #mod-host call site: loadMod re-checks the derived MCP server name against the user's
 * ~/.claude.json at every start (a server the user added after install refuses the mod COLLISION).
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readStaged, stageInstall } from '../src/kernel/manifest/index.js';
import { installPresenceBinding } from '../src/kernel/manifest/install.js';
import { decideInstallCard, mintTestPresence, unsandboxedModLauncher } from '../src/kernel/testing.js';
import { publisherDisplayOf } from '../src/kernel/manifest/install.js';
import { ECHO_SOURCE, host, installStub, rig, writeModFolder } from './mod-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('Aegis S0b M1: the host passes the user MCP servers to loadMod', () => {
  it('a start refuses COLLISION once ~/.claude.json names gm_acme_srv', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    const m = { manifest: 2, kind: 'mod', publisher: 'acme', name: 'srv', version: '1.0.0', abi: 'mod-abi:v1', provides: { mcp: [{ command: '/usr/local/bin/srv-mcp' }], commands: [{ id: 'acme.srv.seen', title: 'seen' }] }, requires: { capabilities: [], egress: 'none' } };
    const src = writeModFolder(path.join(r.root, 'src', 'srv'), m, ECHO_SOURCE('acme.srv'));
    const st = stageInstall({ home: r.home, source: src, via: 'package', requestedBy: 'p:abcdefgh/cli', trust: r.auth });
    if (st.state !== 'staged') throw new Error('staged');
    const bind = installPresenceBinding(st.cardId, readStaged(r.home, 'acme.srv', st.cardId)!.card.contentHash, 'install');
    decideInstallCard(r.home, 'acme.srv', st.cardId, 'install', { presenceToken: mintTestPresence('mod.install', { bind }), authority: r.auth });
    const uh = path.join(r.root, 'userhome');
    fs.mkdirSync(uh);
    fs.writeFileSync(path.join(uh, '.claude.json'), JSON.stringify({ mcpServers: { gm_acme_srv: { command: 'x' } } }));
    const { h } = host(r, {}, { userHome: uh });
    cleanups.push(() => h.stopAll());
    await expect(h.start('acme.srv')).rejects.toMatchObject({ manifestCode: 'COLLISION' });
  });
});

describe('Aegis S0b L1: status.mods.publishers', () => {
  it('publisherDisplayOf: folder/package unverified, github owner verified, other host shown, gnomon verified', () => {
    const sha = 'c'.repeat(40);
    expect(publisherDisplayOf('acme', 'package')).toEqual({ host: null, verified: false });
    expect(publisherDisplayOf('acme', 'linked:/x')).toEqual({ host: null, verified: false });
    expect(publisherDisplayOf('acme', `git:https://github.com/acme/b#${sha}`)).toEqual({ host: null, verified: true });
    expect(publisherDisplayOf('acme', `git:https://gitlab.com/acme/b#${sha}`)).toEqual({ host: 'gitlab.com', verified: true });
    expect(publisherDisplayOf('gnomon', 'package')).toEqual({ host: null, verified: true });
  });

  it('a running mod is listed with its publisher display', async () => {
    const r = rig();
    cleanups.push(r.cleanup);
    installStub(r, 'acme.bare', []);
    const { h } = host(r, { launcher: unsandboxedModLauncher }, { userHome: path.join(r.root, 'nohome') });
    cleanups.push(() => h.stopAll());
    await h.start('acme.bare');
    expect((h.status() as { publishers: Record<string, unknown> }).publishers).toEqual({ 'acme.bare': { host: null, verified: false } });
  });
});
