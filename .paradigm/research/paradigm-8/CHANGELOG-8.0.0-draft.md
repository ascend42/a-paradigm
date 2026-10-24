<!--
Draft notes (not part of the entry):
- Fold decision: 7.15.2 is folded into 8.0.0; 7.15.1 stays as history.
  7.15.1 is on origin/main (bb93992b), so plugin users already got it: under "every push is a release" it is a real release.
  7.15.2 exists only on feat/gnomon. It was never pushed to main or published to npm, so no user ever ran it.
  Keeping its header would list a version nobody can install, so its content moves into 8.0.0 (marked "from 7.15.2") and the [7.15.2] section is deleted.
- npm users on 7.15.0 also get the Sentinel/Platform UI fixes from main (f14dc717). No changelog entry covers them yet: 7.15.1 says "npm packages unchanged".
- The typecheck commit on this branch is e7532cff. 098f6d35 has the same content but is not on any branch.
- Fill in the date and package versions at tag time.
-->

## [8.0.0] — 2026-10-XX

**Gnomon, the Paradigm 8.0 kernel, ships as a signed Mac app installed through npm.** `npm i -g @a-company/paradigm`, then `gnomon`, opens first-run setup. After two Touch ID (or password) prompts you reach the desk. You don't build or sign anything, and your own Node version doesn't matter. Gnomon is one daemon per user. It owns your sessions, your identity, a hash-chained log, the approvals and a localhost GUI, and it drives Claude Code as a sandboxed headless backend on your own subscription (decision TD-2026-10-21-758). 8.0 runs on Apple silicon Macs only (TD-2026-10-22-310). The Paradigm CLI and MCP server also get the read-only command guarantee and hook fixes that were prepared as 7.15.2, plus a typecheck to zero that turned up live bugs.

### Added
- **Zero-build install** (`#gnomon-wrapper`, `#gnomon-kernel`). `@a-company/paradigm` adds a `gnomon` command. It installs `Gnomon.app` from the `@a-company/gnomon-darwin-arm64` platform package into `/Applications`, or `~/Applications` when `/Applications` isn't writable. The app is Developer ID signed and notarized, and it bundles a pinned Node, the kernel with the GUI embedded, `GnomonHelper.app` and `GnomonVoiceIO.app`. `gnomon` alone opens the app. `gnomon <args>` runs the kernel CLI through the app's wrapper, never through system Node. Upgrades swap the app only after the new one verifies, and your identity is kept.
- **The kernel** (`#gnomon-kernel`, `#kernel-log`, `#supervisor`). One daemon per user (`gnomon up`, `gnomon daemon status|stop`). Every session, approval and grant is recorded in one hash-chained kernel log. `gnomon log`, `gnomon replay` and `gnomon trace` give you a read-only audit timeline, with optional raw capture per project. A budget meter tracks usage across sessions; it measures and does not enforce (P8-D92). When the kernel updates itself, it offers an upgrade card and resumes your sessions afterwards.
- **Identity in the Secure Enclave** (`#identity`, `#gnomon-helper`). `gnomon identity init` creates a root key and an approvals key on this Mac's Secure Enclave. Every signature asks for Touch ID, or your login password when Touch ID isn't available. Approving a decision card takes one presence check. `gnomon identity` supports rotation and purging old keys.
- **The decision stack** (`#approval-broker`, `#always-rules`, `#standing-grant`). Tool requests from sessions arrive as decision cards, and you sign each answer. "Always allow" rules are derived from rows the kernel signed, can be scoped to a command prefix, and are listed and revoked with `gnomon rules list|revoke`. A daily standing grant ("Make it standing") notifies you instead of asking. In auto-edits mode, Bash commands that are provably read-only (read-only git subcommands included) run without a card.
- **Sessions in a sandbox** (`#session-runner`, `#claude-adapter`, `#session-sandbox`). Claude Code runs as a headless `claude -p` backend under a default-deny macOS `sandbox-exec` profile. The profile denies `~/.gnomon`, `~/.ssh`, `~/.aws` and other credential stores, and only Claude's transcripts can be written under `~/.claude/projects`. New sessions have a model picker. You can re-pin the `claude` binary from the GUI with one Touch ID prompt and a signer check. A root-config switch sets whose hooks run in sessions: `all` (the default), `user-only` or `none`.
- **The GUI** (`#gui`, `#web-endpoint`). A shell served on localhost, papercraft by day and phosphor by night. The desk shows named sessions with one hue per project. Mods can make offers, which appear as a slip under the reply that made them. Notices share one toast style. Settings holds identity, voice and the session model. The UI now follows the Gnomon design system (`.atelier/systems/gnomon/`): four text sizes, 24px keys, one chip style.
- **Voice, on device** (`#gnomon-voice`, `#gnomon-voice-io`). Speech recognition and speech synthesis run locally (sherpa-onnx). Models are hash-pinned and come from upstream, with a mirror as fallback. There are four ways to speak:
  - **Dictate** fills the composer, and only Enter sends.
  - **Talk** is two-way table talk: replies are spoken aloud, with clickable reply options.
  - **Send word** sends when you say a word you trained in a guided dialog.
  - **Pieces** sends in spoken pieces.

  Send word and Pieces ask you to acknowledge the risk first, and the kernel records that acknowledgement. You can enrol and forget your voice for speaker checks.
