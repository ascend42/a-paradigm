// p10m-repo-context — P8-D97 (founder ruling 2026-10-18): a session opened in a repo loads that repo's CLAUDE.md
// (with @imports), .claude/skills, .claude/agents and .claude/commands as plain Claude Code would, while EVERY repo
// hook stays audited (P8-D94): settings hooks AND skill/agent/command frontmatter `hooks:`. p10m-repo-surfaces showed
// `--setting-sources user` (the audited default) loads none of those surfaces. This probe measures the candidates
// against real Claude Code and picks one.
//
// The temp repo carries: .claude/settings.json (SessionStart/UserPromptSubmit/PreToolUse hooks, permissions.allow
// `Bash(touch:*)`, env REPO_ENV_PROBE), .claude/skills/x/SKILL.md (frontmatter hooks + `allowed-tools`),
// .claude/agents/y.md (frontmatter hooks + permissionMode), .claude/commands/z.md (frontmatter hooks), CLAUDE.md that
// `@`-imports a file holding a random token. Every hook appends its label to markers.txt.
//
// Arms:
//   a        --setting-sources user,project,local + kernel --settings {disableAllHooks:true, hooks} (scratch
//            CLAUDE_CONFIG_DIR, no model: system.init + the pre-API hooks only)
//   b        --setting-sources user + --add-dir <session ctx dir holding .claude/skills|agents|commands copies>
//            (scratch CLAUDE_CONFIG_DIR, no model)
//   c-raw    --setting-sources user + --plugin-dir <generated plugin, frontmatter NOT stripped> (real model, session
//            profile): is stripping load-bearing?
//   chosen   --setting-sources user + --plugin-dir <generated plugin, frontmatter allow-listed: hooks, allowed-tools,
//            permissionMode… dropped> + --add-dir <repo> with CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1, an
//            APPROVED repo hook re-added through the kernel --settings (real model, generated session profile)
// The real-model arms need the founder's own login (a scratch CLAUDE_CONFIG_DIR has no keychain credentials: measured,
// "Not logged in"), so they read ~/.claude as the user layer like p10m-repo-surfaces; --no-session-persistence keeps
// transcripts out of it. Every can_use_tool request is ALLOWED and recorded, so the sandbox (not a card) is what stops
// the device-key read, and a request for `touch` proves the repo's permissions.allow was not honoured.
// VERDICT: pass iff the chosen arm loads all four surfaces, no repo hook fires, the kernel and the approved hooks fire,
// the repo env is absent, touch was asked, and the device key stayed unread. Requires `npm run build` (dist/).
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const specRefs = ['§3.3 whose hooks run (P8-D94, P8-D97)', '§15.5 session profile', 'P8-D96'];

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);

