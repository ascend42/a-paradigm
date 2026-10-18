/**
 * M1.12 (spec §19.1) — clients + observability + replay + conformance.
 * Slice 1 landed the published, package-only client display rules, the typed
 * client surface and the conformance catalog in @a-company/gnomon-contracts
 * (packages/gnomon-contracts/test/display.test.ts). Everything below is the
 * named slice-2 remainder; nothing here is claimed as passing.
 * Platform-independent.
 */
import { describe, expect, it } from 'vitest';
import { CONFORMANCE_CHECKS, buildDisplayVectors } from '@a-company/gnomon-contracts';

describe('M1.12 slice 1 — the kernel bundles the published client rules', () => {
  it('the bundled contracts expose the conformance catalog and display vectors', () => {
    expect(CONFORMANCE_CHECKS.length).toBeGreaterThan(0);
    expect(buildDisplayVectors().sanitize.length).toBeGreaterThan(0);
  });
});

describe('M1.12 slice 2 (deferred)', () => {
  it.todo('slice 2: TS client src/clients/ts (hello/serverSig, device + read-token PoP auth, 12 verbs + 2 relays typed, subscriptions) built on gnomon-contracts only');
  it.todo('slice 2: conformance runner + driver protocol against a spawned kernel; TS client passes (G-CLI-02)');
  it.todo('slice 2: Python client parity (pure-Python Ed25519; python3 has no cryptography module here) passes the same run checks; byte-identical display vectors (falsifier: two UIs disagree)');
  it.todo('slice 2: G-CLI-03 a forged approval.request (bad kernel sig) never renders as a card');
  it.todo('slice 2: G-CLI-01 constellation + flow on the kernel; G-RUN-04 HeadlessRunner retired');
  it.todo('slice 2: `gnomon replay` deterministic re-projection; divergence ⇒ refused (G-KRN-01)');
  it.todo('slice 2: generated docs/specs/gnomon-client-api.md fixed point (G-HON-04 rule)');
  it.todo('slice 2: status.clients[] labelled declared + clients{n, declaredConformant}; §9.6 metrics (G-OBS-01)');
  it.todo('slice 2: log.read:sensitive grant for community device keys (§9.3 community-client row, G-SEC-02)');
  it.todo('slice 2: honesty CI G-HON-02 (fabrication grep), G-HON-03 (denominators in status), G-HON-05..07');
  it.todo('slice 2: Paradigm logger port for library code (kernel has zero deps, G-SEC-01: an injected ParadigmLogger-shaped port)');
});
