/**
 * @symbol #bare-entry
 * @symbol #first-run
 *
 * Auto-open: a launch or setup URL printed on the user's terminal is ALSO
 * handed to the default browser (spec §2.4 rule 10, §11.2 rule 2; probe P07).
 *
 * The URL carries a single-use token, and the token is never on any process
 * argv, env, file or log (G-GUI-12). So `open <url>` is forbidden: the URL
 * would sit on `open`'s argv where `ps` reads it. Instead, on darwin, this
 * runs `/usr/bin/osascript -` (absolute path, no shell, an EMPTY env) and
 * writes `open location "<url>"` to its STDIN; LaunchServices opens the
 * default browser. The URL is validated strictly first (loopback, a fragment
 * of [A-Za-z0-9_=&%.-] only), so no quote, backslash or newline can reach
 * the script. Never throws: the result is ok or failed, and the caller keeps
 * printing the URL on the TTY as the fallback.
 *
 * Who may open: only a terminal launch (printLaunch's TTY rule, runGuiSetup
 * via 'tty'). Never the wrapper channel (`up --wrapper`), never without a
 * TTY, never with `--no-open` or `GNOMON_NO_OPEN=1`. Zero deps (G-SEC-01).
 */
import { spawn as nodeSpawn } from 'node:child_process';

export type OpenResult = { ok: true } | { ok: false; reason: string };

/** Opens a launch URL in the default browser. Never throws. */
export type BrowserOpener = (url: string) => Promise<OpenResult>;

/** The slice of a ChildProcess the opener uses. */
export interface OpenerChild {
  stdin: { write(s: string): unknown; end(): unknown; on(ev: 'error', l: (e: Error) => void): unknown } | null;
  on(ev: 'error', l: (e: Error) => void): unknown;
  on(ev: 'exit', l: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

/** The spawn seam (tests): argv and env are asserted exactly. */
export type OpenerSpawn = (file: string, args: readonly string[], opts: { env: Record<string, string>; stdio: ['pipe', 'ignore', 'ignore']; shell: false }) => OpenerChild;

export interface OpenDeps {
  platform?: NodeJS.Platform;
  spawn?: OpenerSpawn;
  timeoutMs?: number;
  /** tests (the darwin smoke): build a different script from the validated URL, e.g. one that only returns. */
  script?: (url: string) => string;
}

export const OSASCRIPT = '/usr/bin/osascript';
export const OPEN_TIMEOUT_MS = 5000;

/** The only URL shape the opener accepts: the loopback endpoint with a fragment of safe characters. */
export const LAUNCH_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d{1,5}\/#[A-Za-z0-9_=&%.-]+$/;

export function isOpenableUrl(url: unknown): url is string {
  return typeof url === 'string' && LAUNCH_URL_PATTERN.test(url);
}

/** The AppleScript for a VALIDATED url (the pattern excludes `"`, `\` and newlines, so the literal cannot be broken). */
export function openLocationScript(url: string): string {
  return `open location "${url}"\n`;
}

export function openInDefaultBrowser(url: string, deps: OpenDeps = {}): Promise<OpenResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return Promise.resolve({ ok: false, reason: `auto-open is macOS only (this is ${platform})` });
  if (!isOpenableUrl(url)) return Promise.resolve({ ok: false, reason: 'refused: not a loopback launch URL' });
  const script = (deps.script ?? openLocationScript)(url);
  const spawn = deps.spawn ?? (nodeSpawn as unknown as OpenerSpawn);
  return new Promise<OpenResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (r: OpenResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let child: OpenerChild;
    try {
      // the URL rides on stdin only: argv is exactly ['-'] and the env is empty
      child = spawn(OSASCRIPT, ['-'], { env: {}, stdio: ['pipe', 'ignore', 'ignore'], shell: false });
    } catch (e) {
      done({ ok: false, reason: `osascript did not start: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done({ ok: false, reason: 'osascript timed out' });
    }, deps.timeoutMs ?? OPEN_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', (e) => done({ ok: false, reason: `osascript failed: ${e.message}` }));
    child.on('exit', (code, signal) => done(code === 0 ? { ok: true } : { ok: false, reason: `osascript exited ${code ?? signal}` }));
    if (!child.stdin) {
      done({ ok: false, reason: 'osascript has no stdin' });
      return;
    }
    child.stdin.on('error', (e) => done({ ok: false, reason: `osascript stdin: ${e.message}` }));
    try {
      child.stdin.write(script);
      child.stdin.end();
    } catch (e) {
      done({ ok: false, reason: `osascript stdin: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}

/** `GNOMON_NO_OPEN` set to anything but empty or `0` turns auto-open off (scripts). */
export function noOpenFromEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  const v = env.GNOMON_NO_OPEN;
  return v !== undefined && v !== '' && v !== '0';
}

/** The opener a terminal launch uses, or null when auto-open is off (`--no-open`, GNOMON_NO_OPEN). */
export function terminalOpener(o: { noOpen?: boolean; env?: Readonly<Record<string, string | undefined>>; open?: BrowserOpener }): BrowserOpener | null {
  if (o.noOpen === true || noOpenFromEnv(o.env ?? process.env)) return null;
  return o.open ?? ((url) => openInDefaultBrowser(url));
}

/**
 * Show a single-use URL on the terminal. With an opener the URL is printed FIRST (so a slow or hung osascript
 * never holds back the fallback, Aegis L2), then handed to the browser, and a failure is reported under it;
 * without one, the plain copy-this line. The caller has already checked the TTY; the URL goes nowhere but the
 * TTY and osascript's stdin.
 */
export async function presentUrl(out: { write(s: string): unknown }, url: string, opener: BrowserOpener | null, copyLine: string): Promise<boolean> {
  if (!opener) {
    out.write(`\n  ${copyLine}:\n\n  ${url}\n`);
    return false;
  }
  out.write(`\n  opening in your browser (single use, 60 s)\n  if it doesn't open: ${url}\n`);
  let r: OpenResult;
  try {
    r = await opener(url);
  } catch (e) {
    r = { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!r.ok) out.write(`  (could not open your browser: ${r.reason}; ${copyLine.toLowerCase()} above)\n`);
  return r.ok;
}
