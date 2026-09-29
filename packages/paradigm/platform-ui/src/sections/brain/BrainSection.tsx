import React, { useEffect } from 'react';
import { useBrainStore } from './store/brainStore';
import { PrivacyBadge } from './components/PrivacyBadge';
import { BrainMapPanel } from './components/BrainMapPanel';
import { LockedPanel } from './components/LockedPanel';
import { HealthPanel } from './components/HealthPanel';
import { SuggestionsPanel } from './components/SuggestionsPanel';
import { FindPanel } from './components/FindPanel';
import { whenText } from './labels';
import { errorText, muted } from './components/styles';

/**
 * Brain — your notes folder, organised locally (7.14.0). Everything here comes
 * through the server's owner view: private files are browsable, sensitive
 * areas appear only as a lock and a count. Plain words only — this section is
 * for people who have never seen a config file.
 */
export default function BrainSection() {
  const overview = useBrainStore((s) => s.overview);
  const loading = useBrainStore((s) => s.loading);
  const error = useBrainStore((s) => s.error);
  const health = useBrainStore((s) => s.health);
  const healthError = useBrainStore((s) => s.healthError);
  const load = useBrainStore((s) => s.load);
  const selectBrain = useBrainStore((s) => s.selectBrain);

  useEffect(() => {
    load();
  }, []);

  // Live refresh: the central WS hub (useAgentEffects) forwards brain:* server
  // broadcasts as a `brain-ws` CustomEvent. Debounced so a burst of verdicts
  // triggers one refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onBrainWs(e: Event) {
      const msg = (e as CustomEvent).detail;
      if (!msg || msg.type !== 'brain:changed') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void useBrainStore.getState().refresh(typeof msg.brain === 'string' ? msg.brain : undefined);
      }, 250);
    }
    window.addEventListener('brain-ws', onBrainWs);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('brain-ws', onBrainWs);
    };
  }, []);

  const current = overview?.brains.find((b) => b.id === overview.selected) ?? null;
  const empty = overview && overview.brains.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--p-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--p-text-primary)' }}>Brain</span>
          <span style={{ fontSize: 13, color: 'var(--p-text-muted)' }}>
            {current ? (
              <>
                {current.name} &middot; last looked {whenText(overview?.scannedAt)}
              </>
            ) : (
              'your notes, organised on this Mac'
            )}
          </span>
          {overview && overview.brains.length > 1 && (
            <select
              value={overview.selected ?? ''}
              onChange={(e) => selectBrain(e.target.value)}
              style={{ fontSize: 13, background: 'var(--p-bg-tertiary)', color: 'var(--p-text-primary)', border: '1px solid var(--p-border)', borderRadius: 'var(--p-radius)' }}
            >
              {overview.brains.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {overview?.badge && <PrivacyBadge badge={overview.badge} egress={overview.egress ?? []} />}
      </div>

      {overview?.banner && (
        <div
          role="alert"
          style={{
            margin: '12px 24px 0',
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--p-accent-amber)',
            border: '1px solid var(--p-accent-amber)',
            borderRadius: 'var(--p-radius)',
          }}
        >
          {overview.banner}
        </div>
      )}

      {error && <div style={{ ...errorText, padding: 24 }}>Couldn't load your notes: {error}</div>}
      {loading && !overview && <div style={{ ...muted, padding: 24 }}>Loading…</div>}

      {empty && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: 'var(--p-text-muted)' }}>
          <span style={{ fontSize: 40 }} aria-hidden>
            ◍
          </span>
          <h2 style={{ margin: 0, color: 'var(--p-text-primary)', fontSize: 20 }}>No notes folder yet</h2>
          <p style={{ margin: 0, maxWidth: 440, textAlign: 'center', lineHeight: 1.5, fontSize: 14 }}>
            Run <code>paradigm brain init &lt;folder&gt;</code> to get started. Everything stays on this Mac.
          </p>
        </div>
      )}

      {overview && overview.selected && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(0, 1.6fr)',
            gap: 24,
            padding: 24,
            overflow: 'auto',
            flex: 1,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {overview.map && <BrainMapPanel map={overview.map} visible={overview.visible ?? 0} />}
            <LockedPanel locked={overview.locked ?? []} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FindPanel />
            <SuggestionsPanel />
            <HealthPanel health={health} error={healthError} />
          </div>
        </div>
      )}
    </div>
  );
}
