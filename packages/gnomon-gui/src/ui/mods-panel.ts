/**
 * @symbol #gui-mods-panel
 *
 * #gui-mods-panel, the DOM side (the model is core/mods.ts). The sheet and its header key are created here (no
 * index.html change): the `Mods` key sits before the ⚙ Settings key, the sheet reuses the Settings sheet's overlay
 * and section styles. It opens from that key, from the ⌘K palette ("Mods…", `mods.open`) and from the Workshop
 * footer when the Workshop is not installed.
 *
 *   - Every key press must be a trusted user event (G-GUI-04): a script-made click changes nothing.
 *   - Every key sends ONE request through `requestMod` (log.append{kind:'request.mod.*'}); while it is in flight the
 *     key is busy (aria-busy, disabled), then the row shows what happened in words: the kernel's note on success, the
 *     refusal (code, reason, message, next steps) on failure. Nothing fails silently.
 *   - "Decide" on a pending card scrolls the stack to that card and focuses its default key (never decides).
 *   - Esc closes the sheet and focus returns to where it was.
 */
import { RpcError, type GnomonClient, type ShownRefusal } from '../core/client.js';
import { configRequest, configurable, deskText, folderPathError, installRequest, linkRequest, mcpText, modsViewOf, pauseRequest, resultText, startRequest, stateText, uninstallRequest, type ConfigForm, type InstalledMod, type ModPending, type ModRequest, type ModsView } from '../core/mods.js';
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import type { StackCard } from '../core/store.js';

export interface ModsDeps {
  client: () => GnomonClient | null;
  status: () => unknown;
  cards: () => Iterable<StackCard>;
  refreshStatus: () => Promise<void>;
  focusCard: (cardId: string) => void;
}

export interface ModsPanel {
  open(): void;
  close(): void;
  isOpen(): boolean;
  repaint(): void;
}

/** What one request came to, in words (shown in its row). */
export interface ModResult {
  text: string;
  fail: boolean;
}

function refusalLine(r: ShownRefusal): string {
  return `${r.code}${r.reason ? ` ${r.reason}` : ''}: ${r.message}${r.next.length ? ` · next: ${r.next.join(' · ')}` : ''}`;
}

/** Send one mod request; never throws: the result is always words for the row (or the Workshop footer). */
export async function requestMod(client: GnomonClient | null, req: ModRequest): Promise<ModResult> {
  if (!client) return { text: 'not connected: nothing was sent', fail: true };
  try {
    return { text: resultText(req.kind, await client.call('log.append', req)), fail: false };
  } catch (err) {
    return { text: err instanceof RpcError ? refusalLine(err.refusal) : `the request was not sent (${err instanceof Error ? err.message.slice(0, 120) : 'failed'})`, fail: true };
  }
}

/** The panel's transient state (busy keys, results, the open Configure form, the folder field). */
export interface ModsUi {
  busy: ReadonlySet<string>;
  results: ReadonlyMap<string, ModResult>;
  configOpen: string | null;
  configError: string | null;
  folder: string;
  folderError: string | null;
}

export const emptyUi = (): ModsUi => ({ busy: new Set(), results: new Map(), configOpen: null, configError: null, folder: '', folderError: null });

const key = (doc: MiniDoc, act: string, label: string, attrs: Record<string, string>, ui: ModsUi, busyKey: string): MiniEl => {
  const busy = ui.busy.has(busyKey);
  const b = h(doc, 'button', { class: 'key', type: 'button', 'data-mod-act': act, ...attrs, ...(busy ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {}) }, busy ? `${label}…` : label);
  if (busy) (b as unknown as { disabled: boolean }).disabled = true;
  return b;
};

function resultEl(doc: MiniDoc, r: ModResult | undefined): MiniEl | null {
  return r ? h(doc, 'p', { class: `meta mod-result${r.fail ? ' fail' : ''}`, role: r.fail ? 'alert' : 'status' }, r.text) : null;
}

