// p-two-sdk-servers — three facts about real Claude Code that #mod-tool-bridge (S1.4 P2, a SECOND SDK MCP server named
// `gnomon-mods` beside the kernel's `gnomon`) is designed on. Real claude on the founder's subscription, launched with
// the argv buildClaudeArgv writes (src/adapters/claude-code/adapter.ts:246-270, copied flag for flag; the only extra is
// the allow-listed --no-session-persistence), haiku, no sandbox profile (the question is the channel). Zero deps: the
// two servers are stubs answered here, each with one harmless tool `echo`. Every control_request claude writes is kept
// (trimmed) in evidence.run{A,B,C}.control.
//   Q1  two `type:"sdk"` entries in one --mcp-config: both connect, system.init lists mcp__gnomon__echo and
//       mcp__gnomon-mods__echo, and initialize / tools/list / tools/call arrive as
//       control_request{subtype:'mcp_message', server_name:'gnomon-mods'}
//   Q2  can_use_tool precedes the tools/call of an SDK tool under the kernel's launch (--permission-mode default,
//       --permission-prompts host, --permission-prompt-tool stdio). Runs B and C ask whether an allow rule
//       (`permissions.allow: ["mcp__gnomon-mods__echo"]`) makes claude skip it: B puts the rule in the --settings file
//       (the kernel's own policy.json, which never holds an allow), C in <cwd>/.claude/settings.json with
//       --setting-sources project (a layer the kernel's `all` hooks mode loads; the temp cwd is NOT a trusted
//       workspace, and claude says on stderr whether it took the rule). The user layer (~/.claude/settings.json) is
//       never written by a probe, so it is not measured
//   Q3a after turn 1 the stub sends notifications/tools/list_changed for gnomon-mods (an mcp_message control_request
//       on stdin) and from then on lists a second tool, echo2: is tools/list asked again, and can the model call echo2
//   Q3b turn 2 has a sub-agent (Agent/Task tool) call the tool: what, if anything, in its mcp_message or can_use_tool
//       names the sub-agent
// VERDICT: pass when Q1 and Q2 hold as the design assumes (two servers routed by name; can_use_tool before the call
// with no allow rule); partial when a phase did not run; fail otherwise. Q3 and runs B and C are findings, never the
// verdict. Run: node packages/gnomon/probes/run.mjs p-two-sdk-servers --timeout 420000   (four short haiku turns)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const specRefs = ['§6.6 kernel-run git verbs', '#kernel-mcp', '#mod-tool-bridge (S1.4 P2)'];

