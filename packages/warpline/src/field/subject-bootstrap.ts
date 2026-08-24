/**
 * #field-subject-bootstrap — one-shot onboarding for the field-test SUBJECT (the
 * founder's forthcoming Expo app), expo-field-test-protocol-v2.md §A2/§A3 + runbook
 * §0. It SCAFFOLDS and INSTRUCTS; it does NOT act. Specifically it does NOT run
 * `warpline init` and does NOT mint agent keys — both are deliberate human acts
 * (the run log records the launch command; keys are minted in the operator shell).
 *
 * It writes, under the subject repo's `.warpline/field/`:
 *   1. `greengate.json` — the v2 §A3 starter declared gate (tsc --noEmit + expo
 *      export) with an empty behavioral block the operator fills. readGreenGate
 *      parses it (asserted in test). Idempotent: refuses to clobber an existing
 *      greengate.json unless `force`.
 *   2. `behavioral-checklist.template.md` — a stub the operator authors into the
 *      frozen behavioral oracle (its assertions enumerate the config×code
 *      couplings; a coupling not listed is BLIND, not passed).
 *
 * And it RETURNS (for the CLI to print) the ordered runbook §0 pre-run checklist,
 * each item tagged auto (a `warpline`/tool step) or manual (a human decision/act),
 * plus the load-bearing reminder that agent keys must be minted BEFORE agents
 * propose (Build-D fixture finding: an unkeyed proposal is refused).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { greenGatePathOf, type GreenGateConfig } from './oracle.js';

/** The v2 §A3 starter declared gate: typecheck + bundle, empty behavioral to fill. */
export const STARTER_GREENGATE: GreenGateConfig = {
  checks: [
    { name: 'typecheck', cmd: 'npx', args: ['tsc', '--noEmit'] },
    { name: 'bundle', cmd: 'npx', args: ['expo', 'export'] },
  ],
  behavioral: { script: '', assertions: [] },
};

const BEHAVIORAL_TEMPLATE = `# Behavioral oracle checklist — SUBJECT (frozen before admission 1)

> v2 §A3 / §4 step 3. Author this into greengate.json's \`behavioral\` block, then
> FREEZE it. Each assertion is a PRE-DECLARED config×code coupling the oracle runs
> as \`<script> <assertion>\` on both parents then the merge. A coupling NOT listed
> here is BLIND — it is not passed, it is untested. Do not add assertions mid-run.

## script

The single entrypoint the oracle invokes per assertion (e.g. \`node ./field/assert.mjs\`).
It receives one assertion name as its argument and exits 0 (pass) / non-zero (fail).

    script:

## assertions (enumerate every config×code coupling)

- [ ] <coupling-1> — e.g. "app.json scheme matches the deep-link handler in src/nav"
- [ ] <coupling-2> — e.g. "eas.json build profile env matches the API base URL constant"
- [ ] <coupling-3> — ...

Couplings not listed above are BLIND (readiness doc §D overlap zones Z1–Z4).
`;

/** One pre-run gate line + whether it is a tool step (auto) or a human act (manual). */
export interface ChecklistItem {
  text: string;
  mode: 'auto' | 'manual';
}

export interface InitSubjectResult {
  root: string;
  greengatePath: string;
  /** true iff greengate.json was written this call (false = left an existing one intact). */
  greengateWritten: boolean;
  /** set when a greengate.json already existed and `force` was not given. */
  greengateSkippedReason?: string;
  checklistTemplatePath: string;
  checklistTemplateWritten: boolean;
  /** the ordered runbook §0 pre-run gates, each tagged auto/manual. */
  checklist: ChecklistItem[];
  /** load-bearing reminders the operator must act on (keys-before-propose, etc.). */
  reminders: string[];
}

