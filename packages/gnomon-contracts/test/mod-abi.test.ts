/**
 * `mod-abi:v1` and `modAbiId` (spec §12.3, §10 law 3, A24-2) — G-MOD-01's
 * contracts half: the ABI is ≤ 8 RPCs + 3 lifecycle + the same 2 relays, its id
 * is frozen and pinned, and it moves independently of clientApiId.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_API_ID,
  CLIENT_RELAYS,
  computeClientApiId,
  computeKitId,
  computeModAbiId,
  KIT_ID,
  MOD_ABI_DESCRIPTOR,
  MOD_ABI_ID,
  MOD_ABI_LIFECYCLE,
  MOD_ABI_MAX_RPCS,
  MOD_ABI_RPCS,
} from '../src/index.js';

/** Update ONLY on a deliberate mod-ABI change (and record it in the review). M1.11 slice 2: callId binding (was sha256:00ae702b…). */
const PINNED_MOD_ABI_ID = 'sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082';

describe('mod-abi:v1 (§12.3)', () => {
  it('G-MOD-01: ≤ 8 RPCs, lifecycle init/shutdown/cancel, the two client relays', () => {
    expect(MOD_ABI_RPCS.length).toBeLessThanOrEqual(MOD_ABI_MAX_RPCS);
    expect(MOD_ABI_RPCS.map((r) => r.method)).toEqual(['health', 'view.render', 'command.run', 'tool.call', 'event', 'state.get', 'state.set', 'kernel.call']);
    expect(MOD_ABI_LIFECYCLE.map((r) => r.method)).toEqual(['init', 'shutdown', 'cancel']);
    expect(MOD_ABI_DESCRIPTOR.relays).toBe(CLIENT_RELAYS);
    expect(CLIENT_RELAYS.map((r) => r.relay)).toEqual(['mod.view', 'mod.command']);
  });

  it('G-MOD-01: modAbiId is pinned; clientApiId did not move (modAbiId is not its input)', () => {
    expect(MOD_ABI_ID).toBe(PINNED_MOD_ABI_ID);
    const ids = JSON.parse(readFileSync(fileURLToPath(new URL('../schemas/client-api.ids.json', import.meta.url)), 'utf8'));
    expect(CLIENT_API_ID).toBe(ids.clientApiId);
    expect(CLIENT_API_ID).toBe('sha256:04cbb3581136ee3409f404d42648284fd392bdf8302131b39edd07fd414941ff');
  });

  it('A24-2: a mod-RPC change moves only modAbiId; a kit change moves both', () => {
    const changed = { ...MOD_ABI_DESCRIPTOR, rpcs: [...MOD_ABI_RPCS, { method: 'x' }] };
    expect(computeModAbiId(changed)).not.toBe(MOD_ABI_ID);
    expect(computeClientApiId()).toBe(CLIENT_API_ID);
    const kit2 = computeKitId({ schemaVersion: 'kit:v1', blocks: ['Box'] });
    expect(kit2).not.toBe(KIT_ID);
    expect(computeModAbiId(MOD_ABI_DESCRIPTOR, kit2)).not.toBe(MOD_ABI_ID);
    expect(computeClientApiId(undefined, kit2)).not.toBe(CLIENT_API_ID);
  });
});
