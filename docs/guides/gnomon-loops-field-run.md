# Gnomon loops: one-week field run

A week of real loops on this repo, before 8.0 ships (build plan step 14, LP9). The aim is to see loops run unattended, raise the right cards, stay inside their budgets and never surprise you.

In 8.0 a loop never lands anything by itself. When a loop changes code, the change comes to you as a propose card. Nothing reaches your branch until you accept it (TD-2026-10-22-369).

## 1. What to enable

Three templates, all local-model only:

| Loop | Template | What it does | Changes files? |
|---|---|---|---|
| `flow-health-symbols` | `flow-health` (Example A) | Daily at 07:30, and 5 min after a change under `$symbol-aggregation`: flow check, `.purpose` validation, drift. A local model summarizes a failure into the toast. | No |
| `evening-tidy` | `tidy` (Example D) | Daily at 18:30, or once on the next start if it was missed: rebuilds the symbol index and validates `.purpose` files on a private copy, then sends a summary toast. | No |
| `green-gnomon` | `green` (Example B) | Daily at 02:00: `tsc -p packages/gnomon/tsconfig.json`. On a failure a local act step fixes `packages/gnomon/src/**` in a scratch copy, for up to 8 rounds. | Proposes only |

Create them from the repo root of the checkout Gnomon runs in:

```sh
paradigm loop new flow-health-symbols --template flow-health --flow '$symbol-aggregation'
paradigm loop new evening-tidy --template tidy
paradigm loop new green-gnomon --template green --dir packages/gnomon
paradigm loop list
```

Each command writes `.paradigm/loops/<id>.yaml` and the compiled `<id>.loop.json` that the kernel reads. Commit them, so they stay the same all week. Any edit to a loop, or to a file its checks read (such as `tsconfig.json` or the lockfile), pauses it until you trust it again.

**Before you start:**
- Gnomon must run from the clone install (`npm run gnomon:install`). Builtin checks run the paradigm CLI from this clone, and the signed app alone has none, so its builtins fail closed. Build paradigm first (`npm run build -w @a-company/paradigm`). If you rebuild it during the week, restart Gnomon.
- Set up the local model, and let loops use it. Open **Settings → Local model** (being designed) and choose *Sessions and loops*; the raw form is `gnomon local set --model <id> --loops` (default endpoint Ollama on `http://127.0.0.1:11434`; loopback only in 8.0, LAN endpoints land in 8.1). Gnomon checks the server first, then raises a card you allow with your presence and the root key; the config applies at once, with no restart. The gnomon-local runner ships with Gnomon, so nothing is built. Without a config whose endpoint says loops may use it, a loop with a model node **refuses to start** (`no-local-model`): its run never begins, the refusal is logged, and the stack shows "■ <loop> didn't start" until a config applies. `gnomon local status` shows what is set.

## 2. Trust them in the GUI

Nothing runs until you trust a loop's exact content.

1. Open **Loops** from the palette (`loops.open`) or the wordmark menu. The new loops show under "loops waiting for trust".
2. Choose **Review**, then **Trust**. This raises a `loop-trust` card. It lists every node, command and its hash, the model, the budgets, the triggers and the land paths. For `green-gnomon` it also says "Proposes changes to your current branch; nothing lands until you accept the card."
3. Allow the card with presence. A trust card is never standing and never by voice.

From the CLI, `gnomon loop trust <id>` raises the same card. `gnomon loop trust-status` shows who trusted which version, and when.

While any loop is enabled, Gnomon keeps running with its window closed ("Loops are keeping Gnomon running"). Cmd-Q stops it, and a stopped Gnomon runs no loops. Background start at login comes in 8.1.

## 3. What to watch

- **Runs timeline.** In a loop's detail, each run shows its node visits, verdicts, the model used, and the edge taken. CLI: `gnomon loop runs <id>`, then `gnomon loop logs <runId>`.
- **Propose cards.** A `green-gnomon` change arrives as a verdict card with the diff. Accept needs fresh presence and lands the change on your current branch. Reject drops it. If the land has to wait (a dirty file on a touched path, a turn in flight, an `index.lock`), the loop shows waiting-land. After 120 minutes the change is parked at `refs/gnomon/loops/<id>/<runId>` and you get a toast.
- **Budgets.** Each row shows today's spend against its caps and "local only". When a run hits a cap it stops, and the loop pauses with the reason `budget`. Resuming it needs presence.
- **Pauses.** A pause always names its reason: content or closure changed, thrash (three rounds with the same evidence), strictness, the kill switch. Kernel pauses need you to resume.
- **Pause all** in the Loops header (or `gnomon loop pause --all`) is the kill switch. It stops every run at once and asks for no presence. Resuming a loop afterwards does.

Each day, check:
- Did each scheduled run fire once, on time?
- Did any toast or card say something you could not act on?
- Did anything touch your working tree without a card you accepted? That must never happen. Report it at once.

## 4. Report problems

- **Anything that lands, edits or pauses without the card the docs promise.** Press **Pause all** first, then report with high priority.
- **Everything else** (a confusing card, a wrong verdict, a missed fire, a noisy trigger, a budget that feels wrong) goes in one task per finding:

  ```
  paradigm_task({op:'create', blurb: "loops field run: <what happened>. Loop <id>, run <runId>", priority: "medium", tags: ["loops-field-run", "#loop-runner"]})
  ```

  Add the run id from `gnomon loop runs <id>`, and the card text or a screenshot. Use `#loop-templates` for a template's wording or defaults, and `#gui-loops` for the Loops view.
- **A framework bug**, where you can name the writer and reader lines that disagree, follows the framework-bug protocol in `CLAUDE.md`.

At the end of the week, collect the `loops-field-run` tasks for the 8.0 go or no-go.
