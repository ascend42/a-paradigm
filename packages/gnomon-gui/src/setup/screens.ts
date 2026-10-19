/**
 * @symbol #gui-setup
 *
 * #gui-setup screens (spec §11.1): (a) welcome, (b) preflight rows with
 * fixes and a purge button per leftover generation, (c) name (validated
 * server-side), (d) the two identity cards with the expected digest BIG and
 * grouped, (e) success, (f) hand-off. Every string reaches the page through
 * textContent (or a text node); never parsed as markup. Buttons only REQUEST
 * steps from the SetupFlow.
 */
import { digestInstruction, groupDigest, IDENTITY_CARDS, purgeCopy, TWO_PROMPTS_NOTICE } from './digest.js';
import type { SetupFlow, SetupState } from './route.js';

/** The DOM surface the screens use (a real Document fits; tests pass a fake). */
export interface SDoc {
  createElement(tag: string): SEl;
}
export interface SEl {
  textContent: string | null;
  className: string;
  value?: string;
  disabled?: boolean;
  appendChild(c: SEl): unknown;
  setAttribute(n: string, v: string): void;
  addEventListener(type: string, fn: (ev: { preventDefault(): void }) => void): void;
  replaceChildren(...c: SEl[]): void;
}

export const WELCOME_TEXT =
  'Gnomon watches over your Claude Code sessions on this Mac. When Claude wants to do something that needs your say-so, Gnomon shows it to you and records your answer, signed by a key that never leaves this Mac\'s Secure Enclave and that only your Touch ID can use. Setup creates those keys and registers this Mac. It takes about a minute, with exactly 2 Touch ID prompts.';

function el(doc: SDoc, tag: string, cls: string, text?: string): SEl {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: SDoc, label: string, busy: boolean, fn: () => void): SEl {
  const b = el(doc, 'button', 'key', label);
  b.setAttribute('type', 'button');
  b.disabled = busy;
  b.addEventListener('click', () => fn());
  return b;
}

const MARK = { pass: 'ok', warn: 'warn', fail: 'FAIL' } as const;

