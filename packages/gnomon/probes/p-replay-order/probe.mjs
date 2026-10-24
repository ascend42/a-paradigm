// p-replay-order — when does Claude Code echo a QUEUED user message (--replay-user-messages)? (re-review M-1, M-4;
// T-2026-10-21-008). The supervisor (#session-supervisor), the offer router (#offer-router) and the GUI store pair
// turn.result with the turns Claude Code "consumed", and a replay line is the consumption mark. If the echo came on
// RECEIPT (the moment the line reaches stdin), one result would close a turn that has not started.
// Real claude (the newest pinned copy in ~/.gnomon/bin, else ~/.local/share/claude/versions/<newest>) with the
// adapter's stream flags (adapter.ts buildClaudeArgv: -p, stream-json in and out, --verbose, --replay-user-messages,
// --include-partial-messages), no sandbox profile, in a throwaway dir, haiku, tiny prompts. Env: HOME, USER, LOGNAME,
// PATH only (the subscription login is read from the keychain by USER; nothing here reads or prints a credential).
// Cases, each its own process:
//   a  B sent while A's Bash `sleep 5` runs (Bash pre-allowed with --allowedTools, permission mode default)
//   b  B sent right after A's final message_stop, before A's result (a race: the result may already be out)
//   c  A alone
//   d  B sent right after A, before any output
//   e  a Stop hook (in --settings) that blocks once with exit 2, the adapter flags only: is a hook_response emitted?
//   f  the same with --include-hook-events
//   g  B sent the moment the Stop hook's feedback line arrives (inside the continuation), adapter flags
// Each case records the ordering of SENT, replay, message_start/stop, tool_result and result lines (no text beyond the
// ALPHA/BRAVO tag). VERDICT: pass when every case ran to its result(s); the finding is in evidence.summary.
// Run: node probes/run.mjs p-replay-order --timeout 900000
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const specRefs = ['§3.3 stream-json (replayed user messages)', '§12.9 turn.result pairing', 're-review M-1/M-4'];

function pinnedClaude() {
  const bin = path.join(os.homedir(), '.gnomon', 'bin');
  const pinned = existsSync(bin) ? readdirSync(bin).filter((f) => /^claude-[0-9a-f]{32}$/.test(f)).map((f) => path.join(bin, f)) : [];
  if (pinned.length) return pinned.sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0];
  const vers = path.join(os.homedir(), '.local', 'share', 'claude', 'versions');
  const v = existsSync(vers) ? readdirSync(vers).filter((f) => /^\d+\.\d+\.\d+$/.test(f)) : [];
  v.sort((x, y) => x.split('.').map(Number).reduce((d, n, i) => d || n - Number(y.split('.')[i]), 0));
  return v.length ? path.join(vers, v[v.length - 1]) : null;
}

const MODEL = process.env.P_REPLAY_MODEL ?? 'haiku';
const shellEnv = () => Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'PATH'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));

function tagOf(text) {
  return text.includes('ALPHA') ? 'A' : text.includes('BRAVO') ? 'B' : text.includes('CHARLIE') ? 'C' : '?';
}

/** One stdout line → an ordering label, or null for the noise (deltas). Never carries model text. */
function labelOf(o) {
  const sub = o.parent_tool_use_id ? 'sub:' : '';
  if (o.type === 'system') {
    if (o.subtype === 'init') return 'init';
    if (o.subtype === 'hook_response' || o.subtype === 'hook_started') return `${o.subtype}(${o.hook_event ?? o.hook_name ?? '?'};exit=${o.exit_code ?? '-'};outcome=${o.outcome ?? '-'};decision=${o.decision ?? '-'})`;
    return `system.${o.subtype ?? '?'}`;
  }
  if (o.type === 'user') {
    const c = o.message?.content;
    const blocks = Array.isArray(c) ? c : [];
    if (blocks.some((b) => b?.type === 'tool_result')) return `${sub}tool_result${o.isReplay ? '(replay)' : ''}`;
    const text = typeof c === 'string' ? c : blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
    return `${sub}${o.isReplay ? 'replay' : 'user'}(${tagOf(text)})`;
  }
  if (o.type === 'stream_event') {
    const e = o.event ?? {};
    if (e.type === 'message_start') return `${sub}message_start`;
    if (e.type === 'message_stop') return `${sub}message_stop`;
    if (e.type === 'message_delta' && e.delta?.stop_reason) return `${sub}delta(${e.delta.stop_reason})`;
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') return `${sub}block_start(tool_use:${e.content_block.name})`;
    return null;
  }
  if (o.type === 'assistant') return `${sub}assistant(${(o.message?.content ?? []).map((b) => (b.type === 'tool_use' ? `tool_use:${b.name}` : b.type)).join(',')};stop=${o.message?.stop_reason ?? '-'})`;
  if (o.type === 'result') return `result(${o.subtype ?? '?'}${o.is_error ? ';error' : ''};turns=${o.num_turns ?? '?'})`;
  return `other(${o.type})`;
}

