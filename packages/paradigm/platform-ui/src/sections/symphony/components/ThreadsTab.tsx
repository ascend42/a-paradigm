/**
 * ThreadsTab — Two-panel thread browser with compose box
 *
 * Left: thread list sidebar with status filter
 * Right: conversation view with messages and compose
 */

import { useState, useRef, useEffect } from 'react';
import { useSymphonyStore, type ThreadMessage } from '../store/symphonyStore';

// ── Intent Categorization ─────────────────────────────────

const INTENT_CATEGORY: Record<string, string> = {
  question: 'dialogue',
  context: 'dialogue',
  clarification: 'dialogue',
  verification: 'dialogue',
  reference: 'dialogue',
  proposal: 'action',
  action: 'action',
  decision: 'outcome',
  approval: 'outcome',
  rejection: 'outcome',
  alert: 'system',
  handoff: 'lifecycle',
  fileRequest: 'transfer',
  fileApproved: 'transfer',
  fileDenied: 'transfer',
  fileDelivery: 'transfer',
};

function getIntentCategory(intent: string): string {
  return INTENT_CATEGORY[intent] || 'dialogue';
}

// ── Relative Time ─────────────────────────────────────────

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Thread List Sidebar ───────────────────────────────────

function ThreadListSidebar() {
  const threads = useSymphonyStore(s => s.threads);
  const activeThreadId = useSymphonyStore(s => s.activeThreadId);
  const threadFilter = useSymphonyStore(s => s.threadFilter);
  const setActiveThread = useSymphonyStore(s => s.setActiveThread);
  const setThreadFilter = useSymphonyStore(s => s.setThreadFilter);

  const filters: Array<{ id: 'active' | 'resolved' | 'all'; label: string }> = [
    { id: 'active', label: 'Active' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'all', label: 'All' },
  ];

  return (
    <div className="thread-list-sidebar">
      <div className="thread-list-toolbar">
        {filters.map(f => (
          <button
            key={f.id}
            className={`thread-filter-btn ${threadFilter === f.id ? 'active' : ''}`}
            onClick={() => setThreadFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="thread-list-items">
        {threads.length === 0 ? (
          <div className="thread-list-empty">
            No threads yet.
            <br />
            <br />
            Agents create threads via <code>paradigm_symphony_send</code>
          </div>
        ) : (
          threads.map(t => (
            <div
              key={t.id}
              className={`thread-card ${activeThreadId === t.id ? 'selected' : ''}`}
              onClick={() => setActiveThread(t.id)}
            >
              <div className="thread-card-topic">{t.topic}</div>
              <div className="thread-card-meta">
                <div className="thread-card-participants">
                  {t.participants.slice(0, 4).map(p => (
                    <span
                      key={p.id}
                      className={`participant-avatar ${p.type === 'human' ? 'human' : ''}`}
                      title={p.name}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  ))}
                  {t.participants.length > 4 && (
                    <span className="participant-avatar" style={{ background: 'var(--p-text-muted)' }}>
                      +{t.participants.length - 4}
                    </span>
                  )}
                </div>
                <div className="thread-card-stats">
                  <span className="thread-card-count">{t.messageCount}</span>
                  <span className={`thread-card-status ${t.status}`}>{t.status}</span>
                  <span>{relativeTime(t.lastActivity)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────

function MessageBubble({ msg }: { msg: ThreadMessage }) {
  const [diffOpen, setDiffOpen] = useState(false);
  const category = getIntentCategory(msg.intent);

  return (
    <div className="message-bubble">
      <div className="message-bubble-header">
        <span className="message-sender">{msg.sender.name}</span>
        <span className={`message-sender-type ${msg.sender.type}`}>{msg.sender.type}</span>
        <span className={`intent-pill ${category}`}>{msg.intent}</span>
      </div>
      <div className="message-text">{msg.text}</div>
      {msg.symbols.length > 0 && (
        <div className="message-symbols">
          {msg.symbols.map(s => (
            <span key={s} className="message-symbol-tag">{s}</span>
          ))}
        </div>
      )}
      {msg.diff && (
        <div className="message-diff">
          <button className="message-diff-toggle" onClick={() => setDiffOpen(!diffOpen)}>
            {diffOpen ? 'Hide diff' : 'Show diff'}
          </button>
          {diffOpen && <pre className="message-diff-content">{msg.diff}</pre>}
        </div>
      )}
      {msg.decision && (
        <div className="message-decision">
          <div className="message-decision-label">Decision</div>
          {msg.decision}
        </div>
      )}
      <div className="message-time">{formatTime(msg.timestamp)}</div>
    </div>
  );
}

// ── Compose Box ───────────────────────────────────────────

const INTENTS = [
  'question', 'context', 'proposal', 'decision', 'action',
  'alert', 'approval', 'rejection', 'reference', 'clarification', 'verification',
];

function ComposeBox({ threadId }: { threadId: string | null }) {
  const [intent, setIntent] = useState('question');
  const [text, setText] = useState('');
  const sendMessage = useSymphonyStore(s => s.sendMessage);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;

    await sendMessage({
      intent,
      text: trimmed,
      threadRoot: threadId || undefined,
    });
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="compose-box">
      <div className="compose-row">
        <select
          className="compose-intent-select"
          value={intent}
          onChange={e => setIntent(e.target.value)}
        >
          {INTENTS.map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <textarea
          className="compose-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={1}
        />
        <button
          className="compose-send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Conversation View ─────────────────────────────────────

function ConversationView() {
  const activeThread = useSymphonyStore(s => s.activeThread);
  const activeThreadId = useSymphonyStore(s => s.activeThreadId);
  const resolveThread = useSymphonyStore(s => s.resolveThread);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages.length]);

  if (!activeThread) {
    return (
      <div className="conversation">
        <div className="conversation-empty">Select a thread to view</div>
      </div>
    );
  }

  const { thread, messages } = activeThread;

  return (
    <div className="conversation">
      <div className="conversation-header">
        <div className="conversation-header-left">
          <div className="conversation-topic">{thread.topic}</div>
          <div className="conversation-participants">
            {thread.participants.map(p => p.name).join(', ')}
          </div>
        </div>
        <div className="conversation-actions">
          <span className={`thread-card-status ${thread.status}`}>{thread.status}</span>
          {thread.status === 'active' && (
            <button
              className="resolve-btn"
              onClick={() => resolveThread(activeThreadId!)}
            >
              Resolve
            </button>
          )}
        </div>
      </div>
      <div className="conversation-messages">
        {messages.map(m => (
          <MessageBubble key={m.id} msg={m} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <ComposeBox threadId={activeThreadId} />
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────

export function ThreadsTab() {
  return (
    <div className="threads-layout">
      <ThreadListSidebar />
      <ConversationView />
    </div>
  );
}
