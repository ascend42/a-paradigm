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
export { Agent, MIN_CONTEXT_TARGET, STEP_LIMIT_PROMPT, type MemoryBlock } from './agent.js';
export { MEMORY_TOOLS, MEMORY_TOOL_NAMES, MEMORY_ID_RE, NOTE_MAX_CHARS } from './memory-tools.js';
export { FIND_TOOL, FIND_TOOL_NAME, FIND_TOOL_NEED_MAX } from './find-tool.js';
export { contextLedger, contextReport, memorySlotTokens, memoryBlockTokens, MEMORY_BYTES_PER_TOKEN, MEMORY_SLOT_MAX_TOKENS, MEMORY_SLOT_SHARE, resultCapChars, TARGET_HEADROOM, type ContextLedger, type ContextSlots, type LedgerInput } from './budget.js';
export { shapeResult, SpillStore, escapeData, neutraliseDelimiters, neutraliseSpecialTokens, neutraliseResult, restoreSpecialTokens, WORD_JOINER, dataOpen, DATA_OPEN, DATA_CLOSE, DELIMITER_NAMES, HANDLE_RE, SHAPE_CAP_TOKENS, SHAPE_CAP_CHARS, MIN_SHAPE_CHARS, SPILL_MAX_BYTES, type ShapeOptions, type SpillEntry } from './shape.js';
export { checkRegex, globMatcher, outlineOf, grep, grepWith, grepSlots, regexMatcher, Semaphore, outline, readSection, edit, GREP_LIMITS, GREP_MAX_FILES, GREP_MAX_HITS, GREP_MAX_BYTES, GREP_TIME_MS, GREP_CONCURRENCY, GREP_LINE_CHARS, REGEX_MAX_CHARS, REGEX_TIME_MS, REGEX_WORKER_SRC, OUTLINE, OUTLINE_LINE_CHARS, type GrepLimits, type Matcher, type MatchResult, type OutlineEntry } from './retrieval.js';
export { PathRefused, isReservedDeviceName, lexicalRefusal, resolveRead, resolveWrite, updateConfined, writeConfined, type ResultSource, type ToolContext, type ToolResult } from './confine.js';
export { COMPACTION_HEADINGS, DEFAULT_CONTEXT_TARGET, GOAL_PINNED_LINE, compactedHistory, estimateTokens, isContextOverflow, normaliseSummary, summaryMessages, toolExcerpts, type CompactOptions } from './compaction.js';
export { parseSessionConfig, rpcSession, ConfigError, MAX_COMMAND_LINE, type LocalSessionConfig } from './rpc.js';
export { parseToolProgress, RUN_TIMEOUT_MS } from './broker.js';
export { KernelToolBroker, parseToolsSet, parseToolResponse, parseContextCommand, sha256, validateArgs, BROKER_LIMITS, CONTEXT_TARGET_MAX, CARD_TIMEOUT_MS, PROVENANCE_RE, REQUEST_ID_RE, TOOL_CLASSES, TOOL_NAME_RE, TOOL_TIMEOUT_MS, type BrokeredToolSpec, type KernelBrokerOptions, type ToolClass, type ToolResponse, type ContextCommand } from './broker.js';
export { PROTECTED_PREFIX, ProtectedRefused, protectGlob, protectedHit } from './protect.js';
