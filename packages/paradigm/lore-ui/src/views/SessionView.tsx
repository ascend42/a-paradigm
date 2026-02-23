import React from 'react';
import { useLoreStore, type Session } from '../store/loreStore';
import { SymbolTag } from '../components/SymbolTag';
import { LoreCard } from '../components/LoreCard';

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function SessionSidebarItem({ session, active, onClick }: { session: Session; active: boolean; onClick: () => void }) {
  const isAgent = session.author.type === 'agent';
  return (
    <div className={`sidebar-item session-sidebar-item ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="session-sidebar-info">
        <span className={`session-author-badge ${session.author.type}`}>
          {isAgent ? '\uD83E\uDD16' : '\uD83D\uDC64'} {session.author.id}
        </span>
        <div className="session-sidebar-meta">
          {formatTime(session.startTime)}
          {session.startTime !== session.endTime && ` - ${formatTime(session.endTime)}`}
        </div>
      </div>
      <div className="session-sidebar-stats">
        <span className="sidebar-item-count">{session.entryCount} entries</span>
        {session.symbolsTouched.length > 0 && (
          <span className="sidebar-item-count">{session.symbolsTouched.length} symbols</span>
        )}
      </div>
    </div>
  );
}

function SessionDetail({ session }: { session: Session }) {
  const duration = formatDuration(session.startTime, session.endTime);
  const dateLabel = new Date(session.date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="session-detail">
      <div className="session-detail-header">
        <h2>
          <span className={`session-author-badge ${session.author.type}`}>
            {session.author.type === 'agent' ? '\uD83E\uDD16' : '\uD83D\uDC64'} {session.author.id}
          </span>
        </h2>
        <div className="session-detail-meta">
          <span>{dateLabel}</span>
          <span>{formatTime(session.startTime)} - {formatTime(session.endTime)}</span>
          <span>{duration}</span>
          <span>{session.entryCount} entries</span>
        </div>
      </div>

      {session.symbolsTouched.length > 0 && (
        <div className="session-detail-section">
          <h3>Symbols Touched</h3>
          <div className="session-symbols">
            {session.symbolsTouched.map(s => (
              <SymbolTag key={s} symbol={s} />
            ))}
          </div>
        </div>
      )}

      {session.breadcrumbs && session.breadcrumbs.length > 0 && (
        <div className="session-detail-section">
          <h3>Session Breadcrumbs</h3>
          <div className="breadcrumb-list">
            {session.breadcrumbs.map((bc, i) => (
              <div key={i} className="breadcrumb-item">
                {bc.phase && <span className="breadcrumb-phase">{bc.phase}</span>}
                {bc.context && <span className="breadcrumb-context">{bc.context}</span>}
                {bc.timestamp && (
                  <span className="breadcrumb-time">{formatTime(bc.timestamp)}</span>
                )}
                {bc.decisions && bc.decisions.length > 0 && (
                  <div className="breadcrumb-decisions">
                    {bc.decisions.map((d, j) => (
                      <span key={j} className="breadcrumb-decision">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="session-detail-section">
        <h3>Lore Entries</h3>
        {session.entries ? (
          session.entries.map(e => (
            <div key={e.id} style={{ marginBottom: 12 }}>
              <LoreCard entry={e} />
            </div>
          ))
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading entries...</div>
        )}
      </div>
    </div>
  );
}

export function SessionView() {
  const sessions = useLoreStore(s => s.sessions);
  const selectedSessionId = useLoreStore(s => s.selectedSessionId);
  const selectSession = useLoreStore(s => s.selectSession);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  // Group sessions by date
  const grouped: Map<string, Session[]> = new Map();
  for (const session of sessions) {
    if (!grouped.has(session.date)) grouped.set(session.date, []);
    grouped.get(session.date)!.push(session);
  }

  return (
    <div className="sidebar-view">
      <div className="sidebar">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Sessions ({sessions.length})
        </div>
        {sessions.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>
            No sessions found
          </div>
        ) : (
          Array.from(grouped.entries()).map(([date, dateSessions]) => {
            const dateLabel = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return (
              <React.Fragment key={date}>
                <div className="session-date-header">{dateLabel}</div>
                {dateSessions.map(session => (
                  <SessionSidebarItem
                    key={session.id}
                    session={session}
                    active={selectedSessionId === session.id}
                    onClick={() => selectSession(selectedSessionId === session.id ? null : session.id)}
                  />
                ))}
              </React.Fragment>
            );
          })
        )}
      </div>
      <div className="sidebar-content">
        {selectedSession ? (
          <SessionDetail session={selectedSession} />
        ) : (
          <div className="empty-state">
            <h2>Select a session</h2>
            <p>Choose a session from the sidebar to view its details, entries, and breadcrumbs.</p>
          </div>
        )}
      </div>
    </div>
  );
}