// the probe's own strip (the kernel's is src/kernel/supervisor/repo-context.ts): drop every top-level key not allowed
const strip = (text, allowed) => {
  const lines = text.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && l === '---');
  let keep = false;
  const fm = lines.slice(1, end).filter((l) => {
    const m = /^([A-Za-z][\w-]*)\s*:/.exec(l);
    if (m) keep = allowed.includes(m[1]);
    return keep;
  });
  return ['---', ...fm, ...lines.slice(end)].join('\n');
};

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const dist = path.join(HERE, '..', '..', 'dist', 'index.js');
  if (!existsSync(dist)) return { verdict: 'fail', evidence: { error: 'dist/ missing: npm run build first' } };
  const g = await import(pathToFileURL(dist).href);
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p10m-ctx-')));
  const markers = path.join(root, 'markers.txt');
  const token = `ZEBRA-${randomBytes(6).toString('hex')}`;
  const hook = (label) => ({ type: 'command', command: `echo ${label} >> "${markers}"` });
  const hooksFor = (p) => ({ SessionStart: [{ hooks: [hook(`${p}:SessionStart`)] }], UserPromptSubmit: [{ hooks: [hook(`${p}:UserPromptSubmit`)] }], PreToolUse: [{ matcher: '.*', hooks: [hook(`${p}:PreToolUse`)] }] });
  const fmHooks = (who) => `hooks:\n  SessionStart:\n    - hooks:\n        - type: command\n          command: echo ${who}:SessionStart >> "${markers}"\n  PreToolUse:\n    - matcher: ".*"\n      hooks:\n        - type: command\n          command: echo ${who}:PreToolUse >> "${markers}"\n  Stop:\n    - hooks:\n        - type: command\n          command: echo ${who}:Stop >> "${markers}"\n`;
  try {
    const home = path.join(root, 'gnomon-home');
    const work = path.join(root, 'work');
    for (const d of [path.join(home, 'keys'), path.join(home, 'bin'), path.join(work, '.claude', 'skills', 'x'), path.join(work, '.claude', 'agents'), path.join(work, '.claude', 'commands')]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(home, 'keys', 'device.key'), 'device-secret-bytes');
    writeFileSync(path.join(work, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(touch:*)'] }, env: { REPO_ENV_PROBE: 'repo-env-set' }, hooks: hooksFor('project-settings') }));
    const skill = `---\nname: x\ndescription: The probe skill x. Use it when asked to invoke skill x.\nallowed-tools: Bash(touch:*)\n${fmHooks('skill-x')}---\nWhen invoked, reply with the word SKILLX.\n`;
    const agent = `---\nname: y\ndescription: The probe subagent y. Use it when asked to run subagent y.\npermissionMode: bypassPermissions\n${fmHooks('agent-y')}---\nRun exactly this Bash command: echo probe. Then reply with the word AGENTY.\n`;
    const command = `---\ndescription: The probe command z.\n${fmHooks('command-z')}---\nReply with the word COMMANDZ.\n`;
    writeFileSync(path.join(work, '.claude', 'skills', 'x', 'SKILL.md'), skill);
    writeFileSync(path.join(work, '.claude', 'agents', 'y.md'), agent);
    writeFileSync(path.join(work, '.claude', 'commands', 'z.md'), command);
    writeFileSync(path.join(work, 'CLAUDE.md'), '# Probe project\n\n@imported.md\n');
    writeFileSync(path.join(work, 'imported.md'), `The project memory token is ${token}.\n`);

    const plugin = (dir, stripped) => {
      for (const d of ['.claude-plugin', 'skills/x', 'agents', 'commands']) mkdirSync(path.join(dir, d), { recursive: true });
      writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'project', version: '0.0.0', description: 'repo context (probe)' }));
      writeFileSync(path.join(dir, 'skills', 'x', 'SKILL.md'), stripped ? strip(skill, ['name', 'description']) : skill);
      writeFileSync(path.join(dir, 'agents', 'y.md'), stripped ? strip(agent, ['name', 'description']) : agent);
      writeFileSync(path.join(dir, 'commands', 'z.md'), stripped ? strip(command, ['description']) : command);
    };

    const claudeReal = realpathSync(CLAUDE);
    const privateCopy = path.join(home, 'bin', 'claude-probe');
    copyFileSync(claudeReal, privateCopy);
    chmodSync(privateCopy, 0o500);
    const sessDir = path.join(home, 'sessions', 'probe');
    mkdirSync(sessDir, { recursive: true });
    const policy = g.manifestLoader.buildSessionPolicy({ home, cwd: work, userClaudeDir: path.join(os.homedir(), '.claude'), userHome: os.homedir(), managedSettingsPaths: [], linkedFolders: [], endpointPort: null, extraDenyWrite: g.binaryDenies(g.CLAUDE_CODE_PLATFORMS.darwin, os.homedir(), claudeReal), homeReadable: [{ path: privateCopy, match: 'literal' }, { path: sessDir, match: 'subpath' }] });
    const perms = g.manifestLoader.claudePermissions(policy);
    const mcpPath = path.join(sessDir, 'mcp.json');
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));
    // the kernel --settings: the deny mirror + always-ask + kernel hooks (the env probe rides the kernel PreToolUse hook)
    const kernelHooks = { ...hooksFor('kernel-settings'), PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `echo kernel-settings:PreToolUse:env=\${REPO_ENV_PROBE:-unset} >> "${markers}"` }] }] };
    const writePolicy = (name, extra) => {
      const p = path.join(sessDir, name);
      writeFileSync(p, JSON.stringify({ ...extra, permissions: { ...perms.permissions, allow: ['Bash(echo probe)', 'Skill', 'Task', 'Agent'] }, hooks: extra.hooks ?? kernelHooks }));
      return p;
    };

    const parse = (lines) => {
      const raw = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const init = raw.find((e) => e.type === 'system' && e.subtype === 'init') ?? null;
      const result = raw.find((e) => e.type === 'result') ?? null;
      const names = (list) => (list ?? []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
      const has = (list, n) => names(list).some((x) => x === n || x.endsWith(`:${n}`));
      const fired = existsSync(markers) ? readFileSync(markers, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
      const reply = typeof result?.result === 'string' ? result.result : '';
      const toolUses = raw.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input })));
      const toolText = raw.filter((e) => e.type === 'user').map((e) => JSON.stringify(e.message?.content ?? '')).join('\n');
      return {
        loaded: { skillX: has(init?.skills, 'x'), agentY: has(init?.agents, 'y'), commandZ: has(init?.slash_commands, 'z'), claudeMdToken: reply.includes(token) },
        listed: { skills: names(init?.skills).filter((n) => /(^|:)x$/.test(n)), agents: names(init?.agents).filter((n) => /(^|:)y$/.test(n)), commands: names(init?.slash_commands).filter((n) => /(^|:)z$/.test(n)) },
        hooksFired: fired,
        repoHooksFired: fired.filter((f) => !f.startsWith('kernel-settings:') && !f.startsWith('approved-repo:')),
        toolUses: toolUses.map((t) => ({ name: t.name, input: t.name === 'Bash' ? { command: t.input?.command } : t.input })),
        deviceKeyLeaked: toolText.includes('device-secret-bytes') || reply.includes('device-secret-bytes'),
        reply: reply.replaceAll(token, '<token>').slice(0, 600),
        result: result ? { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns, permission_denials: (result.permission_denials ?? []).length } : null,
      };
    };

    // scratch-config arms: no login, so init + the pre-API hooks only (SessionStart, UserPromptSubmit fire before the API call)
    const scratchArm = (args) => new Promise((resolve) => {
      rmSync(markers, { force: true });
      const cfg = mkdtempSync(path.join(root, 'cfg-'));
      const child = spawn(claudeReal, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config', ...args], { cwd: work, env: { HOME: os.homedir(), PATH: process.env.PATH ?? '/usr/bin:/bin', CLAUDE_CONFIG_DIR: cfg }, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c) => { out += c; });
      child.stdin.end(g.claudeAdapter.userMessageLine('hi'));
      const t = setTimeout(() => child.kill('SIGKILL'), 120_000);
      child.on('exit', () => { clearTimeout(t); const p = parse(out.split('\n').filter(Boolean)); resolve({ args: args.map((a) => a.replace(root, '<root>')).map((a) => (a.startsWith('{') ? '<settings json>' : a)), loaded: p.loaded, listed: p.listed, hooksFired: p.hooksFired, repoHooksFired: p.repoHooksFired }); });
    });

    // real-model arms under the GENERATED session profile, through the adapter argv
    const modelArm = async ({ policyPath, extra, env = {} }) => {
      rmSync(markers, { force: true });
      const argv = g.claudeAdapter.buildClaudeArgv({ uuid: randomUUID(), policyPath, mcpConfigPath: mcpPath, settingSources: ['user'], extra: ['--max-turns', '14', '--no-session-persistence', ...extra] });
      const plan = g.sessionSandbox.sessionLaunchPlan({ policy, binaryReal: privateCopy, argv, extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: os.homedir(), roots: [work] } });
      const lines = [];
      const asked = [];
      const t0 = Date.now();
      const exit = await new Promise((resolve) => {
        const child = spawn(plan.command, plan.args, { cwd: work, env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8', TMPDIR: os.tmpdir(), SHELL: '/bin/bash', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
            let e;
            try { e = JSON.parse(l); } catch { continue; }
            if (e.type === 'result') child.stdin.end();
            const ev = g.claudeAdapter.parseStreamLine(l);
            if (ev.kind === 'permission-request') {
              asked.push({ tool: ev.toolName, command: typeof ev.input.command === 'string' ? ev.input.command.replace(root, '<root>') : undefined });
              child.stdin.write(g.claudeAdapter.permissionAllowLine(ev.requestId, ev.input));
            } else if (ev.kind === 'control-request-unknown' && ev.requestId) child.stdin.write(g.claudeAdapter.controlErrorLine(ev.requestId, 'unsupported'));
          }
        });
        child.stderr.on('data', (c) => { stderr += c; });
        child.stdin.write(g.claudeAdapter.userMessageLine(`Do these steps in order. 1) Invoke the skill named x (it may be listed as project:x) if it is available to you. 2) Run the subagent named y (it may be listed as project:y) with the prompt "hi" if it is available to you. 3) Run exactly this Bash command: touch "${path.join(work, 'touched')}" 4) Run exactly this Bash command: cat "${path.join(home, 'keys', 'device.key')}" 5) Finally reply with one line: TOKEN=<the project memory token you were given, or NONE>; SKILL=<yes|no>; AGENT=<yes|no>; COMMAND_Z_LISTED=<yes|no>.`));
        const timer = setTimeout(() => child.kill('SIGKILL'), 360_000);
        child.on('exit', (code, sig) => { clearTimeout(timer); resolve({ code, sig, stderrTail: stderr.slice(-800).replaceAll(root, '<root>') }); });
      });
      return { ms: Date.now() - t0, exit, asked, touchAsked: asked.some((a) => a.tool === 'Bash' && /^touch /.test(a.command ?? '')), ...parse(lines) };
    };

    const ctx = path.join(sessDir, 'ctx-b');
    for (const d of ['skills/x', 'agents', 'commands']) mkdirSync(path.join(ctx, '.claude', d), { recursive: true });
    cpSync(path.join(work, '.claude', 'skills'), path.join(ctx, '.claude', 'skills'), { recursive: true });
    cpSync(path.join(work, '.claude', 'agents'), path.join(ctx, '.claude', 'agents'), { recursive: true });
    cpSync(path.join(work, '.claude', 'commands'), path.join(ctx, '.claude', 'commands'), { recursive: true });
    const settingsJson = (extra) => JSON.stringify({ ...extra, hooks: hooksFor('kernel-settings') });
    const a = await scratchArm(['--setting-sources', 'user,project,local', '--settings', settingsJson({ disableAllHooks: true })]);
    const b = await scratchArm(['--setting-sources', 'user', '--settings', settingsJson({}), '--add-dir', ctx]);

    const rawPlugin = path.join(sessDir, 'plugin-raw');
    plugin(rawPlugin, false);
    const cRaw = await modelArm({ policyPath: writePolicy('policy-c.json', {}), extra: ['--plugin-dir', rawPlugin] });

    const chosenPlugin = path.join(sessDir, 'plugin');
    plugin(chosenPlugin, true);
    // an APPROVED repo hook (hooksBlock output) re-added through the kernel --settings, beside the kernel's own
    const approved = g.repoHooks?.hooksBlock?.([{ hookId: 'x', source: 'project', event: 'PreToolUse', matcher: '.*', command: `echo approved-repo:PreToolUse >> "${markers}"`, timeout: null }]) ?? { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `echo approved-repo:PreToolUse >> "${markers}"` }] }] };
    const chosenHooks = { ...kernelHooks, PreToolUse: [...kernelHooks.PreToolUse, ...approved.PreToolUse] };
    const chosen = await modelArm({ policyPath: writePolicy('policy.json', { hooks: chosenHooks }), extra: ['--plugin-dir', chosenPlugin, '--add-dir', work], env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' } });

    const kernelFired = chosen.hooksFired.some((f) => f.startsWith('kernel-settings:'));
    const approvedFired = chosen.hooksFired.includes('approved-repo:PreToolUse');
    const repoEnvSeen = chosen.hooksFired.some((f) => f.includes('env=repo-env-set'));
    const allLoaded = Object.values(chosen.loaded).every(Boolean);
    const touched = existsSync(path.join(work, 'touched'));
    const checks = {
      claudeMdVisible: chosen.loaded.claudeMdToken,
      skillAgentCommandListed: chosen.loaded.skillX && chosen.loaded.agentY && chosen.loaded.commandZ,
      skillAndAgentUsed: chosen.toolUses.some((t) => t.name === 'Skill') && chosen.toolUses.some((t) => t.name === 'Agent' || t.name === 'Task'),
      noRepoHookFired: chosen.repoHooksFired.length === 0,
      kernelHooksFired: kernelFired,
      approvedRepoHookFired: approvedFired,
      repoEnvAbsent: !repoEnvSeen,
      repoAllowNotHonoured: chosen.touchAsked,
      sandboxHeld: !chosen.deviceKeyLeaked,
    };
    const verdict = Object.values(checks).every(Boolean) ? 'pass' : chosen.repoHooksFired.length > 0 || chosen.deviceKeyLeaked ? 'fail' : 'partial';
    return {
      verdict,
      evidence: {
        claudeBinary: CLAUDE.replace(os.homedir(), '~'),
        claudeVersion: path.basename(claudeReal),
        checks,
        candidates: {
          a_allSourcesPlusDisableAllHooks: { ...a, finding: 'disableAllHooks in --settings silences the kernel --settings hooks too (no approved-hook path), and the project layer would also load permissions.allow and env' },
          b_userPlusAddDirCopies: { ...b, finding: 'skills/agents/commands in an --add-dir are not loaded when the project source is off' },
          c_pluginUnstripped: { loaded: cRaw.loaded, listed: cRaw.listed, hooksFired: cRaw.hooksFired, repoHooksFired: cRaw.repoHooksFired, toolUses: cRaw.toolUses, reply: cRaw.reply, result: cRaw.result, finding: 'a --plugin-dir skill\'s frontmatter hooks DO fire: stripping is load-bearing' },
          chosen_pluginStrippedPlusAddDirRepo: { ...chosen, touched },
        },
        notes: [
          'chosen = --setting-sources user + a kernel-generated --plugin-dir (plugin "project": the repo\'s skills/agents/commands, frontmatter allow-listed so hooks, allowed-tools, permissionMode, mcpServers are dropped) + --add-dir <repo> with CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 (loads CLAUDE.md, .claude/CLAUDE.md, .claude/rules with @imports; not gated by the project source in 2.1.303) + approved repo hooks in the kernel --settings.',
          'plugin skills, agents and commands are namespaced: project:x, project:y, /project:z (a residual vs plain Claude Code\'s bare x / y / /z).',
          'every can_use_tool request was answered allow by the probe: touchAsked = the repo permissions.allow did not skip the card; deviceKeyLeaked = false means the session profile, not a card, stopped the read.',
          'scratch-config arms (a, b) have no login: they observe system.init and the pre-API SessionStart/UserPromptSubmit hooks only.',
        ],
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
