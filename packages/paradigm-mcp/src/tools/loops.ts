/**
 * #loop-mcp — the `paradigm_loop` family (docs/specs/gnomon-loops.md §5; build plan LP1).
 *
 * ON-DEMAND tier, key `loops`, detector `loops` (`.paradigm/loops/` present). File ops only, no kernel:
 *   create   — write a new `.paradigm/loops/<id>.yaml` (yaml text, a definition object, or an example template)
 *   update   — replace an existing one
 *   validate — validate one loop (id) or all, writing each compiled `<id>.loop.json` on success (all also
 *              removes orphan compiled JSON whose YAML is gone)
 *   list     — every repo loop with its validity and compiled state, plus orphan compiled JSON
 *   get      — one loop's YAML, issues and compiled JSON
 * An invalid definition is never written. Writing a file never makes a loop run: the Gnomon kernel runs a loop
 * only after a human trusts its exact content hash (LL1).
 *
 * Kernel ops (LP7, build step 12), through #gnomon-ts-client (`@a-company/gnomon/agent`) as the AGENT principal,
 * each a `loop.request{op}` the kernel's #loop-agent-ops pre-gate judges (principal and hsid from the connection):
 *   run          a trusted loop now (manual trigger, budgets apply)
 *   pause        any loop (narrowing)
 *   resume       only a loop this agent paused itself, never after a kernel pause
 *   delete       in 8.0 never deletes: the kernel pauses the loop and asks the founder
 *   runs, logs   redacted reads (verdicts and counts, never evidence)
 *   trust_status who trusted which version and when
 * create/update also send `loop.request{op, sourceHash}` so the kernel attributes the file to this agent and raises
 * its one loop-trust card. Without a kernel the file op still succeeds and says "needs Gnomon running".
 */
import type { ProjectContext } from '../utils/index-loader.js';
import type { ToolDefinition } from '../utils/tool-registry.js';
import { log } from '../utils/mcp-logger.js';
import {
  getLoop,
  isLoopId,
  listLoops,
  orphanLoopJson,
  loopTemplate,
  defaultTemplateFlow,
  loopYamlPath,
  validateAllLoops,
  validateLoopFile,
  writeLoop,
  LOOP_EXAMPLE_NAMES,
  type LoopExampleName,
} from '../utils/loop-files.js';
import { trackToolCall } from './context.js';

export const LOOP_FILE_TOOL_NAMES = ['paradigm_loop_create', 'paradigm_loop_update', 'paradigm_loop_validate', 'paradigm_loop_list', 'paradigm_loop_get'] as const;
export const LOOP_KERNEL_TOOL_NAMES = ['paradigm_loop_run', 'paradigm_loop_pause', 'paradigm_loop_resume', 'paradigm_loop_delete', 'paradigm_loop_runs', 'paradigm_loop_logs', 'paradigm_loop_trust_status'] as const;
export const LOOP_TOOL_NAMES = [...LOOP_FILE_TOOL_NAMES, ...LOOP_KERNEL_TOOL_NAMES] as const;

/** The kernel's loop.request door (tests inject one; default `@a-company/gnomon/agent`). Throws when no kernel. */
export type LoopKernelPort = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
const NEEDS_GNOMON = 'needs Gnomon running';

let kernelPort: LoopKernelPort | null = null;
/** Tests: replace (or with null, restore) the kernel port. */
export function setLoopKernelPort(p: LoopKernelPort | null): void {
  kernelPort = p;
}

async function kernel(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    if (kernelPort) return await kernelPort(payload);
    const mod = (await import('@a-company/gnomon/agent')) as { loopRequest: LoopKernelPort };
    return await mod.loopRequest(payload);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    log.component('#loop-mcp').warn('Loop kernel op unavailable', { op: payload.op, error: msg.slice(0, 200) });
    return { error: msg.startsWith(NEEDS_GNOMON) ? msg : `${NEEDS_GNOMON}: ${msg.slice(0, 200)}`, needsGnomon: true };
  }
}

const loopTarget = { id: { type: 'string', description: 'Loop id (kebab-case)' }, personal: { type: 'boolean', description: 'A personal loop (~/.gnomon/loops) instead of this repo' } };

const TRUST_NOTE = 'Nothing runs until a human trusts this exact definition in Gnomon (one loop-trust card).';

