// p01-claude-cli-manual — the manual half of P01 (spec §19.1 M1.0 P01; OPEN 8,
// §3.3, §10 law 7, G-SUB-01). FOUNDER-RUN, interactive; costs ~3 short turns
// on the founder's subscription. Keep ANTHROPIC_API_KEY unset.
//   node packages/gnomon/probes/run.mjs p01-claude-cli-manual --timeout 1800000
// The `claude` binary comes from p01-claude-cli's committed result
// (evidence.claude.path) — by explicit path, NEVER via PATH (§3.3).
// Checks:
//   A. hook stdin session_id — a project-settings SessionStart + UserPromptSubmit
//      hook dumps its stdin; session_id must be present and equal the
//      result's session_id (OPEN 8: 2.1.288+).
//   B. stream-json control_request interrupt — the §3.3 stream-json line; on the
//      first streamed chunk send {"type":"control_request","request":{"subtype":
//      "interrupt"}}; record the control_response and that the turn stops.
//   C. loopback override — ANTHROPIC_BASE_URL at a listener in THIS process:
//      does the CLI send the subscription credential to whatever listens?
//      Only header NAMES and the auth scheme are recorded, never a value. The
//      law-7 refusal itself is the adapter's (M1.7, G-SUB-01); this records
//      why it must refuse.
//   D. managed-policy semantics — with a managed-settings.json SessionStart
//      hook installed by the founder (sudo, printed), does it load under
//      --setting-sources project (i.e. is managed policy outside the
//      setting-sources switch)? Skipped if a managed file already exists.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { onAbort } from '../_shared/abort.mjs';
import { ask, bindSignal, interactive, say } from '../_shared/signing.mjs';

export const specRefs = ['§3.3 spawn line', '§10 law 7', '§19.1 M1.0 P01', 'OPEN 8', 'G-SUB-01', 'G-RUN-03', 'A23-4'];

const MANAGED = '/Library/Application Support/ClaudeCode/managed-settings.json';

function claudePath(probeDir) {
  const res = path.join(probeDir, '..', 'results', `p01-claude-cli.${process.platform}.json`);
  if (!existsSync(res)) return { error: `no ${path.basename(res)} — run p01-claude-cli first` };
  const p = JSON.parse(readFileSync(res, 'utf8')).evidence?.claude?.path;
  if (!p) return { error: 'p01 result has no evidence.claude.path' };
  const abs = p.replace(/^~(?=\/)/, os.homedir());
  return existsSync(abs) ? { path: abs, recorded: p } : { error: `recorded claude path ${p} does not exist` };
}

function env() {
  const e = { ...process.env };
  delete e.ANTHROPIC_API_KEY;
  delete e.ANTHROPIC_BASE_URL;
  delete e.ANTHROPIC_AUTH_TOKEN;
  return e;
}

function runClaude(bin, args, cwd, extraEnv = {}, timeout = 180_000) {
  const r = spawnSync(bin, args, { cwd, env: { ...env(), ...extraEnv }, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // not json
  }
  return { status: r.status, signal: r.signal, json, stdoutTail: json ? undefined : (r.stdout ?? '').slice(-400), stderrTail: (r.stderr ?? '').slice(-400) };
}

function hookProject(dir, events) {
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const hooks = Object.fromEntries(events.map((ev) => [ev, [{ hooks: [{ type: 'command', command: `cat > '${path.join(dir, `hook-${ev}.json`)}'` }] }]]));
  writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ hooks }, null, 2));
}

function readHook(dir, ev) {
  const f = path.join(dir, `hook-${ev}.json`);
  if (!existsSync(f)) return { fired: false };
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { fired: true, keys: Object.keys(j).sort(), sessionId: j.session_id ?? null, hookEventName: j.hook_event_name ?? null };
  } catch {
    return { fired: true, unparsed: true };
  }
}

async function checkA(bin) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p01a-')));
  hookProject(dir, ['SessionStart', 'UserPromptSubmit']);
  const r = runClaude(bin, ['-p', 'Reply with the single word ok.', '--output-format', 'json', '--setting-sources', 'project', '--max-turns', '1'], dir);
  const ss = readHook(dir, 'SessionStart');
  const ups = readHook(dir, 'UserPromptSubmit');
  const sid = r.json?.session_id ?? null;
  return {
    resultSessionId: sid ? 'present' : null,
    sessionStart: { ...ss, sessionId: ss.sessionId ? 'present' : null, matchesResult: !!sid && ss.sessionId === sid },
    userPromptSubmit: { ...ups, sessionId: ups.sessionId ? 'present' : null, matchesResult: !!sid && ups.sessionId === sid },
    exit: r.status,
    isError: r.json?.is_error ?? null,
    costUsd: r.json?.total_cost_usd ?? null,
    ok: !!sid && (ss.sessionId === sid || ups.sessionId === sid),
  };
}

