/**
 * @symbol #gnomon-local
 *
 * @symbol #local-retrieval-tools
 *
 * gnomon-local library surface (spec §13.1) — what the tests and the kernel's
 * parity test import. The executable is cli.ts.
 */
export { classifyEndpoint, type EndpointVerdict, type EndpointClass, type EndpointRefusal } from './endpoint.js';
export { COMPAT_ALLOWLIST, TOOL_ORDER, buildRequest, orderTools, surfaceTools, type CompatProfile, type ToolSpec, type ChatMessage, type ToolSurface } from './compat.js';
export { complete, EndpointRefused, type Completion } from './client.js';
export { repairArguments, parseTextToolCalls, textToolPrompt } from './repair.js';
export { TOOLS, runTool, insideRoots, isDotGit, PATH_CASE_INSENSITIVE, MAX_READ, MIN_READ, LIST_MAX_ENTRIES } from './tools.js';
export { Agent, STEP_LIMIT_PROMPT } from './agent.js';
export { contextLedger, contextReport, resultCapChars, TARGET_HEADROOM, type ContextLedger, type ContextSlots, type LedgerInput } from './budget.js';
export { shapeResult, SpillStore, escapeData, DATA_OPEN, DATA_CLOSE, HANDLE_RE, SHAPE_CAP_TOKENS, SHAPE_CAP_CHARS, MIN_SHAPE_CHARS, SPILL_MAX_BYTES, type ShapeOptions, type SpillEntry } from './shape.js';
export { checkRegex, outlineOf, grep, outline, readSection, edit, GREP_MAX_FILES, GREP_MAX_HITS, GREP_LINE_CHARS, REGEX_MAX_CHARS, REGEX_TIME_MS, OUTLINE, type OutlineEntry } from './retrieval.js';
export { PathRefused, resolveRead, resolveWrite, type ToolContext, type ToolResult } from './confine.js';
export { COMPACTION_HEADINGS, DEFAULT_CONTEXT_TARGET, compactedHistory, estimateTokens, isContextOverflow, normaliseSummary, summaryMessages, toolExcerpts, type CompactOptions } from './compaction.js';
export { parseSessionConfig, rpcSession, ConfigError, type LocalSessionConfig } from './rpc.js';
export { PROTECTED_PREFIX, ProtectedRefused, protectGlob, protectedHit } from './protect.js';