export function getLoopsToolsList(): ToolDefinition[] {
  return [
    {
      name: 'paradigm_loop_create',
      description: 'Create .paradigm/loops/<id>.yaml (loop:v2) from yaml, a definition object or an example; validated first, compiled JSON written beside it. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Loop id (kebab-case); defaults to the definition id' },
          yaml: { type: 'string', description: 'loop:v2 YAML text' },
          definition: { type: 'object', description: 'loop:v2 definition as an object' },
          example: { type: 'string', enum: [...LOOP_EXAMPLE_NAMES], description: 'Start from a template (needs id)' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_update',
      description: 'Replace an existing loop definition; validated first, compiled JSON rewritten. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Loop id' },
          yaml: { type: 'string', description: 'loop:v2 YAML text' },
          definition: { type: 'object', description: 'loop:v2 definition as an object' },
        },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_validate',
      description: 'Validate one loop (id) or all; writes each compiled <id>.loop.json on success. ~200 tokens.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Loop id (default: all)' } } },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_list',
      description: 'Repo loops with validity and compiled state (fresh, stale, missing). ~200 tokens.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_get',
      description: 'One loop: YAML, issues and compiled JSON. ~500 tokens.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Loop id' } }, required: ['id'] },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_run',
      description: 'Run a TRUSTED loop now through Gnomon (manual trigger, budgets apply). Needs Gnomon running. ~100 tokens.',
      inputSchema: { type: 'object', properties: loopTarget, required: ['id'] },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_pause',
      description: 'Pause any loop (a run in flight stops before its next step). Needs Gnomon running. ~100 tokens.',
      inputSchema: { type: 'object', properties: loopTarget, required: ['id'] },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_resume',
      description: 'Resume a loop YOU paused; a kernel or human pause needs the founder. Needs Gnomon running. ~100 tokens.',
      inputSchema: { type: 'object', properties: loopTarget, required: ['id'] },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_delete',
      description: 'Ask to delete a loop: in 8.0 the kernel pauses it and the founder decides. Needs Gnomon running. ~100 tokens.',
      inputSchema: { type: 'object', properties: loopTarget, required: ['id'] },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: 'paradigm_loop_runs',
      description: 'A loop\'s recent runs: verdicts, rounds and counts (never evidence). Needs Gnomon running. ~300 tokens.',
      inputSchema: { type: 'object', properties: { ...loopTarget, limit: { type: 'number', description: 'Max runs (≤ 50, default 20)' } }, required: ['id'] },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_logs',
      description: 'One run\'s node visits, verdicts and edges (never evidence). Needs Gnomon running. ~400 tokens.',
      inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'Run id (lr-…, from paradigm_loop_runs)' }, personal: loopTarget.personal }, required: ['runId'] },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_loop_trust_status',
      description: 'Who trusted which loop version and when (one loop, or all). Needs Gnomon running. ~300 tokens.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Loop id (default: all)' }, personal: loopTarget.personal } },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
  ];
}

/** The loop.request target: this repo's loop (or a personal one). */
function targetOf(rootDir: string, args: Record<string, unknown>): Record<string, unknown> | { error: string } {
  if (!isLoopId(args.id)) return { error: 'id is required (kebab-case, ≤ 64 characters)' };
  return args.personal === true ? { loopId: args.id, scope: 'personal' } : { loopId: args.id, scope: 'repo', repo: rootDir };
}

/** One kernel op as the agent principal (exported for tests). Without a kernel: `{error: 'needs Gnomon running…'}`. */
export async function runLoopKernelOp(rootDir: string, op: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  // reads are scoped to a repo the agent names (this repo, or personal loops); the kernel never lists all repos
  const where = args.personal === true ? { scope: 'personal' } : { scope: 'repo', repo: rootDir };
  if (op === 'logs') {
    if (typeof args.runId !== 'string' || !/^lr-[0-9a-z-]{1,60}$/.test(args.runId)) return { error: 'runId is required (lr-…, from paradigm_loop_runs)' };
    return kernel({ op: 'logs', runId: args.runId, ...where });
  }
  if (op === 'trust_status') {
    if (args.id === undefined) return kernel({ op: 'trust-status', ...where });
    const t = targetOf(rootDir, args);
    return 'error' in t ? t : kernel({ op: 'trust-status', ...t });
  }
  const t = targetOf(rootDir, args);
  if ('error' in t) return t;
  if (op === 'runs') {
    const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : undefined;
    return kernel({ op: 'runs', ...t, ...(limit ? { limit } : {}) });
  }
  return kernel({ op, ...t });
}