/** The ordered runbook §0 pre-run checklist, tagged auto (tool) / manual (human). */
export function preRunChecklist(): ChecklistItem[] {
  return [
    { text: 'Founder gates F1–F7 closed; pre-registration v2 ratified + the §C freeze checklist fully checked', mode: 'manual' },
    { text: 'Subject prepared: npm install; `npx tsc --noEmit` GREEN at base; `npx expo export` succeeds', mode: 'auto' },
    { text: 'Declared green-gate frozen in .warpline/field/greengate.json; behavioral checklist authored + frozen', mode: 'manual' },
    { text: '.warpline onboarded on the subject (`warpline init`); .warpignore covers agent worktrees; daemon up; one MCP token per instance', mode: 'manual' },
    { text: 'Habit (i): every agent reaches Warpline ONLY via the daemon MCP surface; agent Claude Code permissions DENY Bash(warpline*)/Bash(node*cli.js*)/raw git writes and ALL reads+writes of .warpline/keys/** and .warpline/grants/**', mode: 'manual' },
    { text: 'Agent keys MINTED before any agent proposes (an unkeyed proposal is REFUSED — Build-D fixture finding)', mode: 'manual' },
    { text: 'Agents launched with the pinned model `claude --model claude-opus-4-8`; launch command recorded in the run log', mode: 'manual' },
    { text: 'Judge credentials present in the JUDGE operator shell only (never any agent env); @anthropic-ai/sdk installed', mode: 'manual' },
    { text: 'Seeds sealed BEFORE the run — `warpline field seed corpus`, `warpline field seed planted`, and (post-first-KNOTs) `warpline field seed classify`; commit each sealed set sha256 to git', mode: 'auto' },
    { text: 'Verify the seal — `warpline field seed verify` reports every sealed dir loads through the run\'s own loader (§C condition (c))', mode: 'auto' },
    { text: 'Backlog fixed before the run with overlap zones Z1–Z4 (overlap in the WORK, never the verdict)', mode: 'manual' },
    { text: 'No `warpline grant auto-resolve` active on the subject fabric (fail-closed arm; v2 §A11)', mode: 'manual' },
    { text: 'Live judge regression run once: `WARPLINE_JUDGE_LIVE=1 npx vitest run test/judge-regression.test.ts`', mode: 'auto' },
  ];
}

const KEY_REMINDER =
  'MINT AGENT KEYS BEFORE ANY AGENT PROPOSES. A proposal from an unkeyed agent is refused ' +
  '(Build-D fixture finding); minting is a deliberate HUMAN act in the operator shell — this ' +
  'bootstrap does NOT mint keys and does NOT run `warpline init`.';

const SEAL_REMINDER =
  'Seal + COMMIT the seed/corpus sha256 to git before admission 1 (v2 §C). Genuine/over-block ' +
  'seeds are authored AFTER the subject produces contested cards — run `warpline field seed classify` then.';

/**
 * Scaffold the subject repo for the field test. Writes greengate.json (idempotent:
 * refuses to clobber unless `force`) and the behavioral-checklist template, and
 * returns the ordered pre-run checklist + reminders for the CLI to print. Never runs
 * `warpline init`, never mints keys — those are deliberate human acts.
 */
export function initSubject(root: string, opts: { force?: boolean } = {}): InitSubjectResult {
  const greengatePath = greenGatePathOf(root);
  const fieldDir = path.dirname(greengatePath);
  fs.mkdirSync(fieldDir, { recursive: true });

  let greengateWritten = false;
  let greengateSkippedReason: string | undefined;
  if (fs.existsSync(greengatePath) && !opts.force) {
    greengateSkippedReason =
      `greengate.json already exists at ${greengatePath} — refusing to overwrite a frozen gate (use --force to replace)`;
  } else {
    fs.writeFileSync(greengatePath, JSON.stringify(STARTER_GREENGATE, null, 2) + '\n', 'utf8');
    greengateWritten = true;
  }

  const checklistTemplatePath = path.join(fieldDir, 'behavioral-checklist.template.md');
  let checklistTemplateWritten = false;
  if (!fs.existsSync(checklistTemplatePath) || opts.force) {
    fs.writeFileSync(checklistTemplatePath, BEHAVIORAL_TEMPLATE, 'utf8');
    checklistTemplateWritten = true;
  }

  return {
    root,
    greengatePath,
    greengateWritten,
    greengateSkippedReason,
    checklistTemplatePath,
    checklistTemplateWritten,
    checklist: preRunChecklist(),
    reminders: [KEY_REMINDER, SEAL_REMINDER],
  };
}
