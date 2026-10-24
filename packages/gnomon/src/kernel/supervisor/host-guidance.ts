/**
 * @symbol #host-guidance
 *
 * The HOST CONTEXT every Claude Code session Gnomon runs carries in its appended system prompt (founder request
 * 2026-10-23: a Gnomon session told the human to run `/plugin marketplace add …` and restart, which a Gnomon session
 * cannot do). Gnomon runs claude headless over stream-json: there is no TUI, so no slash command runs and the human
 * cannot type into one. The guidance says so, points at Gnomon's own tools and Settings screens, and asks for the exact
 * shell command when only a terminal can do a thing.
 *
 * The GUI's #gui-host-hints is the other half: when a reply still names such an instruction, the reply is shown
 * verbatim and a host slip beside it says the Gnomon way. This text is public code; it is never a security boundary.
 */

/** The host-context paragraph (short on purpose: it rides every session's system prompt). */
export const HOST_GUIDANCE = [
  'You are running inside Gnomon: Claude Code runs headless here and the human reads your replies in the Gnomon window. They cannot type into a terminal UI.',
  'Slash commands do not run in Gnomon: never tell the human to type /plugin, /mcp, /config, /login or any other /command, to restart the session, or to run `claude` interactively.',
  'Suggest Gnomon\'s own way instead: its tools (gnomon_git_* when you have them) and its Settings screens (MCP servers, Rules, Local model, Voice).',
  'For something only a terminal can do, give the exact shell command for the human\'s own terminal, for example `claude plugin marketplace add <owner/repo>`.',
].join(' ');

/**
 * The session's appended system prompt: the caller's own prompt, the host context, then the git-verb guidance when the
 * kernel's verbs are on. Empty parts are dropped; parts are joined by a blank line.
 */
export function sessionSystemPrompt(parts: { systemPrompt?: string; gitVerbs?: string | null }): string {
  return [parts.systemPrompt, HOST_GUIDANCE, parts.gitVerbs ?? undefined].filter((x): x is string => typeof x === 'string' && x.length > 0).join('\n\n');
}
