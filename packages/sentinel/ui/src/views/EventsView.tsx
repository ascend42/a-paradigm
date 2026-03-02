/**
 * Events View — Schema-adaptive generic event viewer
 *
 * Renders based on the selected schema's event type definitions,
 * scope configuration, visualization hints, and causality declarations.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useEventsStore, type GenericEvent } from '../store/eventsStore';
import { useSchemasStore, type StoredSchema } from '../store/schemasStore';

interface EventContextMenuState {
  x: number;
  y: number;
  event: GenericEvent;
}

const SEVERITY_COLORS: Record<string, string> = {
  debug: '#94a3b8',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
};

const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  logs: '#3b82f6',
  metrics: '#22c55e',
  traces: '#a855f7',
  incidents: '#ef4444',
  rules: '#f59e0b',
  state: '#06b6d4',
  cascade: '#ec4899',
  lifecycle: '#84cc16',
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const date = d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
  return `${date} ${time}`;
}

function getCategoryColor(category: string, schema?: StoredSchema): string {
  const vizColors = schema?.visualization?.categoryColors;
  if (vizColors && vizColors[category]) return vizColors[category];
  return DEFAULT_CATEGORY_COLORS[category] || 'var(--text-muted)';
}

// ─── Schema Selector ───────────────────────────────────────────

function SchemaSelector() {
  const { schemas, selectedSchemaId, selectSchema, fetchSchemas, loading } = useSchemasStore();

  useEffect(() => {
    fetchSchemas();
  }, []);

  if (loading) return <div className="events-loading">Loading schemas...</div>;
  if (schemas.length === 0) {
    return (
      <div className="events-empty-state">
        <p>No event schemas registered.</p>
        <p className="hint">
          Applications register schemas via <code>POST /api/schemas</code> or{' '}
          <code>SentinelWebClient.registerSchema()</code>.
        </p>
      </div>
    );
  }

  return (
    <select
      className="events-schema-select"
      value={selectedSchemaId || ''}
      onChange={(e) => selectSchema(e.target.value || null)}
    >
      {schemas.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} (v{s.version})
        </option>
      ))}
    </select>
  );
}

// ─── Scope Navigator ──────────────────────────────────────────

function ScopeNavigator({ schema }: { schema: StoredSchema }) {
  const { scopes, selectedScope, fetchScopes, fetchScopeEvents, selectScope, fetchEvents } =
    useEventsStore();

  useEffect(() => {
    fetchScopes(schema.id);
  }, [schema.id]);

  const handleScopeClick = (scopeValue: string) => {
    if (selectedScope === scopeValue) {
      selectScope(null);
      fetchEvents(schema.id);
    } else {
      fetchScopeEvents(schema.id, scopeValue);
    }
  };

  if (scopes.length === 0) return null;

  return (
    <div className="events-scope-nav">
      <div className="events-scope-label">{schema.scope.label}s</div>
      <div className="events-scope-list">
        {scopes.slice(0, 50).map((s) => (
          <button
            key={s.scopeValue}
            className={`events-scope-chip ${selectedScope === s.scopeValue ? 'active' : ''}`}
            onClick={() => handleScopeClick(s.scopeValue)}
            title={`${s.eventCount} events`}
          >
            <span className="scope-value">
              {schema.scope.type === 'number' ? `#${s.scopeValue}` : s.scopeValue}
            </span>
            <span className="scope-count">{s.eventCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Category Filters ──────────────────────────────────────────

function CategoryFilters({ schema }: { schema: StoredSchema }) {
  const { events, categoryFilter, setCategoryFilter, excludedTypes, toggleExcludedType } =
    useEventsStore();

  // Extract unique categories from events
  const categories = [...new Set(events.map((e) => e.category))];

  // Find high-freq types that are excluded by default
  const defaultExcluded = schema.visualization?.defaultExcluded || [];

  // Initialize excluded types on first render
  useEffect(() => {
    for (const type of defaultExcluded) {
      if (!excludedTypes.has(type)) {
        toggleExcludedType(type);
      }
    }
  }, [schema.id]);

  return (
    <div className="events-category-filters">
      <button
        className={`events-category-chip ${!categoryFilter ? 'active' : ''}`}
        onClick={() => setCategoryFilter(null)}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          className={`events-category-chip ${categoryFilter === cat ? 'active' : ''}`}
          onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
          style={{
            borderColor: getCategoryColor(cat, schema),
            color: categoryFilter === cat ? '#fff' : getCategoryColor(cat, schema),
            backgroundColor: categoryFilter === cat ? getCategoryColor(cat, schema) : 'transparent',
          }}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}

// ─── Event Row ─────────────────────────────────────────────────

function EventRow({
  event,
  schema,
  isExpanded,
  onToggle,
  onContextMenu,
}: {
  event: GenericEvent;
  schema: StoredSchema;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const catColor = getCategoryColor(event.category, schema);

  return (
    <div className={`event-row event-row--${event.severity || 'info'}`} onClick={onToggle} onContextMenu={onContextMenu}>
      <span className="event-time">{formatTimestamp(event.timestamp)}</span>
      <span className="event-severity" style={{ color: SEVERITY_COLORS[event.severity || 'info'] }}>
        {(event.severity || 'info').toUpperCase().padEnd(5)}
      </span>
      <span className="event-type">
        {event.category && event.category !== 'unknown' && (
          <span className="event-category-badge" style={{ color: catColor }}>[{event.category}]</span>
        )}{' '}
        {event.eventType}
      </span>
      <span className="event-service">{event.service}</span>
      {event.scopeValue && <span className="event-scope">{event.scopeValue}</span>}
      {event.depth != null && event.depth > 0 && (
        <span className="event-depth" style={{ paddingLeft: `${event.depth * 12}px` }}>
          {'  '.repeat(event.depth)}
        </span>
      )}
      {isExpanded && event.data && (
        <div className="event-data" onClick={(e) => e.stopPropagation()}>
          <pre>{JSON.stringify(event.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Event Table ──────────────────────────────────────────────

function EventTable({ schema }: { schema: StoredSchema }) {
  const { events, excludedTypes, excludedServices, categoryFilter, loading, toggleExcludedType, toggleExcludedService, clearAllExclusions } = useEventsStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setExpandAll(false);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filter events
  const filtered = events.filter((e) => {
    if (excludedTypes.has(e.eventType)) return false;
    if (excludedServices.has(e.service)) return false;
    if (categoryFilter && e.category !== categoryFilter) return false;
    return true;
  });

  const hasExclusions = excludedTypes.size > 0 || excludedServices.size > 0;
  const [contextMenu, setContextMenu] = useState<EventContextMenuState | null>(null);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, event: GenericEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, event });
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleExpandAll = () => {
    if (expandAll) {
      setExpandedIds(new Set());
      setExpandAll(false);
    } else {
      setExpandedIds(new Set(filtered.filter((e) => e.data).map((e) => e.id)));
      setExpandAll(true);
    }
  };

  if (loading) return <div className="events-loading">Loading events...</div>;

  if (filtered.length === 0) {
    return (
      <div className="events-empty-state">
        <p>No events to display.</p>
        <p className="hint">Events will appear here when applications send them to Sentinel.</p>
      </div>
    );
  }

  return (
    <div className="events-table" ref={containerRef}>
      <div className="events-table-actions">
        <span className="events-count">{filtered.length} events</span>
        <button
          className={`events-expand-btn ${expandAll ? 'active' : ''}`}
          onClick={handleExpandAll}
          title={expandAll ? 'Collapse all payloads' : 'Expand all payloads'}
        >
          {expandAll ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Exclusion Chips */}
      {hasExclusions && (
        <div className="exclusion-bar">
          {[...excludedTypes].map((t) => (
            <span key={`type-${t}`} className="exclusion-chip">
              type: {t} <button onClick={() => toggleExcludedType(t)}>&times;</button>
            </span>
          ))}
          {[...excludedServices].map((s) => (
            <span key={`svc-${s}`} className="exclusion-chip">
              service: {s} <button onClick={() => toggleExcludedService(s)}>&times;</button>
            </span>
          ))}
          <button className="exclusion-clear" onClick={clearAllExclusions}>Clear all</button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { toggleExcludedType(contextMenu.event.eventType); setContextMenu(null); }}>
            Exclude type "{contextMenu.event.eventType}"
          </button>
          <button onClick={() => { toggleExcludedService(contextMenu.event.service); setContextMenu(null); }}>
            Exclude service "{contextMenu.event.service}"
          </button>
        </div>
      )}

      <div className="events-table-header">
        <span className="event-time">Time</span>
        <span className="event-severity">Level</span>
        <span className="event-type">Type</span>
        <span className="event-service">Service</span>
        <span className="event-scope">Scope</span>
      </div>
      <div className="events-table-body">
        {filtered.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            schema={schema}
            isExpanded={expandAll || expandedIds.has(event.id)}
            onToggle={() => toggleRow(event.id)}
            onContextMenu={(e) => handleRowContextMenu(e, event)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main EventsView ──────────────────────────────────────────

export function EventsView() {
  const { selectedSchemaId } = useSchemasStore();
  const schema = useSchemasStore((s) => s.getSelectedSchema());
  const { fetchEvents, addRealtimeEvent } = useEventsStore();

  // Fetch events when schema changes
  useEffect(() => {
    if (selectedSchemaId) {
      fetchEvents(selectedSchemaId);
    }
  }, [selectedSchemaId]);

  // WebSocket subscription for real-time events
  useEffect(() => {
    if (!selectedSchemaId) return;

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
        if (data.type === 'event' && data.event?.schemaId === selectedSchemaId) {
          addRealtimeEvent(data.event);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, [selectedSchemaId]);

  return (
    <div className="events-view">
      <div className="events-toolbar">
        <SchemaSelector />
        {schema && <CategoryFilters schema={schema} />}
      </div>
      {schema && <ScopeNavigator schema={schema} />}
      {schema ? (
        <EventTable schema={schema} />
      ) : (
        <div className="events-empty-state">
          <p>Select a schema to view events.</p>
        </div>
      )}
    </div>
  );
}
