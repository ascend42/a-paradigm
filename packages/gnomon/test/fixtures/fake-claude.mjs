// A FAKE `claude` for the M1.7 tests — never the real binary, never Anthropic. Launched through a generated
// `#!/bin/sh` wrapper named `claude` (test/session-helpers.ts). Its behaviour comes from `mode.json` beside the
// wrapper (the child env is allowlisted, so env vars cannot steer it). It records its argv, env NAMES and every
// stdin line to `trace.jsonl` in the same dir, and speaks the stream-json shapes p10m-claude-compat-generated
// observed from Claude Code 2.1.302 (system.init, stream_event.*, assistant, user, rate_limit_event, result).
import { appendFileSync, readFileSync } from 'node:fs';
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
if (mode.exitAtStart !== undefined) process.exit(mode.exitAtStart);
if (mode.ignoreTerm) process.on('SIGTERM', () => trace({ t: 'sigterm-ignored' }));
const session = args[args.indexOf('--session-id') + 1] ?? 'none';
out({ type: 'system', subtype: 'hook_started', hook: 'x', futureField: { a: 1 } });
out({ type: 'system', subtype: 'init', session_id: session, model: 'fake-model', apiKeySource: 'apiKeySource' in mode ? mode.apiKeySource : 'none', tools: ['Bash'], brandNewField: true });
for (const l of mode.extraLines ?? []) out(l);
if (mode.bigLine) out({ type: 'assistant', message: { id: 'big', content: [{ type: 'text', text: 'x'.repeat(mode.bigLine) }] } });
let n = 0;
let buf = '';
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
    if (m.type !== 'user') continue;
    n++;
    const id = `msg_${n}`;
    out({ ...m, isReplay: true });
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
