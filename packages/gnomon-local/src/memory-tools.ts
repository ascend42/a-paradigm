/**
 * @symbol #gnomon-local
 * @symbol #local-working-memory
 *
 * Slice B2 (TD-2026-10-27-833): the model's two working-memory tools. The
 * KERNEL owns the memory (packages/gnomon/src/kernel/local/working-memory.ts);
 * the child never stores or renders it. A call goes out as a tool_request
 * through the broker (broker.ts), the kernel validates and applies it, answers
 * with a tool_response and pushes the new block with memory_set.
 *
 *   note{text}  remember one short fact (≤ NOTE_MAX_CHARS); the kernel keeps at
 *               most 16 model notes, the oldest leaves first
 *   forget{id}  drop one of the model's own notes (an id the block shows)
 *
 * They are offered only when the session config says `memory: true` (the
 * kernel writes it for attended sessions; a loop session has no memory and no
 * memory tools). Their names are reserved: a kernel tools_set may not reuse
 * them. The class is `read` (no card: the effect is the session's own scratch
 * memory, never the workspace), so the read deadline applies.
 */
import type { BrokeredToolSpec } from './broker.js';

/** The longest note the model may write (the kernel refuses a longer one too). */
export const NOTE_MAX_CHARS = 300;
/** A working-memory entry id as the kernel mints it. */
export const MEMORY_ID_RE = /^wm-[1-9]\d{0,8}$/;

export const MEMORY_TOOLS: readonly BrokeredToolSpec[] = Object.freeze([
  {
    name: 'note',
    description: 'Remember one short fact for the rest of this session (kept in working memory, survives compaction). At most 300 characters; old notes are dropped first when there are many.',
    parameters: { type: 'object', properties: { text: { type: 'string', maxLength: NOTE_MAX_CHARS, description: 'the fact to remember' } }, required: ['text'], additionalProperties: false },
    class: 'read',
  },
  {
    name: 'forget',
    description: 'Drop one of your own notes from working memory by its id (wm-N, shown in the working-memory block).',
    parameters: { type: 'object', properties: { id: { type: 'string', maxLength: 12, description: 'the note id, e.g. wm-4' } }, required: ['id'], additionalProperties: false },
    class: 'read',
  },
]);

export const MEMORY_TOOL_NAMES: readonly string[] = Object.freeze(MEMORY_TOOLS.map((t) => t.name));
