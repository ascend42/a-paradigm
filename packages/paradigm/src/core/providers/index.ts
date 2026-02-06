/**
 * Agent Providers
 *
 * Trickle-down provider cascade:
 * 1. claude - Anthropic API (best, requires ANTHROPIC_API_KEY)
 * 2. claude-code-teams - Claude Code Agent Teams (experimental, parallel)
 * 3. claude-code - Claude Code Task tool (works with Max plan)
 * 4. cursor-cli - Cursor agent CLI (works in Cursor IDE)
 * 5. claude-cli - Claude CLI spawning (works if claude installed)
 * 6. manual - File-based handoff (always works)
 */

export { ClaudeAgentProvider } from './claude.js';
export { ClaudeCodeTeamsProvider } from './claude-code-teams.js';
export { ClaudeCodeTaskProvider } from './claude-code.js';
export { CursorCliProvider } from './cursor-cli.js';
export { ClaudeCliProvider } from './claude-cli.js';
export { ManualProvider } from './manual.js';