const PENDING_WORDS: Record<ModPending['what'], string> = { install: 'install card waiting', update: 'update card waiting', uninstall: 'uninstall card waiting', configure: 'launch-change card waiting' };

function pendingEls(doc: MiniDoc, pending: readonly ModPending[]): MiniEl[] {
  return pending.map((p) => h(doc, 'p', { class: 'meta mod-pending' }, h(doc, 'span', { class: 'chip warn flag' }, PENDING_WORDS[p.what]), ' ', h(doc, 'button', { class: 'key quiet', type: 'button', 'data-mod-act': 'decide', 'data-card-id': p.cardId, title: 'Show this card in the decision stack (deciding takes Touch ID there)' }, 'decide in the stack')));
}

function configForm(doc: MiniDoc, m: InstalledMod, ui: ModsUi): MiniEl {
  const c = m.mcp!.configurable;
  const f = h(doc, 'div', { class: 'mod-config', role: 'group', 'aria-label': `Configure ${m.name}`, 'data-config-for': m.name });
  f.appendChild(h(doc, 'p', { class: 'meta' }, `How ${m.mcp!.server} launches today: ${m.mcp!.command}${m.mcp!.args.length ? ` ${m.mcp!.args.join(' ')}` : ''}. Leave a field empty to keep it. The change takes effect only when you allow its card.`));
  if (c.command) f.appendChild(h(doc, 'label', { class: 'meta mod-field' }, 'command (an absolute path)', h(doc, 'input', { class: 'field', type: 'text', name: 'command', placeholder: '/opt/homebrew/bin/…', 'aria-label': 'command', maxlength: '1024' })));
  if (c.args) f.appendChild(h(doc, 'label', { class: 'meta mod-field' }, 'arguments (separate with spaces; quote one that holds a space)', h(doc, 'input', { class: 'field', type: 'text', name: 'args', 'aria-label': 'arguments', maxlength: '4096' })));
  for (const e of c.env.filter((x) => !c.secret.includes(x))) f.appendChild(h(doc, 'label', { class: 'meta mod-field' }, `env ${e}`, h(doc, 'input', { class: 'field', type: 'text', name: `env:${e}`, 'data-env': e, 'aria-label': `env ${e}`, maxlength: '4096' })));
  if (c.secret.length) f.appendChild(h(doc, 'p', { class: 'meta' }, `${c.secret.join(', ')} hold secrets and cannot be set here until Gnomon has a secret store.`));
  if (ui.configError) f.appendChild(h(doc, 'p', { class: 'meta mod-result fail', role: 'alert' }, ui.configError));
  f.appendChild(h(doc, 'div', { class: 'mod-keys' }, key(doc, 'config-send', 'Ask for the change', { 'data-mod-name': m.name }, ui, `config:${m.name}`), h(doc, 'button', { class: 'key quiet', type: 'button', 'data-mod-act': 'config-cancel' }, 'cancel')));
  return f;
}

