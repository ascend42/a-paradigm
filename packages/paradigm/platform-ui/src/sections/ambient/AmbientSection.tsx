import React, { useEffect, useRef } from 'react';
import { useAmbientStore, type StreamEvent, type Nomination, type Debate } from './store/ambientStore';
import './styles/ambient.css';

const URGENCY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

function getTypeBadgeClass(type: string): string {
  const known = ['file_change', 'tool_call', 'sentinel', 'agent'];
  return known.includes(type) ? `ambient__type-badge--${type}` : 'ambient__type-badge--default';
}

function getUrgencyBadgeClass(urgency: string): string {
  const known = ['critical', 'high', 'medium', 'low'];
  return known.includes(urgency) ? `ambient__urgency-badge--${urgency}` : 'ambient__urgency-badge--low';
}

function eventsLastHour(events: StreamEvent[]): number {
  const oneHourAgo = Date.now() - 3600_000;
  return events.filter((e) => {
    try { return new Date(e.timestamp).getTime() > oneHourAgo; } catch { return false; }
  }).length;
}

function StatCard({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  return (
    <div
      className="stat-card"
      style={accent ? { borderTopColor: accent, borderTopWidth: 2 } as React.CSSProperties : undefined}
    >
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

function getUniqueEventTypes(events: StreamEvent[]): string[] {
  const types = new Set(events.map((e) => e.type));
  return Array.from(types).sort();
}

function EventItem({ event }: { event: StreamEvent }) {
  return (
    <div className="ambient__event-item">
      <span className={`ambient__type-badge ${getTypeBadgeClass(event.type)}`}>
        {event.type.replace(/_/g, ' ')}
      </span>
      <div className="ambient__event-body">
        <div className="ambient__event-top-row">
          {event.context && <span className="ambient__event-context">{event.context}</span>}
          {!event.context && event.source && (
            <span className="ambient__event-context">{event.source}</span>
          )}
        </div>
        {event.path && <span className="ambient__event-path">{event.path}</span>}
        {event.symbols && event.symbols.length > 0 && (
          <div className="ambient__event-symbols">
            {event.symbols.map((sym) => (
              <span key={sym} className="ambient__event-symbol">{sym}</span>
            ))}
          </div>
        )}
      </div>
      <span className="ambient__event-time">{formatTime(event.timestamp)}</span>
    </div>
  );
}

function NominationItem({
  nomination,
  onEngage,
}: {
  nomination: Nomination;
  onEngage: (id: string, response: 'accepted' | 'dismissed' | 'deferred') => void;
}) {
  const engaged = nomination.engaged;

  return (
    <div className="ambient__nom-item">
      <div className="ambient__nom-header">
        <span className={`ambient__urgency-badge ${getUrgencyBadgeClass(nomination.urgency)}`}>
          {nomination.urgency}
        </span>
        <span className="ambient__nom-agent">{nomination.agent}</span>
        <span className="ambient__nom-type">{nomination.type}</span>
      </div>
      <div className="ambient__nom-brief">{nomination.brief}</div>
      {!engaged && (
        <div className="ambient__nom-actions">
          <button
            className="ambient__nom-btn ambient__nom-btn--accept"
            onClick={() => onEngage(nomination.id, 'accepted')}
          >
            Accept
          </button>
          <button
            className="ambient__nom-btn ambient__nom-btn--dismiss"
            onClick={() => onEngage(nomination.id, 'dismissed')}
          >
            Dismiss
          </button>
        </div>
      )}
      {engaged && (
        <div style={{ fontSize: 11, color: 'var(--p-text-muted)', fontStyle: 'italic' }}>
          {nomination.response === 'accepted' ? 'Accepted' : nomination.response === 'dismissed' ? 'Dismissed' : 'Deferred'}
        </div>
      )}
    </div>
  );
}

function DebateItem({ debate }: { debate: Debate }) {
  return (
    <div className="ambient__debate-item">
      <div className="ambient__debate-topic">{debate.topic}</div>
      <div className="ambient__debate-meta">
        {debate.type} &middot; {debate.nominations.length} nomination{debate.nominations.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export default function AmbientSection() {
  const {
    events,
    nominations,
    debates,
    loading,
    eventFilter,
    fetchEvents,
    fetchNominations,
    engageNomination,
    setEventFilter,
  } = useAmbientStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchEvents();
    fetchNominations();

    intervalRef.current = setInterval(() => {
      fetchEvents();
      fetchNominations();
    }, 10_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const pendingNominations = nominations
    .filter((n) => !n.engaged)
    .sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 99) - (URGENCY_ORDER[b.urgency] ?? 99));

  const eventTypes = getUniqueEventTypes(events);

  if (loading && events.length === 0) {
    return (
      <div className="ambient">
        <h1 className="ambient__title">Ambient</h1>
        <p style={{ color: 'var(--p-text-muted)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="ambient">
      <h1 className="ambient__title">Ambient</h1>

      {/* Stat cards */}
      <div className="ambient__cards">
        <StatCard
          value={eventsLastHour(events)}
          label="Events (last hour)"
          accent="var(--p-accent-blue)"
        />
        <StatCard
          value={pendingNominations.length}
          label="Pending Nominations"
          accent="var(--p-accent-orange)"
        />
        <StatCard
          value={debates.length}
          label="Active Debates"
          accent="var(--p-accent-purple)"
        />
      </div>

      {/* Main two-column grid */}
      <div className="ambient__grid">
        {/* Left column: Event Stream */}
        <div>
          <div className="ambient__section-header">
            <span className="ambient__section-header-title">Event Stream</span>
            <select
              className="ambient__filter-select"
              value={eventFilter.type || ''}
              onChange={(e) => setEventFilter({ ...eventFilter, type: e.target.value || undefined })}
            >
              <option value="">All types</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="ambient__events">
            {events.length === 0 && (
              <div className="ambient__events-empty">No events recorded yet</div>
            )}
            {events.map((event) => (
              <EventItem key={event.id} event={event} />
            ))}
          </div>
        </div>

        {/* Right column: Nominations + Debates */}
        <div>
          <div className="ambient__section-title">Nominations</div>
          <div className="ambient__nominations">
            {pendingNominations.length === 0 && (
              <div className="ambient__nominations-empty">No pending nominations</div>
            )}
            {pendingNominations.map((nom) => (
              <NominationItem
                key={nom.id}
                nomination={nom}
                onEngage={engageNomination}
              />
            ))}
          </div>

          {debates.length > 0 && (
            <div className="ambient__debates">
              <div className="ambient__section-title">Debates</div>
              {debates.map((debate) => (
                <DebateItem key={debate.id} debate={debate} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
