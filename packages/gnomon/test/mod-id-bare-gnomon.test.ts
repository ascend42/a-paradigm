/**
 * Probe (review of boards S1.3 P4b-3): can a mod with the BARE id `gnomon` be installed or loaded through the real
 * install path? By the whole-segment rule alone `modns.gnomon.` prefixes every first-party kind, so a mod that reached
 * the bridge under that id would have owned them all; `ownsModKind` now answers false for anything but a full mod id.
 * Runs on every platform (no socket, no sandbox: the unsandboxed launcher seam, and nothing is spawned). This file tries every door to that id
 * against a temp home: a fresh install (format 2 and format 1), a root-signed legacy (grantRow:v1) pin of an earlier
 * kernel, a root-signed v2 pin written past the writer, and the host's own start and relay admission.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS } from '@a-company/gnomon-contracts';
import { grantsPath, loadMod, MANIFEST_FILE, readGrants, stageInstall } from '../src/kernel/manifest/index.js';
import { ownsModKind } from '../src/kernel/manifest/mod-kind.js';
import { noEvents } from '../src/kernel/manifest/refusal.js';
import { snapshotFolder } from '../src/kernel/manifest/snapshot.js';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { host, probeManifest, PROBE_SOURCE, rig, writeModFolder, type Rig } from './mod-helpers.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const newRig = (): Rig => {
  const r = rig();
  cleanups.push(r.cleanup);
  return r;
};
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { manifestCode?: string; modCode?: string }).manifestCode ?? (e as { modCode?: string }).modCode ?? (e as Error).message);
  }
  return 'NO REFUSAL';
};
const DIM_SOURCE = PROBE_SOURCE.replaceAll('modns.acme.probe.', 'modns.gnomon.dimension.');
const stage = (r: Rig, folder: string): string => codeOf(() => stageInstall({ home: r.home, source: folder, via: 'package', requestedBy: 'p:abcdefgh/s-01hzzzzz', trust: r.auth }));

describe('Probe: the bare mod id `gnomon` (it would own every modns.gnomon.* kind) cannot be installed or loaded', () => {
  it('the ownership rule itself refuses it (the second layer): a bare `gnomon`, or any name that is not a full mod id, owns no kind', () => {
    // (before the fix this was TRUE by the whole-segment rule: `modns.gnomon.` is a prefix of every first-party kind)
    for (const k of [DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end]) expect(ownsModKind('gnomon', k), k).toBe(false);
    for (const id of ['gnomon', 'dimension', '', 'gnomon.', '.dimension', 'GNOMON.dimension']) expect(ownsModKind(id, `modns.${id}.x`), JSON.stringify(id)).toBe(false);
    // the owner still owns its kinds
    for (const k of [DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end]) expect(ownsModKind('gnomon.dimension', k), k).toBe(true);
    // and the resolved ids a legacy `gnomon` could get do not
    for (const id of ['local.gnomon', 'gnomon.gnomon']) expect(ownsModKind(id, DIM_KINDS.op), id).toBe(false);
  });

  it('a fresh install: no manifest shape stages a mod whose id is `gnomon`', () => {
    const r = newRig();
    const base = probeManifest({ provides: { events: ['modns.gnomon.dimension.op'] }, requires: { capabilities: ['log.append:modns.gnomon.*'], egress: 'none' } });
    const tries: Record<string, unknown> = {
      // format 2 with the name alone (no publisher)
      'v2 no publisher': (() => { const { publisher: _p, ...m } = { ...base, name: 'gnomon' }; return m; })(),
      // format 2, an empty publisher
      'v2 empty publisher': { ...base, publisher: '', name: 'gnomon' },
      // format 2, any publisher with the name gnomon (id would be x.gnomon, never bare; refused anyway)
      'v2 acme.gnomon': { ...base, publisher: 'acme', name: 'gnomon' },
      'v2 gnomon.gnomon': { ...base, publisher: 'gnomon', name: 'gnomon' },
      // format 1: the bare name of before S0b
      'v1 gnomon': { manifest: 1, kind: 'mod', name: 'gnomon', version: '1.0.0', abi: 'mod-abi:v1', provides: { events: ['modns.gnomon.dimension.op'] }, requires: { capabilities: ['log.append:modns.gnomon.*'], egress: 'none' } },
    };
    const got: Record<string, string> = {};
    for (const [name, m] of Object.entries(tries)) got[name] = stage(r, writeModFolder(path.join(r.root, 'src', name.replace(/\W+/g, '-')), m, DIM_SOURCE));
    expect(got).toEqual({ 'v2 no publisher': 'SCHEMA', 'v2 empty publisher': 'SCHEMA', 'v2 acme.gnomon': 'NAME', 'v2 gnomon.gnomon': 'NAME', 'v1 gnomon': 'FORMAT' });
    expect(readGrants(r.home, r.auth).installs).toEqual([]);
  });

  it('a root-signed LEGACY pin named `gnomon` (grantRow:v1, as a kernel before S0b wrote) resolves to local.gnomon and never loads; a v2 pin named `gnomon` is rejected by the reader', () => {
    const r = newRig();
    const v1 = { manifest: 1, kind: 'mod', name: 'gnomon', version: '1.0.0', abi: 'mod-abi:v1', provides: { events: ['modns.gnomon.dimension.op'] }, requires: { capabilities: ['log.append:modns.gnomon.*'], egress: 'none' } };
    const snap = snapshotFolder(r.home, writeModFolder(path.join(r.root, 'src', 'legacy'), v1, DIM_SOURCE), 'gnomon', noEvents);
    const mh = `sha256:${'a'.repeat(64)}`;
    const cardId = 'card:01HZZZZZZZZZZZZZZZZZZZZZZC';
    const sign = (row: Record<string, unknown>): string => `${JSON.stringify({ row, ...r.auth.signRow(row as never) })}\n`;
    const at = (ms: number): string => new Date(Date.now() - 60_000 + ms).toISOString();
    fs.mkdirSync(path.dirname(grantsPath(r.home)), { recursive: true });
    fs.writeFileSync(
      grantsPath(r.home),
      // the worst case for the alias rule: the row's manifest is trusted first-party
      sign({ schemaVersion: 'grantRow:v1', kind: 'grant.trust', createdAt: at(0), manifestHash: mh, tier: 'first-party', cardId }) +
        sign({ schemaVersion: 'grantRow:v1', kind: 'grant.install', createdAt: at(1), name: 'gnomon', manifestHash: mh, packageHash: snap.packageHash, cardId, source: 'package' }) +
        // and a v2 row with the bare id, signed by the root past the writer
        sign({ schemaVersion: 'grantRow:v2', kind: 'grant.install', createdAt: at(2), name: 'gnomon', manifestHash: mh, packageHash: snap.packageHash, cardId, source: 'package' }),
    );
    const g = readGrants(r.home, r.auth);
    expect(g.installs.map((i) => [i.name, i.legacyName ?? null])).toEqual([['local.gnomon', 'gnomon']]);
    expect(g.rejected).toEqual([{ line: 3, reason: 'name' }]);
    // no id it can be asked for by loads
    expect(codeOf(() => loadMod({ home: r.home, trust: r.auth, name: 'gnomon' } as never))).toBe('NOT_INSTALLED');
    expect(codeOf(() => loadMod({ home: r.home, trust: r.auth, name: 'gnomon.gnomon' } as never))).toBe('NOT_INSTALLED');
    expect(codeOf(() => loadMod({ home: r.home, trust: r.auth, name: 'local.gnomon' } as never))).toBe('NAME');
    expect(fs.existsSync(path.join(snap.dir, MANIFEST_FILE))).toBe(true);
  });

  it('the mod host: start and relay admission of `gnomon` are refused and nothing is spawned', async () => {
    const r = newRig();
    const { h } = host(r, { launcher: unsandboxedModLauncher });
    cleanups.push(() => h.stopAll());
    await expect(h.start('gnomon')).rejects.toMatchObject({ name: expect.stringMatching(/Refusal/) });
    await expect(h.admit('gnomon')).rejects.toMatchObject({ modCode: 'NOT_INSTALLED', detail: { reason: 'not-found' } });
    expect(r.events.filter((e) => e.kind === 'mod.sandbox' || e.kind === 'mod.health')).toEqual([]);
  });
});
