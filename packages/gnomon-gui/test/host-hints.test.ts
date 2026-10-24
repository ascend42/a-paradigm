/**
 * #gui-host-hints (founder 2026-10-23, the "pre-sanitization"): the ONE mapping table from an instruction that does
 * not run in Gnomon to the Gnomon way (core/host-hints.ts), the host slip's DOM (ui/host-slip.ts) and the app wiring
 * (checked by source). The reply text is never rewritten; a copied command is exactly the command shown; recognition
 * never acts and the slip's keys are trusted presses only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTINS, copyTextOf, HOST_HINTS_MAX, HOST_OPEN_IDS, HOST_SLASH_TABLE, hostHintsOf, NO_SLASH, SAFE_ARG, type HostHint } from '../src/core/host-hints.js';
import { displayText, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { chatItems, type Row } from '../src/core/store.js';
import { renderHostSlips } from '../src/ui/host-slip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const SLIP_UI = readFileSync(path.join(ROOT, 'src', 'ui', 'host-slip.ts'), 'utf8');
const MODEL = readFileSync(path.join(ROOT, 'src', 'core', 'host-hints.ts'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

/** The founder's field case, verbatim. */
const FIELD = 'To get the Neon skills, run `/plugin marketplace add neondatabase/agent-skills`, then restart the session so the plugin loads.';
const one = (text: string): HostHint => {
  const h = hostHintsOf(text);
  expect(h, text).toHaveLength(1);
  return h[0]!;
};

