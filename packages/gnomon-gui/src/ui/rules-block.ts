/**
 * @symbol #gui-rules-view
 *
 * #gui-rules-view, the DOM of the Rules block (Settings › Permissions › Rules; the model is core/rules.ts). Painted
 * with core/render.ts `h()` (text nodes only, allowlisted attributes, no inline style). Components (design system
 * .atelier/systems/gnomon/): rule-row and rules-save-bar.
 *
 *   - `[data-rule-act]` (+ data-rule-id, data-rule-value) stages, unstages and opens Turn off ▾ inline;
 *   - `[data-rules-save]` / `[data-rules-discard]` / `[data-rules-decide]` are the save bar's (and the close prompt's)
 *     keys; `[data-rule-filter]` is the filter field (shown above 12 rules).
 * The sheet routes trusted presses only (G-GUI-04).
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import type { RuleKey, RuleRowView, RulesBlockView, RulesResult } from '../core/rules.js';

function keyEl(doc: MiniDoc, k: RuleKey, ruleId: string): MiniEl {
  return h(doc, 'button', { class: `key${k.quiet ? ' quiet' : ''}`, type: 'button', 'data-rule-act': k.act, 'data-rule-id': ruleId, ...(k.value ? { 'data-rule-value': k.value } : {}), ...(k.expanded !== undefined ? { 'aria-expanded': String(k.expanded) } : {}) }, k.label);
}

export function ruleRowEl(doc: MiniDoc, r: RuleRowView): MiniEl {
  const cls = `rule-row${r.staged ? ' is-staged' : ''}${r.removed ? ' is-removed' : ''}${r.off ? ' is-off' : ''}`;
  const li = h(doc, 'li', { class: cls, 'data-rule-id': r.ruleId, title: `${r.where}${r.from ? ` · ${r.from}` : ''} (${r.ruleId})` });
  li.appendChild(h(doc, 'span', { class: `rule-what${r.removed ? ' struck' : ''}` }, r.what));
  // the group heading names the repo: the meta line doesn't repeat it (it stays in the title and the group's label)
  li.appendChild(h(doc, 'span', { class: 'rule-meta' }, `${r.since} · `, h(doc, 'span', { class: 'rule-state' }, r.state)));
  if (r.staged) li.appendChild(h(doc, 'span', { class: 'rule-staged' }, r.staged));
  li.appendChild(h(doc, 'span', { class: 'rule-keys' }, ...r.keys.map((k) => keyEl(doc, k, r.ruleId))));
  // C2: Turn off ▾ opens inline, under the row (like the card's Always ▾), never a popover
  if (r.offOpen) li.appendChild(h(doc, 'span', { class: 'rule-offs', role: 'group', 'aria-label': 'Turn off for how long' }, ...r.presets.map((k) => keyEl(doc, k, r.ruleId))));
  return li;
}

function resultEl(doc: MiniDoc, r: RulesResult): MiniEl {
  const fail = r.kind === 'refused';
  return h(
    doc,
    'p',
    { class: `sf-result rules-result${fail ? ' fail' : ''}`, role: fail ? 'alert' : 'status' },
    h(doc, 'strong', null, r.kind === 'saved' ? 'saved' : r.kind === 'waiting' ? 'card waiting' : 'not saved'),
    ` ${r.text}`,
    r.next ? h(doc, 'span', { class: 'rules-next' }, `next: ${r.next}`) : null,
  );
}

export function rulesBlockEl(doc: MiniDoc, v: RulesBlockView): MiniEl {
  const box = h(doc, 'div', { class: 'settings-row rules-block', 'data-row': 'rules' });
  if (v.summary) box.appendChild(h(doc, 'p', { class: 'meta rules-sum', 'aria-live': 'polite' }, v.summary));
  if (v.closePrompt) {
    // Mika: closing Settings with unsaved changes asks inline
    box.appendChild(h(doc, 'div', { class: 'rules-close-prompt', role: 'group', 'aria-label': 'Unsaved rule changes' }, h(doc, 'span', { class: 'rcp-text' }, v.closePrompt), h(doc, 'button', { class: 'key pri', type: 'button', 'data-rules-save': 'prompt' }, v.closeSave), h(doc, 'button', { class: 'key quiet', type: 'button', 'data-rules-discard': 'prompt' }, 'Discard changes')));
  }
  if (v.filter.shown) {
    const input = h(doc, 'input', { class: 'field w-name', type: 'search', name: 'rule-filter', value: v.filter.value, 'data-rule-filter': '', placeholder: 'words, repo or tool', 'aria-label': 'Filter rules' });
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    box.appendChild(h(doc, 'label', { class: 'rules-filter' }, h(doc, 'span', { class: 'sf-label' }, 'Filter'), input));
  }
  if (v.empty) box.appendChild(h(doc, 'p', { class: 'rules-empty' }, v.empty));
  if (v.noMatch) box.appendChild(h(doc, 'p', { class: 'rules-empty' }, v.noMatch));
  for (const g of v.groups) {
    const head = h(doc, 'p', { class: 'rules-repo', role: 'heading', 'aria-level': '4' }, g.label, ' ', h(doc, 'span', { class: 'rules-count' }, `${g.count} rule${g.count === 1 ? '' : 's'}${g.off ? ` · ${g.off} off` : ''}`));
    const list = h(doc, 'ul', { class: 'rules-list', role: 'list' }, ...g.rows.map((r) => ruleRowEl(doc, r)));
    box.appendChild(h(doc, 'section', { class: 'rules-group', 'aria-label': `${g.label}, ${g.count} rules` }, head, list));
  }
  if (v.saveBar || v.result) {
    const bar = h(doc, 'div', { class: `rules-save-bar${v.saveBar ? ' has-changes' : ''}`, role: 'group', 'aria-label': 'Rule changes' });
    if (v.result) bar.appendChild(resultEl(doc, v.result));
    if (v.result?.kind === 'waiting') bar.appendChild(h(doc, 'button', { class: 'key', type: 'button', 'data-rules-decide': '' }, 'Decide in the stack'));
    if (v.saveBar) {
      bar.appendChild(h(doc, 'span', { class: 'rsb-count' }, v.saveBar.count));
      const save = h(doc, 'button', { class: 'key pri', type: 'button', 'data-rules-save': 'bar', ...(v.saveBar.busy ? { 'aria-busy': 'true' } : {}) }, v.saveBar.busy ? 'Saving…' : v.saveBar.save);
      if (v.saveBar.busy) (save as unknown as { disabled: boolean }).disabled = true;
      bar.appendChild(save);
      bar.appendChild(h(doc, 'button', { class: 'key quiet', type: 'button', 'data-rules-discard': 'bar' }, 'Discard changes'));
    }
    box.appendChild(bar);
  }
  return box;
}