async function runCase(claude, name, { extra = [], settings = null, drive }) {
  const cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), `gnomon-preplay-${name}-`)));
  const argv = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--include-partial-messages', '--permission-mode', 'default', '--allowedTools', 'Bash', '--session-id', randomUUID(), '--model', MODEL, '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', ...extra];
  if (settings) {
    const f = path.join(cwd, 'settings.json');
    writeFileSync(f, JSON.stringify(settings(cwd)));
    argv.push('--settings', f);
  }
  const child = spawn(claude, argv, { cwd, env: shellEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  const t0 = Date.now();
  const order = [];
  const waiters = [];
  let lastAt = Date.now();
  let buf = '';
  let stderrBytes = 0;
  const mark = (label) => {
    order.push({ t: Date.now() - t0, label });
    lastAt = Date.now();
    for (const w of [...waiters]) if (w.f(label)) (waiters.splice(waiters.indexOf(w), 1), w.r(true));
  };
  child.stderr.on('data', (d) => (stderrBytes += d.length));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        mark('non-json');
        continue;
      }
      const l = labelOf(o);
      if (l) mark(l);
    }
  });
  const exited = new Promise((r) => child.on('close', (code) => r(code)));
  const until = (f, ms = 90_000) =>
    new Promise((r) => {
      if (order.some((x) => f(x.label))) return r(true);
      const w = { f, r };
      waiters.push(w);
      setTimeout(() => (waiters.includes(w) && waiters.splice(waiters.indexOf(w), 1), r(false)), ms);
    });
  const results = () => order.filter((x) => x.label.startsWith('result(')).length;
  const quiet = async (ms, cap = 120_000) => {
    const end = Date.now() + cap;
    while (Date.now() < end && (results() === 0 || Date.now() - lastAt < ms)) await new Promise((r) => setTimeout(r, 200));
  };
  const send = (tag, text) => {
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `${tag}: ${text}` }] } })}\n`);
    mark(`SENT(${tagOf(tag)})`);
  };
  try {
    await drive({ send, until, mark, quiet, results });
    await quiet(8000);
  } finally {
    child.stdin.end();
    const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(killer);
    rmSync(cwd, { recursive: true, force: true });
  }
  return { case: name, argvExtra: extra, results: results(), stderrBytes, order: order.map((x) => `${x.t}ms ${x.label}`) };
}

const OK = 'reply with the single word ok';

export default async function probe() {
  const claude = pinnedClaude();
  if (!claude) return { verdict: 'fail', evidence: { error: 'no pinned claude binary' } };
  const version = await new Promise((r) => {
    const c = spawn(claude, ['--version'], { env: shellEnv() });
    let o = '';
    c.stdout.on('data', (d) => (o += d));
    c.on('close', () => r(o.trim()));
  });
  const cases = [];
  cases.push(await runCase(claude, 'a-during-tool', {
    drive: async ({ send, until }) => {
      send('ALPHA', 'use the Bash tool to run exactly `sleep 5`, then reply with the single word ok');
      await until((l) => l.startsWith('block_start(tool_use') || l.includes('tool_use:Bash'));
      await until((l) => l.startsWith('assistant(') && l.includes('tool_use:Bash'), 20_000);
      await new Promise((r) => setTimeout(r, 1500)); // the sleep is running
      send('BRAVO', OK);
    },
  }));
  cases.push(await runCase(claude, 'b-after-final-stop', {
    drive: async ({ send, until }) => {
      send('ALPHA', OK);
      await until((l) => l === 'message_stop');
      send('BRAVO', OK);
    },
  }));
  cases.push(await runCase(claude, 'c-none-queued', { drive: async ({ send }) => send('ALPHA', OK) }));
  cases.push(await runCase(claude, 'd-back-to-back', {
    drive: async ({ send }) => {
      send('ALPHA', OK);
      send('BRAVO', OK);
    },
  }));
  const stopHook = (cwd) => ({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `if [ -f '${cwd}/stopped' ]; then exit 0; fi; touch '${cwd}/stopped'; echo 'CHARLIE: now reply with the single word done' >&2; exit 2` }] }] } });
  cases.push(await runCase(claude, 'e-stop-hook-adapter-flags', { settings: stopHook, drive: async ({ send }) => send('ALPHA', OK) }));
  cases.push(await runCase(claude, 'g-during-stop-hook-continuation', {
    settings: stopHook,
    drive: async ({ send, until }) => {
      send('ALPHA', OK);
      await until((l) => l === 'user(C)'); // the hook's feedback: the continuation starts
      send('BRAVO', OK);
    },
  }));
  cases.push(await runCase(claude, 'f-stop-hook-include-hook-events', { settings: stopHook, extra: ['--include-hook-events'], drive: async ({ send }) => send('ALPHA', OK) }));

  const idx = (c, f) => c.order.findIndex((x) => f(x.replace(/^\d+ms /, '')));
  const summary = {};
  for (const c of cases) {
    const sentB = idx(c, (l) => l === 'SENT(B)');
    const replayB = idx(c, (l) => l === 'replay(B)');
    const resultA = idx(c, (l) => l.startsWith('result('));
    summary[c.case] = {
      results: c.results,
      replayBAfterSent: sentB >= 0 && replayB >= 0 ? replayB - sentB : null,
      replayBBeforeFirstResult: replayB >= 0 && resultA >= 0 ? replayB < resultA : null,
      nextAfterReplayB: replayB >= 0 ? c.order[replayB + 1] ?? null : null,
      hookResponse: c.order.some((x) => x.includes('hook_response(')),
    };
  }
  const ran = cases.every((c) => c.results >= 1);
  return { verdict: ran ? 'pass' : 'partial', toolVersions: { claude: version }, evidence: { model: MODEL, summary, cases } };
}
