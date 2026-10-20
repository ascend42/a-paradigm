// p-set-model — the mid-session model switch prerequisite (#session-runner model picker, founder ask 2026-10-20).
// Real claude on the founder's subscription, `claude -p` with the stream-json control channel the adapter uses
// (no sandbox profile: the question is the control channel, not the profile). One process, no restart:
//   T1  (started --model haiku) "remember the codeword" => the assistant message's model is a haiku id
//   S1  control_request{subtype:'set_model', model:'sonnet'} => control_response success
//   T2  "what was the codeword?" => recall (the context carried over IN THE SAME PROCESS), the assistant message's
//       model is now a sonnet id, the result is not an error (no thinking-block / signature complaint)
//   S2  set_model 'not-a-real-model-xyz' => control_response error (claude refuses an unknown model itself)
//   S3  set_model 'default' => success
// VERDICT: pass when all hold; partial when the switch answered but recall or the model change was not seen; fail when
// set_model is not answered. Run: node probes/run.mjs p-set-model --timeout 300000
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const specRefs = ['§3.3 stream-json control channel', 'model picker (2026-10-20)'];

const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);
const CODEWORD = 'QUINCE-5521';

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-psetmodel-')));
  const version = await new Promise((r) => {
    const c = spawn(CLAUDE, ['--version']);
    let o = '';
    c.stdout.on('data', (d) => (o += d));
    c.on('close', () => r(o.trim()));
  });
  const child = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--session-id', randomUUID(), '--model', 'haiku', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  const waiters = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        events.push(m);
        for (const w of [...waiters]) if (w.f(m)) (waiters.splice(waiters.indexOf(w), 1), w.r(m));
      } catch {
        /* not json */
      }
    }
  });
  const until = (f, ms = 120_000) =>
    new Promise((r) => {
      const hit = events.find(f);
      if (hit) return r(hit);
      const w = { f, r };
      waiters.push(w);
      setTimeout(() => (waiters.includes(w) && waiters.splice(waiters.indexOf(w), 1), r(null)), ms);
    });
  const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
  const turn = async (text) => {
    const before = events.length;
    send({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
    const res = await until((m) => m.type === 'result' && events.indexOf(m) >= before);
    const msgs = events.slice(before).filter((m) => m.type === 'assistant');
    const textOut = msgs.flatMap((m) => (m.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text)).join(' ');
    return { model: msgs.map((m) => m.message?.model).find(Boolean) ?? null, text: textOut.slice(0, 200), isError: res?.is_error ?? null, subtype: res?.subtype ?? null, cost: res?.total_cost_usd ?? null };
  };
  const control = async (id, request) => {
    send({ type: 'control_request', request_id: id, request });
    const r = await until((m) => m.type === 'control_response' && m.response?.request_id === id, 20_000);
    return r ? { subtype: r.response.subtype, error: r.response.error ?? null, errorCode: r.response.error_code ?? null } : null;
  };
  try {
    const t1 = await turn(`Remember this codeword for later: ${CODEWORD}. Reply only "ok".`);
    const s1 = await control('s1', { subtype: 'set_model', model: 'sonnet' });
    const t2 = await turn('What was the codeword I gave you? Reply with the codeword only.');
    const s2 = await control('s2', { subtype: 'set_model', model: 'not-a-real-model-xyz' });
    const s3 = await control('s3', { subtype: 'set_model', model: 'default' });
    const init = events.find((m) => m.type === 'system' && m.subtype === 'init');
    const recall = t2.text.includes(CODEWORD);
    const switched = /haiku/.test(String(t1.model)) && /sonnet/.test(String(t2.model));
    const answered = s1?.subtype === 'success' && s2?.subtype === 'error' && s3?.subtype === 'success';
    const verdict = !s1 ? 'fail' : answered && recall && switched && t2.isError === false ? 'pass' : 'partial';
    return { verdict, toolVersions: { claude: version }, evidence: { initModel: init?.model ?? null, t1, setModelSonnet: s1, t2, recall, switched, setModelUnknown: s2, setModelDefault: s3, oneProcess: true } };
  } finally {
    child.stdin.end();
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    rmSync(cwd, { recursive: true, force: true });
  }
}