- **Unverified speech is marked, not dropped** (`#gnomon-voice`). In Dictate, speech that isn't recognised as you still fills the draft, marked "unverified voice". Talk, Send word and Pieces, which send without a key, still require a speaker match. If a sent turn contains unverified words, Claude asks before making edits. Other people's speech is never stored in the permanent log; only its hash is.
- **Mods** (`#mod-host`, `#mod-cli`, `#workshop-mod`). Mods run out of process. `gnomon mod install|link|list|status|pause|start|uninstall` manages them, and linked folders can be pinned, paused and re-approved. First-party mods ship inside the app:
  - the **Workshop**, for building mods, with structured drawing and layout caps;
  - the **Ledger**, a context and budget meter;
  - **Paradigm Context**;
  - Desk mods for **Neurons** and **Constellation**.
- **`gnomon guide [<topic>]`**: how-to text compiled into the app, shown only when you ask for it.
- **Mika's design process ships with her, as skills** (`#designer-agent`, from 7.15.2). The bundled `designer.agent` owns `ui-build-protocol` and `design-options-protocol`. `a11y-audit` gains passes for contrast in every state, keyboard-only use and the thumb zone. Earlier drafts shipped these as behaviours, which agents never read at runtime.
- **Hook self-monitoring** (`#hook-monitor`, `#hook-health-warning`, `#doctor-hook-health`, from 7.15.2). Every plugin hook records its wall time and outcome in `.paradigm/events/hook-timings.jsonl`. A SessionStart line warns when a hook was killed or ran slow. `paradigm doctor` reports per-hook timings, repo traits that slow hooks down, and stale plugin caches.
- `paradigm notices` and `paradigm notices ack <id|all>`. `PARADIGM_NO_NOTICES=1` hides notices without writing anything.

### Changed
- **Read-only commands are read-only** (`#command-policy`, from 7.15.2). `status`, `doctor`, `ripple`, `integrity`, `purpose validate`, `portal validate`, `task ls|show`, `lore list|show` and `notices` make no filesystem writes and no network calls. Migration notices go to stderr, so `--json` stdout stays clean. Lore reads, in the CLI and the MCP server, no longer migrate legacy entries.
- **Hooks honour configured enforcement severities** (`#paradigm-common`, from 7.15.2). Before, every check ran at its hard-coded default whatever `.paradigm/config.yaml` said. **If your config differs from the defaults, checks will now block, warn or stay off as configured.**
- **Hook session markers are gitignored** (`#session-markers-gitignore`, from 7.15.2). `paradigm init` and `paradigm sync` write a managed block to `.paradigm/.gitignore`.
- CI runs `npm run typecheck` across `paradigm`, `paradigm-mcp`, `sentinel` and `gnomon`. The script used to print `tsc` help and exit, so nothing was checked.

### Fixed
- **Typecheck to zero exposed live bugs** (`#paradigm-mcp`). The type errors went from 335 to 0 in `paradigm` and from 150 to 0 in `paradigm-mcp`, and fixing them fixed these:
  - every `paradigm_platform` tool threw, because it read `ctx.projectDir`, which was always undefined;
  - Sentinel seed patterns were never loaded;
  - persona Sentinel validation read a missing field, and now keeps the latest event per step;
  - `paradigm_captain` read `r.file` instead of `r.filePath`;
  - tag suggestions dropped their description.
