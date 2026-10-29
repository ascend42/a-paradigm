# @a-company/gnomon-wrapper — Gnomon.app

The Tauri 2 desktop wrapper for the Gnomon GUI, and the default daily surface
(`docs/specs/gnomon.md` §11.1, §11.2 rule 2, §16, §18; M1.13, P8-D56). Slice 1
is macOS (WKWebView). Windows (WebView2) comes in the parity phase.

## What it does

Double-click Gnomon.app and:

1. A window opens on the app's bundled status page ("starting the kernel").
2. The app runs `node --disable-sigusr1 <kernel>/dist/cli/gnomon.js up --wrapper`
   as a supervised child. A release app uses its bundled node and
   `Contents/Resources/kernel`; a dev build uses the checkout it was built in. This is the same hardened in-process path as
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

Trust root (pinned at build time, re-checked before every spawn). The build
has two modes, chosen when it is compiled (`build.rs`, `GNOMON_BUILD_MODE`):

- **Bundle (a release app).** The release script stages the node and the
  kernel first, then builds with `GNOMON_WRAPPER_BUNDLE_STAGE=<stage>`. The
  binary records the **bundle-relative** paths `Resources/node/bin/node` and
  `Resources/kernel` (`src/layout.rs`, shared with the app) and the hashes of
  what was staged: the sha256 of the signed node and the kernel tree hash. At
  every launch the app finds `Contents` from its own executable
  (`<X>.app/Contents/MacOS/gnomon-wrapper`, realpath), re-hashes both and
  refuses a mismatch, a symlink, a hard link, or a path that leaves the bundle
  with "reinstall Gnomon". Then, right before the spawn, it checks the node's
  code signature with SecStaticCode (`src/codesign.rs`) against the compiled
  requirement: our team and identifier `gnomon.node`. Nothing from the build
  machine is compiled in, so the app runs wherever it is copied. A
  release-profile build without a stage fails unless `GNOMON_WRAPPER_DEV=1`
  is set (`build-darwin.mjs` sets it for dev apps). `gnomon-wrapper
  --build-mode` prints `bundle` or `dev`.
- **Dev (founder dogfooding from a checkout).** As before: the build records
  the node path as found (`GNOMON_WRAPPER_NODE`, else `which node`, so
  `/opt/homebrew/bin/node` stays a symlink) and the sha256 of its realpath
  target, plus `packages/gnomon` (`GNOMON_WRAPPER_GNOMON_PKG` overrides it)
  and a hash of its `dist/` plus `package.json`
  (`gnomon-wrapper-kernel-tree:v1`). On a mismatch it refuses with "Gnomon.app
  was built against a different node/kernel … Rebuild the app". A
  `brew upgrade node`, `npm run build:gnomon` or `git pull` all cause that
  mismatch.

The local lane config's runner node is not used until the wrapper can verify
its root signature. The pins hold only up to the spawn: a same-user process
could still swap the files in that window, which is the §15.1 posture.

## CLI passthrough (8.0 M4)

`Gnomon.app/Contents/MacOS/gnomon-wrapper --cli -- <args>` runs the kernel CLI through the same trust-root checks and
env allow-list as a window launch, then execs the bundled node (no window). Paradigm's `gnomon <verb>` uses it.

## Bundle layout (release, 8.0 M2)

One `Gnomon.app` per arch (TD-2026-10-21-758), built and signed once per
release by `packages/gnomon/scripts/release-darwin.mjs` on the founder's Mac.
It runs on any Mac, whatever Node the user has (or none):

```
Gnomon.app/Contents/
  MacOS/gnomon-wrapper                 this Tauri binary (bundle mode)
  Info.plist, Resources/icon.icns      from cargo tauri build
  Resources/node/bin/node              official Node 24.x (bundled-node.lock.json), re-signed, NodeEntitlements.plist
  Resources/node/LICENSE
  Resources/kernel/gnomon.kernel       the signed SEA kernel (identifier gnomon.kernel, KernelEntitlements.plist)
  Resources/kernel/dist/…              npm run build:release (GUI embedded, helper/voice-io sha256 compiled in)
  Resources/kernel/package.json
  Resources/gnomon-voice/              the voice client: package.json, dist/, voice-models.manifest.json,
    node_modules/sherpa-onnx-node/     the native engine and its darwin-<arch> package (.node/.dylib signed)
    node_modules/sherpa-onnx-darwin-<arch>/
  Resources/gnomon-mods/               the first-party mods (packages/gnomon-mods byte for byte; 8.0 M4), found
                                       bundle-relative by the kernel and pinned by packageHash
  Helpers/GnomonHelper.app             signed by its own build (profile, keychain group)
  Helpers/GnomonVoiceIO.app            signed by its own build (audio-input only)
```

