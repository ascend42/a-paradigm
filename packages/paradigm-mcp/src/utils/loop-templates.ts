/**
 * #loop-templates — the `loop:v2` starting points behind `paradigm loop new <id> --template <name>` and
 * `paradigm_loop({op:'create', template})` (docs/specs/gnomon-loops.md §2 Examples A-D, §9 LP9; build plan step 14).
 *
 * Every template is valid under the 8.0 validator: local models only (no `claude` block, `escalate: never`), no
 * cron or sentinel triggers, no `bash` tools, no write checks (the runner refuses `effect: write` in 8.0). The
 * wording fits approve-to-land (TD-2026-10-22-369): an act template says its change comes to the human as a
 * propose card and nothing lands until they accept it; no template promises to land on its own.
 *
 * Parameters are interpolated into YAML, so each is checked against a closed pattern first (TemplateParamError).
 * Writing a template never makes it run: Gnomon runs a loop only after a human trusts its exact content hash.
 */

export const LOOP_TEMPLATE_NAMES = ['flow-health', 'green', 'watch', 'tidy'] as const;
export type LoopTemplateName = (typeof LOOP_TEMPLATE_NAMES)[number];

/** One line per template, for help text and listings. */
export const LOOP_TEMPLATES: Readonly<Record<LoopTemplateName, { example: string; summary: string }>> = Object.freeze({
  'flow-health': { example: 'A', summary: 'read-only checks on one flow (flow, .purpose, drift); a local model summarizes a failure' },
  green: { example: 'B', summary: 'fix until tsc passes with a local act step; every change comes to you as a propose card' },
  watch: { example: 'C', summary: 'a local judge classifies file changes on one flow (sentinel triggers land in 8.1)' },
  tidy: { example: 'D', summary: 'evening report: rebuild the index and validate .purpose files on a private copy; changes no file' },
});

export interface LoopTemplateParams {
  /** The flow flow-health and watch serve (`$flow-id`). */
  flow?: string;
  /** The directory green typechecks (`tsc -p <dir>/tsconfig.json`), repo-relative; default the repo root. */
  dir?: string;
}

export class TemplateParamError extends Error {}

const FLOW_RE = /^\$[a-z0-9][a-z0-9-]{0,63}$/;
const DIR_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function isTemplateName(v: unknown): v is LoopTemplateName {
  return typeof v === 'string' && (LOOP_TEMPLATE_NAMES as readonly string[]).includes(v);
}

/** A flow id a template may name (kebab-case after `$`). */
export function checkTemplateFlow(flow: string): string {
  if (!FLOW_RE.test(flow)) throw new TemplateParamError(`a flow is $kebab-id (got ${JSON.stringify(flow).slice(0, 80)})`);
  return flow;
}

/** A repo-relative directory a template may name: plain path words, no `..`, no glob or quote characters. */
export function checkTemplateDir(dir: string): string {
  const d = dir.replace(/\/+$/, '');
  if (d === '' || d === '.') return '.';
  if (!DIR_RE.test(d) || d.split('/').some((w) => w === '.' || w === '..' || w === 'node_modules')) {
    throw new TemplateParamError(`a directory is repo-relative, like packages/gnomon (got ${JSON.stringify(dir).slice(0, 80)})`);
  }
  return d;
}

