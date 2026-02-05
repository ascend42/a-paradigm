/**
 * Agent Providers
 *
 * Trickle-down provider cascade:
 * 1. claude - Anthropic API (best, requires ANTHROPIC_API_KEY)
 * 2. claude-code - Claude Code Task tool (works with Max plan)
 * 3. claude-cli - Claude CLI spawning (works if claude installed)
 * 4. manual - File-based handoff (always works)
 */

export { ClaudeAgentProvider } from './claude.js';
export { ClaudeCodeTaskProvider } from './claude-code.js';
export { ClaudeCliProvider } from './claude-cli.js';
export { ManualProvider } from './manual.js';
