/**
 * #command-consent — decides whether an API-run agent may use run_command.
 *
 * Gate ^command-execution-consent (portal.yaml). The setting is per user, in
 * ~/.paradigm/config.yaml:
 *
 *   agent-provider:
 *     allow-commands: true   # or false; absent = not decided yet
 *
 * It is deliberately NOT read from the project's .paradigm/config.yaml: a
 * cloned repo must not be able to grant itself shell access, and the agent's
 * own file tools are confined to the working directory, so they cannot reach
 * this file either.
 *
 * Resolution, first match wins:
 *   1. --allow-commands / --no-allow-commands for this run (never saved)
 *   2. the saved user setting
 *   3. not decided: interactive terminal -> offered, and the first call asks
 *      once and saves the answer; anything else (background, orchestrated,
 *      MCP, piped) -> not offered.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import * as tty from 'tty';
import * as yaml from 'js-yaml';

export interface CommandPolicy {
  /** One-run override from --allow-commands / --no-allow-commands. Never saved. */
  allowCommands?: boolean;
  /**
   * Whether a person is at the terminal to answer the consent question.
   * Defaults to stdin, stdout and stderr all being TTYs. Background runs set false.
   */
  interactive?: boolean;
  /** Called before the consent question is shown (e.g. stop a spinner). */
  onBeforePrompt?: () => void;
  /** Called after it is answered. */
  onAfterPrompt?: () => void;
}

export type ConsentState = 'allowed' | 'denied' | 'ask';
export type ConsentSource = 'flag' | 'config' | 'non-interactive' | 'undecided';

export interface ConsentDecision {
  allowed: boolean;
  /** Message for the model when refused. */
  reason?: string;
}

/** Asks the person whether to keep agent shell commands on. Resolves true for yes. */
export type ConsentPrompt = (command: string, cwd: string) => Promise<boolean>;

export const CONSENT_QUESTION =
  'Paradigm agents can run shell commands on your machine with your permissions. Keep this on? [y/N] ';

export const SETTING_KEY = 'agent-provider.allow-commands';

/**
 * The user's home from the account database (os.userInfo), not $HOME, so a
 * run started with HOME=. (or HOME pointing into a repo) can't move the
 * consent file somewhere the repo controls.
 */
export function userHomeDir(): string {
  try {
    return os.userInfo().homedir || os.homedir();
  } catch {
    return os.homedir();
  }
}

export function userConfigPath(home: string = userHomeDir()): string {
  return path.join(home, '.paradigm', 'config.yaml');
}

