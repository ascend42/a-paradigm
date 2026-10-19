// p-resume — the drain-and-resume prerequisite (spec §2.4 rule 11, §3.3; TD-2026-10-19-908, T-2026-10-19-014, before
// slice B2). Real claude, run under the GENERATED `session` profile with the adapter argv (like p01b), in a throwaway
// git repo. Three haiku invocations on the founder's subscription:
//   A  new session (--session-id U, settings S1 + plugin dir P1) under the generated profile PLUS a probe-local
//      candidate allow for ~/.claude/projects: codeword, then `sleep 20` with Bash, SIGKILLed while the call runs
//   B  respawn (--resume U, settings S2 + plugin dir P2 = a regenerated layer set, a different layersHash), same
//      candidate allow, user message "continue"  => Q2 (re-issued call?), Q3 (new layers apply, old do not), Q4 (ids)
//   C  --resume U under the profile EXACTLY as generated: "what was the codeword?"  => Q1 as shipped
// The stock profile denies file-write* on (subpath "~/.claude"); a first run (5 invocations, stock profile only)
// produced no transcript file at all, which is why A/B carry the candidate allow.
// The transcript (~/.claude/projects/<encoded cwd>/<uuid>.jsonl) is snapshotted after every step. The temp repo and
// ONLY the projects dir of that temp cwd are removed at the end.
// VERDICT: fail if the resumed session cannot recall the codeword (transcript unreadable) or the transcript does not
// grow (unwritable); partial if any of Q2–Q4 is unanswered; pass otherwise.
// Requires `npm run build` (dist/). Run: node probes/run.mjs p-resume --timeout 900000
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const specRefs = ['§2.4 rule 11 (drain and resume)', '§3.3 argv (--session-id | --resume)', '§15.5 session profile', 'TD-2026-10-19-908'];

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);
const MODEL = process.env.P_RESUME_MODEL ?? 'haiku';
const CODEWORD = 'PLUM-7342';

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const dist = path.join(HERE, '..', '..', 'dist', 'index.js');
  if (!existsSync(dist)) return { verdict: 'fail', evidence: { error: 'dist/ missing: npm run build first' } };
  const g = await import(pathToFileURL(dist).href);
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-presume-')));
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const red = (s) => String(s).replaceAll(root, '<tmp>').replaceAll(os.homedir(), '~');
  const work = path.join(root, 'work');
  const transcriptDirs = new Set();
  let invocations = 0;
  try {
    const home = path.join(root, 'gnomon-home');
    for (const d of [path.join(home, 'keys'), path.join(home, 'bin'), work]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(home, 'keys', 'device.key'), 'secret');
    execFileSync('git', ['init', '-q'], { cwd: work });
    writeFileSync(path.join(work, 'README.md'), 'p-resume\n');
    const claudeReal = realpathSync(CLAUDE);
    const privateCopy = path.join(home, 'bin', 'claude-probe');
    copyFileSync(claudeReal, privateCopy);
    chmodSync(privateCopy, 0o500);
    const extraDenyWrite = g.binaryDenies(g.CLAUDE_CODE_PLATFORMS.darwin, os.homedir(), claudeReal);

    const findTranscript = (uuid) => {
      for (const d of existsSync(projectsDir) ? readdirSync(projectsDir) : []) {
        const f = path.join(projectsDir, d, `${uuid}.jsonl`);
        if (existsSync(f)) return f;
      }
      return null;
    };
    const snap = (uuid) => {
      const f = findTranscript(uuid);
      if (!f) return { exists: false };
      transcriptDirs.add(path.dirname(f));
      const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
      const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
      const tail = rows.slice(-8).map((o) => o && ({
        type: o.type, sessionId: o.sessionId ?? null, isSidechain: o.isSidechain ?? null,
        content: Array.isArray(o.message?.content) ? o.message.content.map((c) => c.type === 'tool_use' ? `tool_use:${c.name}:${JSON.stringify(c.input).slice(0, 80)}` : c.type === 'tool_result' ? `tool_result(is_error=${c.is_error === true}):${red(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 160)}` : c.type === 'text' ? `text:${red(c.text).slice(0, 120)}` : c.type) : typeof o.message?.content === 'string' ? `str:${red(o.message.content).slice(0, 120)}` : null,
      }));
      return {
        exists: true, file: red(f), encodedDir: path.basename(path.dirname(f)), lineCount: lines.length,
        sessionIds: [...new Set(rows.map((o) => o?.sessionId).filter(Boolean))],
        types: [...new Set(rows.map((o) => o?.type).filter(Boolean))],
        mentionsLayer1: lines.some((l) => l.includes('layer-1')), mentionsLayer2: lines.some((l) => l.includes('layer-2')),
        tail,
      };
    };

    /** A regenerated layer set: its own policy.json (S<n>) and kernel-staged plugin dir (P<n>), like a new layersHash. */
    const layers = (n, denyTool, skill) => {
      const sessDir = path.join(home, 'sessions', `layer-${n}`);
      const plug = path.join(sessDir, 'plugin');
      mkdirSync(path.join(plug, '.claude-plugin'), { recursive: true });
      mkdirSync(path.join(plug, 'skills', skill), { recursive: true });
      writeFileSync(path.join(plug, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: `gnomon-presume-l${n}`, version: '0.0.0' }));
      writeFileSync(path.join(plug, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: p-resume marker skill for layer ${n}; never use it.\n---\nDo nothing.\n`);
      const policy = g.manifestLoader.buildSessionPolicy({ home, cwd: work, userClaudeDir: path.join(os.homedir(), '.claude'), userHome: os.homedir(), managedSettingsPaths: [], linkedFolders: [], endpointPort: null, extraDenyWrite, homeReadable: [{ path: privateCopy, match: 'literal' }, { path: sessDir, match: 'subpath' }] });
      const base = g.manifestLoader.claudePermissions(policy);
      const policyPath = path.join(sessDir, 'policy.json');
      const mcpPath = path.join(sessDir, 'mcp.json');
      writeFileSync(policyPath, JSON.stringify({ permissions: { ...base.permissions, deny: [...base.permissions.deny, denyTool] } }));
      writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));
      return { policy, policyPath, mcpPath, plug, denyTool, skill };
    };
    const L1 = layers(1, 'NotebookEdit', 'presume-alpha');
    const L2 = layers(2, 'WebSearch', 'presume-beta');
    const claudeRules = (pol) => {
      const pick = (arr) => (arr ?? []).filter((p) => /\.claude(\/|$)/.test(p.path)).map((p) => `${p.match}:${red(p.path)}`);
      return { denyRead: pick(pol.denyRead), allowRead: pick(pol.allowRead), denyReadAlways: pick(pol.denyReadAlways), denyWrite: pick(pol.denyWrite) };
    };
    const profileText = g.sessionSandbox.sessionLaunchPlan({ policy: L1.policy, binaryReal: privateCopy, argv: ['-p'], extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: os.homedir(), roots: [work] } });
    const profileStr = JSON.stringify(profileText.args);
    const profileClaudeLines = profileStr.split('\\n').filter((l) => l.includes('/.claude')).map((l) => red(l).slice(0, 400));

    const run = async ({ name, uuid, resume, L, prompt, killOnBash = false, holdStdinMs = 0, waitMs = 120_000, extraAllow = null }) => {
      invocations++;
      const argv = g.claudeAdapter.buildClaudeArgv({ uuid, resume, policyPath: L.policyPath, mcpConfigPath: L.mcpPath, settingSources: g.claudeAdapter.settingSourcesFor('audited'), model: MODEL, pluginDirs: [L.plug], extra: ['--max-turns', '4'] });
      const plan = g.sessionSandbox.sessionLaunchPlan({ policy: L.policy, binaryReal: privateCopy, argv, extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: os.homedir(), roots: [work] } });
      // probe-local arm only: append a candidate allow AFTER the generated profile (SBPL: the last matching rule wins)
      if (extraAllow) plan.args[1] = `${plan.args[1]}\n${extraAllow}`;
      const t0 = Date.now();
      const raw = [];
      const events = [];
      const exit = await new Promise((resolve) => {
        const child = spawn(plan.command, plan.args, { cwd: work, detached: true, env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8', TMPDIR: os.tmpdir(), SHELL: '/bin/bash' }, stdio: ['pipe', 'pipe', 'pipe'] });
        const write = (o) => { try { child.stdin.write(`${JSON.stringify(o)}\n`); } catch { /* gone */ } };
        const closeStdin = () => { events.push({ at: Date.now() - t0, ev: 'stdin-closed' }); try { child.stdin.end(); } catch { /* gone */ } };
        let killed = false;
        let buf = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (c) => {
          buf += c;
          for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
            const l = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!l.trim()) continue;
            let o = null;
            try { o = JSON.parse(l); } catch { /* malformed */ }
            raw.push({ at: Date.now() - t0, o });
            if (o?.type === 'control_request' && o.request?.subtype === 'can_use_tool') {
              events.push({ at: Date.now() - t0, ev: `can_use_tool:${o.request.tool_name}` });
              write({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: { behavior: 'allow', updatedInput: o.request.input } } });
              if (killOnBash && o.request.tool_name === 'Bash' && !killed) {
                killed = true;
                setTimeout(() => { events.push({ at: Date.now() - t0, ev: 'SIGKILL-pgroup (Bash call running)' }); try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 5_000);
              }
            }
            if (o?.type === 'result') closeStdin();
          }
        });
        child.stderr.on('data', (c) => { stderr += c; });
        if (prompt) write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
        else setTimeout(closeStdin, holdStdinMs);
        const timer = setTimeout(() => { events.push({ at: Date.now() - t0, ev: 'probe-timeout-kill' }); try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, waitMs);
        child.on('exit', (code, sig) => { clearTimeout(timer); resolve({ code, sig, stderrTail: red(stderr.slice(-600)) }); });
      });
      const objs = raw.map((r) => r.o).filter(Boolean);
      const init = objs.find((o) => o.type === 'system' && o.subtype === 'init') ?? null;
      const result = objs.find((o) => o.type === 'result') ?? null;
      const toolUses = objs.filter((o) => o.type === 'assistant').flatMap((o) => (o.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => `${c.name}:${JSON.stringify(c.input).slice(0, 80)}`));
      const texts = objs.filter((o) => o.type === 'assistant').flatMap((o) => (o.message?.content ?? []).filter((c) => c.type === 'text').map((c) => red(c.text).slice(0, 200)));
      return {
        name, ms: Date.now() - t0, exit, resume: !!resume, uuidRequested: uuid, layer: path.basename(path.dirname(L.plug)),
        streamSessionIds: [...new Set(objs.map((o) => o.session_id).filter(Boolean))],
        lineTypes: [...new Set(objs.map((o) => `${o.type}${o.subtype ? `.${o.subtype}` : ''}`))],
        replayedHistory: objs.filter((o) => (o.type === 'user' || o.type === 'assistant') && o.isReplay).length,
        init: init ? {
          session_id: init.session_id, model: init.model, permissionMode: init.permissionMode,
          hasNotebookEdit: (init.tools ?? []).includes('NotebookEdit'), hasWebSearch: (init.tools ?? []).includes('WebSearch'),
          plugins: (init.plugins ?? []).map((p) => (typeof p === 'string' ? p : p.name)),
          presumeSkills: [...(init.skills ?? []), ...(init.slash_commands ?? [])].filter((s) => String(s).includes('presume')),
        } : null,
        events, toolUses, texts,
        result: result ? { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns, session_id: result.session_id, reply: red(String(result.result ?? '')).slice(0, 300) } : null,
      };
    };

    const U = randomUUID();
    const R = {};
    const allowRule = `(allow file-write* (subpath ${JSON.stringify(projectsDir)}))`;
    const predictedEncoded = work.replace(/[^a-zA-Z0-9]/g, '-');
    const sleepCalls = (r) => (r?.toolUses ?? []).filter((t) => t.startsWith('Bash') && t.includes('sleep')).length;
    let answers = null;
    let verdict = 'partial';
    try {
      // A: new session, codeword + a Bash call that is SIGKILLed mid-call; generated profile + the candidate allow
      R.A = await run({ name: 'A new (S1,P1) +allow; codeword, Bash sleep 20, SIGKILL mid-call', uuid: U, resume: false, L: L1, killOnBash: true, extraAllow: allowRule,
        prompt: `Remember this codeword for later: ${CODEWORD}. Now run the shell command \`sleep 20\` with your Bash tool, then reply with the word ok.` });
      R.A.transcript = snap(U);
      // B: respawn with --resume and a REGENERATED layer set (S2,P2), user message "continue" => Q2, Q3, Q4, Q1(write)
      R.B = await run({ name: 'B resume (S2,P2) +allow; "continue"', uuid: U, resume: true, L: L2, extraAllow: allowRule, prompt: 'continue' });
      R.B.transcript = snap(U);
      // C: resume under the UNMODIFIED generated profile => Q1 as shipped (read allowed, write denied)
      R.C = await run({ name: 'C resume (S2,P2) stock profile; recall codeword', uuid: U, resume: true, L: L2, prompt: 'What was the codeword I gave you earlier? Reply with just the codeword.' });
      R.C.transcript = snap(U);
      answers = {
        q1StockProfileDeniesTranscriptWrite: claudeRules(L1.policy).denyWrite.some((r) => r === 'subpath:~/.claude'),
        q1WithAllowTranscriptCreated: !!R.A.transcript?.exists,
        q1WithAllowTranscriptGrewOnResume: !!(R.B.transcript?.exists && R.A.transcript?.exists && R.B.transcript.lineCount > R.A.transcript.lineCount),
        q1StockProfileRecallsCodeword: (R.C.result?.reply ?? '').includes(CODEWORD),
        q1StockProfileTranscriptGrew: !!(R.C.transcript?.exists && R.B.transcript?.exists && R.C.transcript.lineCount > R.B.transcript.lineCount),
        encodedDirPredicted: predictedEncoded, encodedDirActual: R.A.transcript?.encodedDir ?? null,
        q2: { killedMidCall: (R.A.events ?? []).some((e) => e.ev.startsWith('SIGKILL')) && !R.A.result, sleepCallsBeforeKill: sleepCalls(R.A), sleepCallsAfterResumeContinue: sleepCalls(R.B) },
        q3: { resumedInit: R.B.init, newLayerApplies: R.B.init ? R.B.init.hasNotebookEdit && !R.B.init.hasWebSearch : null, newPluginOnly: R.B.init ? R.B.init.plugins.includes('gnomon-presume-l2') && !R.B.init.plugins.includes('gnomon-presume-l1') : null },
        q4: { requested: U, streamIdsB: R.B.streamSessionIds, streamIdsC: R.C.streamSessionIds, transcriptIds: R.C.transcript?.sessionIds ?? R.B.transcript?.sessionIds ?? null },
      };
      verdict = answers.q1WithAllowTranscriptCreated && answers.q2.killedMidCall && answers.q3.newLayerApplies !== null ? 'pass' : 'partial';
    } catch (err) {
      answers = { error: String(err?.stack ?? err).slice(0, 600) };
    }
    return {
      verdict,
      evidence: {
        claudeBinary: CLAUDE.replace(os.homedir(), '~'),
        claudeVersion: execFileSync(CLAUDE, ['--version'], { encoding: 'utf8' }).trim(),
        model: MODEL,
        claudeInvocationsThisRun: invocations,
        candidateAllow: red(allowRule),
        policyClaudeRules: claudeRules(L1.policy),
        profileLinesNamingDotClaude: profileClaudeLines,
        answers,
        runs: R,
        notes: [
          'Every run uses the GENERATED session profile (sandbox-exec), the adapter argv (buildClaudeArgv with resume true/false), --setting-sources from settingSourcesFor(audited), --include-partial-messages and --replay-user-messages (adapter defaults), a private copy of claude, and answers every can_use_tool with allow.',
          'Runs A and B append candidateAllow after the generated profile (probe-local; the profile generator is NOT changed). Run C uses the profile exactly as generated.',
          'Layer 1 = policy.json denying NotebookEdit + plugin gnomon-presume-l1 (skill presume-alpha); layer 2 = policy.json denying WebSearch + plugin gnomon-presume-l2 (skill presume-beta), each in its own session dir, as a regenerated layersHash would be.',
          'Run A is SIGKILLed (whole process group) 5 s after the Bash can_use_tool is allowed, i.e. while `sleep 20` runs.',
          'An earlier run of this probe (5 invocations: new / resume / new+kill / resume-no-message / resume-continue, all under the stock profile) crashed in its own evidence code, because no transcript file ever appeared under ~/.claude/projects for any of its sessions; that run recorded only this fact. Total claude invocations for P-resume = 5 + claudeInvocationsThisRun.',
        ],
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    for (const d of transcriptDirs) if (path.basename(d).includes('gnomon-presume-')) rmSync(d, { recursive: true, force: true });
  }
}
