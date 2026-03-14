/**
 * ConversationView — #ConversationView
 *
 * Interactive tree view of Symphony agent conversations.
 * ThreadList sidebar + ConversationPanel with NoteBubbles.
 * Real-time WebSocket updates with intent badges.
 */

import { useEffect, useRef } from 'react';
import { useConversationStore } from '../store/conversationStore';
import type { GenericEvent } from '../store/eventsStore';

// ── Category Colors ──────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  dialogue: '#7dd3fc',
  action: '#86efac',
  outcome: '#fbbf24',
  system: '#f87171',
  lifecycle: '#a78bfa',
  transfer: '#34d399',
};

// ── Intent Badges ────────────────────────────────────────

function IntentBadge({ eventType }: { eventType: string }) {
  const parts = eventType.split(':');
  const label = parts[1]?.toUpperCase() || eventType.toUpperCase();
  const category = getCategoryForType(eventType);
  const color = CATEGORY_COLORS[category] || '#94a3b8';

  return (
    <span
      className="conv-intent-badge"
      style={{ backgroundColor: color, color: '#0f172a' }}
    >
      {label}
    </span>
  );
}

function getCategoryForType(eventType: string): string {
  if (['note:question', 'note:context', 'note:clarification', 'note:verification', 'note:reference'].includes(eventType)) return 'dialogue';
  if (['note:proposal', 'note:action'].includes(eventType)) return 'action';
  if (['note:decision', 'note:approval', 'note:rejection'].includes(eventType)) return 'outcome';
  if (eventType === 'note:alert') return 'system';
  if (eventType.startsWith('thread:') || eventType.startsWith('participant:') || eventType === 'note:handoff') return 'lifecycle';
  if (eventType.startsWith('file:')) return 'transfer';
  return 'dialogue';
}

// ── Participant Badge ────────────────────────────────────

function ParticipantBadge({ sender, role }: { sender: string; role: string }) {
  const isHuman = role === 'human';
  return (
    <span className={`conv-participant ${isHuman ? 'conv-participant-human' : 'conv-participant-agent'}`}>
      <span className="conv-participant-icon">{isHuman ? '\u{1F464}' : '\u{1F916}'}</span>
      <span className="conv-participant-name">{sender}</span>
      {role && role !== 'human' && <span className="conv-participant-role">{role}</span>}
    </span>
  );
}

// ── Note Bubble ──────────────────────────────────────────

