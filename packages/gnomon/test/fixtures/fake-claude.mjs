// A FAKE `claude` for the M1.7 tests — never the real binary, never Anthropic. Launched through a generated
// `#!/bin/sh` wrapper named `claude` (test/session-helpers.ts). Its behaviour comes from `mode.json` beside the
// wrapper (the child env is allowlisted, so env vars cannot steer it). It records its argv, env NAMES and every
// stdin line to `trace.jsonl` in the same dir, and speaks the stream-json shapes p10m-claude-compat-generated
// observed from Claude Code 2.1.302 (system.init, stream_event.*, assistant, user, rate_limit_event, result).
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = path.dirname(path.dirname(process.argv[2] ?? process.argv[1])); // the wrapper lives in <stub>/bin/
const self = process.argv[3];
const args = process.argv.slice(4);
let mode = {};
try { mode = JSON.parse(readFileSync(path.join(dir, 'mode.json'), 'utf8')); } catch { mode = {}; }
const trace = (o) => { try { appendFileSync(path.join(dir, 'trace.jsonl'), `${JSON.stringify(o)}\n`); } catch { /* sandboxed away */ } };
const out = (o) => process.stdout.write(`${typeof o === 'string' ? o : JSON.stringify(o)}\n`);

if (args[0] === '--version') {
  let probe = null;
  if (mode.probeWrite) { try { appendFileSync(mode.probeWrite, 'x'); probe = 'allowed'; } catch { probe = 'blocked'; } }
  trace({ t: 'version', self, probe });
  out(`${mode.version ?? '2.1.302'} (Claude Code)`);
  process.exit(0);
}
if (args[0] === 'auth') {
  out(JSON.stringify(mode.auth ?? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }));
  process.exit(0);
}
trace({ t: 'argv', args, self, home: process.env.HOME, envKeys: Object.keys(process.env).sort(), pid: process.pid });
// P8-D94: emulate Claude's SessionStart command hooks — from --settings, and from the repo's project/local
// layers ONLY when --setting-sources names them (the semantics the audited mode relies on)
{
  const at = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
  const sources = (at('--setting-sources') ?? '').split(',').filter(Boolean);
  const files = [at('--settings'), ...(sources.includes('project') ? [path.join(process.cwd(), '.claude', 'settings.json')] : []), ...(sources.includes('local') ? [path.join(process.cwd(), '.claude', 'settings.local.json')] : [])];
  for (const f of files) {
    if (!f) continue;
    let doc;
    try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const g of doc?.hooks?.SessionStart ?? []) for (const h of g.hooks ?? []) {
      if (h.type !== 'command') continue;
      const r = spawnSync('/bin/sh', ['-c', h.command], { stdio: 'ignore', timeout: 5000 });
      trace({ t: 'hook', event: 'SessionStart', command: h.command, from: f, status: r.status });
    }
  }
}
// P8-D97: emulate what p10m-repo-context measured. (1) A --plugin-dir's skill/agent/command frontmatter hooks FIRE
// (here: every `command:` line inside a frontmatter `hooks:` block runs at start). (2) --add-dir memory loads only
// with CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 (CLAUDE.md + one level of @imports, traced). (3) the effective
// permissions.allow is the --settings file's plus the project/local layers' only when --setting-sources names them.
{
  const all = (f) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));
  const at = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
  const sources = (at('--setting-sources') ?? '').split(',').filter(Boolean);
  const walk = (d) => { try { return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); } catch { return []; } };
  for (const pd of all('--plugin-dir')) {
    const files = walk(pd).filter((f) => f.endsWith('.md'));
    trace({ t: 'plugin', dir: pd, files: files.map((f) => path.relative(pd, f)) });
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const fm = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : '';
      const block = /^hooks:\n((?:[ -].*\n?)*)/m.exec(fm);
      for (const m of block ? block[1].matchAll(/command:\s*(.+)$/gm) : []) {
        const r = spawnSync('/bin/sh', ['-c', m[1]], { stdio: 'ignore', timeout: 5000 });
        trace({ t: 'hook', event: 'frontmatter', command: m[1], from: f, status: r.status });
      }
    }
  }
  if (process.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD === '1') {
    for (const d of all('--add-dir')) {
      let text;
      try { text = readFileSync(path.join(d, 'CLAUDE.md'), 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/^@(\S+)$/gm)) { try { text += readFileSync(path.resolve(d, m[1]), 'utf8'); } catch { /* missing import */ } }
      trace({ t: 'memory', dir: d, text });
    }
  }
  const allow = [];
  const layers = [at('--settings'), ...(sources.includes('project') ? [path.join(process.cwd(), '.claude', 'settings.json')] : []), ...(sources.includes('local') ? [path.join(process.cwd(), '.claude', 'settings.local.json')] : [])];
  for (const f of layers) { try { allow.push(...(JSON.parse(readFileSync(f, 'utf8'))?.permissions?.allow ?? [])); } catch { /* none */ } }
  trace({ t: 'allow', allow });
}
if (mode.exitAtStart !== undefined) process.exit(mode.exitAtStart);
if (mode.ignoreTerm) process.on('SIGTERM', () => trace({ t: 'sigterm-ignored' }));
const session = args[args.indexOf('--session-id') + 1] ?? 'none';
out({ type: 'system', subtype: 'hook_started', hook: 'x', futureField: { a: 1 } });
out({ type: 'system', subtype: 'init', session_id: session, model: 'fake-model', apiKeySource: 'apiKeySource' in mode ? mode.apiKeySource : 'none', tools: ['Bash'], brandNewField: true });
for (const l of mode.extraLines ?? []) out(l);
if (mode.bigLine) out({ type: 'assistant', message: { id: 'big', content: [{ type: 'text', text: 'x'.repeat(mode.bigLine) }] } });
let n = 0;
let buf = '';
// P8-D96 permissionAsk: after a user message, emit each step — {request:{id, tool, input}} as a p01b-shaped
// control_request{subtype:'can_use_tool'}, or {line} verbatim — then wait for an answer to every request. An allowed
// Write writes updatedInput.content to updatedInput.file_path (the real tool effect, under the session profile);
// an allowed Bash runs updatedInput.command. `hold: true` never finishes the turn.
const perm = { open: new Map(), denied: [], turnDone: null };
const finishPerm = () => {
  if (perm.open.size || !perm.turnDone) return;
  const done = perm.turnDone;
  perm.turnDone = null;
  done();
};
const runAllowed = (req, updatedInput) => {
  try {
    if (req.tool === 'Write') { writeFileSync(updatedInput.file_path, String(updatedInput.content)); trace({ t: 'tool-ran', tool: 'Write', path: updatedInput.file_path }); }
    else if (req.tool === 'Bash') { const r = spawnSync('/bin/sh', ['-c', String(updatedInput.command)], { stdio: 'ignore', timeout: 5000 }); trace({ t: 'tool-ran', tool: 'Bash', status: r.status }); }
    else trace({ t: 'tool-ran', tool: req.tool });
  } catch (e) { trace({ t: 'tool-failed', tool: req.tool, error: String(e?.message ?? e) }); }
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let m;
    try { m = JSON.parse(line); } catch { trace({ t: 'bad-stdin', line }); continue; }
    trace({ t: 'stdin', m });
    if (m.type === 'control_request') {
      out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } });
      continue;
    }
    if (m.type === 'control_response') {
      const id = m.response?.request_id;
      const req = perm.open.get(id);
      trace({ t: 'perm-answer', id, known: !!req, subtype: m.response?.subtype, behavior: m.response?.response?.behavior ?? null, updatedInput: m.response?.response?.updatedInput, message: m.response?.response?.message, keys: Object.keys(m.response?.response ?? {}).sort() });
      if (!req) continue;
      perm.open.delete(id);
      const allowed = m.response?.subtype === 'success' && m.response?.response?.behavior === 'allow';
      if (allowed) runAllowed(req, m.response.response.updatedInput ?? {});
      else perm.denied.push({ tool_name: req.tool, tool_use_id: req.toolUseId, tool_input: req.input });
      // the tool_result line real claude writes after the decision (p01b: permission_decision user_temporary / user_reject)
      out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: req.toolUseId, content: allowed ? 'ok' : 'denied', ...(allowed ? {} : { is_error: true }) }] }, tool_result_meta: [{ id: req.toolUseId, permission_decision: { decision: allowed ? 'accept' : 'reject', source: allowed ? 'user_temporary' : 'user_reject' } }] });
      finishPerm();
      continue;
    }
    if (m.type !== 'user') continue;
    n++;
    const id = `msg_${n}`;
    out({ ...m, isReplay: true });
    if (mode.permissionAsk) {
      let k = 0;
      for (const st of mode.permissionAsk.steps ?? []) {
        if (st.line !== undefined) { out(st.line); continue; }
        if (st.ungated) {
          // a gated tool that runs with NO can_use_tool request (an allow rule / hook would do this in real claude)
          const u = st.ungated;
          const tu = u.toolUseId ?? `toolu_ungated_${n}_${++k}`;
          out({ type: 'assistant', message: { id: `${id}_u${k}`, content: [{ type: 'tool_use', id: tu, name: u.tool, input: u.input }], usage: { input_tokens: 1, output_tokens: 1 } } });
          runAllowed({ tool: u.tool }, u.input);
          out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu, content: 'ok' }] }, tool_result_meta: [{ id: tu, permission_decision: { decision: 'accept', source: 'config', reason_type: 'rule' } }] });
          continue;
        }
        const r = st.request;
        const reqId = r.id ?? `req-${n}-${++k}`;
        const toolUseId = r.toolUseId ?? `toolu_${n}_${k}`;
        out({ type: 'assistant', message: { id: `${id}_t${k}`, content: [{ type: 'tool_use', id: toolUseId, name: r.tool, input: r.input }], usage: { input_tokens: 1, output_tokens: 1 } } });
        if (!perm.open.has(reqId)) perm.open.set(reqId, { tool: r.tool, input: r.input, toolUseId });
        out({ type: 'control_request', request_id: reqId, request: { subtype: 'can_use_tool', tool_name: r.tool, display_name: r.tool, input: r.input, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: r.tool }], behavior: 'allow', destination: 'localSettings' }], tool_use_id: toolUseId } });
      }
      if (mode.permissionAsk.exitAfterMs !== undefined) setTimeout(() => { trace({ t: 'self-exit' }); process.exit(0); }, mode.permissionAsk.exitAfterMs);
      if (mode.permissionAsk.hold) continue;
      perm.turnDone = () => {
        out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, permission_denials: perm.denied.splice(0), result: 'ok' });
      };
      finishPerm();
      continue;
    }
    out({ type: 'stream_event', event: { type: 'message_start', message: { id, usage: { input_tokens: 10, output_tokens: 1 } } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } });
    const tool = mode.tool ? [{ type: 'tool_use', id: `tu_${n}`, name: mode.tool, input: { question: 'Which?' } }] : [];
    // the same message id twice with cumulative usage: the meter charges the delta once
    out({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } } });
    out({ type: 'assistant', message: { id, content: tool, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 } } });
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
    if (mode.resultThenExit) { out({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 25, cache_read_input_tokens: 100 }, permission_denials: [] }); process.exit(0); }
    out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 25, cache_read_input_tokens: 100 }, permission_denials: [], result: 'ok' });
  }
});
process.stdin.on('end', () => { trace({ t: 'stdin-end' }); if (!mode.ignoreStdinEnd) process.exit(0); });
setInterval(() => undefined, 1 << 30);
