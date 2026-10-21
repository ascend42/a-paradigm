/**
 * #claude-adapter (spec §2.2, §3.3; M1.7 slice 1): argv + FORBIDDEN_FLAGS
 * (G-RUN-01), the child env allowlist (G-RUN-02), and transcript replay of
 * the stream-json parser (G-ADP-01) — tolerant to unknown fields/types (the
 * M1.7 falsifier "> 1 stream-json breaking change/month"), usage from stream
 * events only with no double count. Platform-independent: pure functions.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertArgv, assertNoForbiddenFlags, buildClaudeArgv, cardKindOfTool, repoContextFor, SESSION_HOOKS_MODES, controlInterruptLine, FORBIDDEN_FLAGS, ForbiddenFlagError, LineSplitter, parseStreamLine, UsageMeter, userMessageLine } from '../src/adapters/claude-code/adapter.js';
import { buildSessionEnv, ENV_ALLOWLIST } from '../src/kernel/runner/env.js';
import { PKG_ROOT } from './helpers.js';

const base = { uuid: '11111111-1111-4111-8111-111111111111', policyPath: '/s/policy.json', mcpConfigPath: '/s/mcp.json', settingSources: ['user', 'project', 'local'] as const };

describe('G-RUN-01 argv and forbidden flags', () => {
  it('builds the §3.3 argv with an explicit --setting-sources and strict MCP', () => {
    const a = buildClaudeArgv({ ...base, appendSystemPrompt: 'x', model: 'opus' });
    expect(a.slice(0, 1)).toEqual(['-p']);
    for (const f of ['--input-format', '--output-format', '--verbose', '--replay-user-messages', '--include-partial-messages', '--strict-mcp-config']) expect(a).toContain(f);
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('default');
    expect(a[a.indexOf('--permission-prompts') + 1]).toBe('host');
    expect(a[a.indexOf('--permission-prompt-tool') + 1]).toBe('stdio');
    expect(a).not.toContain('none');
    expect(a[a.indexOf('--session-id') + 1]).toBe(base.uuid);
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('user,project,local');
    expect(a[a.indexOf('--settings') + 1]).toBe('/s/policy.json');
    expect(buildClaudeArgv({ ...base, resume: true })).toContain('--resume');
  });
  it.each([...FORBIDDEN_FLAGS])('%s throws (also in --flag=value form, also as an extra)', (flag) => {
    expect(() => buildClaudeArgv({ ...base, extra: [flag] })).toThrow(ForbiddenFlagError);
    expect(() => assertNoForbiddenFlags(['-p', `${flag}=x`])).toThrow(ForbiddenFlagError);
  });
  it('refuses an unknown setting source', () => {
    expect(() => buildClaudeArgv({ ...base, settingSources: ['managed' as never] })).toThrow(TypeError);
  });
  it('stdin lines: the user message and the control_request interrupt (never a signal)', () => {
    expect(JSON.parse(userMessageLine('hi'))).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
    expect(JSON.parse(controlInterruptLine('r1'))).toEqual({ type: 'control_request', request_id: 'r1', request: { subtype: 'interrupt' } });
  });
});

describe('G-SUB-08 P8-D97 repo context argv', () => {
  const base = { uuid: '00000000-0000-4000-8000-000000000000', policyPath: 'policy.json', mcpConfigPath: 'mcp.json', settingSources: ['user'] as const };
  it('pluginDirs and addDirs: one --plugin-dir, ONE variadic --add-dir (deduped); none by default; relative dirs throw', () => {
    const a = buildClaudeArgv({ ...base, pluginDirs: ['/ctx', '/ctx'], addDirs: ['/repo', '/repo/pkg', '/repo'] });
    expect(a.filter((x) => x === '--plugin-dir')).toHaveLength(1);
    expect(a[a.indexOf('--plugin-dir') + 1]).toBe('/ctx');
    expect(a.filter((x) => x === '--add-dir')).toHaveLength(1);
    expect(a.slice(a.indexOf('--add-dir') + 1, a.indexOf('--add-dir') + 3)).toEqual(['/repo', '/repo/pkg']);
    expect(() => buildClaudeArgv({ ...base, addDirs: ['repo'] })).toThrow(TypeError);
    expect(() => buildClaudeArgv({ ...base, pluginDirs: ['-x'] })).toThrow(TypeError);
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('user');
    const b = buildClaudeArgv({ ...base });
    expect(b).not.toContain('--plugin-dir');
    expect(b).not.toContain('--add-dir');
  });
  it('only audited stages the repo context through the kernel', () => {
    expect(SESSION_HOOKS_MODES.filter(repoContextFor)).toEqual(['audited']);
  });
});

describe('Q6 (Aegis): extra is an allow-list; every kernel-owned flag appears once', () => {
  const base = { uuid: '00000000-0000-4000-8000-000000000000', policyPath: '/s/policy.json', mcpConfigPath: '/s/mcp.json', settingSources: ['user'] as const };
  it('the allowed extras pass', () => {
    const a = buildClaudeArgv({ ...base, extra: ['--max-turns', '5', '--no-session-persistence'] });
    expect(a.slice(-3)).toEqual(['--max-turns', '5', '--no-session-persistence']);
    expect(buildClaudeArgv({ ...base, extra: ['--max-turns=7'] }).at(-1)).toBe('--max-turns=7');
  });
  it.each([
    ['--plugin-dir', ['--plugin-dir', '/evil']],
    ['--add-dir', ['--add-dir', '/']],
    ['--agents', ['--agents', '{}']],
    ['--tools', ['--tools', 'Bash']],
    ['--settings', ['--settings', '/x.json']],
    ['--setting-sources', ['--setting-sources=user,project,local']],
    ['--permission-mode', ['--permission-mode', 'bypassPermissions']],
    ['--mcp-config', ['--mcp-config', '/m.json']],
    ['--model', ['--model', 'x']],
    ['--plugin-url', ['--plugin-url', 'https://x']],
    ['an unknown flag', ['--whatever']],
    ['a positional prompt', ['do something']],
    ['a value on a boolean', ['--no-session-persistence=1']],
    ['a missing value', ['--max-turns']],
    ['a repeated extra', ['--max-turns', '1', '--max-turns', '2']],
  ])('extra %s ⇒ TypeError', (_n, extra) => {
    expect(() => buildClaudeArgv({ ...base, extra })).toThrow(TypeError);
  });
  it('assertArgv: a duplicated, missing or =-form duplicate kernel flag throws; the built argv passes', () => {
    const a = buildClaudeArgv({ ...base, pluginDirs: ['/c'], addDirs: ['/r'], appendSystemPrompt: '--settings /evil.json', model: 'opus' });
    expect(() => assertArgv(a)).not.toThrow();
    const counts = assertArgv(a);
    expect(counts.get('--settings')).toBe(1); // the system prompt VALUE is not counted as a flag
    expect(() => assertArgv([...a, '--settings', '/x'])).toThrow(/--settings must appear exactly 1/);
    expect(() => assertArgv([...a, '--settings=/x'])).toThrow(/--settings/);
    expect(() => assertArgv([...a, '--plugin-dir', '/y'])).toThrow(/--plugin-dir/);
    expect(() => assertArgv([...a, '--add-dir', '/y'])).toThrow(/--add-dir/);
    expect(() => assertArgv([...a, '--agents', '{}'])).toThrow(/--agents/);
    expect(() => assertArgv([...a, '--tools', 'Bash'])).toThrow(/--tools/);
    expect(() => assertArgv([...a, '--resume', 'u'])).toThrow(/session-id/);
    const i = a.indexOf('--setting-sources');
    expect(() => assertArgv([...a.slice(0, i), ...a.slice(i + 2)])).toThrow(/--setting-sources/);
  });
  it('an empty --setting-sources value (mode none) is still one value', () => {
    expect(() => buildClaudeArgv({ ...base, settingSources: [] })).not.toThrow();
  });
});

describe('G-RUN-02 the child env is an allowlist plus the scrub', () => {
  it('envKeys ⊆ allowlist ∪ GNOMON session names; API-billing and steering names never pass', () => {
    const from = { HOME: '/h', PATH: '/usr/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDE_CONFIG_DIR: '/c', NODE_OPTIONS: '--x', GNOMON_HOME: '/g', FOO_BASE_URL: 'u', CLAUDE_CODE_USE_BEDROCK: '1', RANDOM: 'r' };
    const { env, envKeys } = buildSessionEnv({ from, hsid: 'hsid:v1:x', sock: '/s.sock', sessionKeyPath: '/k', identity: null, path: null });
    expect(envKeys).toEqual(['GNOMON_HSID', 'GNOMON_SESSION_KEY', 'GNOMON_SOCK', 'HOME', 'PATH']);
    expect(Object.keys(env).every((k) => ENV_ALLOWLIST.includes(k) || k.startsWith('GNOMON_'))).toBe(true);
  });
});

describe('G-ADP-01 transcript replay (Claude Code 2.1.302 shapes, p10m-claude-compat-generated)', () => {
  const lines = readFileSync(path.join(PKG_ROOT, 'src', 'adapters', 'claude-code', 'fixtures', '2.1.302-turn.jsonl'), 'utf8').split('\n').filter(Boolean);
  const events = lines.map(parseStreamLine);
  it('yields the same typed projection every run', () => {
    expect(events.map((e) => e.kind)).toEqual(['unknown', 'unknown', 'init', 'unknown', 'user', 'partial', 'partial', 'partial', 'message', 'partial', 'partial', 'partial', 'user', 'partial', 'message', 'unknown', 'result']);
    const init = events[2]!;
    expect(init.kind === 'init' && init.apiKeySource).toBe('none');
    const result = events.at(-1)!;
    expect(result.kind === 'result' && [result.isError, result.costUsd, result.permissionDenials]).toEqual([false, 0.154356, 0]);
  });
  it('usage: messages charged once by id, the result charges only the remainder (no double count)', () => {
    const m = new UsageMeter();
    let charged = 0;
    for (const e of events) {
      if (e.kind === 'partial' && e.usage) charged += m.message(e.usage.messageId, e.usage.tokens);
      if (e.kind === 'message' && e.tokens !== null) charged += m.message(e.messageId, e.tokens);
      if (e.kind === 'result') charged += m.result(e.tokens);
    }
    expect(charged).toBe(204 + 2000 + 42000 + 70);
  });
  it('tolerant: unknown fields ignored, unknown types are `unknown`, non-objects are `malformed`', () => {
    expect(parseStreamLine('{"type":"assistant","message":{"id":"a","content":[],"usage":{"input_tokens":1}},"zzz":{"new":1}}')).toMatchObject({ kind: 'message', tokens: 1 });
    expect(parseStreamLine('{"type":"brand_new_event","x":1}')).toEqual({ kind: 'unknown', type: 'brand_new_event' });
    expect(parseStreamLine('not json').kind).toBe('malformed');
    expect(parseStreamLine('[1,2]').kind).toBe('malformed');
    expect(parseStreamLine('{"type":"result","is_error":true,"result":"Claude AI usage limit reached"}')).toMatchObject({ kind: 'result', quota: true });
  });
  it('a user line exposes its tool_result ids with Claude\'s permission decision (P8-D96 detector)', () => {
    const l = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"ok"},{"type":"tool_result","tool_use_id":"tu2","is_error":true,"content":"no"}]},"tool_result_meta":[{"id":"tu1","permission_decision":{"decision":"accept","source":"config"}}]}';
    expect(parseStreamLine(l)).toEqual({ kind: 'user', type: 'user', replay: false, toolResults: [{ toolUseId: 'tu1', isError: false, decision: 'accept' }, { toolUseId: 'tu2', isError: true, decision: null }] });
  });
  it('AskUserQuestion ⇒ ask-user, ExitPlanMode ⇒ plan; other tools ⇒ no card', () => {
    expect([cardKindOfTool('AskUserQuestion'), cardKindOfTool('ExitPlanMode'), cardKindOfTool('Bash')]).toEqual(['ask-user', 'plan', null]);
  });
  it('the line splitter drops (and reports) a line over the cap, across chunk boundaries', () => {
    const s = new LineSplitter(10);
    const got: string[] = [];
    const dropped: number[] = [];
    s.push('{"a":1}\n0123456', (l) => got.push(l), (b) => dropped.push(b));
    s.push('789abcdef', (l) => got.push(l), (b) => dropped.push(b));
    s.push('xyz\n{"b":2}\n', (l) => got.push(l), (b) => dropped.push(b));
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
    expect(dropped).toEqual([19]); // reported once, with the whole line's size
  });
});

describe('8.0:model-switch control_response (Aegis L3)', () => {
  it("claude's set_model error text is sanitised: no control or hidden characters, bidi made visible, one line, bounded", () => {
    const raw = 'bad\u001b[31m model‮ evil⁦\nnext\u0007line​' + 'x'.repeat(400);
    const ev = parseStreamLine(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'set-model-1', error: raw, error_code: 'cat‮alog\u0000' } }));
    expect(ev.kind).toBe('control');
    const e = ev as Extract<typeof ev, { kind: 'control' }>;
    expect(e.error).not.toBeNull();
    // eslint-disable-next-line no-control-regex
    expect(e.error!).not.toMatch(/[\u0000-\u001f\u007f-\u009f​‪-‮⁦-⁩]/);
    expect(e.error!.startsWith('bad model')).toBe(true);
    expect(Array.from(e.error!).length).toBeLessThanOrEqual(256);
    // eslint-disable-next-line no-control-regex
    expect(e.errorCode!).not.toMatch(/[\u0000-\u001f‪-‮]/);
    expect(e.errorCode!.length).toBeLessThanOrEqual(64);
    expect(parseStreamLine(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'set-model-2' } }))).toMatchObject({ error: null, errorCode: null });
  });
});