const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);
const SERVERS = ['gnomon', 'gnomon-mods'];
const MODS = 'gnomon-mods';
// policy.json as claudePermissions writes it for a session with no path denies (src/kernel/manifest/policy.ts:655-690)
const POLICY = { permissions: { deny: [], ask: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'PowerShell'] }, env: { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1' } };
const trim = (s, n = 700) => (s.length > n ? `${s.slice(0, n)}…(+${s.length - n})` : s);
const echoTool = (name) => ({ name, description: 'Returns the given text unchanged. Harmless; reads and writes nothing.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });

/** One claude process. `turns(api)` drives it; every control_request it writes is recorded and answered. */
async function session({ label, settingSources, projectSettings, policyAllow, turns }) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p2sdk-')));
  const cwd = path.join(root, 'fresh');
  mkdirSync(cwd);
  if (projectSettings) {
    mkdirSync(path.join(cwd, '.claude'));
    writeFileSync(path.join(cwd, '.claude', 'settings.json'), JSON.stringify(projectSettings));
  }
  const policy = path.join(root, 'policy.json');
  const mcp = path.join(root, 'mcp.json');
  writeFileSync(policy, `${JSON.stringify(policyAllow ? { ...POLICY, permissions: { ...POLICY.permissions, allow: policyAllow } } : POLICY, null, 2)}\n`);
  writeFileSync(mcp, `${JSON.stringify({ mcpServers: Object.fromEntries(SERVERS.map((n) => [n, { type: 'sdk', name: n }])) }, null, 2)}\n`);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--include-partial-messages', '--include-hook-events', '--permission-mode', 'default', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--session-id', randomUUID(), '--settings', policy, '--setting-sources', settingSources, '--mcp-config', mcp, '--strict-mcp-config', '--model', 'haiku', '--no-session-persistence'];
  // this probe may itself be run from inside a Claude Code session: its nested-session vars never reach the child
  const stripped = Object.keys(process.env).filter((k) => /^(CLAUDE|AI_AGENT$)/.test(k)).sort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !stripped.includes(k)));
  const ev = { label, argv: args.map((a) => (a === policy ? '<policy.json>' : a === mcp ? '<mcp.json>' : a)), settingSources, projectSettings: projectSettings ?? null, policyAllow: policyAllow ?? null, envStripped: stripped, phase: 'start', inits: [], mcpServers: null, control: [], controlResponses: [], toolUses: [], toolResults: [], results: [], stderr: '', exit: null };
  const child = spawn(CLAUDE, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { listsSecondTool: false, waiters: [], seq: 0 };
  const write = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
  const closed = new Promise((resolve) => child.on('close', (code) => resolve((ev.exit = code))));
  child.stderr.on('data', (d) => (ev.stderr += d));
  const notify = () => {
    for (const w of [...state.waiters]) if (w.f()) (state.waiters.splice(state.waiters.indexOf(w), 1), w.r(true));
  };
  const until = (f, ms) =>
    new Promise((r) => {
      if (f()) return r(true);
      const w = { f, r };
      state.waiters.push(w);
      setTimeout(() => (state.waiters.includes(w) && state.waiters.splice(state.waiters.indexOf(w), 1), r(false)), ms).unref();
    });
  const answerMcp = (server, m) => {
    if (m?.id === undefined || m?.id === null || String(m?.method).startsWith('notifications/')) return { jsonrpc: '2.0', id: 0, result: {} };
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    const tools = server === MODS && state.listsSecondTool ? [echoTool('echo'), echoTool('echo2')] : [echoTool('echo')];
    switch (m.method) {
      case 'initialize':
        return ok({ protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: server, version: '0.0.0-probe' } });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools });
      case 'tools/call':
        return tools.some((t) => t.name === m.params?.name) ? ok({ content: [{ type: 'text', text: `${server}:${m.params.name}:${String(m.params?.arguments?.text ?? '')}` }], isError: false }) : { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'unknown tool' } };
      default:
        return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } };
    }
  };
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'system' && o.subtype === 'init') { ev.inits.push({ phase: ev.phase, mcpTools: (o.tools ?? []).filter((x) => x.startsWith('mcp__')), model: o.model ?? null, permissionMode: o.permissionMode ?? null }); ev.mcpServers = o.mcp_servers; }
      if (o.type === 'assistant') for (const b of o.message?.content ?? []) if (b?.type === 'tool_use') ev.toolUses.push({ phase: ev.phase, id: b.id, name: b.name, input: b.input, parentToolUseId: o.parent_tool_use_id ?? null });
      if (o.type === 'user' && Array.isArray(o.message?.content)) for (const b of o.message.content) if (b?.type === 'tool_result') ev.toolResults.push({ phase: ev.phase, toolUseId: b.tool_use_id, isError: b.is_error ?? false, parentToolUseId: o.parent_tool_use_id ?? null, text: trim(typeof b.content === 'string' ? b.content : JSON.stringify(b.content), 200) });
      if (o.type === 'result') ev.results.push({ phase: ev.phase, subtype: o.subtype, isError: o.is_error, numTurns: o.num_turns, cost: o.total_cost_usd, text: trim(String(o.result ?? ''), 300) });
      if (o.type === 'control_response' && String(o.response?.request_id).startsWith('probe-')) ev.controlResponses.push({ phase: ev.phase, line: trim(line) }); // answers to the probe's own requests only
      if (o.type === 'control_request') {
        const r = o.request ?? {};
        const row = { seq: ++state.seq, phase: ev.phase, subtype: r.subtype ?? null, requestKeys: Object.keys(r).sort(), topKeys: Object.keys(o).sort(), line: trim(line) };
        if (r.subtype === 'mcp_message') {
          Object.assign(row, { serverName: r.server_name ?? null, method: r.message?.method ?? null, tool: r.message?.params?.name ?? null, messageKeys: Object.keys(r.message ?? {}).sort(), paramsKeys: Object.keys(r.message?.params ?? {}).sort(), meta: r.message?.params?._meta ?? null });
          write({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: { mcp_response: answerMcp(r.server_name, r.message) } } });
        } else if (r.subtype === 'can_use_tool') {
          Object.assign(row, { toolName: r.tool_name ?? null, toolUseId: r.tool_use_id ?? null, agentId: r.agent_id ?? null });
          write({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: { behavior: 'allow', updatedInput: r.input ?? {} } } });
        } else {
          write({ type: 'control_response', response: { subtype: 'error', request_id: o.request_id, error: `unsupported control request: ${String(r.subtype).slice(0, 64)}` } });
        }
        ev.control.push(row);
      }
      notify();
    }
  });
  const api = {
    ev,
    until,
    phase: (p) => (ev.phase = p),
    /** one user turn; resolves true when its result line arrived */
    turn: async (phase, text, ms = 150_000) => {
      ev.phase = phase;
      const n = ev.results.length;
      write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
      return until(() => ev.results.length > n, ms);
    },
    /** server → claude: one JSON-RPC message of an SDK server, the way the SDK transport sends it */
    serverSend: (server, message) => {
      const id = `probe-${randomUUID()}`;
      write({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: server, message } });
      return id;
    },
    secondTool: () => (state.listsSecondTool = true),
  };
  try {
    await Promise.race([turns(api), closed]);
  } finally {
    child.stdin.end();
    const t = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await closed;
    clearTimeout(t);
    rmSync(root, { recursive: true, force: true });
  }
  ev.stderr = trim(ev.stderr, 2000);
  delete ev.phase;
  return ev;
}