function checkB(bin) {
  return new Promise((resolve) => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p01b-')));
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--setting-sources', 'project', '--max-turns', '1'];
    const c = spawn(bin, args, { cwd: dir, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
    const t0 = Date.now();
    let buf = '';
    let sentAt = null;
    let chunksBefore = 0;
    let chunksAfter = 0;
    const out = { args, events: {} };
    const send = (o) => c.stdin.write(`${JSON.stringify(o)}\n`);
    send({ type: 'user', message: { role: 'user', content: 'Count from 1 to 400, one number per line, nothing else.' } });
    const killer = setTimeout(() => c.kill('SIGKILL'), 180_000);
    const unhook = onAbort(() => c.kill('SIGKILL'));
    let text = '';
    c.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        out.events[m.type] = (out.events[m.type] ?? 0) + 1;
        if (m.type === 'stream_event') sentAt ? chunksAfter++ : chunksBefore++;
        if (m.type === 'stream_event' && typeof m.event?.delta?.text === 'string') text += m.event.delta.text;
        if (m.type === 'stream_event' && !sentAt && chunksBefore >= 5) {
          sentAt = Date.now();
          send({ type: 'control_request', request_id: 'p01-interrupt-1', request: { subtype: 'interrupt' } });
        }
        if (m.type === 'control_response') out.controlResponse = { requestId: m.response?.request_id ?? null, subtype: m.response?.subtype ?? null, msAfterSend: sentAt ? Date.now() - sentAt : null, error: m.response?.error ?? undefined };
        if (m.type === 'result') {
          out.result = { subtype: m.subtype, isError: m.is_error, msAfterInterrupt: sentAt ? Date.now() - sentAt : null, numTurns: m.num_turns, costUsd: m.total_cost_usd, resultChars: typeof m.result === 'string' ? m.result.length : null };
          c.stdin.end();
        }
      }
    });
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code, signal) => {
      clearTimeout(killer);
      unhook();
      out.exit = { code, signal, ms: Date.now() - t0, stderrTail: err.slice(-300) || undefined };
      out.chunks = { beforeInterrupt: chunksBefore, afterInterrupt: chunksAfter };
      out.interruptSent = !!sentAt;
      // Truncated = the streamed count never reached 400.
      const nums = (text.match(/\d+/g) ?? []).map(Number).filter((n) => n <= 400);
      out.streamedMaxNumber = nums.length ? Math.max(...nums) : null;
      out.truncated = out.streamedMaxNumber !== null && out.streamedMaxNumber < 400;
      out.ok = out.controlResponse?.subtype === 'success' && out.controlResponse?.requestId === 'p01-interrupt-1'
        && !!out.result && (out.result.msAfterInterrupt ?? Infinity) < 15_000 && out.truncated;
      resolve(out);
    });
  });
}

async function checkC(bin) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    seen.push({ method: req.method, path: req.url.split('?')[0], headerNames: Object.keys(req.headers).sort(), authorizationScheme: auth ? auth.split(' ')[0] : null, xApiKey: 'x-api-key' in req.headers });
    res.writeHead(500, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"api_error","message":"gnomon p01 loopback stand-in"}}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p01c-')));
  const r = runClaude(bin, ['-p', 'ok', '--output-format', 'json', '--setting-sources', 'project', '--max-turns', '1'], dir, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }, 90_000);
  srv.close();
  return {
    requestsToOverride: seen.length,
    requests: seen.slice(0, 5),
    credentialSentToOverride: seen.some((s) => s.authorizationScheme || s.xApiKey),
    exit: r.status,
    isError: r.json?.is_error ?? null,
    note: 'observation only; the law-7 refusal of a loopback override is the adapter preflight (M1.7, G-SUB-01)',
  };
}

