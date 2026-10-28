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

export function userConfigPath(): string {
  return path.join(os.homedir(), '.paradigm', 'config.yaml');
}

function readYaml(configPath: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The saved choice, or undefined when not decided (or not a boolean). */
export function readAllowCommandsSetting(configPath: string = userConfigPath()): boolean | undefined {
  const section = readYaml(configPath)['agent-provider'];
  if (!section || typeof section !== 'object') return undefined;
  const value = (section as Record<string, unknown>)['allow-commands'];
  return typeof value === 'boolean' ? value : undefined;
}

/** Save the choice, keeping every other key in the file. */
export function writeAllowCommandsSetting(value: boolean, configPath: string = userConfigPath()): void {
  const config = fs.existsSync(configPath) ? readYaml(configPath) : {};
  const existing = config['agent-provider'];
  const section = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  section['allow-commands'] = value;
  config['agent-provider'] = section;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1, noRefs: true }), 'utf-8');
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY);
}

/**
 * The real terminal question. Written to stderr so --json output on stdout
 * stays clean. EOF or Ctrl+C counts as no.
 */
export const terminalConsentPrompt: ConsentPrompt = (command, cwd) =>
  new Promise((resolve) => {
    const err = process.stderr;
    err.write('\nA Paradigm agent wants to run a shell command:\n');
    err.write(`  ${command}\n`);
    err.write(`  in ${cwd}\n\n`);
    const rl = readline.createInterface({ input: process.stdin, output: err, terminal: true });
    let answered = false;
    rl.question(CONSENT_QUESTION, (answer) => {
      answered = true;
      rl.close();
      resolve(/^\s*y(es)?\s*$/i.test(answer));
    });
    rl.on('close', () => {
      if (!answered) resolve(false);
    });
  });

// One question at a time per config file, even when parallel builders hit
// run_command together.
const pendingPrompts = new Map<string, Promise<boolean>>();

export interface CommandGateDeps {
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

  constructor(private readonly policy: CommandPolicy = {}, deps: CommandGateDeps = {}) {
    this.configPath = deps.configPath ?? userConfigPath();
    this.prompt = deps.prompt ?? terminalConsentPrompt;
    this.interactive = policy.interactive ?? (deps.isInteractive ?? isInteractiveTerminal)();
    this.notify = deps.notify ?? ((line) => process.stderr.write(`${line}\n`));
  }

  resolve(): { state: ConsentState; source: ConsentSource } {
    if (typeof this.policy.allowCommands === 'boolean') {
      return { state: this.policy.allowCommands ? 'allowed' : 'denied', source: 'flag' };
    }
    const saved = readAllowCommandsSetting(this.configPath);
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
    this.policy.onBeforePrompt?.();
    let yes: boolean;
    let saved = false;
    try {
      yes = await this.prompt(command, cwd);
      writeAllowCommandsSetting(yes, this.configPath);
      saved = true;
    } catch {
      yes = false;
    }
    this.notify(
      saved
        ? `Saved: agent shell commands are ${yes ? 'ON' : 'OFF'}. Change ${SETTING_KEY} in ${this.configPath}, or use --allow-commands / --no-allow-commands for one run.`
        : 'Agent shell commands are OFF for this call; nothing was saved.',
    );
    this.policy.onAfterPrompt?.();
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
