/**
 * @symbol #gnomon-local
 *
 * gnomon-local library surface (spec §13.1) — what the tests and the kernel's
 * parity test import. The executable is cli.ts.
 */
export { classifyEndpoint, type EndpointVerdict, type EndpointClass, type EndpointRefusal } from './endpoint.js';
export { COMPAT_ALLOWLIST, buildRequest, surfaceTools, type CompatProfile, type ToolSpec, type ChatMessage, type ToolSurface } from './compat.js';
export { complete, EndpointRefused, type Completion } from './client.js';
export { repairArguments, parseTextToolCalls, textToolPrompt } from './repair.js';
export { TOOLS, runTool, insideRoots, isDotGit, PATH_CASE_INSENSITIVE } from './tools.js';
export { Agent } from './agent.js';
export { COMPACTION_HEADINGS, DEFAULT_CONTEXT_TARGET, compactedHistory, estimateTokens, isContextOverflow, normaliseSummary, summaryMessages } from './compaction.js';
export { parseSessionConfig, rpcSession, ConfigError, type LocalSessionConfig } from './rpc.js';
export { PROTECTED_PREFIX, ProtectedRefused, protectGlob, protectedHit } from './protect.js';
