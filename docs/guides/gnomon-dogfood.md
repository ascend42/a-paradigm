# Gnomon dogfood launch (DEV ONLY, unsigned, until M1.3)

This is the shortest way to run the Gnomon kernel on your Mac, open the GUI in a
browser and drive a real Claude Code session. It uses a separate dev home with a
**software dev-test root**. It is not the production path. The signed wrapper,
the hardware root and the presence prompt come with M1.3, and this path is
removed when they land (spec §2.4 rule 6, `#dev-launch`).

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
  process, so anything `NODE_OPTIONS` preloads would run inside the kernel. Run
  `unset NODE_OPTIONS` first.

## From a fresh clone

```sh
git clone https://github.com/ascend42/a-paradigm.git
cd a-paradigm
git checkout feat/gnomon
npm ci
npm run build:gnomon

node packages/gnomon/dist/cli/gnomon.js dev init   # provisions ~/.gnomon-dev (once)
node packages/gnomon/dist/cli/gnomon.js dev up     # runs the kernel in this terminal and prints the GUI URL
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
printed only to an interactive terminal: if stdout is a pipe or a file you get
the port and no token.

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
  terminal and type the confirmation.
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
