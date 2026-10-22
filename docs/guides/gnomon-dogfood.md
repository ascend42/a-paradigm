# Gnomon dogfood launch (DEV ONLY, unsigned, until M1.3)

This is the shortest way to run the Gnomon kernel on your Mac, open the GUI in a
browser and drive a real Claude Code session. It uses a separate dev home with a
**software dev-test root**. It is not the production path. The signed wrapper,
the hardware root and the presence prompt come with M1.3, and this path is
removed when they land (spec §2.4 rule 6, `#dev-launch`).

**With M1.3 on your Mac, use the real path instead:** `gnomon identity init`, then
`gnomon` in a repo (or `gnomon up`). Approvals work there, with Touch ID. See
[Real identity: `gnomon up`](#real-identity-gnomon-up) at the end. The
prerequisites below apply to both paths. The short user-facing version of the
real path, with install, update and troubleshooting, is
[packages/gnomon/README.md](../../packages/gnomon/README.md).

**Install once:** `npm ci && npm run gnomon:install` from the clone. It builds
and links `gnomon` into `/opt/homebrew/bin` or `/usr/local/bin` (no sudo; it
refuses to replace a `gnomon` that is not its own link). After that, `gnomon`
works in any terminal and passes `--disable-sigusr1` through its shebang.

## Before you start

- macOS 15 or later, with SIP enabled. The session sandbox refuses to start otherwise.
- Node 24 or later.
- Claude Code installed with the **native installer** (`~/.local/bin/claude`).
  Gnomon also looks in `/opt/homebrew/bin/claude` and `/usr/local/bin/claude`,
  but only a self-contained native executable is accepted. Whatever is found
  there must resolve to a Mach-O binary, not a script. That has not been
  verified for the Homebrew install, so prefer the native installer. An
  npm-installed `claude` (a `#!` script) is refused `claude_binary_unsupported`.
- Claude Code logged in with your **subscription**. `claude auth status --json`
  must show `"authMethod": "claude.ai"` and `"apiProvider": "firstParty"`.
- No API-billing path anywhere a session reads (law 7). That means none of these
  in the shell you start from: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`.
  Also no `apiKeyHelper` or API env block in `~/.claude/settings.json` or in the
  project's `.claude/` settings. A hit is refused `BILLING_REFUSED`, never
  silently allowed.
- **No `NODE_OPTIONS`** in the shell that runs `dev up`. The production daemon
  drops it in its clean re-exec. `dev up` runs the kernel in your own Node
  process, so anything `NODE_OPTIONS` preloads would run inside the kernel.
  `dev up` and `up` therefore **refuse to start** (`unsafe-env`) when
  `NODE_OPTIONS` is set, or when `node` was started with any flag (`--inspect`,
  `--require`, `--import` and so on) other than the one it **requires**,
  `--disable-sigusr1`. Without that flag, any process running as you could
  `kill -USR1` the kernel and open a debugger in it. Run `unset NODE_OPTIONS`
  first, and start the CLI as `node --disable-sigusr1 <path>/gnomon.js`, or run
  `<path>/gnomon.js` directly, since its shebang passes the flag. You need
  Node 24 or later (the installer checks this: `node-too-old`).
- **What this check covers.** It catches an ambient unsafe runtime: an exported
  `NODE_OPTIONS` or a stray flag. It does not stop a hostile preload that is
  already running as you, because that code can scrub the env and `execArgv`
  before the check reads them.

## From a fresh clone

```sh
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm
git checkout feat/gnomon
npm ci
npm run build:gnomon

node packages/gnomon/dist/cli/gnomon.js dev init   # provisions ~/.gnomon-dev (once)
node --disable-sigusr1 packages/gnomon/dist/cli/gnomon.js dev up     # runs the kernel in this terminal and prints the GUI URL
```

The rest of this guide writes `gnomon` for `node <clone>/packages/gnomon/dist/cli/gnomon.js`.
To save typing in **the same terminal**, run
`alias gnomon="node $PWD/packages/gnomon/dist/cli/gnomon.js"` from the clone root.
An alias does not carry over to a new terminal or tab. There, use the full path.

`gnomon dev init` prints `DEV ONLY`, then the home, the dev root key id, the
kernel key id, the device id and the principal (`p:<ns>/founder`). Running it
again only verifies the home. Use `--home /absolute/path` for a different dev home.

`gnomon dev up` prints the socket path, then a URL of this form:

```
http://127.0.0.1:<port>/#launch=<single-use token>&k=<kernel public key>
```

Open it in your browser **within 60 seconds**. The token works once. The URL is
printed only to an interactive terminal. If stdout is a pipe or a file, no web
endpoint starts, no token is minted, and you get `gui  not started` instead.

## Driving a session

1. In the GUI, choose **new session**. Set `cwd` to the absolute path of a
   project and leave the model as `claude`. Then click **open**.
2. The first open pins your `claude` binary (trust on first use). The status
   shows `first-use pin <sha256> from <path>`.
3. Type into the composer. The reply streams into the transcript.

## What works

- Opening attended Claude Code sessions from the GUI, and text turns in both
  directions, under the real `session` sandbox profile.
- The fuse tracks usage but does not enforce it (P8-D92). Law 7 is the one rule
  it enforces.
- Read-only tools that Claude Code allows without asking (Read, Grep, Glob)
  can run.
- The reply text is shown in the **GUI**, which is a first-party surface. A plain
  socket client (a script using the TS client with the device key) reads
  `turn.event` rows as `{kind, hsid}` stubs only (the community-client
  projection, §9.3).

## What is refused until M1.3

- **Approve.** Every card decision is refused `UNSUPPORTED`: there is no presence
  prompt and no approvals key yet. A card appears, but you cannot decide it.
- **Tool permissions.** Sessions run with `--permission-mode default
  --permission-prompts none`. A tool that would need your permission (Edit,
  Write, Bash and so on) is **denied, not blocked**. The turn still finishes,
  and its `turn.result` counts the denials (`permission_denials`). So a
  session never hangs on an approval, but it cannot change files or run
  commands.
- **AskUserQuestion / ExitPlanMode** raise `ask-user` / `plan` cards. You cannot
  answer them, and the session does not wait for them.
- **Reconnect.** A page reload, a closed tab or a transport-child restart ends the
  GUI session, and the page shows Reconnect, which is refused until M1.3. Press
  **Enter** in the `gnomon dev up` terminal to get a fresh URL.
- `gnomon daemon stop` (approval-signed, M1.6) and `gnomon open` as a separate
  command (in-process only; §5 names no verb for it).

## Stopping and cleaning up

- Stop: type `q` and press Enter in the `gnomon dev up` terminal, or press Ctrl-C.
  Session children are stopped and awaited before the kernel exits. A stop that
  fails is reported as `REFUSED  DEV  stop-failed`.
- Interrupted `gnomon dev init` (Ctrl-C, a crash): the marker file is written
  last, so the half-made home is refused by both `init` and `up` (the message
  says it was interrupted). Remove it with `rm -rf ~/.gnomon-dev`, then run
  `gnomon dev init` again.
- Start again: `gnomon dev up`. The log, the registry and the claude pin persist
  in the dev home.
- After Claude Code updates itself, opens are refused `claude_binary_changed`.
  Stop `dev up`, then run `gnomon session repin-claude --home ~/.gnomon-dev` in a
  terminal and type the confirmation. The native installer's `~/.local/bin/claude`
  is a symlink into `~/.local/share/claude/versions/`, so every auto-update moves
  the hash; expect this after any update, even mid-session (2.1.302 became 2.1.303
  on 2026-10-18). A running session keeps its private copy; only the next open is
  refused. The repo-context loading (P8-D97: `--plugin-dir`, `--add-dir` and
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`) was measured on 2.1.303. After
  a repin to a newer version, re-run `node packages/gnomon/probes/run.mjs
  p10m-repo-context` before trusting that repo hooks still stay off.