function installedEl(doc: MiniDoc, m: InstalledMod, ui: ModsUi): MiniEl {
  const row = h(doc, 'div', { class: `mod-row mod-state-${m.state}`, role: 'group', 'aria-label': m.name, 'data-mod': m.name });
  row.appendChild(
    h(
      doc,
      'p',
      { class: 'mod-head' },
      h(doc, 'strong', { class: 'mod-name' }, m.name),
      ` ${m.version ?? '?'} `,
      h(doc, 'span', { class: `chip mod-tier tier-${m.tier}` }, m.tier),
      m.dev ? h(doc, 'span', { class: 'chip warn mod-dev', title: 'dev-linked mod (tier local)' }, 'dev') : null,
      ' ',
      h(doc, 'span', { class: `mod-run state-${m.state}`, role: 'status' }, stateText(m)),
    ),
  );
  if (m.description) row.appendChild(h(doc, 'p', { class: 'meta mod-desc' }, m.description));
  row.appendChild(h(doc, 'p', { class: 'meta mod-facts' }, `publisher ${m.publisher} · ${m.source} · pin `, h(doc, 'code', { title: 'the pinned packageHash (prefix)' }, m.pin)));
  row.appendChild(h(doc, 'p', { class: 'meta mod-mcp' }, `MCP: ${mcpText(m)}`));
  if (m.offers.length) row.appendChild(h(doc, 'p', { class: 'meta mod-offers' }, `offers: ${m.offers.map((o) => (o.title ? `${o.title} (${o.kind})` : o.kind)).join(' · ')}`));
  if (m.offers.length || m.desk.shown || m.desk.suppressed || m.desk.kept) row.appendChild(h(doc, 'p', { class: 'meta mod-desk', title: 'the Desk counts of gnomon desk stats' }, `Desk: ${deskText(m.desk)}`));
  for (const p of pendingEls(doc, m.pending)) row.appendChild(p);
  const keys = h(doc, 'div', { class: 'mod-keys' });
  const n = { 'data-mod-name': m.name };
  if (m.state === 'paused') keys.appendChild(key(doc, 'start', 'Start', n, ui, `start:${m.name}`));
  else if (m.state !== 'error') keys.appendChild(key(doc, 'pause', 'Pause', n, ui, `pause:${m.name}`));
  if (configurable(m) && ui.configOpen !== m.name) keys.appendChild(key(doc, 'configure', 'Configure', n, ui, `configure:${m.name}`));
  if (m.update && !m.pending.some((p) => p.what === 'update')) keys.appendChild(key(doc, 'update', `Update to ${m.update.version}`, { ...n, 'data-path': m.update.path }, ui, `update:${m.name}`));
  if (!m.uninstallRequested && !m.pending.some((p) => p.what === 'uninstall')) keys.appendChild(key(doc, 'uninstall', 'Uninstall', n, ui, `uninstall:${m.name}`));
  row.appendChild(keys);
  if (ui.configOpen === m.name && m.mcp) row.appendChild(configForm(doc, m, ui));
  const r = resultEl(doc, ui.results.get(m.name));
  if (r) row.appendChild(r);
  return row;
}

