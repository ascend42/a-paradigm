# README audit for 8.0.0 (T-2026-10-22-003)

Audited 2026-10-22 on `feat/gnomon` at 03a83273. Read-only, except this file and `README-8.0-draft.md`.

## Which README npm shows

npm shows **`packages/paradigm/README.md`** (142 lines). npm always packs the `README.md` in the package directory, whatever `files` says (`packages/paradigm/package.json` `files`: dist, templates, platform-ui/dist, bin). No build or publish script copies the root README: `grep README` over `packages/paradigm/scripts`, `tsup.config.ts`, the root `package.json` and `.github/workflows` finds nothing. The root `README.md` (441 lines) is the GitHub page. The two have drifted apart. Both need replacing, or the npm one should become a copy of the root one at prepack.

Relative links in the npm README (for example `specs/disciplines.md`) do not resolve on npmjs.com. The draft uses absolute GitHub URLs.

## Package inventory

Columns: "npm" is what the registry serves today (`npm view <name> version`). The last commit is `git log -1 --format=%cs -- <dir>`. Where that commit was a repo-wide sweep, the last substantive change is given in brackets.

| Package (dir) | npm name | Local ver | npm | Last commit | Purpose (.purpose) | Status |
|---|---|---|---|---|---|---|
| paradigm | @a-company/paradigm | 7.15.2 (8.0.0 at release) | 7.15.0 | 2026-10-22 | The unified CLI. It also bundles `paradigm-mcp`, `sentinel`, `sentinel-mcp` and the `gnomon` shim bins | maintained |
| paradigm-mcp | @a-company/paradigm-mcp | 7.15.2, `private: true` | 404 | 2026-10-21 | MCP server. Ships only inside @a-company/paradigm as the `paradigm-mcp` bin (tsup entry `mcp`) | maintained, internal |
| gnomon | @a-company/gnomon | 8.0.0 | not yet | 2026-10-22 | 8.0 kernel: the daemon, sessions, identity, hash-chained log, approvals broker, budget fuse and loopback web endpoint | maintained, publishes in 8.0 |
| gnomon-darwin-arm64 | @a-company/gnomon-darwin-arm64 | 8.0.0 | not yet | 2026-10-22 | The signed, notarized Gnomon.app zip for Apple silicon | maintained, publishes in 8.0 |
| gnomon-contracts | @a-company/gnomon-contracts | 1.0.0, private | — | 2026-10-21 | Versioned contract types, validators and schemas | internal (bundled) |
| gnomon-gui | @a-company/gnomon-gui | 8.0.0, private | — | 2026-10-21 | Single-page app served by the kernel on 127.0.0.1 | internal (in the app) |
| gnomon-wrapper | @a-company/gnomon-wrapper | 8.0.0, private | — | 2026-10-21 | Tauri 2 shell, i.e. Gnomon.app | internal (in the app) |
| gnomon-helper | @a-company/gnomon-helper | 1.0.0, private | — | 2026-10-22 | Signed Swift helper: Secure Enclave keys, presence (Touch ID or password) | internal (in the app) |
| gnomon-voice | @a-company/gnomon-voice | 0.1.0, private | — | 2026-10-22 | Local voice client and darwin audio I/O | internal (in the app) |
| gnomon-mod-sdk | @a-company/gnomon-mod-sdk | 1.0.0, private | — | 2026-10-20 | mod-abi:v1 runtime and example mod | internal |
| gnomon-mods | (no package.json) | — | — | 2026-10-20 | First-party mods: workshop, ledger, paradigm-context, neurons, constellation | internal (in the app and tarball) |
| gnomon-local | @a-company/gnomon-local | 8.0.0, private | — | 2026-10-18 | Local-model session child (llama.cpp, Ollama, LM Studio, vLLM, mlx-lm) | internal; **not in the 8.0 app** (`release-darwin.mjs` stages voice and mods only) |
| logger | @a-company/paradigm-logger | 3.5.2 | 3.5.1 | 2026-04-22 | Symbol-typed structured logging | maintained (low churn) |
| purpose/core | @a-company/purpose-core | 3.7.0 | 3.5.0 | 2026-10-13 | `.purpose` parsing and validation (11 importers) | internal (bundled) |
| premise/core | @a-company/premise-core | 3.12.0 | 0.2.0 | 2026-10-17 | Symbol aggregation and index (67 importers) | internal (bundled) |
| portal/core | @a-company/portal-core | 3.5.0 | 0.1.0 | 2026-08-23 [06-23] | `portal.yaml` parsing (12 importers) | internal (bundled) |
| portal/sdk | @a-company/portal-sdk | 3.5.0 | 0.1.0 | 2026-08-23 [03-24] | Runtime gate SDK (3 importers) | internal, low churn |
| portal/manager | @a-company/portal-manager | 3.5.0 | 0.1.0 | 2026-08-23 [02-25] | Portal testing (1 importer) | internal, low churn |
| portal/viewer | @a-company/portal-viewer | 3.5.0 | 0.1.0 | 2026-08-23 [03-24] | `paradigm portal watch` viewer (1 importer) | internal, low churn |
| portal/e2e | @a-company/portal-e2e | 3.5.0 | 404 | 2026-02-25 [01-24] | AI-driven E2E for portals (0 importers) | **deprecated candidate** |
| probe/core | @a-company/probe-core | 3.5.0 | 3.5.0 | 2026-08-23 [03-24] | Visual discovery index (4 importers) | internal, low churn |
| sentinel | @a-company/sentinel | 3.9.0 | 3.9.0 | 2026-10-21 | Incident tracking. Also bundled as the `sentinel` and `sentinel-mcp` bins of paradigm | maintained |
| sentinel-rs | (Rust crate) | — | — | 2026-03-24 | Rust tracing client for Sentinel | parked |
| sentinel-web | @a-company/sentinel-web | 0.1.0 | 0.1.0 | 2026-08-23 [03-24] | Browser client for Sentinel (0 importers) | parked |
| university | @a-company/university | 7.0.0 | 6.6.0 | 2026-09-29 | First-party University content pack (PLSAT), read by the Platform Academy | maintained |
| university-core | @a-company/university-core | 0.2.0 | 0.1.0 | 2026-09-29 | Pack loader (15 importers) | internal (bundled) |
| warpline | @a-company/warpline | 0.2.2 | 0.2.1 | 2026-10-13 | "Version control for meaning (experimental)". Optional dependency of paradigm | maintained, experimental |
| warpline-action | @a-company/warpline-action | 0.1.0, private | — | 2026-07-17 | Warpline Guard GitHub Action | parked (unpublished) |
| runtime | @a-company/paradigm-runtime | 0.1.0 | 0.1.0 | 2026-08-23 [03-24] | Contracts for Paradigm Studio apps (a-animus); 0 importers | parked |
| paradigm-vscode | paradigm-vscode | 3.5.0 | not on npm | 2026-08-11 [03-24] | VS Code extension. The repo holds `paradigm-vscode-1.0.0.vsix` | parked |
| conductor | (SwiftPM app) | VERSION file | — | 2026-09-29 [Swift: 06-17] | macOS SwiftUI session overlay plus Symphony UI. `paradigm conductor` builds it only from a repo clone (`commands/conductor.ts:270-310`) | parked |
| site | @a-company/paradigm-site | 0.1.0, private | — | 2026-09-29 | Next.js site for useparadigm.dev. That domain serves a GoDaddy placeholder | parked |
| plugins/paradigm | Claude Code plugin | 7.15.2 | marketplace | 2026-10-20 | Hooks, skills, agents and `.mcp.json` (`npx --package=@a-company/paradigm paradigm-mcp`) | maintained |
| plugins/paradigm-cursor | Cursor plugin | — | — | 2026-10-20 | Cursor hooks and skills | maintained |

