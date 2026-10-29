/**
 * @symbol #backend-adapter
 *
 * The backend adapters by id (spec §2.2). Each value's type is its concrete
 * adapter (core codec ∩ the capabilities that backend has), never a widened
 * common type: `BACKEND_ADAPTERS.local.steerLine` exists, and the claude-code
 * entry has no steerLine at all.
 */
import { claudeCodeAdapter, type ClaudeCodeAdapter } from './claude-code/adapter.js';
import { localAdapter, type LocalAdapter } from './local/runner.js';

export type { BackendAdapter, BackendId, ControlChannel, DriverEvent, OfferedTool, PermissionChannel, SdkMcpChannel, SteerChannel, ToolBrokerChannel, ToolResponse, Tolerant, TurnInput, UsageMeter } from './backend-adapter.js';
export { LineSplitter } from './line-splitter.js';
export { claudeCodeAdapter, localAdapter, type ClaudeCodeAdapter, type LocalAdapter };

export const BACKEND_ADAPTERS = { 'claude-code': claudeCodeAdapter, local: localAdapter } as const;

export type AnyBackendAdapter = ClaudeCodeAdapter | LocalAdapter;