/** Paint the Mods sheet body (cleared first). Exported for tests over a fake document. */
export function paintMods(doc: MiniDoc, body: { firstChild: unknown; removeChild(c: unknown): unknown; appendChild(c: unknown): unknown }, v: ModsView, ui: ModsUi): void {
  while (body.firstChild) body.removeChild(body.firstChild);
  const sec = (id: string, title: string, note?: string): MiniEl => {
    const s = h(doc, 'section', { class: 'settings-sec mods-sec', 'data-section': id, 'aria-label': title }, h(doc, 'h3', { class: 'title settings-h' }, title));
    if (note) s.appendChild(h(doc, 'p', { class: 'meta' }, note));
    body.appendChild(s);
    return s;
  };
  if (v.unsupported) {
    sec('unsupported', 'Mods', 'This kernel does not list its mods to the GUI yet (it predates the Mods panel). Restart Gnomon on the new build, or use the terminal: gnomon mod list.');
    return;
  }
  if (v.error) sec('error', 'Mods', `The kernel could not read its mods: ${v.error}. The terminal form is gnomon mod list.`).setAttribute('role', 'alert');
  const inst = sec('installed', `Installed (${v.installed.length})`, v.installed.length ? undefined : 'No mod is installed yet. Install one below; the kernel raises its card in the stack and you allow it there with Touch ID.');
  for (const m of v.installed) inst.appendChild(installedEl(doc, m, ui));
  const avail = sec('available', 'Available', v.available.length ? 'First-party mods shipped with this Gnomon. Install raises the install card in the stack.' : v.catalogRoot ? 'Every first-party mod shipped with this Gnomon is installed.' : 'This kernel found no first-party mods beside it (the gnomon-mods folder). Add one from a folder below.');
  for (const a of v.available) {
    const row = h(doc, 'div', { class: 'mod-row', role: 'group', 'aria-label': a.name, 'data-mod': a.name }, h(doc, 'p', { class: 'mod-head' }, h(doc, 'strong', { class: 'mod-name' }, a.name), ` ${a.version} `, h(doc, 'span', { class: `chip mod-tier tier-${a.tier}` }, a.tier)));
    if (a.description) row.appendChild(h(doc, 'p', { class: 'meta mod-desc' }, a.description));
    for (const p of pendingEls(doc, a.pending)) row.appendChild(p);
    if (!a.pending.length) row.appendChild(h(doc, 'div', { class: 'mod-keys' }, key(doc, 'install', 'Install', { 'data-mod-name': a.name, 'data-path': a.path }, ui, `install:${a.name}`)));
    const r = resultEl(doc, ui.results.get(a.name));
    if (r) row.appendChild(r);
    avail.appendChild(row);
  }
  if (v.otherPending.length) {
    const s = sec('pending', 'Waiting on you');
    for (const p of v.otherPending) s.appendChild(h(doc, 'div', { class: 'mod-row', 'data-mod': p.name }, h(doc, 'p', { class: 'mod-head' }, h(doc, 'strong', { class: 'mod-name' }, p.name)), ...pendingEls(doc, [p])));
  }
  const add = sec('add', 'Add from folder', 'A mod you are writing or were given: the folder that holds its gnomon-manifest.json. It installs as a linked folder (tier local); edits re-pin through a card. Installing from a git URL lands later.');
  const field = h(doc, 'div', { class: 'mod-folder' }, h(doc, 'input', { class: 'field', type: 'text', name: 'folder', value: ui.folder, placeholder: '/Users/you/code/my-mod', 'aria-label': 'mod folder (absolute path)', ...(ui.folderError ? { 'aria-invalid': 'true' } : {}), maxlength: '1024' }), key(doc, 'link', 'Add', {}, ui, 'link'));
  add.appendChild(field);
  if (ui.folderError) add.appendChild(h(doc, 'p', { class: 'meta mod-result fail', role: 'alert' }, ui.folderError));
  const r = resultEl(doc, ui.results.get('link'));
  if (r) add.appendChild(r);
  add.appendChild(h(doc, 'p', { class: 'meta settings-how' }, 'The terminal form of every key here: gnomon mod install | link | pause | start | uninstall | config.'));
}