**Summary:** 7 maintained (paradigm, gnomon, gnomon-darwin-arm64, sentinel, university, warpline [experimental], logger) plus the 2 plugins. 17 are internal or bundled, gnomon-local among them (not shipped in 8.0). 7 are parked (sentinel-rs, sentinel-web, runtime, paradigm-vscode, conductor, site, warpline-action), and 1 is a deprecation candidate (portal-e2e).

Side findings, not part of the README itself:

- The sub-packages on npm are far behind (portal-core is 0.1.0 on npm and 3.5.0 locally). Paradigm bundles them (`tsup.config.ts` `noExternal: [/^@a-company\//]`), so this has no runtime effect. Paradigm still lists them as `*` dependencies, so npm installs the stale copies for nothing.
- `packages/sentinel/.purpose`, `packages/sentinel-rs/.purpose` and `packages/conductor/.purpose` fail strict YAML parsing. They use the legacy `#Component:` keys, which YAML reads as comments.
- **The Gnomon macOS floor is inconsistent.** `kernel/setup/preflight.ts:48` has `MACOS_MAJOR_FLOOR = 13` and the wrapper declares 13.0 (`gnomon-wrapper/tauri.conf.json:38`). The helper and voice-io declare 14.0 (`gnomon-helper/darwin/Package.swift:14`). The session sandbox refuses below 15 (`platform/darwin/session-sbpl.ts:82`, `SESSION_SANDBOX_MIN_MACOS = 15`). So setup can pass on macOS 13 or 14 and sessions then refuse. The draft states macOS 15.
- `packages/gnomon/README.md` still documents the clone-and-build install (`npm ci`, Node 24). It predates the zero-build 8.0 path.

