// @gnomon-platform: darwin
/**
 * S1.4 P5 review (Probe's wrapper, Aegis 1(b) item 10): the bridge e2e on THIS host as a GitHub runner meets it.
 * `darwinSipEnabled` answers false (SIP off), GNOMON_E2E_SIP_STUB=1 passes the test-only seam and
 * GNOMON_E2E_REQUIRED=1 turns a skip into a failure: tests A to E must pass with the session and mod floors' SIP
 * answered by the stub alone. The daemon runs in this process, so the mock reaches the kernel's real default probe.
 */
import { vi } from 'vitest';

vi.mock('../src/platform/darwin/macos.js', async (orig) => ({ ...((await orig()) as Record<string, unknown>), darwinSipEnabled: () => false }));
process.env.GNOMON_E2E_SIP_STUB = '1';
process.env.GNOMON_E2E_REQUIRED = '1';
await import('./dimension-bridge-e2e.test.js');
// the values are read once at import; nothing after this file sees them
delete process.env.GNOMON_E2E_SIP_STUB;
delete process.env.GNOMON_E2E_REQUIRED;
