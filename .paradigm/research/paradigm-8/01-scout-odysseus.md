# Scout: Odysseus (2026-10-15)

Repo `~/Documents/GitHub/odysseus` — harness 0.20.19, AGPL-3.0, first commit 2026-05-31, 733 commits by pewdiepie-archdaemon plus a large community. Docs and source read by an Explore scout; inferences marked.

## What it is
"A self-hosted AI workspace for chat, agents, research, documents, email, notes, calendar, and local model workflows." For privacy-minded self-hosters on local or API models. Thesis (inferred): one owner-scoped local-first app replaces ChatGPT + Gmail + Notion + calendar, with an agent across all of them.

## Architecture
- One FastAPI monolith (`app.py`, ~54 `routes/`), sidecars chromadb, searxng, ntfy; GPU compose overlays; native installers; PyInstaller/macOS .app/Windows portable; Swift MLX image bridge.
- Core loop `src/agent_loop.py` is a single 38,039-line file: prompt assembly, tool retrieval, multi-round tool calls, loop-breakers, verifier retries, teacher escalation.
- `src/turn_contract.py`: frozen per-turn tool set, required ⊆ offered ⊆ executable. `src/agent_runtime/journal.py`: ActionJournal with receipts propose → authorize → dispatch → settle.
- Provider layer `src/llm_core.py` + per-provider specs (36). Device-flow login for Copilot/ChatGPT subscriptions. "Cookbook" (`services/hwfit/`) detects hardware, ranks models that fit, downloads and serves them.
- Tools retrieved per turn by embedding + keyword (`src/tool_index.py`). MCP via `src/mcp_manager.py`. bubblewrap containment that reports truthfully what it enforced and never silently downgrades (`src/containment.py`).
- UI: no-build static SPA (~99 modules), PWA, snap-tiling tool windows.
- Companion: LAN QR pairing minting a chat-scoped token.
- External agents: `integrations/claude`, `integrations/codex` ship SKILL.md + helper calling a scope-gated `/api/codex/*`.

## Extension model
No first-class plugin/mod/manifest system and no third-party display API. Extension = MCP servers (sanitized, untrusted tools need exact approval), skills (`SKILL.md` with name/version/status/confidence/when_to_use; GitHub import with SSRF protection; lifecycle draft → audited → approved; progressive loading, credited to Hermes), CrewMember agent rows, generic API integrations, HMAC webhooks. Native tools need ~6 hand-synced registries (their own spec admits this). Trust via policy: untrusted content in context ⇒ high-impact tools need sealed, expiring exact-action approval.

## Memory
JSON memory + ChromaDB vectors (keyword fallback). Pinned → keyword+vector → injected as untrusted → use counts. LLM extraction incl. dislikes. Consolidation "Memory Tidy" fires every 5 `memory_added` events with an over-consolidation guard. Notes/todos own reminders (browser/email/ntfy/webhook). Deep research → self-contained HTML report.

## Loops / autonomy
Scheduler: once/daily/cron/event-count triggers, chained tasks, webhook triggers, max_steps; housekeeping seeded paused. Interactive gate: background work waits until UI is quiet, cancels when user returns. Background jobs auto-continue the chat. Agent tools `create_session`, `send_to_session`, `chat_with_model`, `ask_teacher`; blind A/B compare mode.
Teacher escalation: a local student model fails (regex then LLM-judge detector) → SOTA teacher writes the fix AND a SKILL.md so the student handles it next time; SFT corpus pipeline.

## UX worth stealing
Paste-a-key `/setup` (provider detected by prefix); hardware-fit model ranking; live SVG "synapse" graph of a research run; snap tiling; documents that stream open in the editor; approval cards showing exact action/effects/workspace; QR phone pairing; self-running housekeeping that stays out of the way.

## Steal / avoid
1. Teacher → skill flywheel, gated by an audit queue.
2. Event-count triggers + interactive quiet gate for consolidation/housekeeping.
3. Authority vs containment separation with truthful grants; sealed exact-action approvals after untrusted input; frozen per-turn tool contracts.
4. Bonus: agent-facing "implementation-truth" DocumentMap (`specs/_readme.md`).
Avoid: monolithic loop and hand-synced registries. Define tools/skills/displays in ONE declarative manifest that generates schema, retrieval text and UI toggles.