- **Node** is never the builder's `which node`. `bundled-node.lock.json` names
  the official tarball and its sha256 per arch. Only
  `node packages/gnomon/scripts/bump-bundled-node.mjs --version 24.x.y` writes
  it: the script gpg-verifies `SHASUMS256.txt` against the release keys in
  `node-release-keys.json` and records the signer. The release script refuses
  a lock without that provenance. It downloads the tarball from nodejs.org (or
  a cache) and refuses it unless it matches. Node is signed with identifier
  `gnomon.node` and `allow-jit` only (`NodeEntitlements.plist`).
- **Kernel runtime deps.** None are copied. The kernel has zero runtime
  dependencies (G-SEC-01), and tsup already inlines `gnomon-contracts`, so
  `Resources/kernel` is `dist/` plus `package.json`. The voice client is a
  pruned copy: its package, dist, models manifest and the two sherpa packages.
  The kernel copies it into `<home>/bin/voice/client` and pins it, as before.
- **Kernel.** The wrapper spawns the signed SEA `Resources/kernel/gnomon.kernel`
  (#kernel-sea, TD-2026-10-29-746). Its identifier is `gnomon.kernel` and it is
  built by `packages/gnomon/scripts/build-sea.mjs`. `--disable-sigusr1` is baked
  in and NODE_OPTIONS is never read. The app pins the SEA's sha256 and code
  requirement, and checks both before every spawn.
- **Children.** The kernel's `process.execPath` is the SEA itself, so every
  node child (gnomon-web, mods, the voice client, the model fetch, the MCP pool,
  sessions' PATH head) runs the bundled node, which is signed `gnomon.node`
  (`src/kernel/lifecycle/sea.ts` `childNodePath`). No child runs PATH `node` or
  the kernel. Only the kernel's own re-execs (the gnomond activator and the
  upgrade successor) run the SEA, with `--gnomond`.
- **Helpers.** A kernel running from a bundle finds the helper, voice-io and
  voice client inside its own app (`src/kernel/lifecycle/app-bundle.ts`),
  from its own location. A moved app (M4 copies it to `~/Applications`)
  still finds them. The app's own helper also wins over a stale
  `identity.json` path. Trust is still the code-signing requirement plus the
  release sha256 pin, never the path.
- **Signing order (inside-out).** The sherpa libs come first, then node.
  Signing rewrites node's bytes, so the pin is taken after. Then
  `cargo tauri build` pins the stage, the app is assembled, and the outer app
  is signed (empty `Entitlements.plist`, hardened runtime, no `--deep`: the
  nested code is already signed). Then it is verified, optionally notarized
  and stapled, and zipped (`ditto -c -k --keepParent`) with a `.sha256`.

```sh
node packages/gnomon/scripts/release-darwin.mjs                       # signed, this Mac's arch → packages/gnomon/release/
node packages/gnomon/scripts/release-darwin.mjs --notarize            # + notarytool (profile gnomon-notary) + staple
node packages/gnomon/scripts/release-darwin.mjs --unsigned            # ad-hoc (CI, any Mac)
node packages/gnomon/scripts/release-darwin.mjs --dry-run --unsigned  # layout + pins only: no swift/npm/cargo/network/codesign
```

Build each arch on a Mac of that arch: the Swift helpers, cargo and the sherpa
platform package build for the host only.

## Dev build, sign, notarize (founder, macOS)

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
npm ci && npm run gnomon:install                # = build:gnomon + links `gnomon` for terminal use (packages/gnomon/README.md)
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

**The app runs the kernel from the checkout it was built in.** After every
update (`git pull`, then `npm run gnomon:install`), rebuild the app with
`build-darwin.mjs`: the pins above make it refuse until you do. Rebuild it after
moving the checkout. Rebuild it after `npm run build:gnomon` changes the GUI
bundle, because the app refuses a bundle other than its pin.

Before the first launch, provision the identity once in a terminal:
`node packages/gnomon/dist/cli/gnomon.js identity init` (or `gnomon identity init`
once installed). Until you do, the app shows that exact instruction. While the
app runs, a terminal `gnomon` refuses `already-running` and tells you to open
the folder in the app's window (**+ new**).

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
