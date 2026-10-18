/**
 * @symbol #manifest-loader
 *
 * Platform registry for the `session` profile's non-path deny classes (spec
 * §15.5, §16 "Session denies"; Aegis F9). #manifest-loader emits the
 * platform-neutral classes (SESSION_DENY_CLASSES in kernel/manifest/policy.ts);
 * this table names the mechanism that realises each class on each platform.
 * DATA ONLY: M1.7 generates the profiles from it (and re-runs p10m against the
 * macOS one). `partial` marks a class the platform can deny only partly and
 * reports honestly; `none` marks a class with no mechanism yet (reported, and
 * the §15.5 gate-class card rule applies).
 */
import type { SessionDenyClass } from '../kernel/manifest/policy.js';

export type DenyMechanism = { mechanism: string; fidelity: 'full' | 'partial' | 'none' };
export type DenyPlatform = 'darwin' | 'win32' | 'linux';

export const SESSION_DENY_REALISATION: Readonly<Record<DenyPlatform, Readonly<Record<SessionDenyClass, DenyMechanism>>>> = Object.freeze({
  darwin: {
    'unix-socket:tmux': { mechanism: 'network-outbound (remote unix-socket (subpath "/private/tmp/tmux-<uid>"))', fidelity: 'full' },
    'unix-socket:screen': { mechanism: 'network-outbound (remote unix-socket (subpath <screen socket dir>)) — by analogy until the M1.7 p10m re-run', fidelity: 'partial' },
    'ipc:helper-service': { mechanism: 'deny mach-lookup (global-name <helper XPC service>)', fidelity: 'full' },
    'ipc:process-table-service': { mechanism: 'deny mach-lookup (global-name "com.apple.sysmond")', fidelity: 'full' },
    // partial while spec OPEN 5 is open: no test proves a non-Apple sender is stopped (the copied-osascript check sends no event)
    'automation:apple-events': { mechanism: 'deny appleevent-send + mach-lookup com.apple.coreservices.appleevents', fidelity: 'partial' },
    'service-manager': { mechanism: 'deny process-exec /bin/launchctl + mach-lookup of launchd job submission', fidelity: 'partial' },
    'media:microphone': { mechanism: 'TCC: no microphone entitlement for the sandboxed child (device-microphone deny)', fidelity: 'full' },
    'media:camera': { mechanism: 'TCC: device-camera deny', fidelity: 'full' },
    launchers: { mechanism: 'deny process-exec /usr/bin/open, /usr/bin/osascript, lsregister (realpath)', fidelity: 'partial' },
    'process-info:others': { mechanism: 'deny process-info* except self + sysctl kern.proc deny', fidelity: 'full' },
    'loopback:endpoint-port': { mechanism: 'network-outbound (remote ip "localhost:<port>") deny', fidelity: 'full' },
  },
  win32: {
    'unix-socket:tmux': { mechanism: 'n/a (no tmux on Windows); AF_UNIX sockets under the user profile denied by ACE', fidelity: 'partial' },
    'unix-socket:screen': { mechanism: 'n/a (no screen on Windows)', fidelity: 'partial' },
    'ipc:helper-service': { mechanism: 'helper pipe DACL excludes the restricting SID', fidelity: 'partial' },
    'ipc:process-table-service': { mechanism: 'restricted token: no WMI / NtQuerySystemInformation process listing where the OS allows', fidelity: 'partial' },
    'automation:apple-events': { mechanism: 'n/a (COM automation of other apps denied via job limits + helper)', fidelity: 'partial' },
    'service-manager': { mechanism: 'schtasks / WMI / Start-Process -Verb RunAs denied via job limits + helper', fidelity: 'partial' },
    'media:microphone': { mechanism: 'CapabilityAccessManager: no microphone capability for the restricted token', fidelity: 'partial' },
    'media:camera': { mechanism: 'CapabilityAccessManager: no webcam capability for the restricted token', fidelity: 'partial' },
    launchers: { mechanism: 'job object: no breakaway; explorer/rundll32/ShellExecute denied via helper', fidelity: 'partial' },
    'process-info:others': { mechanism: 'restricted token process-info denial where the OS allows', fidelity: 'partial' },
    'loopback:endpoint-port': { mechanism: 'WFP filter keyed by the S29-08 mechanism (restricting SID, install-time service, or AppContainer)', fidelity: 'partial' },
  },
  linux: {
    'unix-socket:tmux': { mechanism: 'none yet (Linux sessions are CI-only in 8.0)', fidelity: 'none' },
    'unix-socket:screen': { mechanism: 'none yet', fidelity: 'none' },
    'ipc:helper-service': { mechanism: 'none yet', fidelity: 'none' },
    'ipc:process-table-service': { mechanism: 'none yet (/proc hidepid is a mount option)', fidelity: 'none' },
    'automation:apple-events': { mechanism: 'n/a', fidelity: 'none' },
    'service-manager': { mechanism: 'none yet (systemd --user)', fidelity: 'none' },
    'media:microphone': { mechanism: 'none yet', fidelity: 'none' },
    'media:camera': { mechanism: 'none yet', fidelity: 'none' },
    launchers: { mechanism: 'none yet (xdg-open)', fidelity: 'none' },
    'process-info:others': { mechanism: 'none yet', fidelity: 'none' },
    'loopback:endpoint-port': { mechanism: 'none yet', fidelity: 'none' },
  },
});