describe('#gui-host-hints mapping table', () => {
  it("the field case: /plugin marketplace add X → copy `claude plugin marketplace add X`, and the restart → New session", () => {
    const [plugin, restart] = hostHintsOf(FIELD);
    expect(plugin).toEqual({ said: '/plugin marketplace add neondatabase/agent-skills', line: "Slash commands don't run in Gnomon. Run this in your terminal:", action: { kind: 'copy', command: 'claude plugin marketplace add neondatabase/agent-skills' } });
    expect(restart).toMatchObject({ said: 'restart the session', action: { kind: 'open', id: 'session.new' } });
  });
  it('/plugin subcommands map to the claude plugin CLI; a bare /plugin to its help', () => {
    expect(copyTextOf(one('Run `/plugin install neon@agent-skills`.'))).toBe('claude plugin install neon@agent-skills');
    expect(copyTextOf(one('Type /plugin update neon'))).toBe('claude plugin update neon');
    expect(copyTextOf(one('`/plugin marketplace update agent-skills`'))).toBe('claude plugin marketplace update agent-skills');
    expect(copyTextOf(one('Open `/plugin` and pick Discover.'))).toBe('claude plugin --help');
    expect(copyTextOf(one('/plugin marketplace add https://github.com/neondatabase/agent-skills.git'))).toBe('claude plugin marketplace add https://github.com/neondatabase/agent-skills.git');
  });
  it('/mcp opens Settings › MCP servers; /config Settings; /permissions Rules; /clear a new session', () => {
    expect(one('Run `/mcp` to check the server.').action).toEqual({ kind: 'open', id: 'mcp.open', label: 'Open MCP servers' });
    expect(one('Use /config to turn it off.').action).toMatchObject({ kind: 'open', id: 'settings.open' });
    expect(one('Try `/permissions`.').action).toMatchObject({ kind: 'open', id: 'rules.open' });
    expect(one('Run /clear first').action).toMatchObject({ kind: 'open', id: 'session.new' });
    expect(one('Run `/login` again.').action).toEqual({ kind: 'copy', command: 'claude' });
  });
  it('a built-in with no mapping, and an unknown command after a verb, get the generic slip', () => {
    expect(one('`/doctor`').action).toEqual({ kind: 'copy', command: 'claude doctor' });
    expect(one('Run `/hooks` to see them.')).toEqual({ said: '/hooks', line: NO_SLASH, action: null });
    expect(one('Then type /frobnicate and wait.')).toEqual({ said: '/frobnicate', line: NO_SLASH, action: null });
    expect(one('`/neon:setup`')).toEqual({ said: '/neon:setup', line: NO_SLASH, action: null });
  });
  it('a slash command at a line start counts, in prose or a fence (a "$ " prompt allowed)', () => {
    expect(copyTextOf(one('Do this:\n\n```\n/plugin marketplace add neondatabase/agent-skills\n```'))).toBe('claude plugin marketplace add neondatabase/agent-skills');
    expect(one('Steps:\n1. /mcp\n').action).toMatchObject({ id: 'mcp.open' });
    expect(one('$ /config').action).toMatchObject({ id: 'settings.open' });
  });
  it('paths, routes, URLs and plain prose never count', () => {
    for (const t of [
      'The binary is in /usr/bin and logs go to /tmp/x.',
      'Edit src/mcp/index.ts and the /config.json file.',
      'The handler for GET /login returns 302.',
      'Add a /login route and a /status endpoint.',
      'See https://example.com/mcp for more.',
      'and/or the mcp server',
      'The app has a `/api` prefix.',
      'Open `/users` in the browser.',
      'Claude Code is the CLI; use Gnomon.',
    ]) expect(hostHintsOf(t), t).toEqual([]);
  });
  it('restart and "run claude …"', () => {
    expect(one('Restart Claude Code to load it.').action).toMatchObject({ id: 'session.new' });
    expect(one('Then run `claude --resume`.').action).toMatchObject({ id: 'session.new' });
    expect(one('Run `claude mcp add neon -- npx neon-mcp`.').action).toMatchObject({ id: 'mcp.open' });
    expect(copyTextOf(one('In a terminal, run `claude plugin marketplace add neondatabase/agent-skills`.'))).toBe('claude plugin marketplace add neondatabase/agent-skills');
  });
  it('an argument that is not a plain token never becomes a command (no shell metacharacters, quotes or spaces)', () => {
    for (const bad of ['x;rm -rf ~', 'a$(id)', '`id`', "o/r'", 'a|b', 'a&&b', '"x"', 'a>b']) {
      expect(SAFE_ARG.test(bad), bad).toBe(false);
      const h = hostHintsOf(`Run \`/plugin marketplace add ${bad}\``);
      for (const x of h) if (x.action?.kind === 'copy') expect(x.action.command).not.toContain(bad);
    }
    const h = one('Run `/plugin install a;b`');
    expect(h.action).toBeNull();
  });
  it('at most HOST_HINTS_MAX per reply, one per instruction', () => {
    expect(hostHintsOf('Run `/mcp`. Run `/mcp` again. Run `/config`, `/permissions`, `/clear` and `/hooks`.')).toHaveLength(HOST_HINTS_MAX);
    expect(hostHintsOf('Run `/mcp`, then `/mcp`.')).toHaveLength(1);
  });
  it('the table: every action opens a HOST_OPEN_IDS screen or copies a command starting with claude', () => {
    for (const [name, rule] of Object.entries(HOST_SLASH_TABLE)) {
      const a = rule('').action;
      if (a?.kind === 'open') expect(HOST_OPEN_IDS, name).toContain(a.id);
      if (a?.kind === 'copy') expect(a.command, name).toMatch(/^claude\b/);
      expect(BUILTINS.has(name), `${name} is in the table and BUILTINS`).toBe(false);
    }
  });
  it('the model only reads: no send, no log.append, no client call', () => {
    expect(MODEL).not.toMatch(/log\.append|client\.call|session\.send|fetch\(/);
  });
});

describe('#gui-host-hints: the reply is shown verbatim', () => {
  it('chatItems keeps the field-case text byte for byte (nothing rewritten, hidden or struck)', () => {
    const line = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: FIELD }] } });
    const rows: Row[] = [{ seq: 1, kind: 'turn.event', session: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0', view: 'full', payload: { type: 'assistant', line } }];
    const it0 = chatItems(rows).items.find((x) => x.role === 'assistant')!;
    expect(it0.text).toBe(FIELD);
    expect(hostHintsOf(it0.text)).toHaveLength(2);
  });
  it('the app draws host slips beside the reply body, from the unchanged text, never in the raw view', () => {
    expect(APP).toMatch(/const host = it\.role === 'assistant' && !rawMode \? hostHintsFor\(it\.key, it\.text\) : \[\];/);
    expect(APP).toMatch(/\.\.\.body, \.\.\.renderHostSlips\(doc, it\.key, host, hostCopied\)/);
  });
});

