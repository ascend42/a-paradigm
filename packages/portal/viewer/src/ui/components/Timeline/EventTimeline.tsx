/**
 * Event Timeline - scrolling log of portal events
 */

import { useViewerStore } from '../../store/viewerStore';
import type { ViewerEvent } from '../../../types';

interface EventTimelineProps {
  compact?: boolean;
}

export function EventTimeline({ compact = false }: EventTimelineProps) {
  const { events, filterEntityId, setFilterEntity, selectPortal } = useViewerStore();

  // Filter events by entity if filter is set
  const filteredEvents = filterEntityId
    ? events.filter((e) => e.entityId === filterEntityId)
    : events;

  // Get unique entity IDs for filter dropdown
  const entityIds = [...new Set(events.map((e) => e.entityId))];

  const displayEvents = compact ? filteredEvents.slice(0, 10) : filteredEvents;

  return (
    <div className={`event-timeline ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="timeline-header">
          <h2>Event Timeline</h2>
          {entityIds.length > 1 && (
            <div className="entity-filter">
              <label>Entity:</label>
              <select
                value={filterEntityId || ''}
                onChange={(e) => setFilterEntity(e.target.value || null)}
              >
                <option value="">All Entities</option>
                {entityIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="timeline-events">
        {displayEvents.length === 0 ? (
          <div className="timeline-empty">
            <p>No events yet</p>
            <p className="hint">Portal events will appear here as they occur.</p>
          </div>
        ) : (
          displayEvents.map((event) => (
            <EventItem
              key={event.id}
              event={event}
              compact={compact}
              onPortalClick={() => selectPortal(event.gate || null)}
            />
          ))
        )}
      </div>

      {compact && filteredEvents.length > 10 && (
        <div className="timeline-more">
          +{filteredEvents.length - 10} more events
        </div>
      )}
    </div>
  );
}

interface EventItemProps {
  event: ViewerEvent;
  compact: boolean;
  onPortalClick: () => void;
}

function EventItem({ event, compact, onPortalClick }: EventItemProps) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const icon = getEventIcon(event);
  const statusClass = getEventStatusClass(event);

  return (
    <div className={`event-item ${statusClass}`}>
      <div className="event-icon">{icon}</div>
      <div className="event-content">
        <div className="event-main">
          {event.gate && (
            <button className="event-gate" onClick={onPortalClick}>
              {event.gate}
            </button>
          )}
          {!compact && event.reason && (
            <span className="event-reason">{event.reason}</span>
          )}
        </div>
        {!compact && (
          <div className="event-meta">
            <span className="event-entity">{event.entityId}</span>
            {event.duration !== undefined && (
              <span className="event-duration">{event.duration}ms</span>
            )}
          </div>
        )}
      </div>
      <div className="event-time">{time}</div>
    </div>
  );
}

function getEventIcon(event: ViewerEvent): string {
  switch (event.type) {
    case 'gate:check':
      return '🔍';
    case 'gate:pass':
      return '✅';
    case 'gate:fail':
      return '❌';
    case 'prize:fire':
      return '🎁';
    case 'flow:start':
      return '🏁';
    case 'flow:progress':
      return '➡️';
    case 'flow:complete':
      return '🏆';
    default:
      return '📋';
  }
}

function getEventStatusClass(event: ViewerEvent): string {
  switch (event.decision) {
    case 'allow':
      return 'event-pass';
    case 'deny':
      return 'event-fail';
    case 'pending':
      return 'event-pending';
    default:
      return '';
  }
}
