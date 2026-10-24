/**
 * #host-guidance: the host context every Gnomon session's appended system prompt carries (founder request 2026-10-23).
 * The text names what does not exist in a headless session (slash commands, /plugin, /mcp, /config, a TUI), points at
 * Gnomon's tools and Settings screens, and asks for the exact shell command; it stays short.
 */
import { describe, expect, it } from 'vitest';
import { GIT_VERBS_GUIDANCE } from '../src/kernel/git/verbs.js';
import { HOST_GUIDANCE, sessionSystemPrompt } from '../src/kernel/supervisor/host-guidance.js';

describe('#host-guidance', () => {
  it('says the session runs inside Gnomon, with no slash commands and no TUI', () => {
    expect(HOST_GUIDANCE).toMatch(/inside Gnomon/);
    for (const cmd of ['/plugin', '/mcp', '/config']) expect(HOST_GUIDANCE).toContain(cmd);
    expect(HOST_GUIDANCE).toMatch(/Slash commands do not run in Gnomon/);
    expect(HOST_GUIDANCE).toMatch(/cannot type into a terminal UI/);
    expect(HOST_GUIDANCE).toMatch(/restart the session/);
  });
  it("points at Gnomon's tools and Settings screens, and asks for the exact shell command", () => {
    expect(HOST_GUIDANCE).toMatch(/gnomon_git_\*/);
    for (const screen of ['MCP servers', 'Rules', 'Local model']) expect(HOST_GUIDANCE).toContain(screen);
    expect(HOST_GUIDANCE).toMatch(/exact shell command/);
    expect(HOST_GUIDANCE).toContain('claude plugin marketplace add');
  });
  it('stays short (it rides every session)', () => {
    expect(HOST_GUIDANCE.split(/\s+/).length).toBeLessThanOrEqual(110);
  });
  it('the appended prompt: the caller prompt, the host context, then the git verbs; empty parts dropped', () => {
    expect(sessionSystemPrompt({})).toBe(HOST_GUIDANCE);
    expect(sessionSystemPrompt({ systemPrompt: '', gitVerbs: null })).toBe(HOST_GUIDANCE);
    expect(sessionSystemPrompt({ systemPrompt: 'be terse', gitVerbs: GIT_VERBS_GUIDANCE })).toBe(`be terse\n\n${HOST_GUIDANCE}\n\n${GIT_VERBS_GUIDANCE}`);
  });
});
