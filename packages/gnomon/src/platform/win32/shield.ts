/**
 * @symbol #gnomon-helper
 *
 * Keep Gnomon sessions out of Gnomon's own processes (W5; spec §16 "Sandbox"). A win32 session runs under a restricted
 * token that still carries the user SID (platform/win32/session-sandbox.ts), so the user-only default DACL of the
 * kernel would admit it: gnomon-helper `process.shield` adds a DENY of every access for GNOMON_SESSION_SID to the
 * process, its threads and its token's default DACL (everything it creates later), and reads the process DACL back.
 * The kernel shields itself before its pipe serves anything; a failure refuses the start.
 */
import { helperOp, kernelWin32Helper, type Win32HelperPin } from './helper-client.js';

export async function shieldProcess(pid: number = process.pid, pin: Win32HelperPin = kernelWin32Helper()): Promise<void> {
  const r = await helperOp(pin, 'process.shield', { pid });
  if (r.sessionDenied !== true) throw new Error(`process ${pid} was not shielded from sessions (${String(r.sddl ?? '?')})`);
}
