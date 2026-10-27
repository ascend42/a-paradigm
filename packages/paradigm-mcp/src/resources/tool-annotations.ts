/**
 * MCP Tool-Annotations Resource — per-op annotations of the family tools.
 *
 * paradigm://tool-annotations serves
 *   { schema: "io.gnomon/op-annotations:v1",
 *     tools: { "<family tool>": { "<op>": { readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? } } } }
 * for the family tools in the CURRENT tools/list. Each op carries only the hints
 * its underlying per-op tool declares; an op declaring none is absent (consumers
 * read it as mutating). It lives here, not in tools/list `_meta`, so the map
 * never costs a model-facing listing tokens. Content follows tools/list: after
 * notifications/tools/list_changed (paradigm_tool_activate) a client re-reads it.
 */

import { OP_ANNOTATIONS_RESOURCE_URI, type OpAnnotationsDocument } from '../utils/tool-family.js';

export type OpAnnotationsProvider = () => OpAnnotationsDocument;

export function getToolAnnotationsResourcesList(provider?: OpAnnotationsProvider) {
  if (!provider) return [];
  return [{
    uri: OP_ANNOTATIONS_RESOURCE_URI,
    name: 'Tool Op Annotations',
    description: 'Per-op MCP annotations (readOnly/destructive/idempotent/openWorld) of the listed paradigm_<family> tools (schema io.gnomon/op-annotations:v1)',
    mimeType: 'application/json',
  }];
}

export function handleToolAnnotationsResource(
  resourcePath: string,
  provider?: OpAnnotationsProvider,
): { handled: false } | { handled: true; text: string; mimeType: string } {
  if (!provider || `paradigm://${resourcePath}` !== OP_ANNOTATIONS_RESOURCE_URI) return { handled: false };
  return { handled: true, text: JSON.stringify(provider()), mimeType: 'application/json' };
}
