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
  // W5 as BUILT (platform/win32/session-sandbox.ts; Aegis M1, PR #52): Low integrity + a restricted token with the
  // Gnomon and per-session SIDs + a private Low desktop + a kill-on-close job with UI limits. Classes it does not reach
  // say so ('none'), never an intended mechanism.
  win32: {
    'unix-socket:tmux': { mechanism: 'n/a (no tmux on Windows); a Low process is expected not to connect to a Medium-labelled AF_UNIX socket (unprobed)', fidelity: 'partial' },
    'unix-socket:screen': { mechanism: 'n/a (no screen on Windows)', fidelity: 'partial' },
    'ipc:helper-service': { mechanism: 'the kernel pipe DACL denies the Gnomon session SID; the kernel process is shielded (process.shield)', fidelity: 'full' },
    'ipc:process-table-service': { mechanism: 'none: a Low process can still list processes (PROCESS_QUERY_LIMITED_INFORMATION, WMI reads)', fidelity: 'none' },
    'automation:apple-events': { mechanism: 'UIPI: a Low process cannot send input or messages to Medium windows; private desktop; job UI limits. COM out-of-process servers not denied', fidelity: 'partial' },
    'service-manager': { mechanism: 'Low integrity cannot write HKCU Run keys or the Startup folder; schtasks / WMI not denied', fidelity: 'partial' },
    'media:microphone': { mechanism: 'none: no capability restriction on a restricted Low token', fidelity: 'none' },
    'media:camera': { mechanism: 'none: no capability restriction on a restricted Low token', fidelity: 'none' },
    launchers: { mechanism: 'kill-on-close job (no breakaway); ShellExecute of other apps not denied', fidelity: 'partial' },
    'process-info:others': { mechanism: 'Low integrity: no VM read/write, thread or handle access to Medium processes; limited query still allowed', fidelity: 'partial' },
    'loopback:endpoint-port': { mechanism: 'none yet: no WFP filter (probe P10w)', fidelity: 'none' },
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
