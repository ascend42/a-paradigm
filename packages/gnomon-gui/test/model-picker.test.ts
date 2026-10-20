/**
 * #gui-model-picker: the pure core (core/model-picker.ts) and the page wiring read from the source (ui/model-picker.ts
 * is browser glue; app.ts mounts it with a minimal diff).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CUSTOM, MODEL_BY_FOLDER_KEY, MODEL_CHOICES, MODEL_LAST_KEY, MODEL_REQUEST, modelLabel, openModelOf, pickerProblem, rememberChoice, rememberedChoice, sessionModelOf, switchChoices, switchConfirmText, switchRequest } from '../src/core/model-picker.js';

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
    expect(sessionModelOf(rows)).toEqual({ model: 'claude', backend: 'claude-code', pending: 'opus' });
    rows.push({ kind: 'session.model', payload: { outcome: 'switched', from: 'claude', to: 'opus' } } as never);
    expect(sessionModelOf(rows)).toEqual({ model: 'opus', backend: 'claude-code', pending: null });
    rows.push({ kind: 'session.model', payload: { outcome: 'refused', from: 'opus', to: 'haiku' } } as never);
    expect(sessionModelOf(rows)!.model).toBe('opus');
    expect(sessionModelOf([])).toBeNull();
  });
  it('the request is log.append{request.session.model, {hsid, model}}', () => {
    expect(switchRequest('h', 'sonnet')).toEqual({ kind: 'request.session.model', payload: { hsid: 'h', model: 'sonnet' } });
  });
  it('the confirm text is truthful: the conversation continues, the cache restarts, nothing says context is lost', () => {
    const t = switchConfirmText('opus', 'sonnet').join(' ');
    expect(t).toMatch(/conversation continues/);
    expect(t).toMatch(/cache starts over/);
    expect(t).not.toMatch(/lost|lose/i);
    expect(modelLabel('claude')).toBe('default');
  });
  it('the menu offers every choice but the current one', () => {
    expect(switchChoices('opus')).not.toContain('opus');
    expect(switchChoices('claude')).not.toContain('default');
  });
});

describe('model picker: page wiring (source)', () => {
  const ui = src('src/ui/model-picker.ts');
  const app = src('src/ui/app.ts');
  it('app.ts mounts the module and sends the picker model on open', () => {
    expect(app).toMatch(/mountModelPicker\(document/);
    expect(app).toMatch(/modelPicker\.openModel\(\$<HTMLSelectElement>\('ns-model'\)\.value\)/);
    expect(app).toMatch(/void openSession\(cwd, model\)/);
    expect(app).toMatch(/modelPicker\?\.headChip\(meta, s\.hsid\)/);
  });
  it('the switch is sent only from the trusted submit of the confirm sheet', () => {
    const i = ui.indexOf("card.addEventListener('submit'");
    expect(i).toBeGreaterThan(0);
    expect(ui.slice(i, i + 200)).toMatch(/!e\.isTrusted/);
    expect(ui.match(/switchRequest\(/g)).toHaveLength(1);
  });
});
