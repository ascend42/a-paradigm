/**
 * Aegis M1 (PR #52): `status` never overstates the win32 session sandbox. Pure (runs everywhere): the win32 row is the
 * BUILT mechanism, so the classes nothing denies yet say 'none', the overall fidelity is 'partial', and no row claims a
 * mechanism that is not built (WFP, capability restrictions).
 */
import { describe, expect, it } from 'vitest';
import { sessionSandboxFidelity } from '../src/kernel/sandbox/index.js';
import { SESSION_DENY_REALISATION } from '../src/platform/session-denies.js';

describe('win32 session fidelity is the built one', () => {
  it('partial overall; loopback, media and the process table say none; no unbuilt mechanism is claimed', () => {
    const f = sessionSandboxFidelity('win32');
    expect(f.fidelity).toBe('partial');
    for (const k of ['loopback:endpoint-port', 'media:microphone', 'media:camera', 'ipc:process-table-service']) expect(f.classes[k], k).toBe('none');
    expect(f.classes['ipc:helper-service']).toBe('full'); // the pipe deny + the kernel shield
    for (const [k, v] of Object.entries(SESSION_DENY_REALISATION.win32)) {
      if (/WFP|CapabilityAccessManager/.test(v.mechanism)) expect(v.mechanism, k).toMatch(/^none/);
    }
  });
});
