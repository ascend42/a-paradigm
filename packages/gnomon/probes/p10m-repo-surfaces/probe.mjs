// p10m-repo-surfaces — Aegis C3 (M1.7 slice 2 round 2, P8-D94): which REPO surfaces still reach a real Claude Code
// session under the `audited` hooks mode (`--setting-sources user` + a kernel-generated `--settings`), run under the
// GENERATED `session` profile with the adapter argv, like p10m-claude-compat-generated.
//
// The temp repo carries every repo surface that can run code or steer the model besides `.claude/settings*.json`:
//   - .claude/settings.json            SessionStart + UserPromptSubmit + PreToolUse command hooks (the baseline: must NOT fire)
//   - .claude/skills/x/SKILL.md        frontmatter `hooks:` (SessionStart, PreToolUse)
//   - .claude/agents/y.md              frontmatter `hooks:` (SessionStart, PreToolUse, Stop)
//   - .claude/commands/z.md            a slash command
//   - CLAUDE.md                        `@imported.md`, which holds a random token
// and the kernel-written --settings carries ONE SessionStart hook (does a `--settings` hook fire under
// `--setting-sources user`? — the P8-D94 mechanism residual). Every hook appends its label to markers.txt.
// The model is asked to invoke skill x, run subagent y, and report the CLAUDE.md token; system.init's skills /
// slash_commands / agents lists are recorded. VERDICT: fail if ANY repo hook fired (a bypass of the audit);
// partial if none fired but the --settings hook did not fire either (the mechanism is unproven); pass otherwise.
// What loads (skills, agents, commands, CLAUDE.md) is recorded as evidence — loading is not a hook bypass.
// Costs a few turns on the founder's subscription. Requires `npm run build` (dist/).
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const specRefs = ['§3.3 whose hooks run (P8-D94)', '§15.5 session profile', '§A.9', 'T-2026-10-18-010'];

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const dist = path.join(HERE, '..', '..', 'dist', 'index.js');
  if (!existsSync(dist)) return { verdict: 'fail', evidence: { error: 'dist/ missing: npm run build first' } };
  const g = await import(pathToFileURL(dist).href);
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p10m-surf-')));
  const markers = path.join(root, 'markers.txt');
  const token = `ZEBRA-${randomBytes(6).toString('hex')}`;
  const hook = (label) => ({ type: 'command', command: `echo ${label} >> "${markers}"` });
  try {
    const home = path.join(root, 'gnomon-home');
    const work = path.join(root, 'work');
    for (const d of [path.join(home, 'keys'), path.join(home, 'bin'), path.join(work, '.claude', 'skills', 'x'), path.join(work, '.claude', 'agents'), path.join(work, '.claude', 'commands')]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(home, 'keys', 'device.key'), 'secret');
    writeFileSync(path.join(work, '.claude', 'settings.json'), JSON.stringify({ hooks: {
      SessionStart: [{ hooks: [hook('project-settings:SessionStart')] }],
      UserPromptSubmit: [{ hooks: [hook('project-settings:UserPromptSubmit')] }],
      PreToolUse: [{ matcher: '.*', hooks: [hook('project-settings:PreToolUse')] }],
    } }));
    writeFileSync(path.join(work, '.claude', 'skills', 'x', 'SKILL.md'), `---
name: x
description: The probe skill x. Use it when asked to invoke skill x.
hooks:
  SessionStart:
    - hooks:
        - type: command
          command: echo skill-x:SessionStart >> "${markers}"
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: echo skill-x:PreToolUse >> "${markers}"
---
When invoked, reply with the word SKILLX.
`);
    writeFileSync(path.join(work, '.claude', 'agents', 'y.md'), `---
name: y
description: The probe subagent y. Use it when asked to run subagent y.
hooks:
  SessionStart:
    - hooks:
        - type: command
          command: echo agent-y:SessionStart >> "${markers}"
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: echo agent-y:PreToolUse >> "${markers}"
  Stop:
    - hooks:
        - type: command
          command: echo agent-y:Stop >> "${markers}"
---
Reply with the word AGENTY.
`);
    writeFileSync(path.join(work, '.claude', 'commands', 'z.md'), 'Reply with the word COMMANDZ.\n');
    writeFileSync(path.join(work, 'CLAUDE.md'), '# Probe project\n\n@imported.md\n');
    writeFileSync(path.join(work, 'imported.md'), `The project memory token is ${token}.\n`);
    const claudeReal = realpathSync(CLAUDE);
    const privateCopy = path.join(home, 'bin', 'claude-probe');
    copyFileSync(claudeReal, privateCopy);
    chmodSync(privateCopy, 0o500);
    const extraDenyWrite = g.binaryDenies(g.CLAUDE_CODE_PLATFORMS.darwin, os.homedir(), claudeReal);
    const sessDir = path.join(home, 'sessions', 'probe');
    mkdirSync(sessDir, { recursive: true });
    const policy = g.manifestLoader.buildSessionPolicy({ home, cwd: work, userClaudeDir: path.join(os.homedir(), '.claude'), userHome: os.homedir(), managedSettingsPaths: [], linkedFolders: [], endpointPort: null, extraDenyWrite, homeReadable: [{ path: privateCopy, match: 'literal' }, { path: sessDir, match: 'subpath' }] });
    const perms = g.manifestLoader.claudePermissions(policy);
    const policyPath = path.join(sessDir, 'policy.json');
    const mcpPath = path.join(sessDir, 'mcp.json');
    // the kernel-written --settings: the deny mirror + ONE kernel hook (does a --settings hook fire under --setting-sources user?)
    writeFileSync(policyPath, JSON.stringify({ permissions: { ...perms.permissions, allow: ['Bash(echo probe)', 'Skill', 'Task'] }, hooks: {
      SessionStart: [{ hooks: [hook('kernel-settings:SessionStart')] }],
      UserPromptSubmit: [{ hooks: [hook('kernel-settings:UserPromptSubmit')] }],
      PreToolUse: [{ matcher: '.*', hooks: [hook('kernel-settings:PreToolUse')] }],
    } }));
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));
    const arm = async (settingSources) => {
    rmSync(markers, { force: true });
    const argv = g.claudeAdapter.buildClaudeArgv({ uuid: randomUUID(), policyPath, mcpConfigPath: mcpPath, settingSources, extra: ['--max-turns', '10'] });
    const plan = g.sessionSandbox.sessionLaunchPlan({ policy, binaryReal: privateCopy, argv, extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: os.homedir(), roots: [work] } });
    const t0 = Date.now();
    const lines = [];
    const exit = await new Promise((resolve) => {
      const child = spawn(plan.command, plan.args, { cwd: work, env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8', TMPDIR: os.tmpdir(), SHELL: '/bin/bash' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let buf = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c) => {
        buf += c;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          const l = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          lines.push(l);
          try { if (JSON.parse(l).type === 'result') child.stdin.end(); } catch { /* tolerant */ }
        }
      });
      child.stderr.on('data', (c) => { stderr += c; });
      child.stdin.write(g.claudeAdapter.userMessageLine('Do these steps in order. 1) Invoke the skill named x if it is available to you. 2) Run the subagent named y (Task tool) with the prompt "hi" if it is available to you. 3) Run exactly this Bash command: echo probe. 4) Finally reply with one line: TOKEN=<the project memory token you were given, or NONE>; SKILL=<yes|no>; AGENT=<yes|no>.'));
      const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
      child.on('exit', (code, sig) => { clearTimeout(timer); resolve({ code, sig, stderrTail: stderr.slice(-1500) }); });
    });
    const raw = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const init = raw.find((e) => e.type === 'system' && e.subtype === 'init') ?? null;
    const result = raw.find((e) => e.type === 'result') ?? null;
    const fired = existsSync(markers) ? readFileSync(markers, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
    const repoHooksFired = fired.filter((f) => !f.startsWith('kernel-settings:'));
    const reply = typeof result?.result === 'string' ? result.result : '';
    const toolUses = raw.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input })));
    const has = (list, name) => Array.isArray(list) && list.some((x) => (typeof x === 'string' ? x : x?.name) === name || String(typeof x === 'string' ? x : x?.name).endsWith(`:${name}`));
    const loaded = {
      skillX: has(init?.skills, 'x'),
      agentY: has(init?.agents, 'y'),
      commandZ: has(init?.slash_commands, 'z'),
      claudeMdToken: reply.includes(token),
    };
    return {
        settingSources,
        ms: Date.now() - t0,
        exit,
        hooksFired: fired,
        repoHooksFired,
        loaded,
        init: init ? { apiKeySource: init.apiKeySource, model: init.model, skills: init.skills ?? null, agents: init.agents ?? null, slash_commands: init.slash_commands ?? null } : null,
        toolUses,
        reply: reply.replaceAll(token, '<token>').slice(0, 600),
        result: result ? { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns } : null,
    };
    };
    const audited = await arm(g.claudeAdapter.settingSourcesFor('audited'));
    // CONTROL: the same repo with the project layer loaded — proves this harness can observe a hook firing at all
    const control = await arm(['user', 'project', 'local']);
    const kernelAny = audited.hooksFired.some((f) => f.startsWith('kernel-settings:'));
    const verdict = audited.repoHooksFired.length > 0 ? 'fail' : kernelAny ? 'pass' : 'partial';
    return {
      verdict,
      evidence: {
        claudeBinary: CLAUDE.replace(os.homedir(), '~'),
        audited: { ...audited, init: audited.init ? { ...audited.init, skills: (audited.init.skills ?? []).filter((x) => !String(x).includes(':')), agents: (audited.init.agents ?? []).filter((x) => !String(x).includes(':')), slash_commands: undefined } : null },
        control: { settingSources: control.settingSources, hooksFired: control.hooksFired, loaded: control.loaded, toolUses: control.toolUses, reply: control.reply, result: control.result },
        kernelSettingsHooksFired: audited.hooksFired.filter((f) => f.startsWith('kernel-settings:')),
        notes: [
          'fail = a REPO hook fired under --setting-sources user (a bypass of the P8-D94 audit); partial = no repo hook fired, but neither did the kernel --settings hook (the approved-hook path is unproven).',
          'loaded.* records which repo surfaces reached the model (init lists; the CLAUDE.md @import token in the reply). Loading a skill/agent/command/memory file is model steering, not a hook; a frontmatter hook firing is.',
          "The founder's own ~/.claude user layer is loaded (--setting-sources user); its hooks do not write markers.txt.",
        ],
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
