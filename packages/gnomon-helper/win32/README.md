# gnomon-helper — win32

The Windows platform helper, in **Rust** (`windows-sys`), per founder ruling P8-D71.
W2 of [docs/plans/gnomon-windows.md](../../../docs/plans/gnomon-windows.md).

```
gnomon-helper.exe --version              gnomon-helper <version> gnomon-helper:v2 win32
gnomon-helper.exe serve                  NDJSON ops on stdin/stdout until stdin closes
gnomon-helper.exe once                   one request line in, one reply line out
gnomon-helper.exe exec -- <exe> [args]   run <exe> inside a kill-on-close job object
gnomon-helper.exe sandbox [--desktop] [--low] -- <exe> [args]
                                         run <exe> as a Gnomon session (W5, below)
```

Same envelope as the darwin helper (`gnomon-helper:v2`): request `{"id","op",…}`, reply
`{"id","ok":true,…}` or `{"id","ok":false,"error","message"}`.

| Op | What |
|---|---|
| `info` | version, protocol, ops, the user SID |
| `pipe.secure {name}` | the kernel pipe's DACL → protected current-user only, read back; reports the server pid (spec §16, G-WIN-01, probe P03) |
| `pipe.read {name}` | the pipe's DACL, read only |
| `acl.owner-only {path, kind}` | protected owner-only DACL on a file or directory (OICI on a directory), read back (G-WIN-02) |
| `acl.read {path}` | the DACL and the owner-only verdicts (`ownerOnly`, `ownerOnlyProtected`) |
| `acl.session {entries}` | the session deny list (W5): per path `deny-read`, `deny-write`, `deny-all`, `deny-replace`, `allow-read`, `allow-write`, `clear`, `label-low`, `label-clear`; `match` subpath or literal; each entry reports `ok`, `missing` or an error |
| `fs.rename-durable {from, to}` | `MoveFileExW(REPLACE_EXISTING \| WRITE_THROUGH)` (G-LOG-06) |
| `boot.id` | `win:<BootId>` (the per-boot counter Windows keeps in the registry) |
| `shell.open {url}` | `ShellExecuteW` for a loopback http(s) URL with no launch token (spec §16 hand-off) |

`exec` puts itself in a fresh job (`KILL_ON_JOB_CLOSE | DIE_ON_UNHANDLED_EXCEPTION`) before it spawns, so every
descendant is in the job with no race, and when the launcher exits for any reason the OS kills the tree
(G-RUN-03). It runs only an absolute `.exe`, never a `.cmd`/`.bat` and never a `PATH` lookup.

`exec` is containment for well-behaved trees only (Aegis M4): processes another service starts for the child (WMI,
COM servers, Task Scheduler, explorer's ShellExecute) are not descendants, so it reports `partial`.

## The session sandbox (W5, groundwork; the kernel backend is next)

`sandbox` runs the child with a RESTRICTED token whose restricting SIDs are the user's enabled groups, the user SID
and `GNOMON_SESSION_SID` (`S-1-9-4174-2026-1022`): the restricted access check passes wherever the user's does,
except where a DENY ACE names that SID (placed by `acl.session`). `--low` adds Low integrity: no write up (only
`label-low` roots are writable) and no open/read/inject/dup-handle into Medium processes (the kernel, the wrapper,
explorer); `--desktop` runs it on a private desktop labelled Low (UIPI and the job's UI limits keep its input away
from the user's windows). `acl.session` deny ACEs come with an explicit OWNER RIGHTS ACE, so the owner's implicit
WRITE_DAC cannot be used from inside a session to remove them (verified: `icacls /reset` and `/grant` are denied).
Verified on Windows 11 25H2: Claude Code 2.1.44 and Node 24 run under `--low --desktop`; WMI process creation is
denied; PROCESS_TERMINATE on the user's processes is not (the same-user-signals residual of spec §A.2).

Not here yet: the Windows Hello keys (W4, probe P02), the WFP loopback filter (W5, probe P10w), Authenticode
signing (W7). Until W7 the helper is unsigned: a dev kernel pins it by sha256,
a release kernel refuses it.

Build: `node packages/gnomon-helper/scripts/build-win32.mjs` → `bin/win32/gnomon-helper.exe`.
Tests: `cargo test` (pure checks); the kernel's `test/win32-helper.test.ts` runs the ops against the OS.