const mcpRows = (ev, server, method) => ev.control.filter((c) => c.subtype === 'mcp_message' && c.serverName === server && c.method === method);
/** is there a can_use_tool for `tool` written before the first tools/call of that tool's server in `phase`? */
function askedBeforeCall(ev, phase, tool, server, name) {
  const call = ev.control.find((c) => c.phase === phase && c.subtype === 'mcp_message' && c.serverName === server && c.method === 'tools/call' && c.tool === name);
  const ask = ev.control.find((c) => c.phase === phase && c.subtype === 'can_use_tool' && c.toolName === tool);
  return { called: call !== undefined, asked: ask !== undefined, askedFirst: call !== undefined && ask !== undefined && ask.seq < call.seq };
}

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const version = await new Promise((r) => {
    const c = spawn(CLAUDE, ['--version']);
    let o = '';
    c.stdout.on('data', (d) => (o += d));
    c.on('close', () => r(o.trim()));
  });

  // run A: the kernel's launch (setting sources none), two turns
  const q3 = { listChangedSent: false, listChangedResponse: null, relistWithin15s: false, subAgentTool: null, subAgentCallSeenBeforeTurnResult: null };
  const runA = await session({
    label: 'A: kernel launch, no allow rule',
    settingSources: '',
    turns: async (s) => {
      if (!(await s.turn('turn1', 'Call the tool mcp__gnomon-mods__echo with text "one". Then reply with only the tool\'s output text.'))) return;
      s.phase('list-changed');
      s.secondTool();
      const before = mcpRows(s.ev, MODS, 'tools/list').length;
      const id = s.serverSend(MODS, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      q3.listChangedSent = true;
      q3.relistWithin15s = await s.until(() => mcpRows(s.ev, MODS, 'tools/list').length > before, 15_000);
      q3.listChangedResponse = s.ev.controlResponses.find((c) => c.line.includes(id))?.line ?? null;
      // the sub-agent calls echo2 when claude asked for the list again (so the new tool can be known), echo otherwise
      q3.subAgentTool = q3.relistWithin15s ? 'echo2' : 'echo';
      await s.turn('turn2', `Use the Agent tool (the Task sub-agent tool, subagent_type "general-purpose") exactly once. Its whole prompt: 'Call the tool mcp__gnomon-mods__${q3.subAgentTool} with text "sub" and reply with only its output text.' Run it in the foreground (run_in_background false) and wait for it. Do not call that tool yourself. Then reply with only what the sub-agent returned.`, 200_000);
      // a sub-agent the model put in the background outlives the turn's result line: its can_use_tool and tools/call
      // come later, and closing stdin first fails them ("Tool permission request failed: AbortError: Stream closed")
      q3.subAgentCallSeenBeforeTurnResult = s.ev.control.some((c) => c.phase === 'turn2' && c.subtype === 'mcp_message' && c.method === 'tools/call');
      if (!q3.subAgentCallSeenBeforeTurnResult) await s.until(() => s.ev.control.some((c) => c.phase === 'turn2' && c.subtype === 'mcp_message' && c.method === 'tools/call'), 90_000);
    },
  });

  // runs B and C: the same launch plus an allow rule for the second server's tool (B: --settings file; C: project layer)
  const one = async (s) => void (await s.turn('turn1', 'Call the tool mcp__gnomon-mods__echo with text "one". Then reply with only the tool\'s output text.'));
  const runB = await session({ label: 'B: the --settings file (policy.json) allows mcp__gnomon-mods__echo', settingSources: '', policyAllow: ['mcp__gnomon-mods__echo'], turns: one });
  const runC = await session({ label: 'C: the project settings layer allows mcp__gnomon-mods__echo (untrusted temp cwd)', settingSources: 'project', projectSettings: { permissions: { allow: ['mcp__gnomon-mods__echo'] } }, turns: one });

  const connected = (ev, n) => (ev.mcpServers ?? []).some((x) => x.name === n && x.status === 'connected');
  const a1 = askedBeforeCall(runA, 'turn1', 'mcp__gnomon-mods__echo', MODS, 'echo');
  const b1 = askedBeforeCall(runB, 'turn1', 'mcp__gnomon-mods__echo', MODS, 'echo');
  const c1 = { ...askedBeforeCall(runC, 'turn1', 'mcp__gnomon-mods__echo', MODS, 'echo'), ruleIgnoredAsUntrusted: /Ignoring \d+ permissions\.allow/.test(runC.stderr) };
  const subTool = q3.subAgentTool ?? 'echo';
  const sub = askedBeforeCall(runA, 'turn2', `mcp__gnomon-mods__${subTool}`, MODS, subTool);
  const agentUse = runA.toolUses.find((u) => u.phase === 'turn2' && u.parentToolUseId === null && (u.name === 'Agent' || u.name === 'Task'));
  const subUse = runA.toolUses.find((u) => u.phase === 'turn2' && u.name === `mcp__gnomon-mods__${subTool}`);
  const subRows = runA.control.filter((c) => c.phase === 'turn2' && ((c.subtype === 'mcp_message' && c.method === 'tools/call') || c.subtype === 'can_use_tool'));
  const mainRows = runA.control.filter((c) => c.phase === 'turn1' && ((c.subtype === 'mcp_message' && c.method === 'tools/call') || c.subtype === 'can_use_tool'));
  const keysOf = (rows, sub2) => [...new Set(rows.filter((c) => c.subtype === sub2).flatMap((c) => [...c.requestKeys.map((k) => `request.${k}`), ...c.topKeys.map((k) => `top.${k}`), ...(c.messageKeys ?? []).map((k) => `message.${k}`), ...(c.paramsKeys ?? []).map((k) => `params.${k}`)]))].sort();
  const answers = {
    q1: {
      bothConnected: SERVERS.every((n) => connected(runA, n)),
      bothToolsInInit: ['mcp__gnomon__echo', 'mcp__gnomon-mods__echo'].every((t) => (runA.inits[0]?.mcpTools ?? []).includes(t)),
      methodsByServer: Object.fromEntries(SERVERS.map((n) => [n, runA.control.filter((c) => c.subtype === 'mcp_message' && c.serverName === n).map((c) => c.method)])),
      secondServerCalled: a1.called,
    },
    q2: { kernelLaunch: a1, withAllowRuleInSettingsFile: b1, withAllowRuleInProjectLayer: c1, subAgentCall: sub, permissionModeAtInit: runA.inits[0]?.permissionMode ?? null },
    q3: {
      ...q3,
      toolsListCountSecondServer: mcpRows(runA, MODS, 'tools/list').map((c) => c.phase),
      // system.init is written again at each turn: does the turn after the notification list echo2?
      secondToolInLaterInit: runA.inits.some((i) => i.phase === 'turn2' && i.mcpTools.includes('mcp__gnomon-mods__echo2')),
      subAgentRan: agentUse !== undefined && subUse !== undefined && subUse.parentToolUseId !== null,
      agentToolUseId: agentUse?.id ?? null,
      subAgentToolUse: subUse ?? null,
      // which keys a sub-agent's requests carry that the main agent's do not (and the reverse), and whether any line
      // of turn 2 names the Agent tool_use id
      mcpMessageKeys: { main: keysOf(mainRows, 'mcp_message'), sub: keysOf(subRows, 'mcp_message') },
      canUseToolKeys: { main: keysOf(mainRows.filter((c) => c.toolName?.startsWith('mcp__')), 'can_use_tool'), sub: keysOf(subRows.filter((c) => c.toolName?.startsWith('mcp__')), 'can_use_tool') },
      subMcpMessageNamesAgentToolUse: agentUse ? subRows.some((c) => c.subtype === 'mcp_message' && c.line.includes(agentUse.id)) : null,
      // what does name it: can_use_tool.agent_id, joinable to the tools/call by params._meta['claudecode/toolUseId']
      subCanUseToolAgentId: subRows.find((c) => c.subtype === 'can_use_tool' && c.toolName?.startsWith('mcp__'))?.agentId ?? null,
      mainCanUseToolAgentId: mainRows.find((c) => c.subtype === 'can_use_tool' && c.toolName?.startsWith('mcp__'))?.agentId ?? null,
      subCallMetaToolUseIdIsItsCanUseToolId: ((ask, call) => ask !== undefined && call !== undefined && call.meta?.['claudecode/toolUseId'] === ask.toolUseId)(subRows.find((c) => c.subtype === 'can_use_tool' && c.toolName?.startsWith('mcp__')), subRows.find((c) => c.subtype === 'mcp_message')),
      subCanUseToolNamesAgentToolUse: agentUse ? subRows.some((c) => c.subtype === 'can_use_tool' && c.toolName?.startsWith('mcp__') && c.line.includes(agentUse.id)) : null,
    },
  };
  const q1 = answers.q1.bothConnected && answers.q1.bothToolsInInit && ['initialize', 'tools/list', 'tools/call'].every((m) => answers.q1.methodsByServer[MODS].includes(m));
  const q2 = a1.askedFirst;
  const ranAll = runA.results.length >= 2 && runB.results.length === 1 && runC.results.length === 1 && [runA, runB, runC].every((x) => x.results.every((r) => r.isError === false));
  return { verdict: q1 && q2 ? (ranAll && answers.q3.subAgentRan ? 'pass' : 'partial') : 'fail', toolVersions: { claude: version }, evidence: { checks: { q1, q2, ranAll }, answers, runA, runB, runC } };
}
