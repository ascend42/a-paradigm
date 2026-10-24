// p-kernel-mcp-sdk — does real Claude Code accept the kernel's SDK MCP server and route it over stdio? (#kernel-mcp,
// T-2026-10-23-002). Real claude on the founder's subscription, `claude -p` with the adapter's stream-json control
// channel and permission flags (--permission-prompts host --permission-prompt-tool stdio), `--mcp-config` holding ONLY
// {"gnomon":{"type":"sdk","name":"gnomon"}} and `--strict-mcp-config` (no sandbox profile: the question is the channel).
// The answers come from the KERNEL'S OWN code: parseStreamLine (adapter), kernelMcpAnswer + GitVerbs (git.init in a
// fresh folder, auto-edits with a stub broker), mcpResponseLine. One cheap turn on haiku:
//   C1 claude starts and system.init lists mcp__gnomon__gnomon_git_init with mcp_servers gnomon connected (source sdk)
//   C2 the handshake arrives as control_request{subtype:'mcp_message', server_name:'gnomon'}: initialize,
//      notifications/initialized, tools/list — each parsed by the adapter as `mcp-message`
//   C3 the model's tool use: can_use_tool for mcp__gnomon__gnomon_git_init, then tools/call, answered by GitVerbs
//   C4 the fresh folder is a repo (HEAD on main), the turn's result is not an error
// VERDICT: pass when all hold; fail otherwise. Run (TypeScript sources): npx tsx probes/run.mjs p-kernel-mcp-sdk
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStreamLine, mcpResponseLine, permissionAllowLine } from '../../src/adapters/claude-code/adapter.ts';
import { kernelMcpAnswer, KERNEL_MCP_ENTRY } from '../../src/kernel/supervisor/kernel-mcp.ts';
import { GitVerbs } from '../../src/kernel/git/kernel-verbs.ts';

export const specRefs = ['§6.6 kernel-run git verbs', '#kernel-mcp'];

const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-pkmcp-')));
  const cwd = path.join(root, 'fresh');
  mkdirSync(cwd);
  const mcp = path.join(root, 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gnomon: { ...KERNEL_MCP_ENTRY } } }));
  const version = await new Promise((r) => {
    const c = spawn(CLAUDE, ['--version']);
    let o = '';
    c.stdout.on('data', (d) => (o += d));
    c.on('close', () => r(o.trim()));
  });
  const rows = [];
  const autos = [];
  const verbs = new GitVerbs({ log: async (kind, payload) => void rows.push({ kind, phase: payload.phase, why: payload.why ?? null }), broker: { raise: async () => { throw new Error('no card expected'); }, decisionOf: async () => 'deny', auto: async (p) => void autos.push(p.modeRef) }, gnomonHome: path.join(root, 'gnomon'), userHome: () => os.homedir() });
  const session = { hsid: 'hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', principalId: 'p:probe/s-x', cwd, repoKey: 'sha256:00', mode: 'auto-edits', planApproved: false, loop: false, worktreesGuarded: true };
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--mcp-config', mcp, '--strict-mcp-config', '--setting-sources', '', '--model', 'haiku', '--max-turns', '3'];
  const ev = { claude: version, init: null, mcpServers: null, handshake: [], parsedAs: [], permissionFor: [], toolCall: null, toolAnswer: null, result: null, repoHead: null, verbRows: rows, autos, stderr: '' };
  const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const write = (l) => child.stdin.write(l);
  let buf = '';
  const done = new Promise((resolve) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 150_000);
    child.on('close', (code) => { clearTimeout(t); resolve(code); });
  });
  child.stderr.on('data', (d) => (ev.stderr += d));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', async (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'system' && o.subtype === 'init') { ev.init = (o.tools ?? []).filter((x) => x.startsWith('mcp__gnomon__')); ev.mcpServers = o.mcp_servers; }
      if (o.type === 'result') { ev.result = { subtype: o.subtype, isError: o.is_error, text: String(o.result ?? '').slice(0, 300) }; child.stdin.end(); }
      if (o.type !== 'control_request') continue;
      const p = parseStreamLine(line);
      ev.parsedAs.push(p.kind);
      if (p.kind === 'mcp-message') {
        const m = p.message;
        ev.handshake.push(m?.method);
        if (m?.method === 'tools/call') ev.toolCall = { name: m.params?.name, arguments: m.params?.arguments };
        const a = await kernelMcpAnswer(m, verbs, () => session);
        if (m?.method === 'tools/call') ev.toolAnswer = a.result ?? a.error;
        write(mcpResponseLine(p.requestId, a));
      } else if (p.kind === 'permission-request') {
        ev.permissionFor.push(p.toolName);
        write(permissionAllowLine(p.requestId, p.input));
      }
    }
  });
  write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Call the tool mcp__gnomon__gnomon_git_init with no arguments, then reply with only its output text.' }] } })}\n`);
  const exit = await done;
  try { ev.repoHead = readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim(); } catch { ev.repoHead = null; }
  ev.exit = exit;
  ev.stderr = ev.stderr.slice(0, 2000);
  rmSync(root, { recursive: true, force: true });
  const c1 = Array.isArray(ev.init) && ev.init.includes('mcp__gnomon__gnomon_git_init') && (ev.mcpServers ?? []).some((s) => s.name === 'gnomon' && s.status === 'connected');
  const c2 = ['initialize', 'notifications/initialized', 'tools/list'].every((x) => ev.handshake.includes(x)) && !ev.parsedAs.includes('control-request-unknown');
  const c3 = ev.permissionFor.includes('mcp__gnomon__gnomon_git_init') && ev.toolCall?.name === 'gnomon_git_init' && ev.toolAnswer?.isError === false;
  const c4 = ev.repoHead === 'ref: refs/heads/main' && ev.result?.isError === false;
  return { verdict: c1 && c2 && c3 && c4 ? 'pass' : 'fail', evidence: { checks: { c1, c2, c3, c4 }, ...ev } };
}
