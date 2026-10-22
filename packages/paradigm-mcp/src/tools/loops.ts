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
 * only after a human trusts its exact content hash (LL1). Kernel ops (run, pause, resume, trust-status …) land
 * with LP7 through #gnomon-ts-client.
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

export const LOOP_TOOL_NAMES = ['paradigm_loop_create', 'paradigm_loop_update', 'paradigm_loop_validate', 'paradigm_loop_list', 'paradigm_loop_get'] as const;

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
  ];
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
    result = runLoopOp(ctx.rootDir, op, args ?? {});
  } catch (e) {
    log.component('#loop-mcp').warn('Loop tool error', { op, error: (e as Error).message });
    result = { error: (e as Error).message };
  }
  const text = JSON.stringify(result, null, 2);
  trackToolCall(text.length, name);
  return { handled: true, text };
}
