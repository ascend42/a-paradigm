# Scout: TUI + mod-system references (2026-10-16)

Read-only. Licenses: deepseek-harness MIT; QM MIT; ruflo MIT; Odysseus AGPL-3.0 (ideas only); Pi MIT (github.com/badlogic/pi-mono @4954d76, packages now @earendil-works/pi-*); OpenCode MIT (github.com/sst/opencode @37e3912, v2.0.30). Orchestrator verified Pi + OpenCode LICENSE files, pi-tui MIN_RENDER_INTERVAL_MS = 16, package name @earendil-works/pi-tui.

## TUI architectures
- Pi (packages/tui): custom, framework-free; retained components render(width): string[]; line-diff rendering from first changed line, synchronized output ?2026h; 16 ms throttle, input immediate; alt-screen fullscreen with mouse; editor with kill ring/undo/paste collapse; Kitty keyboard protocol; named-action keybindings; overlays, no tiling.
- OpenCode: OpenTUI 0.5.17 (native core) + Solid at 60 fps; real client/server split (Effect HttpApi, SSE /api/event drops slow consumers, typed client, --server attach); streaming markdown; per-hunk diffs; budgeted transcript mount; resizable panes/tabs; schema-typed keybinds; ~34 themes.
- deepseek-harness dropped its pi-tui TUI (commit 10bb9cbf4a, 2026-08-04): 12 s to render a 196k-event session, 800 ms/keystroke until width-keyed line caches (17 ms). Now React web/Electron with dockable split panes + virtualized transcript.
- ruflo draws inside Claude Code's mod engine (Pane kit Box/Text/Button/Input/Raster via ui.render). Odysseus web-only floating windows. Nobody uses Ink.

## Driving Claude Code headless on a subscription
- Agent SDK: QM (built-ins off, settingSources:[], jailed HOME/CLAUDE_CONFIG_DIR, bypassPermissions, partial-message streaming, MessageQueue mid-turn steering, CLAUDE_CODE_OAUTH_TOKEN, approvals as NeedsApproval inside its own MCP tools); dsh (canUseTool always denies, AskUserQuestion disallowed, no resume/progress).
- claude -p stream-json: a-flow headless.py (stream-json in/out, replay-user-messages, permission-mode default, permission-prompts none, session-id/resume, --settings; preflight binary sha/version/subscription; PermissionRequest hook → hub; FORBIDDEN_FLAGS via bare assert), a-constellation (+ --mcp-config, --append-system-prompt, --model; Allow/Always/Deny cards).
- Headless loses: live token streaming (needs --include-partial-messages — absent from spec §3.3 argv), slash/skills menu (from init), plan mode, AskUserQuestion, /compact, login UI, Esc (→ SIGINT / interrupt()).
- Recommendation: keep claude -p per spec (pinning, one driver, parity); TUI renders cards for the PermissionRequest → broker → card:v1 path; render AskUserQuestion and ExitPlanMode as card kinds. (inferred) Have Aegis confirm whether shipping subscription-driven headless sessions "for the world" in 8.1 fits Anthropic's terms.

## Local model loop
- Pi agent-loop: 4 default tools, parallel tools, steering + follow-up queues, JSONL session tree v3, compaction (reserve 16384, keep ~20k, fixed headings Goal/Constraints/Progress/Decisions/Next/Critical, one compact-and-retry); local via openai-completions with hand-set compat flags (best preset: llama.cpp extension — no developer role, no store, max_tokens, qwen-chat-template thinking); no MLX; `pi --mode rpc` JSONL drive.
- OpenCode: Ollama/LM Studio/vLLM plugins probe capabilities, tools off unless detected; tool-input-repair; compaction keeps 15k.
- Odysseus (ideas): text-tool fallback, multi-dialect tool-call parser, per-model tool surface none/compact/full, n_ctx from llama.cpp /slots, Cookbook backend choice.
- Works across Ollama/llama.cpp/MLX (inferred): OpenAI-compatible transport + per-backend compat profile, tool-capability probe, argument repair, text-tool fallback, ~8k context targets for coding.

## Mod systems
Manifests: Pi package.json "pi" key; OpenCode {id, setup(ctx)} + effect peer; dsh Cordis + engines.dsh; ruflo plugin.json + hooks.json. Views: Pi renderers/widgets/custom(); OpenCode ui.slot(claim) with prepend/append/before/after/replace on named paths; dsh typed SlotMap + ConversationNodeDefinition; ruflo Pane kit. Tools: Pi registerTool (TypeBox); OpenCode tool.transform; dsh ctx.tools.register. Hot reload: Pi full runtime reload (jiti), OpenCode sha256 fingerprints, dsh profile HMR. Sandbox: none anywhere (dsh node:vm "not a security boundary"); ruflo scan-only trust tiers. Agent authoring: Pi points the model at docs/examples; dsh live introspection + install validation with rollback. Nobody versions a mod ABI separately.

## Recommendation
- TypeScript/Node; lift @earendil-works/pi-tui (MIT) as the renderer (OpenTUI pre-1.0, native, Bun-leaning); copy OpenCode's topology: TUI is a client of gnomon-rpc:v1, kernel owns sessions (Shuttle, constellation, TUI as peers); local backend = pi-agent-core + pi-ai (MIT) behind the adapter, seeded with the llama.cpp compat preset. Mind dsh's long-session render lesson (width-keyed line caches, virtualization).
- One manifest: manifest:v1 adds `abi`, provides.tools (schemas + declared effects read|write|network|spend), views (slots sidebar|panel|status|composer.footer|tool.view:<tool>|card.detail:<kind>, append|replace, fixtures), commands, keybindings (bind to command ids only), plus mcp/hooks/skills/bands.
- Minimal stable mod ABI (inferred): mods run OUT OF PROCESS (one stdio JSON-RPC child each); views are pure render(input) → display-block:v1 from a closed kit (Box, Text, List, Table, Markdown, Diff, Progress, Button); Button carries only {command}; approvals only from kernel-signed card:v1; ~6 RPCs (tool.call, view.render, command.run, event feed, state.get/set, health); hot reload by manifestHash; declared effects enforced at the RPC boundary.
- Agent-maintainable: `gnomon mod types` (generated .d.ts + JSON Schema → abiId), fixtures + `gnomon mod test` golden renders and contract tests, `gnomon mod inspect`, agent install = validate → test → install card (Aegis M6), rollback; system prompt points at docs + example mod.
- Lift (MIT): pi-tui, pi-agent-core, pi-ai (compat schema, llama preset), OpenCode keybind schema shape + slot placement + once/always/reject permission UX + tool-input-repair idea, QM MessageQueue steering. Re-derive: Odysseus (AGPL), ruflo, dsh ConversationNodeDefinition.
- Risk/opportunity: mirror Claude Code's Pane kit shape so one view targets both the TUI and the Shuttle band (inferred).
