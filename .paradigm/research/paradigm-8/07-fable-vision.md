# Fable — divergent vision pass (2026-10-15)

Fable read 00–04 and spot-checked constellation agents.ts, .warpline/fabric.jsonl (143 strands), packages/warpline (agent-shell, daemon, mcp, f4), warpline-flows.md, warpline-v3-identity.md, ~/.paradigm/score/, dsh goal + tool-ralph. Fable re-issued the pass after the P8-R2 relay; the spec-as-contract section below comes from that second version (which also checked packages/paradigm/src/commands/pipeline and .paradigm/specs/*.md).

## Reframing finding
In weaving, the HARNESS is the frame of heddles that lifts warp threads so the weft can pass. "Paradigm Harness" is already Warpline vocabulary: not beside Warpline, the part of the loom that makes weaving possible.

## Linux analogy
- Kernel: (a) ledger — one append-only, hash-chained, content-addressed store with fail-closed checkpoints (Warpline fabric v3 is the only kernel-grade one); (b) principals + authority — daemon/tokens.ts + HUMAN_ONLY matrix + $WARPLINE_AGENT_ID; (c) turn runner — the stream-json driver, already shipped in triplicate.
- Syscalls/ABI: MCP tool families; F4 cold-agent legibility = ABI stability (runtime self-description is the man page).
- Filesystem: symbol graph + .purpose + one ref grammar. /proc: paradigm_status, warpline selvage, dsh --dump-config, and `~/.claude/projects/<cwd>/<uuid>.jsonl` = /proc/<pid>.
- Userland: 101 agents, notebooks, skills, atelier crew, neurons recipes, hooks.
- Shell: Claude Code. It is bash — don't write a shell. Conductor/constellation/Platform/Studio are terminal emulators and window managers.
- Distros: flow (headless automation), constellation (voice/map), atelier (design), Conductor (macOS desktop). dsh profile/bundle/patch is the packaging grammar.
- Package manager: six manifests today; apt needs one. init: session recover + roster + notebook injection = PID 1; flowmation-harness LaunchAgent = systemd. cron: six schedulers. Users: root = human, agents unprivileged, sudo = approval card (×3 UIs), setuid = HUMAN_ONLY verbs, groups = trust tiers, quarantine selvage = new user with no sudoers.
- Breaks: no ring 0 (model is rented, hooks advisory); Linux never judged meaning (Warpline does); userland rewrites itself (package manager must be an audit queue); five ledgers claim truth vs one VFS — "the actual 8.0 fight".

## Three shapes
**A — Heddle: the kernel beneath Claude Code.** One daemon: session runner + ledger + identity + scheduler + event bus + manifest. Claude Code stays the shell; constellation, flow, Conductor, atelier become clients; display seam is a Claude Code Mod. Day: open Claude Code as today; sessions auto-register; a band shows selvage/inbox/budget; `heddle spawn 4 --goal "…"` forks four Warpline-native worktree sessions; KNOTs arrive as approval cards on phone or constellation. Consolidates 3 runners→1, 6 crons→1 grammar, 3 approval UIs→1, Symphony Score onto the bus. Keeps UI shells, neurons vault, symbol graph engine. Warpline: the ledger IS the kernel log; every injected context becomes a logged strand [design bet: fabric today records code meaning, not session events]. Risk: daemon becomes the sixth thing to keep alive. Falsifier: after two weeks, >50% of real sessions still start outside the daemon.
**B — Distro on dsh.** Paradigm Harness = a deepseek-harness profile; Paradigm ships the plugins dsh lacks (symbol graph, notebooks/calibration, lore/decisions, Warpline). Claude Code/Codex as backends; local models trivial. Risk: dsh API churn; its loop vs Claude Code for subscription users. Falsifier: any week the founder prefers Claude Code for real work, or two breaking Cordis changes in a month.
**C — Overlay: pure Mods, no daemon.** Harness = Mods + hooks + skills + MCP; armada coordinated through files (score/, .warpline/, worktrees). Zero new processes. Risk: Mods can't host persistent panes fed by out-of-process events. Falsifier: Mod can't subscribe to an external event source, or the admin allowlist blocks 8.1 distribution.

## Named asks in Shape A
- Harness: `packages/heddle` — one `claude -p` driver (lift constellation's, delete flow's and Conductor's), HMAC per-agent tokens, session keyed by Claude uuid.
- Mods/displays: one display envelope (constellation Admin blocks + conductor-visual + paradigm_platform), rendered first by a Claude Code Mod subscribed to daemon SSE; constellation and Conductor render the same envelope.
- Notebook query/consolidation: one `knowledge` syscall over notebooks + neurons + lore with provenance and trust tier; event-count trigger + quiet gate; Steward + neurons tend do the work; classroom certifies.
- Loops: one loop record = goal + round cap + budget + fresh-context policy + eval oracle + stuck detector; every round seals a PICK so progress vs thrash is readable from the fabric; /loop, /schedule, automations, routines become policies over it.
- Interconnected sessions: Symphony Score onto the bus, addressed by uuid, delivered by Mod band + hook injection, the injection logged as a strand.
- Warpline-native armada: `heddle spawn N` gives each session a worktree, agent key (M3-LITE), $WARPLINE_AGENT_ID, warpline skill with F4 descriptors as first-turn self-description, a post-edit hook sealing PICKs, `offer` wired to the daemon. KNOTs → human inbox; resolve HUMAN_ONLY (FG-1). New sessions start in quarantine selvage and earn admission by replayable evidence. "Birth, not onboarding."

## Forgotten pieces (ranked, solo armada)
1. Budget governance (no cost ledger anywhere [inferred]) — "eight sessions without this is a credit-card incident".
2. Replay + evals — calibration has no denominator without it.
3. The human inbox — the founder is the scheduler's bottleneck; one inbox for approvals + KNOTs + questions, with phone presence.
4. Secrets + egress — one broker, per-session egress policy.
5. One identity — one agent key = one notebook = one Warpline signer = one nevr.land profile.
6. Teleport — resume on another machine or cloud; ledger-out-of-git (TD-735) enables it.

## Epiphanies
- The harness is a deletion project before a build project.
- Warpline and the harness are each other's missing half: Warpline's denominator is empty (zero KNOTs, one serial human); only an armada produces contested verdicts. The harness is Warpline's instrument; Warpline is the harness's merge law.
- The gap list equals dsh's refusal list.
- "Model-visible ⟺ logged" and "transfer ≠ admission" are the same law at two layers.
- Odysseus's teacher flywheel is the classroom with roles inverted — more supply, same gate.
- The Claude Code session uuid is already the shared primary key [inferred]; adopt it as the pid.

## Recommendation
Shape A, Heddle. "Claude Code is the shell; we ship the kernel it never had: one ledger, one identity, one scheduler, and every session Warpline-native from birth."
First three moves (two weeks):
1. Delete two runners — extract constellation's driver into the daemon; flow and constellation consume it. Pass: both on one code path.
2. `spawn` on a real repo — four Warpline-native worktree sessions. Pass: the first KNOT in Warpline's history, hydrated, zero W3.
3. One Mod band + logged injections. Pass: replaying a session from strands reproduces its context.

## Names
Heddle (one per session; the harness is the frame) · Jacquard (programmable loom; punch cards were the first flows) · Shuttle (carries weft between threads) · Treadle (the human's foot on the loom = HUMAN_ONLY) · Orrery (many bodies in concert; fits constellation/neurons).

## Tensions with Arky (to resolve)
1. Kernel ledger: Fable = Warpline fabric widened to session events; Arky = flow-style hash chain as the one envelope, fabric stays its own store referenced via `ref.foreign`.
2. F4: Fable injects the warpline skill + F4 descriptors on the first turn; Arky says the kernel must inject at most one pointer line, or F4 measures the harness instead of Warpline.
3. Session id: Fable adopts the Claude uuid as the pid; Arky issues a kernel `hsid` with the Claude uuid as an attribute (other backends have none; respawns change uuids).
4. Conductor runner: Fable deletes it; Arky migrates it onto the TS runner (and drops --dangerously-skip-permissions).

## Spec-as-contract (P8-R2), from Fable's second version
- Specs under `.paradigm/specs/` already name `#components`, `$flows`, `^gates` (prose with refs; no compile step exists [inferred]).
- Add a compile step: `paradigm pipeline` stage `plan` emits a **contract** = expected symbols, flows, gates and tests, each a task-DAG node with an acceptance oracle (test id, gate check, ripple-clean).
- Progress = `exists AND passes` over contract nodes, rendered as a diagram whose nodes light up as PICKs are admitted.
- The fleet claims nodes by compare-and-set (dsh task-graph pattern), builds in worktrees, offers.
- Checks and balances = three independent oracles per node: tests (can't lie), Warpline admission (meaning), and a reviewer agent that did not build it. Done only when all three agree; disagreement fails closed into a KNOT.
- Revised move 2: four Warpline-native sessions against one compiled contract from a real spec. Proof: the first KNOT in Warpline's history AND a progress diagram that moves without a human editing it.
- Revised move 3 adds: flip `appliedCount` to count attribution in an admitted PICK, so "the 384/396 number changes for a reason you can replay".
- Second version also names Shape B "Bolt" and Shape C "Shuttle", and the daemon package `packages/harness` with CLI `pd spawn N`.
