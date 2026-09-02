/**
 * paradigm_retrieve — rehydrate a spilled large payload (#spill).
 *
 * The companion to the generic spill-and-handle primitive (premise-core/spill).
 * Tools that would otherwise dump an unbounded array (a full graph, a worktree
 * `admit`'s changed-symbol set, an agent transcript) instead write the FULL
 * payload to `.paradigm/spill/{handle}.json` and return a bounded preview + the
 * handle. `paradigm_retrieve` fetches the full payload (or a window of it) back.
 */

import { retrieveSpilled, spillDirFor } from '@a-company/premise-core';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';

export function getSpillToolsList() {
  return [
    {
      name: 'paradigm_retrieve',
      description:
        'Rehydrate a large payload that a Paradigm tool SPILLED to disk (`.paradigm/spill/{handle}.json`) instead of dumping inline. Pass the `handle` a prior tool returned (e.g. a `warpline admit` changed-symbol set, a spilled graph). For array payloads, `offset`/`limit` return a bounded window instead of the whole set. Lossless — the full data was written verbatim. ~50 tokens + the window you ask for.',
      inputSchema: {
        type: 'object',
        properties: {
          handle: {
            type: 'string',
            description: 'The spill handle returned by the tool that spilled (e.g. "admit-changed-l9x2-a1b2c3").',
          },
          offset: {
            type: 'number',
            description: 'For array payloads: start index of the returned window (default 0).',
          },
          limit: {
            type: 'number',
            description: 'For array payloads: max items to return from offset (default: to the end).',
          },
        },
        required: ['handle'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      aliases: ['retrieve spill', 'rehydrate', 'get spilled payload', 'expand handle'],
    },
  ];
}

export async function handleSpillTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  if (name !== 'paradigm_retrieve') {
    return { handled: false, text: '' };
  }

  const handle = args.handle as string | undefined;
  if (!handle) {
    const text = JSON.stringify({ error: 'handle is required' }, null, 2);
    trackToolCall(text.length, name);
    return { handled: true, text };
  }

  const offset = typeof args.offset === 'number' ? (args.offset as number) : undefined;
  const limit = typeof args.limit === 'number' ? (args.limit as number) : undefined;

  const result = retrieveSpilled(handle, { dir: spillDirFor(ctx.rootDir), offset, limit });
  const text = JSON.stringify(result, null, 2);
  trackToolCall(text.length, name);
  return { handled: true, text };
}
