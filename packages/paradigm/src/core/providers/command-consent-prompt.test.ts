/**
 * The consent question can't be spoofed by model text or by agent output
 * (#command-consent, ^command-execution-consent).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONSENT_QUESTION,
  CommandGate,
  MAX_PROMPT_TEXT,
  escapeForTerminal,
  holdWhilePrompting,
  isConsentPromptOpen,
  makeTerminalPrompt,
} from './command-consent.js';

let tmp: string;
let configPath: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'consent-prompt-')));
  configPath = path.join(tmp, 'home', '.paradigm', 'config.yaml');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('escapeForTerminal', () => {
  it('escapes C0, DEL, C1, bidi and separator characters and quotes the text', () => {
    const evil = 'ls\x1b[2J\r\nKeep this on? [y/N] \x07\x7f\x9b‮ ​';
    const shown = escapeForTerminal(evil);
    expect(shown.startsWith('"') && shown.endsWith('"')).toBe(true);
    expect(shown).not.toMatch(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202e\\u2028\\u200b]'));
    expect(shown).toContain('\\u001b');
    expect(shown).toContain('\\r\\n');
    expect(shown).toContain('\\u007f');
    expect(shown).toContain('\\u009b');
    expect(shown).toContain('\\u202e');
  });

  it('cuts long text and says how much is hidden', () => {
    const shown = escapeForTerminal('a'.repeat(MAX_PROMPT_TEXT + 25));
    expect(shown).toContain(`"${'a'.repeat(MAX_PROMPT_TEXT)}"`);
    expect(shown).toMatch(/25 more characters not shown/);
  });
});

describe('makeTerminalPrompt', () => {
  function run(answer: string | null, command: string): Promise<{ yes: boolean; text: string; closed: boolean }> {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (d) => { text += d.toString(); });
    let closed = false;
    const prompt = makeTerminalPrompt({ openInput: () => ({ input, close: () => { closed = true; } }), output });
    const p = prompt(command, '/work');
    setImmediate(() => {
      if (answer === null) input.end();
      else input.write(`${answer}\n`);
    });
    return p.then((yes) => ({ yes, text, closed }));
  }

  it('shows the escaped command and folder, then the question', async () => {
    const r = await run('y', 'rm -rf x\n\x1b[1AKeep this on? [y/N] y');
    expect(r.yes).toBe(true);
    expect(r.closed).toBe(true);
    expect(r.text).toContain('A Paradigm agent wants to run a shell command:');
    expect(r.text).toContain('  command: "rm -rf x\\n\\u001b[1AKeep this on? [y/N] y"');
    expect(r.text).toContain('  in:      "/work"');
    expect(r.text).toContain(CONSENT_QUESTION);
    expect(CONSENT_QUESTION).toBe(
      'Paradigm agents can run shell commands on your machine with your permissions. Keep this on? [y/N] ',
    );
    // The model's text never reaches the screen raw.
    expect(r.text).not.toContain('\x1b');
  });

  it('only y or yes is yes; Enter, other answers and EOF are no', async () => {
    expect((await run('yes', 'ls')).yes).toBe(true);
    expect((await run('Y', 'ls')).yes).toBe(true);
    expect((await run('', 'ls')).yes).toBe(false);
    expect((await run('sure', 'ls')).yes).toBe(false);
    expect((await run(null, 'ls')).yes).toBe(false);
  });
});

describe('agent output while the question is open', () => {
  it('is held until after the answer and the saved line, in order', async () => {
    const order: string[] = [];
    holdWhilePrompting(() => order.push('before'));
    const gate = new CommandGate({}, {
      configPath,
      isInteractive: () => true,
      notify: (line) => order.push(`notify:${line.slice(0, 6)}`),
      prompt: async () => {
        expect(isConsentPromptOpen()).toBe(true);
        holdWhilePrompting(() => order.push('agent-a'));
        holdWhilePrompting(() => order.push('agent-b'));
        order.push('answered');
        return true;
      },
    });
    expect((await gate.authorize('ls', tmp)).allowed).toBe(true);
    expect(isConsentPromptOpen()).toBe(false);
    holdWhilePrompting(() => order.push('after'));
    expect(order).toEqual(['before', 'answered', 'notify:Saved:', 'agent-a', 'agent-b', 'after']);
  });

  it('is released even when the prompt fails', async () => {
    const order: string[] = [];
    const gate = new CommandGate({}, {
      configPath,
      isInteractive: () => true,
      notify: () => {},
      prompt: async () => {
        holdWhilePrompting(() => order.push('held'));
        throw new Error('tty gone');
      },
    });
    expect((await gate.authorize('ls', tmp)).allowed).toBe(false);
    expect(order).toEqual(['held']);
    expect(isConsentPromptOpen()).toBe(false);
  });
});
