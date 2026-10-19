# @a-company/gnomon-wrapper — Gnomon.app

The Tauri 2 desktop wrapper for the Gnomon GUI, and the default daily surface
(`docs/specs/gnomon.md` §11.1, §11.2 rule 2, §16, §18; M1.13, P8-D56). Slice 1
is macOS (WKWebView). Windows (WebView2) comes in the parity phase.

## What it does

Double-click Gnomon.app and:

1. A window opens on the app's bundled status page ("starting the kernel").
2. The app runs `node --disable-sigusr1 <checkout>/packages/gnomon/dist/cli/gnomon.js up --wrapper`
   as a supervised child. This is the same hardened in-process path as
   `gnomon up` in a terminal: the hardware identity via the signed helper, and
   a refusal of `NODE_OPTIONS` or any node flag. The child gets a clean
   environment: `HOME USER LOGNAME LANG TMPDIR SHELL` plus a fixed `PATH`.
3. The child answers on its stdout pipe (`gnomon-wrapper-channel:v1`). The
   app asks for a launch grant: `{port, launchToken, kernelPublicKey, bundleHash}`.
   The token is only ever on that pipe: never on argv, in the environment, in
   a file or in a log.
4. Before the page may load, the app checks three things natively, in Rust:
   - the `bundleHash` equals the GUI bundle pin compiled into this app;
   - its own WebSocket `hello` to `ws://127.0.0.1:<port>/rpc` returns a
     `serverSig` that verifies (Ed25519) against the kernel key from the
     channel, bound to a fresh client nonce. This proves the listener is this
     kernel;
   - every pinned bundle file, and `/`, re-hashes to the pin.

   Only then does the window navigate to `http://127.0.0.1:<port>/#launch=…&k=…`.
   That is the same single origin the browser uses.
5. If any step fails, the window stays on the status page and shows the error.
   This covers a forged key, a bundle mismatch, an unprovisioned home and a
   kernel that is already running. Nothing else renders.

If the kernel exits for any reason (a refusal, a crash, a kill), the window
says so, with the exit status and the log path. The app does not restart the
kernel in place: quit (Cmd-Q) and reopen Gnomon to start it again.

Closing the window hides it, and the kernel and its sessions keep running.
Click the Dock icon to show it again. Quit (Cmd-Q) stops the kernel: the app
sends `quit`, waits 10 s, then kills it. Opening the app a second time focuses
the running one (LaunchServices).

Security posture:

- **No IPC for page content.** `invoke_system` swaps Tauri's invoke script for
  a stub that holds no invoke key and throws. There are no commands, no invoke
  handler, no plugins and no capabilities (`capabilities: []`, and the
  generated `gen/schemas/capabilities.json` is `{}`). `withGlobalTauri` is
  false and `freezePrototype` is true.
- **Navigation locked** to the bundled status page or `http://127.0.0.1:<port>`;
  new windows are denied.
- **Devtools only in debug builds.** There is no `devtools` cargo feature.
- **Hardened runtime** with an empty entitlements set.
- **Surface.** The kernel page gets a frozen `window.gnomonSurface = 'wrapper'`.
  The GUI then sends `hello.client.surface: 'wrapper'` and drops the
  extension-risk badge. This is display only; the kernel never trusts it.
- **Logs.** `~/Library/Logs/Gnomon/kernel.log` (0600) holds the kernel's stderr
  and the wrapper's own lines. It never contains a token or a key.

Trust root (pinned at build time, re-checked before every spawn):

- **Node.** The build records the node path as found (`GNOMON_WRAPPER_NODE`,
  else `which node`, so `/opt/homebrew/bin/node` stays a symlink) and the
  sha256 of its realpath target.
- **Kernel.** The build records `packages/gnomon` (`GNOMON_WRAPPER_GNOMON_PKG`
  overrides it) and a hash of its `dist/` plus `package.json`
  (`gnomon-wrapper-kernel-tree:v1`). The dist bundles its workspace deps.

Before each launch the app re-hashes both. On a mismatch it refuses with
"Gnomon.app was built against a different node/kernel … Rebuild the app". A
`brew upgrade node`, `npm run build:gnomon` or `git pull` all cause that
mismatch.

The local lane config's runner node is not used until the wrapper can verify
its root signature. The pins hold only up to the spawn: a same-user process
could still swap the files in that window, which is the §15.1 posture.

## Build, sign, notarize (founder, macOS)

On a fresh machine, install Rust and the Tauri CLI once:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal   # rustup + stable (>= 1.92)
export PATH="$HOME/.cargo/bin:$PATH"
cargo install tauri-cli --version '^2' --locked                                             # provides `cargo tauri`
cargo --version && cargo tauri --version
```

Then, each build:

```sh
# from the a-paradigm checkout you want the app to run
npm ci && npm run build:gnomon
export PATH="$HOME/.cargo/bin:$PATH"            # cargo + cargo-tauri

node packages/gnomon-wrapper/scripts/build-darwin.mjs        # release build, Developer ID signed, hardened runtime
node packages/gnomon-wrapper/scripts/notarize-darwin.mjs     # optional: notarytool (profile gnomon-notary) + staple + spctl
open packages/gnomon-wrapper/target/release/bundle/macos     # drag Gnomon.app to /Applications
```

For a dev build: `node packages/gnomon-wrapper/scripts/build-darwin.mjs --unsigned`
gives an ad-hoc signature, which works only on this Mac. The signing identity is
looked up in the login keychain (`packages/gnomon-helper/scripts/signing.mjs`),
never hardcoded. The build checks `codesign --verify --strict --deep`, the
requirement (Apple anchor, Developer ID leaf, team `SW4BMQ8PNL`, identifier
`gnomon.wrapper`) and that the app carries no entitlements.

**The app runs the kernel from the checkout it was built in.** Rebuild it after
moving the checkout. Rebuild it after `npm run build:gnomon` changes the GUI
bundle, because the app refuses a bundle other than its pin.

Before the first launch, provision the identity once in a terminal:
`node packages/gnomon/dist/cli/gnomon.js identity init`. Until you do, the app
shows that exact instruction.

## Tests

```sh
cd packages/gnomon-wrapper && cargo test        # unit + tests/live_kernel.rs + tests/no_page_ipc.rs
```

- `tests/live_kernel.rs` spawns a real dev kernel, the same way the app spawns
  its child, and checks the native preflight against it. A foreign key or
  another pin is refused. It skips when node or `packages/gnomon/dist` is
  missing, as on CI's native job.
- The channel's "no token on any argv or env" falsifier is
  `packages/gnomon/test/wrapper-channel.test.ts` (P07-style `ps` sampler with a
  positive control).
- `test/fixtures/vectors-v1.json` is generated from the TypeScript definitions
  (`node scripts/gen-fixtures.mjs`).

## Seams (not built in slice 1)

- **Windows / WebView2:** `nav::APP_ORIGIN` (`http://tauri.localhost`) and
  `kernel::child_command` (needs a named-pipe channel and a job object).
- **Native capture-excluded panel** (S29-K8, M4.6): a wrapper-owned
  `NSPanel` with `sharingType = .none` for the handle and challenge region. It
  attaches to the same app as a second native window, and nothing in the page
  path rules it out.
- **Notifications and presence Reconnect UI.** The page's own Reconnect still works.
- **Tauri origin probe P08** (live `__TAURI_INTERNALS__` / `webkit.messageHandlers.ipc`
  denial inside the running app) is founder-run. Its structural half is
  `tests/no_page_ipc.rs`.