/** Split an arguments field on spaces, keeping "quoted" or 'quoted' runs whole. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

export function mountMods(document: Document, d: ModsDeps): ModsPanel {
  // board header-5b: no header key; the sheet opens from the Gnomon menu, ⌘K → Mods… and the Workshop's Mods key
  const overlay = document.createElement('div');
  overlay.id = 'mods';
  overlay.className = 'overlay';
  overlay.hidden = true;
  const card = document.createElement('div');
  card.className = 'sheet-card settings-card mods-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'mods-title');
  const head = document.createElement('div');
  head.className = 'settings-head';
  const title = document.createElement('h2');
  title.id = 'mods-title';
  title.className = 'title';
  title.textContent = 'Mods';
  const sub = document.createElement('span');
  sub.className = 'meta';
  sub.textContent = 'every change is a card you decide in the stack';
  const closeBtn = document.createElement('button');
  closeBtn.id = 'mods-close';
  closeBtn.className = 'key quiet';
  closeBtn.type = 'button';
  closeBtn.title = 'Close (Esc)';
  closeBtn.textContent = 'close';
  head.append(title, sub, closeBtn);
  const body = document.createElement('div');
  body.id = 'mods-body';
  body.className = 'settings-body mods-body';
  card.append(head, body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const ui = emptyUi() as { busy: Set<string>; results: Map<string, ModResult>; configOpen: string | null; configError: string | null; folder: string; folderError: string | null };
  let back: HTMLElement | null = null;
  const repaint = (): void => {
    if (overlay.hidden) return;
    const active = document.activeElement as HTMLElement | null;
    const keep = active && body.contains(active) ? { name: active.getAttribute('name'), act: active.dataset?.modAct, mod: active.dataset?.modName } : null;
    paintMods(document as unknown as MiniDoc, body, modsViewOf(d.status(), d.cards()), ui);
    // keyboard: a repaint keeps focus on the same control
    if (keep) {
      const sel = keep.name ? `[name="${CSS.escape(keep.name)}"]` : keep.act ? `[data-mod-act="${CSS.escape(keep.act)}"]${keep.mod ? `[data-mod-name="${CSS.escape(keep.mod)}"]` : ''}` : null;
      const el = sel ? (body.querySelector(sel) as HTMLElement | null) : null;
      el?.focus();
    }
  };
  const close = (): void => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    back?.focus();
    back = null;
  };
  const open = (): void => {
    back = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    repaint();
    closeBtn.focus();
    void d.refreshStatus().then(repaint, () => undefined);
  };
  const send = async (busyKey: string, resultKey: string, req: ModRequest): Promise<void> => {
    if (ui.busy.has(busyKey)) return;
    ui.busy.add(busyKey);
    ui.results.delete(resultKey);
    repaint();
    const r = await requestMod(d.client(), req);
    ui.busy.delete(busyKey);
    ui.results.set(resultKey, r);
    if (!r.fail && req.kind === 'request.mod.config') ui.configOpen = null;
    if (!r.fail && req.kind === 'request.mod.link') ui.folder = '';
    await d.refreshStatus().catch(() => undefined);
    repaint();
  };
  body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'folder') {
      ui.folder = t.value;
      ui.folderError = null;
    }
  });
  body.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t.name === 'folder' && e.isTrusted) {
      e.preventDefault();
      (body.querySelector('[data-mod-act="link"]') as HTMLButtonElement | null)?.click();
    }
  });
  body.addEventListener('click', (e) => {
    if (!e.isTrusted) return; // G-GUI-04: only the human's own press
    const b = (e.target as HTMLElement).closest('[data-mod-act]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const act = b.dataset.modAct!;
    const name = b.dataset.modName ?? '';
    if (act === 'decide') {
      close();
      return d.focusCard(b.dataset.cardId!);
    }
    if (act === 'pause') return void send(`pause:${name}`, name, pauseRequest(name));
    if (act === 'start') return void send(`start:${name}`, name, startRequest(name));
    if (act === 'uninstall') return void send(`uninstall:${name}`, name, uninstallRequest(name));
    if (act === 'install' || act === 'update') return void send(`${act}:${name}`, name, installRequest(b.dataset.path!));
    if (act === 'configure') {
      ui.configOpen = name;
      ui.configError = null;
      repaint();
      return void (body.querySelector(`[data-config-for="${CSS.escape(name)}"] input`) as HTMLElement | null)?.focus();
    }
    if (act === 'config-cancel') {
      ui.configOpen = null;
      ui.configError = null;
      return repaint();
    }
    if (act === 'config-send') {
      const m = modsViewOf(d.status(), d.cards()).installed.find((x) => x.name === name);
      const form = body.querySelector(`[data-config-for="${CSS.escape(name)}"]`);
      if (!m?.mcp || !form) return;
      const val = (n: string): string => (form.querySelector(`[name="${CSS.escape(n)}"]`) as HTMLInputElement | null)?.value ?? '';
      const env = [...form.querySelectorAll<HTMLInputElement>('[data-env]')].filter((i) => i.value !== '').map((i) => `${i.dataset.env}=${i.value}`);
      const f: ConfigForm = { command: val('command'), args: splitArgs(val('args')).join('\n'), env: env.join('\n') };
      const r = configRequest(name, m.mcp, f);
      if ('error' in r) {
        ui.configError = r.error;
        return repaint();
      }
      ui.configError = null;
      return void send(`config:${name}`, name, r.request);
    }
    if (act === 'link') {
      const err = folderPathError(ui.folder);
      ui.folderError = err;
      if (err) return repaint();
      return void send('link', 'link', linkRequest(ui.folder));
    }
  });
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // a press on the scrim closes it
  });
  return { open, close, isOpen: () => !overlay.hidden, repaint };
}
