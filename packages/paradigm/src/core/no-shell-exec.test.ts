/**
 * Repo content (flow symbols, .purpose anchors, project paths) and model or
 * user text (orchestration tasks, --pr) never reach a shell. Each test plants
 * a `touch <marker>` payload and asserts the marker was not created.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { validateFlow, loadFlowsFromPurpose, grepAnyFile } from './flow-validator.js';
import type { FlowDefinition } from './flow-schema.js';
import { recordLore } from './lore/storage.js';
import type { LoreEntry } from './lore/types.js';
import { notificationOsascriptArgs } from './background-orchestrator.js';
import { isPrRef } from '../commands/review/index.js';
import { tutorialCheckpointCommand, tutorialNextCommand, checkpointArgv } from '../commands/tutorial/index.js';
import { resolveInsideRoot } from '../commands/drift.js';
import { gitDiffSinceCommit } from '../../../paradigm-mcp/src/utils/safe-git.js';

let base: string;
let root: string;
const MARK = 'PWNED_MARK';
const marked = (): boolean => fs.existsSync(path.join(base, MARK)) || fs.existsSync(path.join(root, MARK)) || fs.existsSync(path.join(process.cwd(), MARK));

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'no-shell-'));
  // The project directory name itself is hostile: it reaches find/grep as rootDir.
  root = path.join(base, `proj$(touch ${path.join(base, MARK)})`);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'emit("order-placed");\nexport const checkoutForm = "#checkout-form";\n');
  fs.writeFileSync(path.join(root, '.purpose'), '#checkout-form:\n  description: form\nflows:\n  $checkout-flow:\n    steps: []\n');
});
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe('#flow-validator greps and finds without a shell', () => {
  it('validateFlow with hostile step symbols runs nothing and still finds real ones', () => {
    const flow: FlowDefinition = {
      id: '$checkout-flow',
      steps: [
        { type: 'action', symbol: '#checkout-form' },
        { type: 'action', symbol: `#x"; touch ${path.join(base, MARK)}; echo "` },
        { type: 'action', symbol: '#y$(touch PWNED_MARK)`touch PWNED_MARK`' },
        { type: 'signal', symbol: '!order-placed' },
        { type: 'signal', symbol: '!z$(touch PWNED_MARK)' },
      ],
    } as FlowDefinition;
    const r = validateFlow(flow, { rootDir: root, checkImplementation: true });
    expect(marked()).toBe(false);
    expect(r.coverage.actionsMissing).toEqual([flow.steps[1].symbol, flow.steps[2].symbol]);
    expect(r.coverage.signalsMissing).toEqual(['!z$(touch PWNED_MARK)']);
  });

  it('grepAnyFile treats a leading dash as a pattern, not an option', () => {
    expect(grepAnyFile(['-F'], '--version', root)).toBe(false);
    expect(grepAnyFile(['-F'], '#checkout-form', root)).toBe(true);
  });

  it('loadFlowsFromPurpose finds .purpose files under a hostile rootDir', () => {
    const flows = loadFlowsFromPurpose(root);
    expect(marked()).toBe(false);
    expect(flows.map((f) => f.id)).toEqual(['$checkout-flow']);
  });
});

describe('#lore-storage symbol validation', () => {
  it('finds .purpose files under a hostile rootDir without a shell', async () => {
    const entry: LoreEntry = {
      id: '', type: 'agent-session', timestamp: '2026-02-21T10:00:00Z', author: 't',
      agent: { provider: 'anthropic', model: 'm' }, title: 't', summary: 's',
      symbols_touched: ['#checkout-form', '#unknown-thing'],
    } as LoreEntry;
    const { validation } = await recordLore(root, entry, { validateSymbols: true });
    expect(marked()).toBe(false);
    expect(validation?.unregistered).toEqual(['#unknown-thing']);
  });
});

describe('CLI drift shares the no-shell git diff', () => {
  it('diffs a hostile anchor path and refuses a non-hex commit', () => {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    g('init', '--quiet'); g('config', 'user.email', 't@e.com'); g('config', 'user.name', 'T'); g('config', 'commit.gpgsign', 'false');
    const file = 'f$(touch PWNED_MARK)`touch PWNED_MARK`.ts';
    fs.writeFileSync(path.join(root, file), 'a\nb\n');
    g('add', '-A'); g('commit', '--quiet', '-m', '1');
    const from = g('rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(root, file), 'z\na\nb\n');
    g('commit', '--quiet', '-am', '2');
    expect(gitDiffSinceCommit(root, from, file)).toContain('+z');
    expect(gitDiffSinceCommit(root, 'HEAD~1', file)).toBeNull();
    expect(marked()).toBe(false);
  });
});

describe('#background-orchestrator desktop notification', () => {
  it('passes the task text as a run argument, never as AppleScript source', () => {
    const msg = 'Orchestration done: a" & (do shell script "touch /tmp/PWNED") & "';
    const args = notificationOsascriptArgs(msg);
    const sep = args.indexOf('--');
    expect(args.slice(sep + 1)).toEqual([msg, 'Paradigm']);
    expect(args.slice(0, sep).join(' ')).not.toContain('do shell script');
  });

  it.runIf(process.platform === 'darwin')('osascript reads the argument as data', () => {
    const msg = 'x" & (do shell script "touch ' + path.join(base, MARK) + '") & "';
    // Same argv shape, with `return` in place of `display notification` so the test shows no banner.
    const args = notificationOsascriptArgs(msg).map((a) => a.replace(/^display notification \(item 1 of argv\) with title \(item 2 of argv\)$/, 'return item 1 of argv'));
    expect(execFileSync('osascript', args, { encoding: 'utf8' }).trim()).toBe(msg);
    expect(marked()).toBe(false);
  });
});

describe('tutorial command-success checkpoints', () => {
  const setup = (command: string): void => {
    fs.mkdirSync(path.join(root, '.paradigm', 'tutorial'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'tutorial', 'curriculum.yaml'), [
      'title: t', 'description: d', 'bugs: []', 'steps:',
      '  - id: s1', '    title: s1', '    description: d', '    file: s1.md',
      '    checkpoints:', '      - type: command-success', `        command: ${JSON.stringify(command)}`,
    ].join('\n'));
    fs.writeFileSync(path.join(root, '.paradigm', 'tutorial', 'state.json'), JSON.stringify({ currentStep: 's1', completedSteps: [], fixedBugs: [] }));
  };

  it('never runs a command from curriculum.yaml', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const cmd of [`touch ${path.join(base, MARK)}`, `paradigm status; touch ${path.join(base, MARK)}`, 'paradigm status $(touch PWNED_MARK)']) {
        setup(cmd);
        await tutorialCheckpointCommand(root);
        await tutorialNextCommand(root);
      }
      expect(marked()).toBe(false);
      expect(exit).toHaveBeenCalledWith(1);
      expect(logs.mock.calls.flat().join('\n')).toContain('Unsupported checkpoint command');
    } finally {
      exit.mockRestore();
      logs.mockRestore();
    }
  });

  it('maps only the built-in commands to argv', () => {
    expect(checkpointArgv('paradigm status')).toEqual(['status']);
    expect(checkpointArgv('  paradigm   dream aggregate ')).toEqual(['dream', 'aggregate']);
    for (const bad of ['paradigm doctor --fix', 'paradigm status; id', 'touch x', 'constructor', 'toString', undefined, 42]) {
      expect(checkpointArgv(bad), String(bad)).toBeNull();
    }
  });
});

describe('#flow-validator signal patterns are escaped', () => {
  it('a regex metacharacter in a signal matches only literally', () => {
    fs.writeFileSync(path.join(root, 'src', 'c.ts'), 'emit("aXb");\n');
    const flow = { id: '$f', steps: [{ type: 'signal', symbol: '!a.b' }, { type: 'signal', symbol: '!order-placed' }] } as FlowDefinition;
    const r = validateFlow(flow, { rootDir: root, checkImplementation: true });
    expect(r.coverage.signalsMissing).toEqual(['!a.b']);
  });
});

describe('paradigm drift path containment', () => {
  it('resolveInsideRoot refuses paths outside the project, including through symlinks', () => {
    expect(resolveInsideRoot(root, '.purpose')).toBe(fs.realpathSync(path.join(root, '.purpose')));
    expect(resolveInsideRoot(root, 'src/a.ts')).toBe(fs.realpathSync(path.join(root, 'src', 'a.ts')));
    fs.writeFileSync(path.join(base, 'outside.txt'), 'x');
    expect(resolveInsideRoot(root, '../outside.txt')).toBeNull();
    expect(resolveInsideRoot(root, path.join(base, 'outside.txt'))).toBeNull();
    fs.symlinkSync(path.join(base, 'outside.txt'), path.join(root, 'link.purpose'));
    expect(resolveInsideRoot(root, 'link.purpose')).toBeNull();
    expect(resolveInsideRoot(root, 'missing.ts')).toBeNull();
    expect(resolveInsideRoot(root, '.')).toBeNull();
  });
});

describe('review --pr', () => {
  it('accepts numbers, URLs and branch names; refuses options and whitespace', () => {
    for (const ok of ['42', 'https://github.com/o/r/pull/42', 'feature/x']) expect(isPrRef(ok), ok).toBe(true);
    for (const bad of ['--repo=evil/x', '-R', '42 --web', '', '1;touch x\n']) expect(isPrRef(bad), bad).toBe(false);
  });
});
