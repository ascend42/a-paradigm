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
import { renderRunRow } from '../src/ui/slash-menu.js';
import { runReducer, runWords, startRun } from '../src/core/slash-runs.js';
import { SKILL_HINT_LINE, BUILTINS, copyTextOf, HOST_HINTS_MAX, HOST_OPEN_IDS, HOST_SLASH_TABLE, hostHintsOf, NO_SLASH, SAFE_ARG, type HostHint } from '../src/core/host-hints.js';
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
    expect(plugin).toEqual({ said: '/plugin marketplace add neondatabase/agent-skills', line: "Slash commands don't run in Gnomon. Run this in your terminal:", action: { kind: 'copy', command: 'claude plugin marketplace add neondatabase/agent-skills', arg: 'neondatabase/agent-skills' }, warn: 'Plugins run code on your machine: check where neondatabase/agent-skills comes from before you run this.' });
    expect(restart).toMatchObject({ said: 'restart the session', action: { kind: 'open', id: 'session.new' } });
  });
  it('/plugin subcommands map to the claude plugin CLI; a bare /plugin to its help', () => {
    expect(copyTextOf(one('Run `/plugin install neon@agent-skills`.'))).toBe('claude plugin install neon@agent-skills');
    expect(copyTextOf(one('Type /plugin update neon'))).toBe('claude plugin update neon');
    expect(copyTextOf(one('`/plugin marketplace update agent-skills`'))).toBe('claude plugin marketplace update agent-skills');
    expect(copyTextOf(one('Open `/plugin` and pick Discover.'))).toBe('claude plugin --help');
    expect(copyTextOf(one('/plugin marketplace add https://github.com/neondatabase/agent-skills.git'))).toBe('claude plugin marketplace add https://github.com/neondatabase/agent-skills.git');
  });
  it('Aegis M1: the argument the reply chose is marked, and a command that brings plugin code carries the fixed warning', () => {
    for (const [text, arg] of [['Run `/plugin install neon@agent-skills`.', 'neon@agent-skills'], ['Type /plugin enable neon', 'neon'], ['Run `claude plugin install neon@agent-skills`', 'neon@agent-skills'], ['Run `claude plugin marketplace add a/b`', 'a/b']] as const) {
      const h = one(text);
      expect(h.action).toMatchObject({ kind: 'copy', arg });
      expect(copyTextOf(h)!.endsWith(` ${arg}`)).toBe(true);
      expect(h.warn).toBe(`Plugins run code on your machine: check where ${arg} comes from before you run this.`);
    }
    const off = one('Type /plugin disable neon');
    expect(off.action).toMatchObject({ kind: 'copy', command: 'claude plugin disable neon', arg: 'neon' });
    expect(off.warn).toBeUndefined();
    expect(one('`/plugin marketplace list`').warn).toBeUndefined();
  });
  it('Aegis L1: the said text holds recognised tokens only; zero-width characters go and no bidi control survives', () => {
    const rlo = '\u202E';
    const bad = one('Run `/plugin install neon@x' + rlo + 'evil`');
    expect(bad.said).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/);
    expect(bad.action).toBeNull(); // a bidi control in the argument fails SAFE_ARG: nothing to copy
    const quoted = one('Run `/plugin install neon"x`');
    expect(quoted.said).toBe('/plugin install …');
    expect(quoted.action).toBeNull();
    const cl = one('Run `claude --resume $(curl x)`');
    expect(cl.said).toBe('claude --resume … x'); // $(curl is not a token: …
    expect(one('Run `/mcp\u200B`').said).toBe('/mcp');
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
    expect(el.text).toContain('note · gnomon');
    expect(el.attrs.get('aria-label')).toBe('note from Gnomon');
    expect(el.all().find((x) => x.className === 'host-said')!.text).toBe('/plugin marketplace add neondatabase/agent-skills');
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
  it('Mika Delta 10: ONE slip per reply, one item per hint; the repeated lead is said once; prose is quoted', () => {
    const hints = hostHintsOf('Run `/plugin marketplace add neondatabase/agent-skills`, then `/plugin install neon@agent-skills`, then restart the session.');
    expect(hints).toHaveLength(3);
    const out = renderHostSlips(fdoc, '7', hints);
    expect(out).toHaveLength(1);
    const el = out[0] as unknown as FEl;
    const items = el.all().filter((x) => x.className === 'host-item');
    expect(items.map((x) => x.attrs.get('data-host'))).toEqual(['7:0', '7:1', '7:2']);
    const q = (x: FEl): string | null => x.all().find((y) => y.className === 'slip-q')?.text ?? null;
    expect(q(items[0]!)).toBe("Slash commands don't run in Gnomon. Run this in your terminal:");
    expect(q(items[1]!)).toBeNull(); // the same words as the item above: not repeated
    expect(q(items[2]!)).toMatch(/^Gnomon has no restart/);
    expect(items[2]!.all().find((y) => y.className === 'host-said')!.text).toBe('“restart the session”');
    expect(items[1]!.all().find((y) => y.tag === 'button')!.attrs.get('data-host-copy')).toBe('7:1');
    expect(renderHostSlips(fdoc, '7', [])).toEqual([]);
    const two = renderHostSlips(fdoc, '8', hostHintsOf('Run `/plugin marketplace add a/b`, then check `/mcp`.'))[0] as unknown as FEl;
    expect(two.all().filter((x) => x.className === 'slip-q').map((x) => x.text)).toEqual(["Slash commands don't run in Gnomon. Run this in your terminal:", 'MCP servers are in Settings.']);
  });
  it('Aegis M1: the slip underlines the argument, labels it and shows the warning; the code text is still the command', () => {
    const [h0] = hostHintsOf('Run `/plugin install neon@agent-skills`.');
    const el = renderHostSlips(fdoc, '4', [h0!])[0] as unknown as FEl;
    const code = el.all().find((x) => x.className === 'host-cmd')!;
    expect(code.text).toBe('claude plugin install neon@agent-skills');
    expect(code.all().find((x) => x.className === 'host-arg')!.text).toBe('neon@agent-skills');
    expect(el.all().find((x) => x.className === 'host-note')!.text).toBe('underlined: named in the reply, not by Gnomon');
    expect(el.all().find((x) => x.className === 'host-note host-warn')!.text).toBe(h0!.warn);
    expect(CSS).toMatch(/\.host-said code, \.host-cmd, \.host-warn \{ unicode-bidi: isolate; \}/);
  });
  it('Aegis L2: Copy refuses unless the rendered command text equals the command exactly', () => {
    expect(APP).toMatch(/const shown = \$\('viewport'\)\.querySelector\(`\[data-host-cmd="\$\{CSS\.escape\(ref\)\}"\]`\)\?\.textContent \?\? null;\n  if \(shown !== cmd\) return/);
  });
  it('Mika Delta 10: Copy keeps focus across its remount and is announced', () => {
    expect(APP).toMatch(/if \(had\) \(\$\('viewport'\)\.querySelector\(sel\) as HTMLElement \| null\)\?\.focus\(\{ preventScroll: true \}\);/);
    expect(APP).toMatch(/put\(\$\('toast-say'\), `Copied: \$\{cmd\}`\)/);
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

describe("#gui-host-hints: a loaded skill runs from / (C6'b2-1 host-slip amendment)", () => {
  it('a slash command naming a listed, loaded skill: "Run it from /" with Open / menu, never the no-slash words', () => {
    for (const text of ['Run `/review main` next.', '/review', 'Type /project:review to check it.']) {
      const [h] = hostHintsOf(text, ['review']);
      expect(h, text).toMatchObject({ line: SKILL_HINT_LINE, action: { kind: 'open', id: 'slash.open', label: 'Open / menu' } });
      expect(h!.line).not.toContain(NO_SLASH);
    }
    expect(HOST_OPEN_IDS).toContain('slash.open');
  });
  it('without the skill loaded the old words stay; the table keeps its own commands; prose never counts', () => {
    expect(hostHintsOf('Type /review now', [])[0]!.line).toBe(NO_SLASH);
    expect(hostHintsOf('Run `/mcp`', ['mcp'])[0]!.action).toMatchObject({ kind: 'open', id: 'mcp.open' });
    expect(hostHintsOf('the review step', ['review'])).toEqual([]);
  });
});

describe('#gui-slash-runs: the run row over a fake document', () => {
  it('text nodes only; the data edge and label; the fold key; Decide in the stack only while carded', () => {
    const at = '2026-10-28T12:00:00.000Z';
    const run = `run-${'a'.repeat(24)}`;
    const base = startRun({ key: 'lr-1', hsid: 'h', tool: 'grep', server: 'fs', toolId: 'fs/grep@0123abcd', cls: 'read', policy: 'send', at });
    const long = Array.from({ length: 20 }, (_, i) => `<b>x${i}</b>`).join('\n');
    const ran = runReducer(base, { type: 'reply', v: { status: 'ran', runId: run, content: long, isError: false } });
    const el = renderRunRow(fdoc, runWords(ran), { key: 'lr-1', at, now: Date.parse(at) }) as unknown as FEl;
    expect(el.className).toBe('trow role-run');
    const all = el.all();
    expect(all.some((e) => e.tag === 'b')).toBe(false);
    expect(all.find((e) => e.className.includes('run-data'))!.text).toContain('data');
    expect(all.find((e) => e.className.includes('run-fold'))!.text).toBe('show all 20 lines');
    expect(el.text).toContain('goes with your next message');
    const carded = runReducer(base, { type: 'reply', v: { status: 'carded', runId: run, cardId: 'card:1' } });
    const c = renderRunRow(fdoc, runWords(carded), { key: 'lr-1', at, now: Date.parse(at) }) as unknown as FEl;
    expect(c.all().find((e) => e.attrs.get('data-run-act') === 'decide')!.text).toBe('Decide in the stack');
    expect(el.all().some((e) => e.attrs.get('data-run-act') === 'decide')).toBe(false);
    const running = renderRunRow(fdoc, runWords(base), { key: 'lr-1', at, now: Date.parse(at) + 5000 }) as unknown as FEl;
    expect(running.text).toContain('running… · 5s');
  });
});