describe('#gui-host-hints slip DOM', () => {
  const [plugin] = hostHintsOf(FIELD);
  it('the copy slip: tab, line, the command shown exactly, a Copy quiet key', () => {
    const el = renderHostSlips(fdoc, '12', [plugin!])[0] as unknown as FEl;
    expect(el.className).toBe('slip host-slip');
    expect(el.attrs.get('role')).toBe('note');
    const code = el.all().find((x) => x.className === 'host-cmd')!;
    expect(code.tag).toBe('code');
    expect(code.text).toBe(copyTextOf(plugin!));
    expect(displayText(copyTextOf(plugin!))).toBe(copyTextOf(plugin!)); // the sanitizer changes nothing: shown == copied
    const key = el.all().find((x) => x.tag === 'button')!;
    expect(key.className).toBe('key quiet');
    expect(key.attrs.get('data-host-copy')).toBe('12:0');
    expect(key.attrs.has('data-decision')).toBe(false);
    expect(key.text).toBe('Copy');
    expect(el.text).toContain('in Gnomon · /plugin marketplace add neondatabase/agent-skills');
    expect((renderHostSlips(fdoc, '12', [plugin!], '12:0')[0] as unknown as FEl).all().find((x) => x.tag === 'button')!.text).toBe('Copied');
  });
  it('the screen slip opens a palette id; the note slip has no key', () => {
    const [mcp] = hostHintsOf('Run `/mcp`.');
    const el = renderHostSlips(fdoc, '3', [mcp!])[0] as unknown as FEl;
    expect(el.all().find((x) => x.tag === 'button')!.attrs.get('data-host-open')).toBe('mcp.open');
    const note = renderHostSlips(fdoc, '3', hostHintsOf('Then type /frobnicate'))[0] as unknown as FEl;
    expect(note.all().some((x) => x.tag === 'button')).toBe(false);
    expect(note.text).toContain(NO_SLASH);
  });
  it('presses are trusted only; Copy copies from the drawn hint; open runs a HOST_OPEN_IDS command; nothing is sent', () => {
    expect(SLIP_UI).toMatch(/if \(!e\.isTrusted\) return;/);
    expect(SLIP_UI).toMatch(/isOpenId\(id\)/);
    expect(APP).toMatch(/function onHostCopy\(ref: string, e: Event\): void \{\n  if \(!e\.isTrusted\) return;/);
    expect(APP).toMatch(/const cmd = hint \? copyTextOf\(hint\) : null;/);
    expect(APP).toMatch(/navigator\.clipboard\.writeText\(cmd\)/);
    expect(APP).toMatch(/wireHostSlips\(\$\('viewport'\), \{ copy: onHostCopy, open: \(id, e\) => run\(id, e\.isTrusted\) \}\);/);
    expect(SLIP_UI).not.toMatch(/\.innerHTML\s*=|log\.append|client\.call/);
  });
  it('the CSS: the offer-slip paper, flat; the command mono and wrapping', () => {
    expect(CSS).toMatch(/\.host-slip \{ transform: none; \}/);
    expect(CSS).toMatch(/\.host-cmd \{[^}]*font-family: var\(--mono\)[^}]*overflow-wrap: anywhere/);
  });
});
