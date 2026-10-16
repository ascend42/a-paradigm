import React, { useEffect } from 'react';
import { useBrainStore, type Verdict } from '../store/brainStore';
import { plainText, suggestionsOffCopy } from '../labels';
import { card, errorText, h2, muted } from './styles';

const VERDICT_WORD: Record<Verdict, string> = { accept: 'Kept', reject: 'Dismissed', skip: 'Later' };

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
}

/** Up to 10 suggested labels, rationale beside each. A = accept, R = reject, S = skip. */
export function SuggestionsPanel() {
  const s = useBrainStore((st) => st.suggestions);
  const error = useBrainStore((st) => st.suggestionsError);
  const cursor = useBrainStore((st) => st.cursor);
  const decided = useBrainStore((st) => st.decided);
  const pending = useBrainStore((st) => st.verdictPending);
  const verdictError = useBrainStore((st) => st.verdictError);
  const decide = useBrainStore((st) => st.decide);
  const setCursor = useBrainStore((st) => st.setCursor);
  const reload = useBrainStore((st) => st.loadSuggestions);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      const k = e.key.toLowerCase();
      if (k === 'a') decide('accept');
      else if (k === 'r') decide('reject');
      else if (k === 's') decide('skip');
      else if (k === 'arrowdown' || k === 'j') setCursor(useBrainStore.getState().cursor + 1);
      else if (k === 'arrowup' || k === 'k') setCursor(useBrainStore.getState().cursor - 1);
      else return;
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [decide, setCursor]);

  const list = s?.suggestions ?? [];
  const remaining = list.filter((x) => !decided[x.id]).length;

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={h2}>Suggestions</h2>
        <span style={muted}>
          <kbd>A</kbd> keep · <kbd>R</kbd> dismiss · <kbd>S</kbd> not now
        </span>
      </div>
      {error && <div style={errorText}>Couldn't load suggestions: {error}</div>}
      {verdictError && <div style={errorText}>Couldn't save that: {verdictError}</div>}
      {!s && !error && <div style={muted}>Looking for patterns…</div>}
      {s && !s.enabled && <div style={muted}>{suggestionsOffCopy(s)}</div>}
      {s && s.enabled && list.length === 0 && <div style={muted}>No suggestions right now — check back after you add notes.</div>}
      {s?.acceptance !== null && s?.acceptance !== undefined && (
        <div style={muted}>You've kept {Math.round(s.acceptance * 100)}% of past suggestions.</div>
      )}
      {list.map((item, i) => {
        const v = decided[item.id];
        const active = i === cursor;
        return (
          <div
            key={item.id}
            onClick={() => setCursor(i)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) auto',
              gap: 12,
              alignItems: 'center',
              padding: '8px 10px',
              borderRadius: 'var(--p-radius)',
              border: `1px solid ${active ? 'var(--p-border-active)' : 'var(--p-border)'}`,
              background: active ? 'var(--p-bg-hover)' : 'var(--p-bg-tertiary)',
              opacity: v ? 0.55 : 1,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--p-text-primary)', fontSize: 14 }}>{plainText(item.label)}</span>
              <span style={{ color: 'var(--p-text-muted)', fontSize: 12 }}>
                {item.scope === 'folder' ? 'Folder' : 'Note'}: {item.target || 'top folder'}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--p-text-secondary)' }}>{plainText(item.rationale)}</span>
            <span style={{ fontSize: 12 }}>
              {v ? (
                <span style={{ color: v === 'accept' ? 'var(--p-accent-green)' : 'var(--p-text-muted)' }}>{VERDICT_WORD[v]}</span>
              ) : active ? (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  {(['accept', 'reject', 'skip'] as Verdict[]).map((vv) => (
                    <button
                      key={vv}
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        decide(vv);
                      }}
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 'var(--p-radius)',
                        border: '1px solid var(--p-border)',
                        background: 'var(--p-bg-secondary)',
                        color: 'var(--p-text-primary)',
                        cursor: pending ? 'wait' : 'pointer',
                      }}
                    >
                      {vv === 'accept' ? 'Keep' : vv === 'reject' ? 'Dismiss' : 'Not now'}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
      {s && list.length > 0 && remaining === 0 && (
        <button
          onClick={() => reload()}
          style={{ alignSelf: 'flex-start', fontSize: 13, background: 'none', border: 'none', color: 'var(--p-accent-blue)', cursor: 'pointer', padding: 0 }}
        >
          All done — show the next batch
        </button>
      )}
    </div>
  );
}
