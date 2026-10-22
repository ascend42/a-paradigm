/**
 * @symbol #gnomon-helper
 *
 * The kernel pipe's owner-only DACL (spec §16 "Kernel endpoint", S22-H7, G-WIN-01; probe P03). The kernel binds
 * `\\.\pipe\gnomon-<sha>` itself (Node cannot adopt a pipe another process created; libuv binds the first instance
 * exclusively), then the helper opens it READ_CONTROL|WRITE_DAC, replaces the default DACL (owner, SYSTEM,
 * Administrators, Everyone read, Anonymous read) with a protected current-user-only one that also DENIES
 * GNOMON_SESSION_SID (a session token carries the user SID, so owner-only alone would let a session connect), and
 * reads it back. Accepted only when the read-back is owner-only, the session deny is there, AND the pipe's server is
 * this process (a pipe someone else serves
 * under our name is refused; the listen would have failed EADDRINUSE first anyway).
 */
import { pipeNameOf } from '../../kernel/lifecycle/endpoint.js';
import { helperOp, kernelWin32Helper, type Win32HelperPin } from './helper-client.js';

export async function secureKernelPipe(socketPath: string, pin: Win32HelperPin = kernelWin32Helper()): Promise<void> {
  const name = pipeNameOf(socketPath);
  if (!name) throw new Error(`${socketPath} is not a named pipe`);
  const r = await helperOp(pin, 'pipe.secure', { name });
  if (r.ownerOnly !== true) throw new Error(`the read-back DACL is not owner-only (${String(r.sddl ?? '?')})`);
  if (r.sessionDenied !== true) throw new Error(`the read-back DACL does not deny Gnomon sessions (${String(r.sddl ?? '?')})`);
  if (r.serverPid !== process.pid) throw new Error(`the pipe is served by pid ${String(r.serverPid)}, not this kernel (${process.pid})`);
}