## Claim audit

Verdicts: **T** = true, **S** = stale (was true, or true only in part), **F** = false. Evidence paths are relative to the repo root.

### npm README (`packages/paradigm/README.md`)

| # | Line | Claim | Verdict | Evidence |
|---|---|---|---|---|
| N1 | 3 | "Universal Agentic Development Protocol – Language & Discipline Agnostic" | S | Not the current positioning (structure, determinism, calibration). Says nothing about Gnomon, MCP or agents |
| N2 | 5 | Works for web, ML, firmware, infra: "the same consistent context protocol" | S | 14 discipline values exist (`packages/paradigm/src/core/paradigm-config.ts:12-27`). "Blueprint" is marketing |
| N3 | 10 | `npm install -g @a-company/paradigm` | T | `packages/paradigm/package.json` bin |
| N4 | 17-26 | `init`, `shift`, `status`, `doctor` | T | `paradigm --help` |
| N5 | 34 | shift = init + team + scan + sync all IDEs | T | `src/commands/shift.ts:307-691` (it also installs hooks) |
| N6 | 36 | `paradigm scan` "Rebuild scan index" | F | `scan` is a group whose only subcommand is `auto` (drafts `.purpose`). The index comes from `paradigm index` or `paradigm_reindex` |
| N7 | 35,37,38 | `sync`, `status`, `doctor` | T | `paradigm --help` |
| N8 | 39-41 | `team init`, `team agents suggest`, `team orchestrate` | T | `paradigm team --help`, `paradigm team agents --help` |
| N9 | 48 | `sync cursor` → `.cursor/rules/*.mdc` | T | `src/core/ide-adapters/cursor.ts:51` |
| N10 | 49 | `sync copilot` → `.github/copilot-instructions.md` | S | Now `.github/instructions/*.instructions.md` (`ide-adapters/copilot.ts:3,48`) |
| N11 | 50-52 | windsurf → `.windsurfrules`; claude → `CLAUDE.md`; `--all` | T | `windsurf.ts:25`, `claude.ts:19`, `paradigm sync --help` |
| N12 | 58-59 | `purpose validate`, `purpose remember` | T | `paradigm purpose --help` |
| N13 | 65-66 | `portal validate`, `portal test` | T | `paradigm portal --help` |
| N14 | 72-73 | `premise aggregate`, `premise snapshot` | T | `paradigm premise --help` |
| N15 | 78-98 | 5 symbols plus a tag bank | T | `CLAUDE.md` symbol table, `.paradigm/tags.yaml` (guaranteed file) |
| N16 | 104-114 | Discipline table; "See `specs/disciplines.md`" | S | Disciplines exist. The file is `.paradigm/specs/disciplines.md` in an initialised project (`templates/paradigm/specs/disciplines.md`), and the relative link is dead on npm |
| N17 | 121-133 | Tree has `specs/symbols-v2.md` and `specs/scan.md` | F | Templates ship `symbols.md` and no `scan.md` (`templates/paradigm/specs/`) |
| N18 | 122-133 | `config.yaml`, `tags.yaml`, `agents.yaml`, `docs/*`, `logger.md`, `disciplines.md` | T | `src/commands/shift-files.ts:26-212`, `templates/paradigm/` |
| N19 | 138 | Main repository link | T | github.com/ascend42/a-paradigm |
| N20 | 142 | MIT | T | `LICENSE`, package.json `license` |
| N21 | — | (omission) No mention of Gnomon, the MCP server, the plugin, agents or skills | S | The 8.0 headline is missing from the npm page |

