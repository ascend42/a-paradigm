# Gnomon

Gnomon runs your Claude Code sessions for you on your Mac and asks before
anything that matters happens. It is a small local program, the **kernel**,
that starts Claude Code inside a sandbox and keeps a tamper-evident log of what
each session did. When a session needs your decision (a repo hook, a question,
a plan), it shows a **card**. You decide the card in a local web page, the
**GUI**, and every decision is signed after a Touch ID prompt from a helper that
keeps its keys in the Secure Enclave.

You use it much like `claude`: `cd` into a repo, type `gnomon`, and open the
page it prints. If you prefer an app, use Gnomon.app instead.

The design is in `docs/specs/gnomon.md`. The longer walkthrough, including the
DEV ONLY path, is [docs/guides/gnomon-dogfood.md](../../docs/guides/gnomon-dogfood.md).

## What you need

- macOS 15 or later with SIP on, and Node 24 or later (22.14+ on 22.x and 23.7+ on 23.x also work: they have `--disable-sigusr1`).
- Claude Code from the **native installer** (`~/.local/bin/claude`), logged in
  with your **subscription**. Gnomon refuses API billing (`BILLING_REFUSED`).
- `NODE_OPTIONS` **unset** in your shell. Gnomon refuses to run its kernel
  under it (see Troubleshooting).

## Install

From a clone of `a-paradigm` on the `feat/gnomon` branch:

```sh
npm ci
npm run gnomon:install
```

This builds the Gnomon packages and links `gnomon` into the first writable
directory of `/opt/homebrew/bin` or `/usr/local/bin`. You can run it again
safely. It does not use sudo, and it never reads or writes `~/.gnomon` or any
key. It refuses to replace a `gnomon` that is not a symlink, or a link to a
different clone, and tells you what to remove if you mean to switch.
`--no-build` skips the build (`node packages/gnomon/scripts/install-darwin.mjs --no-build`).

## First run (once)

```sh
node packages/gnomon-helper/scripts/build-darwin.mjs   # the signed Secure Enclave helper
gnomon identity init --name <you>                      # two Touch ID prompts; <you> is lowercase: a-z 0-9 . _ -
gnomon identity status
```

`identity init` asks for two Touch ID prompts. Each one ends with a short
digest that the terminal also prints. Check they match before you touch. If
you want to run the hardware test (`packages/gnomon-helper/README.md`), run it
**before** `identity init`.

## Daily use

```sh
cd ~/code/my-repo
gnomon
```

`gnomon` starts the kernel in this terminal and prints a one-time URL. Open it
in your browser within 60 seconds. The new-session form opens with this repo's
top folder filled in (or the current folder, if you are not in a git repo; it
says so). Check the path, then click **open**. Nothing opens until you click.
The path is only a suggestion from your terminal, so the page shows it in full,
and it does not fill in a path with unusual characters; you type that yourself.

In the terminal: **Enter** prints a fresh URL, and **q** or **Ctrl-C** stops the
kernel and its sessions. The URL is printed only to an interactive terminal.

Other commands (`gnomon help` lists them all):

- `gnomon up` starts the kernel the same way, without a folder suggestion.
- `gnomon session repin-claude` re-pins the Claude Code binary after it updates.
- `gnomon rules list | revoke` shows or removes standing always-allow rules.

**Gnomon.app** runs the same kernel without a terminal. Build it once with
`packages/gnomon-wrapper/README.md`, then double-click it. Use one or the other
at a time: only one kernel runs on your home.

## Updating

```sh
git pull
npm run gnomon:install                                  # rebuilds, keeps the link
node packages/gnomon-wrapper/scripts/build-darwin.mjs   # if you use Gnomon.app
```

Rebuild Gnomon.app after every update. At build time the app pins the node it
runs and a hash of the kernel build, so a new build, a `git pull` or
`brew upgrade node` makes it refuse with "Rebuild the app" until you do.

Claude Code updates itself. After it does, opening a session is refused with
`claude_binary_changed`. Stop Gnomon, run `gnomon session repin-claude`, type
the confirmation, and start again.

## Troubleshooting

| You see | Meaning | Do this |
|---|---|---|
| `REFUSED  GNOMON  unsafe-env` (or `UP`) | `NODE_OPTIONS` is set, or node was started with extra flags | `unset NODE_OPTIONS` (and remove it from your shell profile); run `gnomon` itself, whose first line passes the one flag it needs |
| `REFUSED  GNOMON  unprovisioned` | No identity on `~/.gnomon` yet | `gnomon identity init` |
| `REFUSED  GNOMON  already-running` (exit 3) | A kernel already runs on your home: Gnomon.app, another `gnomon`/`gnomon up`, or `gnomond`. The message names which one | Open a session for this folder in that window (**+ new**, or Cmd-N) and paste the path it prints. Or stop that instance and run `gnomon` again. A terminal command to open a folder in a running kernel (`gnomon open`) is planned, not built |
| `REFUSED  INSTALL  link` | A `gnomon` already exists in the bin directory and is not this clone's link | Remove it as the message says, then run the installer again |
| Gnomon.app says "Rebuild the app" | node or the kernel build changed since the app was built | `node packages/gnomon-wrapper/scripts/build-darwin.mjs` |
| `claude_binary_changed` when opening a session | Claude Code updated itself | `gnomon session repin-claude` |
| `gui  not started` | stdout is not a terminal (a pipe or a file), so no URL was made | Run `gnomon` in a terminal window |

## Where things live

- `~/.gnomon/`: your home. Keys (`keys/`), the hash-chained log, the Claude
  pin. Do not copy the keys anywhere.
- The kernel's log rows are in that home; `gnomon replay` checks the chain.
- Gnomon.app writes `~/Library/Logs/Gnomon/kernel.log`, which names the node
  and kernel it ran.
- Claude Code keeps its own transcripts under `~/.claude/` as usual.

## For developers

`npm run build:gnomon && npm run test:gnomon` from the repo root. Package layout,
symbols and tests are described in `packages/gnomon/.purpose`.
