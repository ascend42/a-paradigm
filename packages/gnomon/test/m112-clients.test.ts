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

// Slice 2 LANDED (test/m112-conformance.test.ts, test/approval-broker.test.ts): kernel cards use the one
// §4.5 sanitizer; the TS client (G-CLI-02 TS half); the conformance runner + driver protocol; status
// labels declared conformance + clientConformance{n, of} (G-OBS-01 part). Named remainder:
describe('M1.12 slice 3 (deferred)', () => {
  it.todo('slice 3: `gnomon replay <home> [--expect <hash>]` — verifyLog + deterministic fold → projection hash; divergence ⇒ refused (G-KRN-01)');
  it.todo('slice 3: Python client parity (pure-Python Ed25519 RFC 8032; python3 has no cryptography module here) via SubprocessDriver; byte-identical display vectors (falsifier: two UIs disagree)');
  it.todo('slice 3: G-CLI-03 a forged approval.request (bad kernel sig) never renders as a card — needs the §12.8 proposal ratified first');
  it.todo('slice 3: G-CLI-01 constellation + flow on the kernel; G-RUN-04 HeadlessRunner retired');
  it.todo('slice 3: generated docs/specs/gnomon-client-api.md fixed point (G-HON-04 rule)');
  it.todo('slice 3: remaining §9.6 metrics (G-OBS-01) beyond clientConformance{n, of}');
  it.todo('slice 3: log.read:sensitive grant for community device keys (§9.3 community-client row, G-SEC-02)');
  it.todo('slice 3: honesty CI G-HON-02 (fabrication grep), G-HON-03 (denominators in status), G-HON-05..07');
  it.todo('slice 3: conformance runner checks auth.launch-token, auth.reconnect, subscribe.dropped, cards.*, kit.image-canvas (catalogued slice-2)');
  it.todo('slice 3: kernel socket/client.ts (CLI) delegating to src/clients/ts, one client implementation');
  it.todo('slice 3: Appendix A ids for #gnomon-ts-client / #client-conformance (allowlisted for now)');
});
