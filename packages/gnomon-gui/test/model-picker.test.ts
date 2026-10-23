/**
 * #gui-model-picker: the pure core (core/model-picker.ts) and the page wiring read from the source (ui/model-picker.ts
 * is browser glue; app.ts mounts it with a minimal diff).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { settingsModel } from '../src/core/settings.js';
import { sessionModelLine } from '../src/core/store.js';
import { CUSTOM, MODEL_BY_FOLDER_KEY, MODEL_CHOICES, MODEL_LAST_KEY, MODEL_REQUEST, modelChipText, modelLabel, openModelOf, sessionModelText, pickerProblem, rememberChoice, rememberedChoice, sessionModelOf, switchChoices, switchConfirmText, switchRequest } from '../src/core/model-picker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f: string): string => readFileSync(path.join(ROOT, f), 'utf8');
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('model picker: what session.open sends', () => {
  it('offers default first, the claude aliases, then custom', () => {
    expect(MODEL_CHOICES[0]).toBe('default');
    for (const a of ['opus', 'sonnet', 'haiku', 'fable']) expect(MODEL_CHOICES).toContain(a);
    expect(MODEL_CHOICES.at(-1)).toBe(CUSTOM);
  });
  it.each([
    ['claude', 'opus', '', 'opus'],
    ['claude', 'sonnet', '', 'sonnet'],
    ['claude', 'default', '', 'claude'],
    ['claude', CUSTOM, '  claude-opus-5-5 ', 'claude-opus-5-5'],
    ['any', 'opus', '', 'any'],
    ['local', 'opus', '', 'local'],
  ])('route %s, choice %s ⇒ model %s', (route, choice, custom, want) => {
    expect(openModelOf(route, choice, custom)).toBe(want);
  });
  it.each(['--dangerously-skip-permissions', '-p', 'opus --bare', 'gpt-5', ''])('a custom id %j is refused in the sheet (never sent)', (v) => {
    expect(pickerProblem(CUSTOM, v)).not.toBeNull();
  });
  it('a listed alias passes; an unlisted choice does not', () => {
    expect(pickerProblem('haiku', '')).toBeNull();
    expect(pickerProblem('gpt', '')).not.toBeNull();
  });
});

describe('model picker: memory per folder', () => {
  it('remembers per folder, then the last overall for a new folder', () => {
    const st = mem();
    rememberChoice(st, '/a', 'opus');
    rememberChoice(st, '/b', 'claude-sonnet-4-5');
    expect(rememberedChoice(st, '/a')).toEqual({ choice: 'opus', custom: '' });
    expect(rememberedChoice(st, '/b')).toEqual({ choice: CUSTOM, custom: 'claude-sonnet-4-5' });
    expect(rememberedChoice(st, '/new')).toEqual({ choice: CUSTOM, custom: 'claude-sonnet-4-5' });
    rememberChoice(st, '/a', 'claude'); // the default
    expect(rememberedChoice(st, '/a')).toEqual({ choice: 'default', custom: '' });
  });
  it('a tampered stored value is never restored', () => {
    const st = mem();
    st.setItem(MODEL_BY_FOLDER_KEY, JSON.stringify({ '/a': '--bare' }));
    st.setItem(MODEL_LAST_KEY, '-p');
    expect(rememberedChoice(st, '/a')).toEqual({ choice: 'default', custom: '' });
    st.setItem(MODEL_BY_FOLDER_KEY, 'not json');
    expect(rememberedChoice(st, '/a').choice).toBe('default');
  });
  it('keeps at most 64 folders (oldest dropped)', () => {
    const st = mem();
    for (let i = 0; i < 70; i++) rememberChoice(st, `/f${i}`, 'haiku');
    const m = JSON.parse(st.getItem(MODEL_BY_FOLDER_KEY)!) as Record<string, string>;
    expect(Object.keys(m)).toHaveLength(64);
    expect(m['/f0']).toBeUndefined();
    expect(m['/f69']).toBe('haiku');
  });
});

describe('model picker: the session model and the switch', () => {
  it('reads the model from the kernel rows: session.open, then a switched session.model', () => {
    const rows = [
      { kind: 'session.open', payload: { backend: 'claude-code', model: 'claude' } },
      { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'opus' } },
    ];
    expect(sessionModelOf(rows)).toEqual({ model: 'claude', backend: 'claude-code', pending: 'opus', uncertain: null });
    rows.push({ kind: 'session.model', payload: { outcome: 'switched', from: 'claude', to: 'opus' } } as never);
    expect(sessionModelOf(rows)).toEqual({ model: 'opus', backend: 'claude-code', pending: null, uncertain: null });
    rows.push({ kind: 'session.model', payload: { outcome: 'refused', from: 'opus', to: 'haiku' } } as never);
    expect(sessionModelOf(rows)!.model).toBe('opus');
    expect(sessionModelOf([])).toBeNull();
  });
  it('a timeout is UNCONFIRMED until the kernel reconciles it from the next reply (switching… (unconfirmed))', () => {
    const rows: Array<{ kind: string; payload: unknown }> = [
      { kind: 'session.open', payload: { backend: 'claude-code', model: 'haiku' } },
      { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'sonnet' } },
      { kind: 'session.model', payload: { outcome: 'timeout', from: 'haiku', to: 'sonnet' } },
    ];
    const m = sessionModelOf(rows)!;
    expect(m).toEqual({ model: 'haiku', backend: 'claude-code', pending: null, uncertain: 'sonnet' });
    expect(modelChipText(m)).toBe('model: switching… (unconfirmed)');
    expect(sessionModelText(m)).toMatch(/unconfirmed/);
    rows.push({ kind: 'session.model', payload: { outcome: 'reconciled', from: 'haiku', to: 'sonnet' } });
    expect(sessionModelOf(rows)).toEqual({ model: 'sonnet', backend: 'claude-code', pending: null, uncertain: null });
    expect(modelChipText(sessionModelOf(rows))).toBe('sonnet');
    rows.push({ kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'opus' } }, { kind: 'session.model', payload: { outcome: 'timeout', from: 'sonnet', to: 'opus' } }, { kind: 'session.model', payload: { outcome: 'reconciled', from: 'sonnet', to: 'sonnet' } });
    expect(sessionModelOf(rows)).toMatchObject({ model: 'sonnet', uncertain: null });
    expect(sessionModelText(null)).toBe('no session focused');
  });
  it('after the session ended a timeout is never shown unconfirmed (Aegis L2), whichever row came first; a resume starts afresh', () => {
    const base = [
      { kind: 'session.open', payload: { backend: 'claude-code', model: 'haiku' } },
      { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'sonnet' } },
    ];
    const timeout = { kind: 'session.model', payload: { outcome: 'timeout', from: 'haiku', to: 'sonnet' } };
    const exited = { kind: 'session.exited', payload: { reason: 'session.stop' } };
    for (const rows of [[...base, timeout, exited], [...base, exited, timeout]]) {
      const m = sessionModelOf(rows)!;
      expect(m).toEqual({ model: 'haiku', backend: 'claude-code', pending: null, uncertain: null });
      expect(modelChipText(m)).toBe('haiku');
      expect(sessionModelText(m)).not.toMatch(/unconfirmed/);
    }
    const resumed = [...base, exited, { kind: 'session.open', payload: { backend: 'claude-code', model: 'haiku' } }, { kind: MODEL_REQUEST, payload: { hsid: 'h', model: 'opus' } }, { kind: 'session.model', payload: { outcome: 'timeout', from: 'haiku', to: 'opus' } }];
    expect(sessionModelOf(resumed)).toMatchObject({ uncertain: 'opus' });
  });
  it('the transcript says what each outcome did', () => {
    expect(sessionModelLine({ outcome: 'switched', from: 'claude', to: 'opus' })).toMatch(/default → opus · the conversation continues; the prompt cache restarts/);
    expect(sessionModelLine({ outcome: 'timeout', from: 'haiku', to: 'opus' })).toMatch(/switching… \(unconfirmed\)/);
    expect(sessionModelLine({ outcome: 'reconciled', from: 'haiku', to: 'haiku' })).toMatch(/did not take/);
    expect(sessionModelLine({ outcome: 'backend-refused', from: 'haiku', to: 'x' })).toMatch(/stays haiku/);
  });
  it('the request is log.append{request.session.model, {hsid, model}}', () => {
    expect(switchRequest('h', 'sonnet')).toEqual({ kind: 'request.session.model', payload: { hsid: 'h', model: 'sonnet' } });
  });
  it('the confirm text is truthful: the conversation continues, the cache restarts, nothing says context is lost', () => {
    const t = switchConfirmText('opus', 'sonnet').join(' ');
    expect(t).toMatch(/conversation continues/);
    expect(t).toMatch(/prompt cache restarts/);
    expect(t).not.toMatch(/lost|lose/i);
    expect(modelLabel('claude')).toBe('default');
  });
  it('the menu offers every choice but the current one', () => {
    expect(switchChoices('opus')).not.toContain('opus');
    expect(switchChoices('claude')).not.toContain('default');
  });
});

describe('model picker: Settings session-model slot', () => {
  it('a read-only Session model row carries the slot the picker repaints', () => {
    const rows = settingsModel({ theme: 'auto', motion: 'system', prefersDark: false, prefersReduced: false, layout: { name: 'desk', visible: { sessions: true, stack: true, workshop: true }, workshop: 'footer' } as never, status: null, mode: null, dictationDelayMs: null, sessionModel: 'sonnet · claude-code', connection: null, gui: { name: 'g', version: '1' }, unlock: { state: 'none', at: null, reason: null } }).flatMap((x) => x.rows);
    expect(rows.find((r) => r.id === 'session-model')).toMatchObject({ kind: 'readonly', value: 'sonnet · claude-code', slot: 'session-model' });
  });
});

describe('model picker: page wiring (source)', () => {
  const ui = src('src/ui/model-picker.ts');
  const app = src('src/ui/app.ts');
  it('app.ts mounts the module and sends the picker model on open', () => {
    expect(app).toMatch(/mountModelPicker\(document/);
    expect(app).toMatch(/modelPicker\.openModel\(\$<HTMLSelectElement>\('ns-model'\)\.value\)/);
    expect(app).toMatch(/await openSession\(cwd, model\)/); // #gui-folder-field: the sheet waits for the answer
    expect(app).toMatch(/modelPicker\?\.headChip\(meta, s\.hsid\)/);
  });
  it('the switch is sent only after a trusted click on the go key or a trusted Enter in the field (Aegis L1), never on the submit event\'s own isTrusted', () => {
    const i = ui.indexOf("card.addEventListener('submit'");
    expect(i).toBeGreaterThan(0);
    const submit = ui.slice(i, i + 300);
    expect(submit).toMatch(/const human = armed;\s*armed = false;[\s\S]*if \(!human \|\| !target\) return;/);
    expect(submit).not.toMatch(/e\.isTrusted/);
    // armed only by the go key's click or the id field's Enter, each from its own trusted event
    expect(ui).toMatch(/go\.addEventListener\('click', \(e\) => \{\s*armed = e\.isTrusted;/);
    expect(ui).toMatch(/customSwitch\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key === 'Enter'\) armed = e\.isTrusted;/);
    expect(ui.match(/armed = true/g)).toBeNull();
    // the sheet's open and close disarm it
    expect(ui).toMatch(/const closeSheet = \(\): void => \{[\s\S]{0,80}armed = false;/);
    expect(ui.match(/switchRequest\(/g)).toHaveLength(1);
  });
});