function NoteBubble({ event }: { event: GenericEvent }) {
  const sender = (event.data?.sender as string) || event.service || 'unknown';
  const senderRole = (event.data?.senderRole as string) || 'agent';
  const text = (event.data?.text as string) || '';
  const diff = event.data?.diff as string | undefined;
  const decision = event.data?.decision as string | undefined;
  const symbols = event.data?.symbols as string[] | undefined;
  const category = getCategoryForType(event.eventType);
  const borderColor = CATEGORY_COLORS[category] || '#334155';
  const time = new Date(event.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // File transfer events
  const isFileEvent = event.eventType.startsWith('file:');
  const filePath = event.data?.filePath as string | undefined;

  // Lifecycle events (thread/participant)
  const isLifecycle = event.eventType.startsWith('thread:') || event.eventType.startsWith('participant:');

  if (isLifecycle) {
    return (
      <div className="conv-note conv-note-lifecycle">
        <span className="conv-note-lifecycle-line" style={{ borderColor }}>
          <IntentBadge eventType={event.eventType} />
          <span className="conv-note-lifecycle-text">{text || (event.data?.topic as string) || event.eventType}</span>
          <span className="conv-note-time">{time}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="conv-note" style={{ borderLeftColor: borderColor }}>
      <div className="conv-note-header">
        <ParticipantBadge sender={sender} role={senderRole} />
        <IntentBadge eventType={event.eventType} />
        <span className="conv-note-time">{time}</span>
      </div>

      <div className="conv-note-text">{text}</div>

      {decision && (
        <div className="conv-note-decision">
          <strong>Decision:</strong> {decision}
        </div>
      )}

      {isFileEvent && filePath && (
        <div className="conv-note-file">
          <code>{filePath}</code>
          {event.data?.size != null && <span className="conv-note-file-size">{String(event.data.size)} bytes</span>}
        </div>
      )}

      {diff && (
        <details className="conv-note-diff">
          <summary>Diff</summary>
          <pre>{diff}</pre>
        </details>
      )}

      {symbols && symbols.length > 0 && (
        <div className="conv-note-symbols">
          {symbols.map((sym, i) => (
            <span key={i} className="conv-symbol-chip">{sym}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Thread Card ──────────────────────────────────────────

function ThreadCard({ thread, isSelected, onSelect }: {
  thread: { id: string; topic: string; status: string; noteCount: number; lastActivity: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  const time = new Date(thread.lastActivity).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <button
      className={`conv-thread-card ${isSelected ? 'conv-thread-card-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="conv-thread-card-header">
        <span className={`conv-thread-status-dot ${thread.status === 'active' ? 'conv-status-active' : 'conv-status-resolved'}`} />
        <span className="conv-thread-topic">{thread.topic}</span>
      </div>
      <div className="conv-thread-card-meta">
        <span>{thread.noteCount} notes</span>
        <span>{time}</span>
      </div>
    </button>
  );
}

// ── Decision Summary ─────────────────────────────────────

function DecisionSummary({ decisions }: { decisions: string[] }) {
  if (decisions.length === 0) return null;

  return (
    <details className="conv-decision-summary">
      <summary>Decisions ({decisions.length})</summary>
      <ul>
        {decisions.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </details>
  );
}

// ── Main View ────────────────────────────────────────────

export function ConversationView() {
  const {
    threads, selectedThreadId, threadFilter, notes, decisions,
    loading, isLive,
    fetchThreads, selectThread, setThreadFilter, setLive, addRealtimeNote,
  } = useConversationStore();

  const notesEndRef = useRef<HTMLDivElement>(null);

  // Fetch threads on mount
  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // WebSocket for real-time updates
  useEffect(() => {
    if (!isLive) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'event' && data.event?.schemaId === 'paradigm-symphony') {
          addRealtimeNote(data.event);
        }
      } catch {
        // Ignore malformed
      }
    };

    return () => {
      ws.close();
    };
  }, [isLive, addRealtimeNote]);

  // Auto-scroll to bottom when new notes arrive
  useEffect(() => {
    notesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes.length]);

  // Filter threads
  const filteredThreads = threads.filter((t) => {
    if (threadFilter === 'all') return true;
    return t.status === threadFilter;
  });

  return (
    <div className="conv-view">
      {/* Toolbar */}
      <div className="conv-toolbar">
        <div className="conv-filter-chips">
          {(['all', 'active', 'resolved'] as const).map((f) => (
            <button
              key={f}
              className={`conv-filter-chip ${threadFilter === f ? 'conv-filter-active' : ''}`}
              onClick={() => setThreadFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <label className="conv-live-toggle">
          <input type="checkbox" checked={isLive} onChange={(e) => setLive(e.target.checked)} />
          Live
        </label>
      </div>

      {/* Content */}
      <div className="conv-content">
        {/* Thread List Sidebar */}
        <div className="conv-thread-list">
          {filteredThreads.length === 0 ? (
            <div className="conv-empty">No threads</div>
          ) : (
            filteredThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                isSelected={thread.id === selectedThreadId}
                onSelect={() => selectThread(thread.id)}
              />
            ))
          )}
        </div>

        {/* Conversation Panel */}
        <div className="conv-panel">
          {!selectedThreadId ? (
            <div className="conv-empty-panel">
              <p>Select a thread to view the conversation</p>
            </div>
          ) : loading ? (
            <div className="conv-loading">Loading...</div>
          ) : (
            <>
              {/* Thread Header */}
              <div className="conv-thread-header">
                <h3>{selectedThreadId}</h3>
                <span className="conv-note-count">{notes.length} notes</span>
              </div>

              {/* Notes */}
              <div className="conv-notes-scroll">
                {notes.map((note) => (
                  <NoteBubble key={note.id} event={note} />
                ))}
                <div ref={notesEndRef} />
              </div>

              {/* Decision Summary */}
              <DecisionSummary decisions={decisions} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
