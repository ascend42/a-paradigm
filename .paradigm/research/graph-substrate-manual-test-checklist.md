# Manual Test Checklist — Symbol-Graph-as-Discourse-Substrate arc

Running list of everything Matt should hand-verify when the arc is feature-complete.
Built/automated checks (unit tests, builds) are already green; THIS list is the human-eyes/in-app verification.

Design: L-2026-06-17-ascend-181541-001 · Branch: conductor-revival-phase0
Launch the latest: `/Applications/Conductor.app` (rebuilt each phase via build-conductor.sh)

---

## Phase 1 — standalone projector (CLI + MCP) — commit 3d858e0b

- [ ] `paradigm graph slice '#cockpit-view' --format mermaid` shows REAL edges incl. the `$fleet-switch` in-flow edge (was bare before the live-parse fix)
- [ ] `paradigm graph slice '#atrium-decision-card' --as-lightbox` emits a well-formed `conductor-visual` graph envelope (root/nodes/edges/freshness/truncated)
- [ ] Wrong symbol (`paradigm graph slice '#cockpit-veiw'`) → fail-loud "Did you mean" with the right suggestion, no empty render
- [ ] `--radius 2` and `--mode ripple` / `--mode flow` produce sensibly different, still-bounded slices
- [ ] `--format json` topology is byte-identical across two runs (determinism — only the freshness timestamp varies)
- [ ] From a live cockpit session, the agent can call the `paradigm_graph_slice` MCP tool and get a slice back

## Phase 2a — native .graph LIGHTBOX render (static) — commit d256fa93

- [ ] Xcode `#Preview` in `AtriumGraphView.swift` renders the 6-node ego-graph ring
- [ ] Live: paste `paradigm graph slice '#atrium-decision-card' --as-lightbox` output into a session → ▸ launcher → LIGHTBOX opens with the `❖` header → native graph draws
- [ ] Node colors/shapes read legibly at the 380px LIGHTBOX width (Mika mapping: component→ink, flow→blue stadium, gate→amber diamond, signal→teal circle, aspect→violet dashed)
- [ ] Root/focus node is centered with its halo and is visually distinguishable
- [ ] ⌘= / ⌘- (atriumFontScale) scales the graph labels with the rest of the cockpit
- [ ] A dense symbol (one exceeding the degree cap) shows the `truncated` / "+N more" affordance
- [ ] CHORUS rail stays live/mounted underneath while the LIGHTBOX is open (never traded for the diagram)

## Phase 2b+2c — grounding by default + decision symbols + hover spotlight — commit 5689fb70 (Conductor.app build 700)

- [ ] Prompt-behavior: ask the agent about a real 3+-symbol architecture change → it calls `paradigm_graph_slice` and emits a `symbols`-tagged `conductor-decision` + a real graph slice (NOT hand-drawn mermaid)
- [ ] Prompt-discriminator: a greeting / status / single-symbol question → NO graph block (it only fires when topology is the point)
- [ ] Hover an option row with the LIGHTBOX **open on a graph** → that option's `affectedSymbols` light (full saturation + amber ring, lit-to-lit edges amber), the rest dim to ~40%; hover-out eases back over ~150ms
- [ ] Hover with the LIGHTBOX **closed** → no graph effect; card-row hover affordance unaffected
- [ ] Hover an option whose `affectedSymbols` is **empty** → graph stays at rest (no dim)
- [ ] Hover an option whose symbols include the **root** → root + halo stay lit
- [ ] Rapidly sweep across rows → smooth re-spotlight, no flicker, LIGHTBOX does NOT re-animate/re-identify
- [ ] Hover NEVER changes the radio/checkbox selection and never commits; composer never locks (clicking is still the only commit)
- [ ] LIGHTBOX open on a **comparison or flow** visual (not graph) → hover does nothing

<!-- Phase 2d (learning/divergence instrument) items appended on landing -->