- Remove Gnomon's state: stop `dev up`, then run `rm -rf ~/.gnomon-dev`. That removes
  everything **Gnomon** wrote: the keys, the log, the claude pin and its private
  copy under `bin/`. It does **not** remove what Claude Code itself writes.
  Sessions run your real Claude Code with your real `HOME`, so it keeps its own
  transcripts, session state and history under `~/.claude/` (and
  `~/.claude.json`), as any Claude Code session does. Clean those with Claude
  Code's own tools if you want them gone.

## Security notes

- **The dev log proves nothing against your own user.** The dev root, kernel and
  device keys are plain 0600 files under `~/.gnomon-dev/keys/`. Any process
  running as your user can read them, sign rows, register devices and connect
  as you. The session sandbox read-denies that directory to sessions, but an
  unsandboxed process does not have that limit. So signatures in the dev log
  are not evidence of who did what. That is the M1.3 gap this path accepts.
  These are dev-only keys. Do not copy them anywhere or reuse them.
- **The launch URL is a credential for 60 seconds.** Anything that records your
  terminal can capture it: `script`, tmux or screen scrollback and logging,
  terminal session logs, and scrollback restore when the terminal reopens. So
  can your browser's history and session-restore files. The token is single-use
  and lives 60 s, and a stale replay is refused and logged. Even so, open the
  URL promptly, and don't run `dev up` inside a recorded session you share.
