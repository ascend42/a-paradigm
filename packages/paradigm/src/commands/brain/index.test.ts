/**
 * Tests for #brain-cli. HOME points into a sandbox (os.homedir() honors it),
 * so brain storage never touches the real ~/.paradigm.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  initCommand, scanCommand, suggestCommand, confirmCommand, statusCommand, shareCommand, unshareCommand,
  accessCommand, suggestionsFlagCommand, purgeCommand, egressCommand, resolveBrain, setBrainPrompter,
  setBrainLauncher, suggestionsOffText, BRAIN_URL,
} from './index.js';
import { makeSandbox, snapshotTree, type BrainSandbox } from '../../../../paradigm-mcp/src/utils/brain/__fixtures__/env.js';
import { loadBrainConfig, rootHashOf, brainDir } from '../../../../paradigm-mcp/src/utils/brain/config.js';
import { loadDeclared } from '../../../../paradigm-mcp/src/utils/brain/declared.js';

let sb: BrainSandbox;
let root: string;
let stdout: string;
let stderr: string;

function w(rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function lastJson(): any {
  return JSON.parse(stdout.slice(stdout.lastIndexOf('\n{') + 1));
}

beforeEach(() => {
  sb = makeSandbox('brain-cli-');
  root = path.join(sb.tmp, 'Notes');
  fs.mkdirSync(root);
  w('Recipes/Pasta.md', '---\ntags: [cooking]\n---\n# Pasta\n[[Soup]]\n');
  w('Recipes/Soup.md', '---\ntags: [cooking]\n---\n# Soup\n[[Missing]]\n');
  w('Health/Checkup.md', '# Checkup\n');
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => { stdout += String(c); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((c: any) => { stderr += String(c); return true; });
  setBrainPrompter({ isTTY: () => false, confirm: async () => false });
  process.exitCode = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  setBrainPrompter(null);
  setBrainLauncher(null);
  process.exitCode = 0;
  sb.cleanup();
});

describe('paradigm brain CLI', () => {
  it('init scans, locks zones, never writes inside the folder', async () => {
    const snap = snapshotTree(root);
    await initCommand(root, { open: false });
    expect(stdout).toContain('Brain ready');
    expect(stdout).toContain('Health');
    expect(stdout).toContain('Nothing has left this Mac');
    expect(stdout).not.toContain('Checkup');
    expect(snapshotTree(root)).toEqual(snap);
    await initCommand(root, { open: false, json: true });
    expect(lastJson()).toMatchObject({ created: false, visible: 2 });
  });

  it('init refuses the home folder with a plain error', async () => {
    await initCommand(sb.home, { open: false });
    expect(process.exitCode).toBe(1);
    expect(stderr).toMatch(/home folder/);
  });

  it('scan --json reports health', async () => {
    await initCommand(root, { open: false });
    await scanCommand({ json: true });
    const j = lastJson();
    expect(j.health.counts.brokenLinks).toBe(1);
    expect(JSON.stringify(j)).not.toContain('Checkup');
  });

  it('suggest → confirm / --reject / --skip → status --acceptance', async () => {
    await initCommand(root, { open: false });
    await suggestCommand({ json: true });
    const batch = lastJson();
    expect(batch.suggestions.length).toBeGreaterThanOrEqual(2);
    const [a, b] = batch.suggestions;
    await confirmCommand(a.id, {});
    expect(stdout).toContain(`Kept topic "${a.label}"`);
    await confirmCommand(b.id, { reject: true });
    await confirmCommand('s_0000000000', { skip: true });
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    await confirmCommand(a.id, { reject: true, skip: true });
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(Object.keys(loadDeclared(rootHashOf(root)).components)).toHaveLength(1);
    await statusCommand({ acceptance: true, json: true });
    expect(lastJson().acceptance).toMatchObject({ accept: 1, reject: 1, acceptance: 0.5 });
    stdout = '';
    await statusCommand({ acceptance: true });
    expect(stdout).toContain('50%');
  });

  it('suggestions flag off → suggest says off', async () => {
    await initCommand(root, { open: false });
    await suggestionsFlagCommand('off', {});
    await suggestCommand({});
    expect(stdout).toContain('Suggestions are off');
    await suggestionsFlagCommand('bogus', {});
    expect(process.exitCode).toBe(1);
  });

  it('share requires a person at a terminal; unshare does not', async () => {
    await initCommand(root, { open: false });
    const h = rootHashOf(root);
    await shareCommand('Recipes/**', {});
    expect(process.exitCode).toBe(1);
    expect(loadBrainConfig(h).share).toEqual([]);
    process.exitCode = 0;
    setBrainPrompter({ isTTY: () => true, confirm: async () => false });
    await shareCommand('Recipes/**', {});
    expect(loadBrainConfig(h).share).toEqual([]);
    setBrainPrompter({ isTTY: () => true, confirm: async () => true });
    await shareCommand('Recipes/**', {});
    expect(loadBrainConfig(h).share).toEqual(['Recipes/**']);
    setBrainPrompter({ isTTY: () => false, confirm: async () => true });
    await unshareCommand('Recipes/**', {});
    expect(loadBrainConfig(h).share).toEqual([]);
  });

  it('access metadata needs TTY confirmation; off does not', async () => {
    await initCommand(root, { open: false });
    const h = rootHashOf(root);
    await accessCommand('metadata', {});
    expect(loadBrainConfig(h).agent_access).toBe('off');
    process.exitCode = 0;
    setBrainPrompter({ isTTY: () => true, confirm: async () => true });
    await accessCommand('metadata', {});
    expect(loadBrainConfig(h).agent_access).toBe('metadata');
    setBrainPrompter({ isTTY: () => false, confirm: async () => false });
    await accessCommand('off', {});
    expect(loadBrainConfig(h).agent_access).toBe('off');
  });

  it('access after an out-of-band brain.yaml edit shows a diff and needs TTY confirmation', async () => {
    await initCommand(root, { open: false });
    const h = rootHashOf(root);
    const file = path.join(brainDir(h), 'brain.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('share: []', "share:\n  - '**'").replace(/agent_access: '?off'?/, 'agent_access: metadata'));
    expect(loadBrainConfig(h)).toMatchObject({ tampered: true, agent_access: 'off' });

    // off-TTY: refused even for `off`, diff shown, nothing re-hashed
    await accessCommand('off', {});
    expect(process.exitCode).toBe(1);
    expect(stdout + stderr).toContain('+ shared: **');
    expect(stdout + stderr).toContain('~ agent access: off → metadata');
    expect(loadBrainConfig(h).tampered).toBe(true);

    // TTY but declined → still paused
    process.exitCode = 0;
    setBrainPrompter({ isTTY: () => true, confirm: async () => false });
    await accessCommand('metadata', {});
    expect(loadBrainConfig(h).tampered).toBe(true);

    // TTY + confirmed → accepted and re-hashed
    setBrainPrompter({ isTTY: () => true, confirm: async () => true });
    await accessCommand('metadata', {});
    const cfg = loadBrainConfig(h);
    expect(cfg.tampered).toBeUndefined();
    expect(cfg).toMatchObject({ agent_access: 'metadata', share: ['**'] });
  });

  it('egress reports nothing left; purge needs --yes off-TTY and archives egress', async () => {
    await initCommand(root, { open: false });
    await egressCommand({});
    expect(stdout).toContain('Nothing has left this Mac.');
    const h = rootHashOf(root);
    fs.writeFileSync(path.join(brainDir(h), 'egress.log'), JSON.stringify({ at: 'x', channel: 'mcp', op: 'status', fileIds: [], bytes: 1, root }) + '\n');
    await purgeCommand({});
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(brainDir(h))).toBe(true);
    process.exitCode = 0;
    await purgeCommand({ yes: true, json: true });
    const res = lastJson();
    expect(res.removed).toBe(true);
    expect(fs.existsSync(res.egressArchive)).toBe(true);
    expect(fs.existsSync(brainDir(h))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Recipes', 'Pasta.md'))).toBe(true);
  });

  it('resolveBrain: needs --folder/--brain once there are several', async () => {
    await initCommand(root, { open: false });
    const other = path.join(sb.tmp, 'Other');
    fs.mkdirSync(other);
    await initCommand(other, { open: false });
    expect(resolveBrain({})).toBeNull();
    expect(stderr).toContain('More than one brain');
    expect(resolveBrain({ folder: other })).toBe(rootHashOf(other));
    expect(resolveBrain({ brain: 'nope' })).toBeNull();
    process.exitCode = 0;
    stdout = '';
    await statusCommand({});
    expect(stdout).toContain(rootHashOf(other));
  });

  it('init on a TTY launches the Platform detached and returns (deep-links /brain); --no-open skips it', async () => {
    const launch = vi.fn(async () => BRAIN_URL);
    setBrainLauncher({ launch });
    setBrainPrompter({ isTTY: () => true, confirm: async () => false });
    await initCommand(root, {});
    expect(launch).toHaveBeenCalledTimes(1);
    expect(BRAIN_URL).toMatch(/\/brain$/);
    expect(stdout).toContain(BRAIN_URL);
    launch.mockClear();
    await initCommand(root, { open: false });
    expect(launch).not.toHaveBeenCalled();
    // Launcher could not start a server → prints how to open it, still returns.
    setBrainLauncher({ launch: async () => null });
    stdout = '';
    await initCommand(root, {});
    expect(stdout).toContain('paradigm serve');
    expect(stdout).toContain(BRAIN_URL);
  });

  it('CLI shows only cli-output lines: no INFO library logs, no padlock emoji', async () => {
    await initCommand(root, { open: false });
    await scanCommand({});
    expect(stderr).not.toMatch(/INFO/);
    expect(stdout).not.toMatch(/INFO/);
    expect(stdout).toContain('Private & locked');
    expect(stdout).not.toContain('\u{1F512}');
  });

  it('suggest --limit rejects non-numbers with exit 1', async () => {
    await initCommand(root, { open: false });
    await suggestCommand({ limit: 'abc' });
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--limit must be a whole number');
    process.exitCode = 0;
    await suggestCommand({ limit: '1', json: true });
    expect(lastJson().suggestions).toHaveLength(1);
  });

  it('scan explains cross-links it could not check', async () => {
    w('Recipes/Code.md', "---\nrelates: ['app/#checkout']\n---\n# Code\n");
    await initCommand(root, { open: false, workspace: path.join(sb.tmp, 'missing-workspace.yaml') });
    stdout = '';
    await scanCommand({});
    expect(stdout).toContain("1 link to code couldn't be checked");
    expect(stdout).toContain('paradigm index');
  });

  it('auto-paused suggestions: status and suggest say "paused (too many dismissed)"', async () => {
    await initCommand(root, { open: false });
    const h = rootHashOf(root);
    const rows = Array.from({ length: 10 }, (_, i) => JSON.stringify({ kind: 'verdict', suggestionId: `s_${String(i).padStart(10, '0')}`, verdict: 'reject', at: 'x' }));
    fs.appendFileSync(path.join(brainDir(h), 'suggestions.jsonl'), rows.join('\n') + '\n');
    stdout = '';
    await statusCommand({});
    expect(stdout).toContain('Suggestions paused (too many dismissed). Turn back on with `paradigm brain suggestions on`.');
    stdout = '';
    await suggestCommand({});
    expect(stdout).toContain('Suggestions paused (too many dismissed)');
    expect(suggestionsOffText({ enabled: false, paused: false })).toContain('Suggestions are off');
  });

  it('skip copy says it comes back', async () => {
    await initCommand(root, { open: false });
    await suggestCommand({ json: true });
    const [a] = lastJson().suggestions;
    await confirmCommand(a.id, { skip: true });
    expect(stdout).toContain('it will come back');
  });
});
