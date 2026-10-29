/**
 * @symbol #gnomon-local
 * @symbol #tool-selector
 *
 * Slice C3' (TD-2026-10-27-833): `find_tool{need}`, the ONE meta-tool. The
 * child offers it as a core tool whenever the kernel has offered brokered
 * tools (never with a tools allowlist, i.e. a loop act session, and never with
 * surface none). A call goes out as a tool_request through the broker like any
 * brokered tool; the KERNEL resolves it (#tool-selector: its selection with the
 * need added), answers with at most 5 tool names and a line each, and sends a
 * tools_set that takes effect from the next step. Until then a found tool is
 * not in this step's set and the child refuses it ("unknown tool").
 *
 * Class read (no card: its only effect is the next step's offer). The name is
 * reserved: a kernel tools_set may not reuse it. The kernel's copy of this spec
 * is packages/gnomon/src/kernel/local/tool-selector.ts FIND_TOOL_SPEC (a test
 * keeps them in step).
 */
import type { BrokeredToolSpec } from './broker.js';

/** The longest need the model may send (the kernel refuses a longer one too). */
export const FIND_TOOL_NEED_MAX = 200;

export const FIND_TOOL: BrokeredToolSpec = Object.freeze({
  name: 'find_tool',
  description: 'Find a tool for a need none of your tools fits. Describe the need in a few words; up to 5 matching tools become callable from your next step.',
  parameters: { type: 'object', properties: { need: { type: 'string', maxLength: FIND_TOOL_NEED_MAX, description: 'what you need a tool for, in a few words' } }, required: ['need'], additionalProperties: false },
  class: 'read',
});

export const FIND_TOOL_NAME = FIND_TOOL.name;