- **The Stop hook finishes in about 1 s instead of hitting its 30 s timeout** (`#stop-hook`, from 7.15.2). Before, it timed out in repos with agent worktrees, so its checks never actually enforced anything. No hook leaves a child holding Claude Code's pipe, and the pre-commit hook no longer downloads the unrelated public `paradigm` package.
- **Portal gate scan** (`#portal-compliance`). It skips agent worktrees, build copies and Markdown. Gates declared in a nested `portal.yaml`, in a `.purpose` `gates:` mapping or on a `^gate:` line now count as declared. `file.md#^block-id` is no longer read as a gate.
- **Sentinel and Platform UI** (`#IncidentsTab`, `#SidebarNav`). Incidents get detail and resolve flows, confirmation, pending and failure states, and a filtered-empty state. Muted text and symbol chips meet WCAG AA in both themes. The sidebar fits short viewports.
- Project-level installs register the SessionStart hook-health warning (`#paradigm-hooks`).

### Security
- **Ids never build a path outside their store** (from 7.15.2). A crafted id such as `L-…/../../x` could make `paradigm lore show` print a file outside the project. Ids containing a separator, a dot or `..` are now refused wherever an id becomes a path: lore, tasks and `paradigm override`.
- **Every Gnomon binary is pinned to the exact release build.** The kernel compiles in the sha256 of the helper and voice binaries, so a validly signed but different build is still refused. The app is checked with `codesign` before every launch; one that fails is moved aside and reinstalled. Before running, the wrapper re-hashes Node and the kernel and applies an environment allow-list, so `NODE_OPTIONS` and `GNOMON_*` from your shell never reach the kernel.
- **The `gnomon` command in paradigm** resolves Gnomon only inside its own `node_modules`. Packages planted elsewhere and `NODE_PATH` are refused.
- **Publishing gates.** `npm run publish:gnomon` refuses any app that isn't signed, notarized, stapled and a release build. The platform package has no scripts and no dependencies. CI never publishes Gnomon, and it refuses to publish paradigm until the matching Gnomon version is on npm.
- **Hook-health warnings reach the next session's context as hook names and numbers only.** No other text from the timing ring is passed on.

### Breaking
- **Node 24 or newer is required (Node 20 reached end of life in April 2026; Node 22 users must upgrade).** Every published package declares `engines.node >=24.0.0`, the Claude Code plugin's hooks and the MCP server run on your Node, and the Gnomon app still bundles its own pinned Node.
- **No commands, MCP tools or files were removed.**
- On Apple silicon Macs, installing paradigm also downloads the zipped `Gnomon.app` (an optional dependency). Other platforms skip it.

### Known limitations
- **Apple silicon Macs only.** On an Intel Mac, `gnomon` prints "Gnomon 8.0 runs on Apple silicon Macs; Intel support is planned." and exits 69. On Linux and Windows it prints one plain line and exits. Windows and Linux support are planned; the Paradigm CLI and MCP server work everywhere as before.
- **Local models are not in the app yet.** The kernel can run local-model sessions against OpenAI-compatible endpoints on loopback or your LAN, through a root-signed, pinned `gnomon-local` runner. That runner isn't bundled in 8.0.
- Speaker verification is a convenience filter, not a security boundary.
- After you empty an unverified draft, Send word stays blocked until your next voice turn (T-2026-10-21-026).
- At 1024px wide, a toast covers the Settings close key (T-2026-10-21-024).
- `paradigm_gates_for_route` and the pm checks never see `portal.yaml` `routes`, because the parser drops them. They now return an empty list explicitly instead of reading undefined (T-2026-10-22-002).
- Specified but not in 8.0: spawning from contracts (the armada), kernel linking, the Doodle and gnome-persona mods, and CI signing (planned for 8.1).

### Packages
- `@a-company/paradigm` 8.0.0, plugin 8.0.0, `@a-company/paradigm-mcp` 8.0.0 (private, bundled)
- `@a-company/gnomon` 8.0.0 and `@a-company/gnomon-darwin-arm64` 8.0.0 (new, public)