/** YAML for `paradigm loop new <id> [--template …]`; no name gives the minimal starter. */
export function loopTemplate(id: string, name?: LoopTemplateName, params: LoopTemplateParams = {}): string {
  const flow = checkTemplateFlow(params.flow ?? '$example-flow');
  switch (name) {
    case 'flow-health':
      return `# Flow health check (spec Example A). Read-only checks on ${flow}, on a private copy of the repo;
# a local model summarizes a failure. It changes no file.
schema: loop:v2
id: ${id}
title: Flow health ${flow}
flows: [${flow}]
triggers:
  - schedule: { daily: "07:30" }
  - event: { kind: file.changed, flow: ${flow} }
    debounce: 5m
autonomy: observe
notify: { on: [fail], as: toast }
budgets: { run: { wallMin: 15, computeSec: 300 }, day: { runs: 12 } }
goal: { node: drift, verdict: pass }
start: defn
nodes:
  - { id: defn, type: check, builtin: paradigm.flow-check, args: { flowId: ${flow}, checkImplementation: true }, on: { pass: gates, fail: why } }
  - { id: gates, type: check, builtin: paradigm.purpose-validate, on: { pass: drift, fail: why } }
  - { id: drift, type: check, builtin: paradigm.drift, args: { symbols: [${flow}] }, on: { pass: '@goal', fail: why } }
  - { id: why, type: model, role: summarize, model: { use: local }, inputs: [last.evidence], on: { any: tell } }
  - { id: tell, type: notify, as: toast, text: "{{loop.id}} failed at {{failed.node}}", attach: [why.text], on: { any: '@stop' } }
`;
    case 'green': {
      const dir = checkTemplateDir(params.dir ?? '.');
      const at = dir === '.' ? '' : `${dir}/`;
      const inputs = dir === '.' ? '["tsconfig*.json"]' : `["${at}tsconfig*.json", "tsconfig*.json"]`;
      return `# Fix until green (spec Example B, local model). A local act step edits a scratch copy until
# tsc passes for ${dir === '.' ? 'the repo' : dir}. Its change comes to you as a propose card: nothing lands on
# your branch until you accept it. argv0 is a direct binary, never npx. -p names the tsconfig file, not the
# directory: a path the check names is protected from act edits, and a directory would protect all of it.
schema: loop:v2
id: ${id}
title: Typecheck green ${dir === '.' ? '(repo)' : dir}
triggers:
  - schedule: { daily: "02:00" }
autonomy: act
budgets: { run: { rounds: 8, wallMin: 60, tokens: 400k }, day: { runs: 1 } }
goal: { node: tsc, verdict: pass, inputs: ${inputs} }
land: { paths: ["${at}src/**"], message: "fix: typecheck green${dir === '.' ? '' : ` in ${dir}`} (loop proposal)" }
start: tsc
nodes:
  - { id: tsc, type: check, run: [node_modules/.bin/tsc, -p, ${at}tsconfig.json, --noEmit], pass: { parse: tsc, failed: 0 }, on: { pass: '@goal', fail: fix } }
  - id: fix
    type: model
    role: act
    model: { use: local }
    tools: [read, edit]
    inputs: [tsc.evidence]
    exit: { maxVisits: 8, maxFailStreak: 3 }
    on: { pass: tsc, fail: tsc, unsure: ask, unavailable: ask }
  - { id: ask, type: notify, as: card, choices: [continue, stop], on: { continue: fix, stop: '@stop', timeout: '@pause' } }
`;
    }
    case 'watch':
      return `# Watcher (spec Example C on a file trigger; the sentinel trigger lands in 8.1). A local judge classifies
# the change. It changes no file. To hand off to a fix loop add a call node: { id: fix, type: call, loop: <loop-id>@<hash8> }.
schema: loop:v2
id: ${id}
triggers:
  - event: { kind: file.changed, flow: ${flow} }
    debounce: 1m
autonomy: observe
budgets: { run: { wallMin: 20 }, day: { runs: 20 } }
start: triage
nodes:
  - { id: triage, type: model, role: judge, model: { use: local }, inputs: [trigger.payload], verdict: { classes: [regression, other] }, on: { any: tell } }
  - { id: tell, type: notify, as: toast, text: "change {{trigger.id}}: {{triage.class}}", on: { any: '@stop' } }
`;
    case 'tidy':
      return `# Evening tidy (spec Example D, 8.0 form). Rebuilds the symbol index and validates the .purpose files on a
# private copy of the repo, then a local model summarizes what they found. It reports only and changes no file:
# refreshing the index on your branch needs write checks, which come after 8.0.
schema: loop:v2
id: ${id}
title: Evening tidy report
triggers:
  - schedule: { daily: "18:30" }
    catchUp: once
autonomy: observe
budgets: { run: { wallMin: 20, computeSec: 900 }, day: { runs: 1 } }
start: reindex
nodes:
  - { id: reindex, type: check, builtin: paradigm.reindex, on: { any: purpose } }
  - { id: purpose, type: check, builtin: paradigm.purpose-validate, on: { any: digest } }
  - { id: digest, type: model, role: summarize, model: { use: local }, inputs: [reindex.evidence, purpose.evidence], on: { any: tell } }
  - { id: tell, type: notify, as: toast, text: "{{loop.id}}: evening report ready", attach: [digest.text], on: { any: '@stop' } }
`;
    default:
      return `# A loop:v2 definition (docs/specs/gnomon-loops.md §2). Nothing runs until a human trusts it in Gnomon.
schema: loop:v2
id: ${id}
title: ${id}
triggers: []          # manual is always implied; add schedule, event or continuous triggers
autonomy: observe
goal: { node: check, verdict: pass }
start: check
nodes:
  - { id: check, type: check, builtin: git.clean, on: { pass: '@goal', fail: tell } }
  - { id: tell, type: notify, as: toast, text: "{{loop.id}}: the working tree is not clean", on: { any: '@stop' } }
`;
  }
}