function readYaml(configPath: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function within(parent: string, p: string): boolean {
  const rel = path.relative(parent, p);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

function realOrNull(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/**
 * Whether a saved setting at configPath can be believed. It can't when the
 * file (followed through symlinks) sits inside the run's working directory,
 * is owned by someone else, or is group- or world-writable: in each case
 * someone other than this user (or the repo) could have written "true".
 */
export function isTrustedConfig(configPath: string, workingDirectory?: string): boolean {
  const real = realOrNull(configPath);
  if (!real) return false;
  if (workingDirectory) {
    const root = realOrNull(workingDirectory);
    if (root && within(root, real)) return false;
  }
  try {
    const st = fs.statSync(real);
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    if (process.platform !== 'win32' && (st.mode & 0o022) !== 0) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * The saved choice, or undefined when not decided, not a boolean, or not
 * trustworthy (see isTrustedConfig).
 */
export function readAllowCommandsSetting(
  configPath: string = userConfigPath(),
  workingDirectory?: string,
): boolean | undefined {
  if (!isTrustedConfig(configPath, workingDirectory)) return undefined;
  const section = readYaml(configPath)['agent-provider'];
  if (!section || typeof section !== 'object') return undefined;
  const value = (section as Record<string, unknown>)['allow-commands'];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Save the choice atomically (temp file + rename, mode 0600), keeping every
 * other key in the file. Refuses (throws) when the config folder resolves
 * inside the working directory.
 */
export function writeAllowCommandsSetting(
  value: boolean,
  configPath: string = userConfigPath(),
  workingDirectory?: string,
): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (workingDirectory) {
    const root = realOrNull(workingDirectory);
    const realDir = realOrNull(dir);
    if (root && realDir && within(root, realDir)) {
      throw new Error(`refusing to save consent inside the working directory (${realDir})`);
    }
  }
  const config = fs.existsSync(configPath) ? readYaml(configPath) : {};
  const existing = config['agent-provider'];
  const section = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  section['allow-commands'] = value;
  config['agent-provider'] = section;
  const tmp = path.join(dir, `.config.yaml.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tmp, yaml.dump(config, { lineWidth: -1, noRefs: true }), { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, configPath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * A person is at the terminal: stdin, stdout and stderr are TTYs and CI is
 * not set. Automation driving a pseudo-terminal (expect, node-pty) counts as
 * interactive; such tools should pass --allow-commands or --no-allow-commands.
 */
export function isInteractiveTerminal(): boolean {
  if (process.env.CI) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY);
}

/** Longest command or folder text shown in the consent question. */
export const MAX_PROMPT_TEXT = 500;

/**
 * Model-written text made safe to show in the consent question: cut to
 * MAX_PROMPT_TEXT characters, quoted with JSON.stringify (escapes C0 controls,
 * quotes, backslashes and newlines), and DEL, C1 controls, bidi overrides,
 * zero-width characters and line/paragraph separators shown as \uXXXX. It
 * can't move the cursor, clear the screen, start a new line or reorder text,
 * so it can't draw a fake question.
 */
export function escapeForTerminal(text: string, max = MAX_PROMPT_TEXT): string {
  const chars = Array.from(String(text));
  const cut = chars.length > max;
  const shown = JSON.stringify(chars.slice(0, max).join('')).replace(
    /[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return cut ? `${shown} ... (${chars.length - max} more characters not shown)` : shown;
}

// While a consent question is open, agent output to the terminal is held here
// and written after the answer (see holdWhilePrompting).
let consentPromptOpen = false;
const heldOutput: Array<() => void> = [];

/** True while the consent question is on screen. */
export function isConsentPromptOpen(): boolean {
  return consentPromptOpen;
}

/**
 * Run a terminal write now, or, while the consent question is open, after it
 * is answered. CLI commands route agent output through this so nothing an
 * agent prints can land between the question and the answer.
 */
export function holdWhilePrompting(write: () => void): void {
  if (consentPromptOpen) heldOutput.push(write);
  else write();
}

function setPromptOpen(open: boolean): void {
  consentPromptOpen = open;
  if (!open) {
    for (const write of heldOutput.splice(0)) {
      try {
        write();
      } catch {
        // A failed write must not lose the rest.
      }
    }
  }
}

export interface TerminalPromptIO {
  /** Where the answer is read. Defaults to /dev/tty when it can be opened, else stdin. */
  openInput?: () => { input: NodeJS.ReadableStream & { isTTY?: boolean }; close: () => void };
  /** Where the question is written. Defaults to stderr, so --json stdout stays clean. */
  output?: NodeJS.WritableStream;
}

function defaultInput(): { input: NodeJS.ReadableStream & { isTTY?: boolean }; close: () => void } {
  try {
    const fd = fs.openSync('/dev/tty', 'r');
    const input = new tty.ReadStream(fd);
    return { input, close: () => input.destroy() };
  } catch {
    return { input: process.stdin, close: () => {} };
  }
}

/**
 * Build the terminal consent question. The answer is read from /dev/tty when
 * available (so piped stdin can't answer it), else stdin. Only y or yes counts
 * as yes; Enter, anything else, EOF or Ctrl+C is no.
 */
export function makeTerminalPrompt(io: TerminalPromptIO = {}): ConsentPrompt {
  return (command, cwd) =>
    new Promise((resolve) => {
      const out = io.output ?? process.stderr;
      const { input, close } = (io.openInput ?? defaultInput)();
      out.write('\nA Paradigm agent wants to run a shell command:\n');
      out.write(`  command: ${escapeForTerminal(command)}\n`);
      out.write(`  in:      ${escapeForTerminal(cwd)}\n\n`);
      const rl = readline.createInterface({ input, output: out, terminal: Boolean(input.isTTY) });
      let settled = false;
      const finish = (yes: boolean): void => {
        if (settled) return;
        settled = true;
        rl.close();
        close();
        resolve(yes);
      };
      rl.question(CONSENT_QUESTION, (answer) => finish(/^\s*y(es)?\s*$/i.test(answer)));
      rl.on('close', () => finish(false));
    });
}

export const terminalConsentPrompt: ConsentPrompt = makeTerminalPrompt();

// One question at a time per config file, even when parallel builders hit
// run_command together.
const pendingPrompts = new Map<string, Promise<boolean>>();

export interface CommandGateDeps {
  /** Test seam for the user's home (defaults to userHomeDir()). */
  homeDir?: string;
  /** The run's working directory; a saved setting inside it is ignored. */
  workingDirectory?: string;
  configPath?: string;
  prompt?: ConsentPrompt;
  isInteractive?: () => boolean;
  /** Where the confirmation line after the answer goes. Defaults to stderr. */
  notify?: (line: string) => void;
}

export class CommandGate {
  private readonly configPath: string;
  private readonly prompt: ConsentPrompt;
  private readonly interactive: boolean;
  private readonly notify: (line: string) => void;
  private readonly workingDirectory?: string;

  constructor(private readonly policy: CommandPolicy = {}, deps: CommandGateDeps = {}) {
    this.configPath = deps.configPath ?? userConfigPath(deps.homeDir);
    this.workingDirectory = deps.workingDirectory;
    this.prompt = deps.prompt ?? terminalConsentPrompt;
    this.interactive = policy.interactive ?? (deps.isInteractive ?? isInteractiveTerminal)();
    this.notify = deps.notify ?? ((line) => process.stderr.write(`${line}\n`));
  }

  resolve(): { state: ConsentState; source: ConsentSource } {
    if (typeof this.policy.allowCommands === 'boolean') {
      return { state: this.policy.allowCommands ? 'allowed' : 'denied', source: 'flag' };
    }
    const saved = readAllowCommandsSetting(this.configPath, this.workingDirectory);
    if (typeof saved === 'boolean') {
      return { state: saved ? 'allowed' : 'denied', source: 'config' };
    }
    return this.interactive
      ? { state: 'ask', source: 'undecided' }
      : { state: 'denied', source: 'non-interactive' };
  }

  /** Whether run_command is put in the tool list sent to the model. */
  isOffered(): boolean {
    return this.resolve().state !== 'denied';
  }

  async authorize(command: string, cwd: string): Promise<ConsentDecision> {
    const { state, source } = this.resolve();
    if (state === 'allowed') return { allowed: true };
    if (state === 'denied') return { allowed: false, reason: refusalFor(source) };

    let pending = pendingPrompts.get(this.configPath);
    if (!pending) {
      pending = this.ask(command, cwd).finally(() => pendingPrompts.delete(this.configPath));
      pendingPrompts.set(this.configPath, pending);
    }
    const yes = await pending;
    return yes ? { allowed: true } : { allowed: false, reason: refusalFor('config') };
  }

  private async ask(command: string, cwd: string): Promise<boolean> {
    setPromptOpen(true);
    let yes = false;
    try {
      this.policy.onBeforePrompt?.();
      let saved = false;
      try {
        yes = await this.prompt(command, cwd);
        writeAllowCommandsSetting(yes, this.configPath, this.workingDirectory);
        saved = true;
      } catch {
        yes = false;
      }
      this.notify(
        saved
          ? `Saved: agent shell commands are ${yes ? 'ON' : 'OFF'}. Change ${SETTING_KEY} in ${this.configPath}, or use --allow-commands / --no-allow-commands for one run.`
          : 'Agent shell commands are OFF for this call; nothing was saved.',
      );
    } finally {
      // Held agent output is written only after the answer and the saved line.
      setPromptOpen(false);
      this.policy.onAfterPrompt?.();
    }
    return yes;
  }
}

function refusalFor(source: ConsentSource): string {
  switch (source) {
    case 'flag':
      return 'run_command is turned off for this run (--no-allow-commands).';
    case 'config':
      return `run_command is turned off by the user (${SETTING_KEY}: false). Do not retry; continue without shell commands.`;
    case 'non-interactive':
    default:
      return `run_command needs the user's consent, and no one is at a terminal to give it. Set ${SETTING_KEY} in ~/.paradigm/config.yaml or pass --allow-commands.`;
  }
}