npm README totals (21 claims, N21 omission counted as S): **T 14 / S 5 / F 2**.

### Root README (`README.md`)

| # | Line | Claim | Verdict | Evidence |
|---|---|---|---|---|
| R1 | 7 | "One command to make your codebase AI-ready" | S | Not the current positioning. No mention of Gnomon |
| R2 | 11 | Node >= 20 | T | `packages/paradigm/package.json` engines. Gnomon's kernel needs 24 but brings its own Node inside the app (spec §18.1 rule 1) |
| R3 | 18,25 | `npm install -g`, `paradigm shift` | T | bin, `shift.ts` |
| R4 | 28 | Shift scaffolds the map, access rules, IDE files and hooks; safe to re-run | T | `shift.ts`; `shift-files.ts` never overwrites |
| R5 | 28 | "Works with TypeScript, Python, Rust, Go, Swift, and more" | T | `paradigm presets` (16: Next.js…FastAPI, Gin, Axum, Swift iOS, Kotlin, Flutter) |
| R6 | 32-63 | Sample output (6 steps, created files) | T | `shift.ts:311-691`, `shift-files.ts` |
| R7 | 75-86 | `curl -fsSL https://a-company.org/paradigm/install.sh \| bash` | F | `curl` returns HTTP 402 `DEPLOYMENT_DISABLED` (checked 2026-10-22). `install.sh` was last changed 2026-02-07 |
| R8 | 88 | Uninstall `@a-company/paradigm-mcp` | S | That package is private and was never on npm (404). `paradigm-mcp` is a bin of @a-company/paradigm |
| R9 | 104-105 | Manual install step 3: install paradigm-mcp globally from source | S | Redundant. `packages/paradigm/package.json` bin `paradigm-mcp` already provides it, and two global packages then claim the same bin |
| R10 | 119 | Plugin: `/plugin marketplace add ascend42/a-paradigm` | S | That only adds the marketplace. Install is `/plugin install paradigm@a-paradigm` (`plugins/paradigm/README.md:10-11`) |
| R11 | 122 | The plugin replaces `paradigm mcp setup` | T | `plugins/paradigm/.mcp.json` |
| R12 | 134-139 | The six shift steps | T | `shift.ts` |
| R13 | 137 | Five IDEs (CLAUDE.md, AGENTS.md, Cursor, Windsurf, Copilot) | T | `src/core/ide-adapters/{claude,agents,cursor,windsurf,copilot}.ts` |
| R14 | 141 | "36 core files and directories are guaranteed" | T | `shift-files.ts` `GUARANTEED_FILES` has 36 entries |
| R15 | 149-157 | Shift flags | T | `paradigm shift --help`. Also has `--no-prompt`, which is undocumented |
| R16 | 165-170 | Root `.purpose` skeleton | T | `shift-files.ts:118-126` |
| R17 | 198 | "One MCP tool… a 200-token summary" | S | Not measured anywhere current. Treat as unbacked |
| R18 | 202-215 | `portal.yaml` example with list-form `gates:` and `routes:` | S | Shift writes map form (`gates: {}`, `routes: {}`, `shift-files.ts:111-116`), and the repo's own `portal.yaml` uses maps |
| R19 | 217 | "Hooks block **commits** that introduce auth logic without a matching gate" | F | The pre-commit hook only rebuilds the index. The **Stop** hook blocks the session (`plugins/paradigm/scripts/paradigm-stop.sh`, `paradigm-common.sh`) |
| R20 | 225-230 | 42% faster, 8.5x less context, 88% cheaper | S | One study of one project, dated 2026-02-04 (`.paradigm/docs/agentic-efficiency-study.md:28,108`). It predates the 7.13 tool surface |
| R21 | 239 | "Scales from solo repos to enterprise monorepos" | S | Workspaces exist (`paradigm workspace`); "enterprise" is unbacked |
| R22 | 240 | 14 disciplines, 16 presets | T | `paradigm-config.ts:12-27` (14 plus `auto`), `paradigm presets` |
| R23 | 265 | `paradigm scan auto`, `paradigm lint` | T | `paradigm scan --help`, `paradigm --help` |
| R24 | 275-280 | Hook table: Claude Code has no session-start hook | S | The plugin has SessionStart and UserPromptSubmit hooks too (`plugins/paradigm/hooks/hooks.json`) |
| R25 | 278 | Stop blocks on `.purpose`, portal gates and lore | T | `paradigm-common.sh:563` (lore-required) |
| R26 | 282 | Cursor stop retries up to 3 loops | T | `src/commands/hooks/index.ts:791` `loop_limit: 3` |
| R27 | 286 | 68 bundled agents | T | `packages/paradigm/templates/agents/*.agent` = 68 |
| R28 | 286 | Opus for high-stakes work, haiku for implementation | T | `src/core/agent-spawner.ts:393`, `src/core/.purpose:185` |
| R29 | 286 | `paradigm orchestrate "..."` | F | No top-level command. It is `paradigm team orchestrate` |
| R30 | 288,296 | `paradigm agent sync-global`, `paradigm agent show` | T | `paradigm agent --help` |
| R31 | 290-294 | Tier lists 17 / 27 / 24 | T | They sum to 68. Each nickname was not checked individually |
| R32 | 308-312 | IDE table (Copilot `.github/instructions`) | T | `copilot.ts:48` |
| R33 | 313 | VS Code: command `paradigm-vscode` | F | No such command. Not on npm. The repo vsix is 1.0.0 while package.json says 3.5.0 |
| R34 | 319 | `@a-company/paradigm-mcp` with "150+ tools" | F | The package is private (404 on npm). The default list is **32** tools (11 anchors + 21 families), plus 13 on-demand, so 45 at most (`packages/paradigm-mcp/src/tools/families.ts:3-8,14-90`; 7.13 cut 134 → 32) |
| R35 | 319 | "~100–300 tokens per call vs ~2,000" | S | Not measured in current tests. `tools-list-budget.test.ts` bounds only the listing (<8000 tokens) |
| R36 | 321 | `paradigm mcp setup --client all` | T | `paradigm mcp setup --help` |
| R37 | 323 | MCP guide and llms.txt links | T (S) | Files exist, but `docs/guides/mcp-setup.md:167,173` itself says "150+" |
| R38 | 341 | Sentinel via `paradigm sentinel` | T | `paradigm --help` |
| R39 | 342 | University via `paradigm university` | T | Command exists. Since 7.11 it is a content pack shown in the Platform Academy |
| R40 | 343 | Conductor: "native macOS overlay" | S | It exists but builds only from a repo clone (`commands/conductor.ts:270-310`). Swift code last changed 2026-06-17 |
| R41 | 344-347 | Orchestration, decisions, workspaces, v6 guide | T | `docs/guides/*.md`, `paradigm workspace` |
| R42 | 355-367 | Useful-commands table | T | All present in `paradigm --help` |
| R43 | 377 | Package table: `@a-company/paradigm-mcp` | F | Private; npm 404 |
| R44 | 379-386 | purpose, portal, premise and probe packages listed as current | S | Published versions are 0.1.0 to 3.5.0, behind local; all are bundled into paradigm |
| R45 | 384 | `@a-company/portal-e2e` | F | npm 404; 0 importers |
| R46 | 388 | `@a-company/university` "Learning platform and PLSAT" | S | Now a content pack only (7.0.0 removed the UI); npm has 6.6.0 |
| R47 | 389-390 | `paradigm-logger`, `paradigm-vscode` | T / S | logger is on npm; vscode is not |
| R48 | — | (omission) Gnomon, Warpline, Platform (`paradigm serve`), skills, Brain, Symphony | S | All exist (`paradigm --help`) and none is mentioned |
| R49 | 396-400 | Docs hub, quick start, command reference, changelog | T | Files and the `#command-reference` anchor exist |
| R50 | 407-413 | Development from source | T | Root `package.json` scripts |
| R51 | 419 | MIT | T | `LICENSE` |
| R52 | 423 | Author site a-company.org | F | HTTP 402 `DEPLOYMENT_DISABLED` |
| R53 | 424-425 | Instagram, YouTube | (unchecked) | Not verified, so not counted |
| R54 | 435 | "~100 tokens per query vs ~2,000 (8.5x)" | S | Same as R20/R35 |
| R55 | 437 | "MCP tools: 150+" | F | 32 by default (see R34) |
| R56 | 438 | Hooks block sessions without `.purpose` updates | T | Stop hook |