- `~/.gnomon`, anything inside it and anything that contains it are refused
  (`production-home`). That includes its symlink target and, on macOS,
  differently-cased spellings such as `~/.GNOMON`. A symlinked dev home is
  refused (`unsafe-home`). A home holding a registry that `dev init` did not
  write is refused (`production-root`). Any other non-empty home is refused
  (`home-not-empty`).
- `gnomond` and `gnomon daemon start` refuse, loudly, any home holding the
  `DEV-ONLY-gnomon-home.json` marker. The production daemon never constructs a
  dev root, and never runs on dev keys.
- `dev up` runs the kernel from your terminal, so its sessions inherit that
  terminal app's TCC grants (spec §2.4 rule 2, §A.2(v)). That is acceptable for
  dogfooding, but it is not the production posture.

## Real identity: `gnomon up`

This is the production counterpart of `dev up` (spec §2.4 rule 7, `#gnomon-up`).
It runs on your real home, `~/.gnomon`, with the **hardware root and approvals
key in the Secure Enclave**, behind the signed helper. Approvals work: every
card decision you make in the GUI takes a Touch ID prompt from the helper, and
the kernel logs the signed decision. The dev path above is unchanged and stays
available.

The prerequisites in [Before you start](#before-you-start) still apply. Above
all, `unset NODE_OPTIONS`. `gnomon up` also runs the kernel in your own Node
process, and it **refuses** (`REFUSED  UP  unsafe-env`) when `NODE_OPTIONS` is
set, or when `node` was started with any flag other than `--disable-sigusr1`,
which it requires. It checks this before it reads the home or opens the helper.

### Once: build the signed helper and provision the root

From the clone root (details in `packages/gnomon-helper/README.md`):

```sh
npm run build:gnomon
node packages/gnomon-helper/scripts/build-darwin.mjs     # Developer ID signed; login password, Always Allow
node packages/gnomon/dist/cli/gnomon.js identity init --name matt
node packages/gnomon/dist/cli/gnomon.js identity status
```

`identity init` asks for **two** Touch ID prompts: the root signs your
approvals key, then this device. Each prompt ends with a 12-character digest,
and stderr names the same digest. Check that they match before you touch. On
success, `identity status` shows `"state":"hardware"`, the root key id, your
principal (`p:<ns>/matt`) and the device id.

If you ran the hardware test (`GNOMON_HW_TESTS=1`, in the helper README), run
it **before** `identity init`. The helper refuses a new key generation while
another one exists.

### Each time: run it

```sh
cd <a repo>
gnomon        # = gnomon up, with this repo suggested in the GUI's new-session form
```

Bare `gnomon` (spec §2.4 rule 8, `#bare-entry`) runs exactly `gnomon up` with
the same checks, and adds a `folder` line: the repo's top folder, or the
current folder when you are not in a git repo (it says so). The launch URL
carries that path after the token, in the part of the URL your browser never
sends to the server. The GUI opens the new-session form with it filled in and
shows the full path as text. You still click **open**. A path with control,
bidi or other hidden characters is shown escaped and is not filled in. Without
a repo hint, `gnomon up` (or `node --disable-sigusr1 packages/gnomon/dist/cli/gnomon.js up`
without the installer) behaves as before.

There is no `DEV ONLY` banner. It prints:

```
UP  kernel (in this process)
  home        /Users/<you>/.gnomon
  socket      /Users/<you>/.gnomon/gnomon.sock
  root        hardware <rootKeyId> (Secure Enclave, signed helper)
  device      <deviceId> as p:<ns>/matt
  approve     from the GUI: Touch ID per decision (the helper prompt names Gnomon)
  kernel key  ephemeral for this run (other socket clients report serverVerified:false)
```

It then opens the GUI in your default browser (spec §2.4 rule 10) and prints
`opened in your browser`, with the launch URL below it in case no tab
appeared. As with `dev up`, the URL goes only to an interactive terminal, works
once and expires after 60 s. Enter opens a fresh URL, and `q` or Ctrl-C stops
the kernel. `gnomon setup` and the first run of bare `gnomon` open the setup
screens the same way. The URL reaches the browser on the standard input of
`/usr/bin/osascript` (`open location`), never on a command line or in the
environment. `--no-open` (on `gnomon`, `gnomon up` and `gnomon setup`) or
`GNOMON_NO_OPEN=1` prints the URL only; Gnomon.app (`up --wrapper`) never opens
a browser. `gnomon dev up` still only prints.

**Starting without a terminal also opens the GUI** (T-2026-10-20-001). When
`gnomon up` or bare `gnomon` runs with no interactive terminal (under `nohup`,
from a script), and after `gnomon daemon start` (or `--detach`, or `gnomond`
without `--foreground`) starts a fresh kernel, Gnomon opens a new GUI window in
your default browser by itself. The launch URL goes only to osascript's
standard input and is **never printed** there, because that output may be a
pipe, a file or a log. To turn this off, pass `--no-open` (on `gnomon`,
`gnomon up` and `gnomon daemon start`) or set `GNOMON_NO_OPEN=1`.
`gnomond --foreground --no-open` is refused with a usage line, because the
foreground kernel never opens anything. A tab left open from before the restart
cannot rejoin, because each start uses a new kernel key and a new port. That
tab says so, and when it sees the new window attach it offers **Close this
tab**. Do not reload it.

`--home /absolute/path` runs a different provisioned home. `gnomon up` never
reads `GNOMON_HOME`. If you ran `identity init` with `GNOMON_HOME` set, pass that
path with `--home`.

### Drive a session where an approval matters

Open a session as in [Driving a session](#driving-a-session). Then raise a card
and decide it:

- **Most deterministic: a repo hook.** Use a scratch project whose
  `.claude/settings.json` declares a hook, for example
  `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo gnomon-hook-ok"}]}]}}`.
  Opening a session there raises one `gate-class` card per hook (allow / deny).
  Click **allow**. You get **one Touch ID prompt** whose text names Gnomon and the
  card. After you touch, the card shows decided. The next session you open in
  that project runs the approved hook.
- **A question card.** Ask the session to use the AskUserQuestion tool. That
  raises an `ask-user` card, and **answer** takes Touch ID the first time. That
  touch also opens a **cached unlock** for this GUI connection.
- **While a cached unlock is open, cached-class decisions are signed without a
  fresh Touch ID.** That covers ask-user answers, plan approve / reject, and
  permission allow / deny once those cards exist. The helper signs them with
  the approvals key and nothing prompts you. Fresh-class decisions (gate-class
  allow / deny, `always`, install) still prompt every time. The unlock is this
  connection's alone. A reload, a closed tab, an idle timeout, a helper exit or
  stopping `gnomon up` ends it. So do not leave an unlocked GUI tab unattended.
- **A cancelled prompt** is refused (`presence`) and decides nothing. The card
  stays pending, and you can decide it again.

What still does not work on this path: tool-permission cards (sessions still
run with `--permission-prompts none`, so Edit, Write and Bash are denied, not
asked); writing an ask-user answer or a plan decision back into the running
session (it is logged and signed, but the child does not wait for it); Reconnect
after a reload (press Enter for a fresh URL); and `gnomon open` against a
separately running `gnomond`.

### Refusals

| Message | Meaning | Next |
|---|---|---|
| `REFUSED  UP  unsafe-env` | `NODE_OPTIONS` is set, `node` was started with flags (`--inspect*`, `--require`, `--import`, …), or `--disable-sigusr1` is missing | `unset NODE_OPTIONS`; run `node --disable-sigusr1 <path>/gnomon.js up` (or the bin directly) |
| `REFUSED  UP  unprovisioned` | No home, or no `keys/identity.json` | `gnomon identity init` |
| `REFUSED  UP  dev-home` | The home carries the DEV-ONLY marker | `gnomon dev up --home <it>` |
| `REFUSED  UP  daemon-running` | A kernel already runs on this home (`gnomond` or another `up`) | Stop it with Ctrl-C in its terminal, or let it exit on idle. `gnomon open` has no wire verb yet. |
| `REFUSED  GNOMON  already-running` (bare `gnomon`, exit 3) | A kernel already runs on this home; the message names it (Gnomon.app, a terminal `gnomon up`, or `gnomond`) | In that window: **+ new** (Cmd-N) and paste the path it prints; or stop that instance and run `gnomon` again. No second kernel is started. |
| `REFUSED  UP  identity-malformed` | `keys/identity.json` is not a regular file, not JSON, or its key ids do not match its keys | Check with `gnomon identity status`; restore it, or `gnomon identity init --recover` if the root is lost |
| `REFUSED  UP  identity-helper` / `identity-mismatch` | The helper is not the pinned signed one or does not answer, or the Secure Enclave keys do not match identity.json | Rebuild the helper; check with `gnomon identity status` |
| `REFUSED  UP  unsafe-home` | The home is a symlink or not a directory | Name the real directory with `--home` |
| `REFUSED  UP  device-key` | `keys/device.key` is missing, a symlink, not owner-only (0600 in a 0700 `keys/`) or not Ed25519 | Fix the modes (`chmod 600`). If it is lost, `gnomon identity init --rotate` |
| `REFUSED  UP  device-unregistered` / `registry-damaged` | The device key or registry does not verify under this root | `gnomon identity init --rotate` |
| `REFUSED  UP  kernel-key` | The kernel key has no public PEM to pin (an internal fault; nothing was served) | Report it; run `gnomon up` again |

Notes:

- `gnomon up` runs the kernel from your terminal. Its sessions inherit that
  terminal app's TCC grants (spec §2.4 rule 2, §A.2(v)). That is acceptable for
  this first test, but it is not the production posture: launchd or the signed app is.
- The kernel key is still a fresh in-memory key on every start, with no
  root-signed row (the keystore item). The GUI pins it from the launch URL and
  `gnomon up` pins it in-process. Other socket clients, such as
  `gnomon daemon status`, report `serverVerified:false`.
- Stopping works as with `dev up`: `q`, Ctrl-C, or closing the terminal
  (SIGHUP). A second Ctrl-C while stopping is ignored, so the children are
  still stopped and the helper closed. Stopping the kernel closes the helper,
  and that drops every cached unlock.
- With stdout not a terminal (a pipe or a file), no web endpoint starts and no
  launch token is minted. The line `gui  not started` says so.

## Open in the app: Gnomon.app

Gnomon.app (`#gnomon-wrapper`, M1.13) is the default daily surface. You
double-click it and there is no terminal step. It runs the same hardened
`gnomon up` path as the section above, as a child process with a clean
environment. It verifies the kernel natively, then shows the GUI in its own
window. Details are in `packages/gnomon-wrapper/README.md`.

### Once: build, sign, notarize, install

You need the identity from [Real identity](#real-identity-gnomon-up) to exist
first: the signed helper plus `gnomon identity init`. Then, from the clone you
want the app to run:

```sh
npm ci && npm run gnomon:install                           # builds, and links `gnomon` for the terminal path
export PATH="$HOME/.cargo/bin:$PATH"
node packages/gnomon-wrapper/scripts/build-darwin.mjs      # Developer ID signed, hardened runtime
node packages/gnomon-wrapper/scripts/notarize-darwin.mjs   # notarytool (gnomon-notary) + staple; a few minutes
open packages/gnomon-wrapper/target/release/bundle/macos   # drag Gnomon.app to /Applications
```

At build time the app pins, inside the signed binary:
- the node it runs: `which node`, or `GNOMON_WRAPPER_NODE=<abs>`, plus the
  sha256 of that node's real file;
- a hash of this clone's `packages/gnomon/dist` and `package.json`.

Before every launch it re-hashes both. `~/Library/Logs/Gnomon/kernel.log` names
the node and kernel it used.

Rebuild the app (`build-darwin.mjs`) after any of these. Until you do, the
window says "Gnomon.app was built against a different node or kernel … Rebuild
the app":
- `brew upgrade node`;
- `npm run build:gnomon`, a `git pull` that changes dist, or moving the clone;
- a change to the GUI bundle. The app also refuses a GUI bundle other than its
  pin.

### Each time: open it

Double-click Gnomon. The window says "starting the kernel", then "verifying the
kernel", then shows the GUI. There is no extension-risk badge, because this
surface has no extensions. `status.guiSessions[].surface` reads `wrapper`.

- **Close the window** (red button or Cmd-W): the window hides and the kernel
  and every session keep running. Click the Dock icon to bring it back.
- **Quit** (Cmd-Q): the kernel stops. The app sends `quit`, waits up to 10 s,
  then kills it.
- **Open it again while it runs:** macOS focuses the running app.
- **Reload inside the window:** the page loses its GUI token (D54) and shows
  Reconnect. Quit and reopen to get a fresh launch.

### What the app refuses (the window shows it, nothing else renders)

| Window says | Meaning | Next |
|---|---|---|
| Gnomon is not set up on this Mac yet | No `~/.gnomon` identity | In Terminal: `node <clone>/packages/gnomon/dist/cli/gnomon.js identity init`, then open Gnomon again |
| a Gnomon kernel is already running on this home | `gnomond` or a terminal `gnomon up` holds `~/.gnomon` | Stop that kernel (Ctrl-C in its terminal), then open Gnomon again |
| Gnomon refused to open the page: … serverSig … | The listener on the port did not sign with the kernel key the child reported | Quit and reopen; if it repeats, check `kernel.log` |
| Gnomon refused to open the page: … bundle … | The served GUI is not the bundle this app was built for | Rebuild the app from the same clone (`build-darwin.mjs`) |
| Gnomon.app was built against a different node or kernel | node or `packages/gnomon/dist` changed since the build (brew upgrade, build:gnomon, git pull) | Rebuild the app (`build-darwin.mjs`) |
| the kernel stopped / exited | The kernel child ended | Read `~/Library/Logs/Gnomon/kernel.log`; quit and reopen |

Notes:

- The kernel child is `node --disable-sigusr1 gnomon.js up --wrapper` (the flag first and only, no NODE_OPTIONS, as the hardened kernel requires). The launch token travels
  only on the pipe between the app and that child: never on argv, in the
  environment, in a file or in a log. `gnomon up --wrapper` refuses to start
  (`REFUSED  UP  wrapper-channel`) when its stdout or stdin is a terminal or a
  file, so you cannot run that mode by hand.
- Sessions started from the app inherit the app's TCC grants, not your
  terminal's.