/** Build the current screen's elements (pure over the state; the flow's methods are the only actions). */
export function screenFor(doc: SDoc, s: SetupState, flow: Pick<SetupFlow, 'preflight' | 'purge' | 'toName' | 'submitName' | 'begin' | 'finish'>): SEl[] {
  const out: SEl[] = [el(doc, 'h1', 'title setup-title', 'Set up Gnomon')];
  switch (s.phase) {
    case 'connecting':
      out.push(el(doc, 'p', 'meta', 'connecting to setup…'));
      break;
    case 'welcome':
      out.push(el(doc, 'p', 'setup-text', WELCOME_TEXT), button(doc, 'Check this Mac', s.busy, () => void flow.preflight()));
      break;
    case 'preflight': {
      const list = el(doc, 'ul', 'setup-checks');
      for (const c of s.checks) {
        const li = el(doc, 'li', `setup-check ${c.status}`);
        li.appendChild(el(doc, 'span', 'setup-mark', MARK[c.status]));
        li.appendChild(el(doc, 'span', 'setup-id', c.id));
        li.appendChild(el(doc, 'span', 'setup-detail', c.detail));
        if (c.fix) li.appendChild(el(doc, 'span', 'setup-fix', `fix: ${c.fix}`));
        list.appendChild(li);
      }
      out.push(list);
      if (s.existing) out.push(el(doc, 'p', 'setup-text', `Already set up (root ${s.existing.rootKeyId}, ${s.existing.createdAt}). Nothing to do here: run gnomon in a repo.`));
      for (const gen of s.leftover) {
        out.push(el(doc, 'p', 'notice', purgeCopy(gen)), button(doc, `Delete generation ${gen}`, s.busy, () => void flow.purge(gen)));
        if (s.presence && s.presence.gen === gen) out.push(el(doc, 'p', 'setup-text', `Touch ID: delete the ${s.presence.key ?? ''} key of generation ${gen} (${s.presence.n} of ${s.presence.of})`));
      }
      if (!s.ok) out.push(el(doc, 'p', 'setup-text fail', 'Fix the FAIL rows above, then check again.'), button(doc, 'Check again', s.busy, () => void flow.preflight()));
      else if (!s.leftover.length && !s.existing) out.push(button(doc, 'Continue', s.busy, () => flow.toName()));
      break;
    }
    case 'name': {
      const form = el(doc, 'form', 'setup-name');
      const label = el(doc, 'label', 'setup-text', 'Your name on approvals');
      const input = el(doc, 'input', 'field');
      input.setAttribute('autocomplete', 'off');
      input.value = s.name ?? s.defaultName;
      form.appendChild(label);
      form.appendChild(input);
      if (s.nameError) form.appendChild(el(doc, 'p', 'setup-text fail', s.nameError));
      const go = el(doc, 'button', 'key', 'Continue');
      go.setAttribute('type', 'submit');
      go.disabled = s.busy;
      form.appendChild(go);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void flow.submitName(input.value ?? '');
      });
      out.push(form);
      break;
    }
    case 'identity': {
      out.push(el(doc, 'p', 'notice', TWO_PROMPTS_NOTICE));
      for (const purpose of ['approvals-binding', 'device-row'] as const) {
        const card = el(doc, 'section', `setup-card${s.presence?.purpose === purpose ? ' live' : ''}`);
        card.appendChild(el(doc, 'h2', 'title', IDENTITY_CARDS[purpose].title));
        card.appendChild(el(doc, 'p', 'setup-text', IDENTITY_CARDS[purpose].body));
        const d = s.presence?.purpose === purpose ? s.presence.digest12 : null;
        if (d) {
          card.appendChild(el(doc, 'p', 'setup-digest', groupDigest(d)));
          card.appendChild(el(doc, 'p', 'setup-text', digestInstruction(d)));
        } else card.appendChild(el(doc, 'p', 'meta', 'its code appears here just before the prompt opens'));
        out.push(card);
      }
      if (s.surface === 'browser') out.push(el(doc, 'p', 'setup-text', 'Started from a terminal? It prints the same codes: trust the terminal, and press Cancel if they differ.'));
      if (!s.busy && !s.presence) out.push(button(doc, 'Begin (2 Touch ID prompts)', false, () => void flow.begin()));
      break;
    }
    case 'success': {
      const r = s.result!;
      out.push(el(doc, 'p', 'setup-text', 'Gnomon is set up.'));
      const list = el(doc, 'ul', 'setup-checks');
      for (const [k, v] of [['root key', `${r.rootKeyId} (Secure Enclave)`], ['you', r.principalId], ['this Mac', r.deviceId], ...r.files.map((f) => ['file', f])] as Array<[string, string]>) {
        const li = el(doc, 'li', 'setup-check pass');
        li.appendChild(el(doc, 'span', 'setup-id', k));
        li.appendChild(el(doc, 'span', 'setup-detail', v));
        list.appendChild(li);
      }
      out.push(list, button(doc, 'Start your first session', s.busy, () => void flow.finish()));
      break;
    }
    case 'handoff':
      out.push(el(doc, 'p', 'setup-text', s.surface === 'wrapper' ? 'Starting Gnomon… this window continues into your first session.' : 'Starting Gnomon… your terminal now prints the launch URL (with this folder suggested). Open it to start your first session.'));
      break;
    case 'aborted':
      out.push(el(doc, 'p', 'setup-text fail', `Setup stopped: ${s.error?.message ?? 'unknown'} (${s.error?.reason ?? 'error'})`), el(doc, 'p', 'meta', 'Nothing half-done was kept. Start setup again: open Gnomon.app, or run gnomon in Terminal.'));
      break;
  }
  return out;
}

export function renderSetup(doc: SDoc, root: SEl, s: SetupState, flow: SetupFlow): void {
  root.replaceChildren(...screenFor(doc, s, flow));
}