Root README totals (55 claims; R53 excluded; R37 and R47 counted as T): **T 31 / S 15 / F 9**.

**Combined: T 45 / S 20 / F 11** (76 claims).

### Other stale copy found on the way (outside both READMEs)

- `plugins/paradigm/.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:14` and `plugins/paradigm/README.md:4` say "50+ MCP tools". The real figure is 32 by default.
- `plugins/paradigm-cursor/.cursor-plugin/plugin.json:4` and `plugins/paradigm-cursor/README.md:4,31` say "50+".
- `docs/guides/mcp-setup.md:167,173` says "150+". `packages/site/src/content/docs/getting-started.md:44` says "100+".
- `nevr.land` (behind `paradigm agent install/search/publish`) returns HTTP 402 `DEPLOYMENT_DISABLED`.
- `useparadigm.dev` serves a GoDaddy placeholder, not `packages/site`.

## Security claims in the draft (for Aegis)

Each claim has the evidence the draft relies on. Aegis, please confirm or strike each one.

1. "Gnomon.app is signed and notarized by Apple." Evidence: spec §18.1 rule 5 and the publish gate (`scripts/gate-gnomon-publish.mjs`: codesign, stapler, spctl); commit 03a83273 ("notarized; spctl 'Notarized Developer ID'").
2. "Before installing, `gnomon` checks the app zip against a hash compiled into the published package, and checks the app's code signature before every launch." Evidence: §18.1 rules 7, 9 and 10; `packages/paradigm/bin/gnomon-app.js` (`ensureApp`, `compiledAppZipPin`).
3. "It does not need sudo and has no postinstall script." Evidence: §18.1 rule 10.
4. "Claude Code sessions run inside a macOS sandbox profile." Evidence: `packages/gnomon/src/kernel/sandbox/session.ts`, `src/platform/darwin/session-sbpl.ts`. Requires macOS 15 and SIP, or sessions refuse.
5. "Your approvals are signed with a key held in the Secure Enclave and need Touch ID or your password." Evidence: `packages/gnomon-helper`, `packages/gnomon/src/kernel/broker/`, `gnomon-gui/src/setup/digest.ts:39-50`.
6. "Setup asks for exactly two Touch ID or password prompts. A third prompt during setup is an attack." Evidence: `gnomon-gui/src/setup/digest.ts:50` (`TWO_PROMPTS_NOTICE`). The draft says only "two prompts". Should the third-prompt warning go into the README?
7. "Every session event goes into a tamper-evident, hash-chained log." Evidence: `packages/gnomon/src/kernel/log/`; spec §1.
8. "The desk is served on 127.0.0.1 only; nothing listens beyond loopback." Evidence: spec §1 non-goals and §11.1. Caveat: the spec's `gnomon-relay` is the one off-loopback listener, and it is not part of 8.0.
9. "Mods run as separate processes under their own sandbox profile." Evidence: `src/kernel/sandbox/mod.ts`, `src/platform/darwin/mod-sbpl.ts`, spec §12.1.
10. "Voice audio stays on the Mac; voice models are checked against pinned hashes." Evidence: spec §1 ("raw audio never leaves the box"), §18.1 rule 13.
11. "Gnomon uses your Claude subscription and refuses API-key billing." Evidence: `src/kernel/runner/preflight.ts:35` (`not_subscription_auth`); `packages/gnomon/README.md` (`BILLING_REFUSED`).
12. "The shim never runs Gnomon on your own Node and passes only an allow-listed environment." Evidence: §18.1 rules 9 and 11; `packages/paradigm/bin/gnomon.js` header. (In the draft as one line.)