async function checkD(bin) {
  if (existsSync(MANAGED)) return { skipped: `a managed settings file already exists at ${MANAGED}; not touching it` };
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p01d-')));
  const marker = path.join(dir, 'managed-hook.json');
  const policy = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `cat > '${marker}'` }] }] } });
  const staged = path.join(dir, 'managed-settings.json');
  writeFileSync(staged, policy);
  await ask(`D. Managed policy. In ANOTHER terminal tab, run exactly:
    sudo mkdir -p "/Library/Application Support/ClaudeCode" && sudo cp '${staged}' "${MANAGED}"
Then come back here and press Enter.`);
  if (!existsSync(MANAGED)) return { skipped: 'managed file not installed' };
  // From here a test policy is live machine-wide: on Ctrl-C / timeout, tell
  // the founder exactly how to remove it (we cannot: it needs sudo).
  const rmLine = `sudo rm "${MANAGED}"`;
  const unhook = onAbort(() => {
    if (existsSync(MANAGED)) process.stderr.write(`\n!!! The P01 test managed policy is STILL INSTALLED. Remove it now:\n    ${rmLine}\n\n`);
  });
  const r = runClaude(bin, ['-p', 'Reply with the single word ok.', '--output-format', 'json', '--setting-sources', 'project', '--max-turns', '1'], dir);
  const fired = existsSync(marker);
  await ask(`D. Done. In the other tab, REMOVE the test policy now:
    ${rmLine}
Press Enter when removed.`);
  const removedAfter = !existsSync(MANAGED);
  if (!removedAfter) process.stderr.write(`\n!!! Not removed yet. Run:\n    ${rmLine}\n\n`);
  unhook();
  return { managedHookFiredUnderSettingSourcesProject: fired, exit: r.status, removedAfter, ok: removedAfter === true, meaning: fired ? 'managed policy loads regardless of --setting-sources (it is outside the switch)' : 'managed hook did NOT fire under --setting-sources project' };
}

export default async function probe(ctx) {
  const cp = claudePath(ctx.probeDir);
  const version = cp.path ? spawnSync(cp.path, ['--version'], { encoding: 'utf8' }).stdout.trim() : null;
  const plan = ['A hook stdin session_id (1 turn)', 'B control_request interrupt (1 short turn)', 'C loopback override observation (no model turn)', 'D managed-policy semantics (1 turn, sudo in another tab)'];
  if (cp.error) return { verdict: 'partial', evidence: { blocked: cp.error } };
  if (process.env.ANTHROPIC_API_KEY) return { verdict: 'partial', evidence: { blocked: 'ANTHROPIC_API_KEY is set; unset it (law 7: subscription only) and re-run' } };
  if (!interactive()) return { verdict: 'partial', evidence: { notRun: 'interactive founder probe', claude: { path: cp.recorded, version, via: 'p01-claude-cli result (never PATH)' }, plan } };
  bindSignal(ctx.signal);
  onAbort(() => {}, ctx.signal)(); // install the SIGINT/SIGTERM + ctx.signal hooks
  say(`P01 manual half with ${cp.recorded} (${version}). Four checks; each asks first.`);
  const ev = { claude: { path: cp.recorded, version, via: 'p01-claude-cli result (never PATH)' } };
  if (!/^n/i.test(await ask('A. Hook stdin session_id: runs one tiny `claude -p` turn in a temp project with a hook that saves its stdin. Run it? [Y/n]'))) ev.A = await checkA(cp.path);
  if (!/^n/i.test(await ask('B. Interrupt: starts a stream-json turn counting to 400 and interrupts it after a few chunks. Run it? [Y/n]'))) ev.B = await checkB(cp.path);
  if (/^y/i.test(await ask('C. Loopback override: runs claude with ANTHROPIC_BASE_URL pointing at a listener inside THIS probe. If the CLI sends your subscription credential there, the probe sees it in memory and records only the header name/scheme, never the value. Run it? [y/N]'))) ev.C = await checkC(cp.path);
  if (/^y/i.test(await ask('D. Managed policy: you will install (and then remove) a test managed-settings.json with sudo in another tab. Run it? [y/N]'))) ev.D = await checkD(cp.path);
  const failed = (ev.A && !ev.A.ok) || (ev.B && !ev.B.ok);
  // D only counts once the test policy is confirmed removed.
  const complete = ev.A && ev.B && ev.C && ev.D && !ev.D.skipped && ev.D.removedAfter === true;
  return { verdict: failed ? 'fail' : complete ? 'pass' : 'partial', evidence: ev, toolVersions: { claude: version ?? 'unknown' } };
}