/**
 * create/update: after the file is written, tell the kernel this agent wrote that exact definition (its compiled
 * source hash), so the trust card and the loop's slip say who wrote it. Never trusts anything.
 */
async function attribute(rootDir: string, op: 'create' | 'update', r: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (r.written !== true || typeof r.id !== 'string' || typeof r.sourceHash !== 'string') return r;
  const k = await kernel({ op, loopId: r.id, scope: 'repo', repo: rootDir, sourceHash: r.sourceHash });
  return { ...r, kernel: k };
}

/** Run one file op (exported for tests and the CLI's parity checks). */
export function runLoopOp(rootDir: string, op: string, args: Record<string, unknown>): Record<string, unknown> {
  try {
    return runLoopOpUnsafe(rootDir, op, args);
  } catch (e) {
    // refused filesystem shapes (symlinks, a loops dir outside the repo) come back as plain errors
    log.component('#loop-mcp').warn('Loop op refused', { op, error: (e as Error).message });
    return { error: (e as Error).message };
  }
}

function runLoopOpUnsafe(rootDir: string, op: string, args: Record<string, unknown>): Record<string, unknown> {
  const id = typeof args.id === 'string' ? args.id : undefined;
  const yamlText = typeof args.yaml === 'string' ? args.yaml : undefined;
  switch (op) {
    case 'create': {
      let text = yamlText;
      if (args.example !== undefined) {
        if (!(LOOP_EXAMPLE_NAMES as readonly string[]).includes(args.example as string)) return { error: `example is one of ${LOOP_EXAMPLE_NAMES.join(', ')}` };
        if (!isLoopId(id)) return { error: 'an example needs an id (kebab-case, ≤ 64 characters)' };
        text = loopTemplate(id, args.example as LoopExampleName, defaultTemplateFlow(rootDir));
      }
      const r = writeLoop(rootDir, 'create', { id, yaml: text, definition: args.definition });
      return 'error' in r ? r : { ...r, written: r.ok, ...(r.ok ? { note: TRUST_NOTE } : {}) };
    }
    case 'update': {
      if (!isLoopId(id)) return { error: 'id is required (kebab-case, ≤ 64 characters)' };
      const r = writeLoop(rootDir, 'update', { id, yaml: yamlText, definition: args.definition });
      return 'error' in r ? r : { ...r, written: r.ok, ...(r.ok ? { note: TRUST_NOTE } : {}) };
    }
    case 'validate': {
      if (id !== undefined) {
        if (!isLoopId(id)) return { error: 'id must be kebab-case, ≤ 64 characters' };
        return { results: [validateLoopFile(rootDir, loopYamlPath(rootDir, id))] };
      }
      const all = validateAllLoops(rootDir);
      return { ...all, ok: all.results.every((r) => r.ok) };
    }
    case 'list':
      return { loops: listLoops(rootDir), orphans: orphanLoopJson(rootDir) };
    case 'get':
      if (id === undefined) return { error: 'id is required' };
      return getLoop(rootDir, id) as Record<string, unknown>;
    default:
      return { error: `unknown op ${op}` };
  }
}

export async function handleLoopsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  if (!(LOOP_TOOL_NAMES as readonly string[]).includes(name)) return { handled: false, text: '' };
  const op = name.slice('paradigm_loop_'.length);
  let result: Record<string, unknown>;
  try {
    if ((LOOP_KERNEL_TOOL_NAMES as readonly string[]).includes(name)) result = await runLoopKernelOp(ctx.rootDir, op, args ?? {});
    else {
      result = runLoopOp(ctx.rootDir, op, args ?? {});
      if (op === 'create' || op === 'update') result = await attribute(ctx.rootDir, op, result);
    }
  } catch (e) {
    log.component('#loop-mcp').warn('Loop tool error', { op, error: (e as Error).message });
    result = { error: (e as Error).message };
  }
  const text = JSON.stringify(result, null, 2);
  trackToolCall(text.length, name);
  return { handled: true, text };
}
