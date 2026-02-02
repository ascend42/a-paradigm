/**
 * Paradigm Sentinel - Timeline Builder
 *
 * Builds and renders flow timelines for incidents with flow context.
 */

import type {
  SymbolicIncidentRecord,
  FlowTimeline,
  FlowEvent,
} from './types.js';

export class TimelineBuilder {
  /**
   * Build a timeline from an incident with flow position
   */
  build(incident: SymbolicIncidentRecord): FlowTimeline | null {
    if (!incident.flowPosition) {
      return null;
    }

    const events: FlowEvent[] = [];
    const baseTime = new Date(incident.timestamp).getTime();

    // Flow start event
    events.push({
      timestamp: new Date(baseTime - 5000).toISOString(),
      symbol: incident.flowPosition.flowId,
      type: 'flow-started',
    });

    // Add actual events that fired
    let eventOffset = 1000;
    for (const signal of incident.flowPosition.actual) {
      const type = this.inferEventType(signal);
      events.push({
        timestamp: new Date(baseTime - 4000 + eventOffset).toISOString(),
        symbol: signal,
        type,
      });
      eventOffset += Math.random() * 1000 + 500;
    }

    // Add failure event
    const failedSymbol =
      incident.flowPosition.failedAt ||
      incident.flowPosition.missing[0] ||
      incident.symbols.gate ||
      incident.symbols.signal ||
      'unknown';

    events.push({
      timestamp: incident.timestamp,
      symbol: failedSymbol,
      type: 'error',
      data: {
        message: incident.error.message,
        missing: incident.flowPosition.missing,
      },
    });

    return {
      incidentId: incident.id,
      flowId: incident.flowPosition.flowId,
      events,
      failure: {
        at: incident.timestamp,
        symbol: failedSymbol,
        reason: incident.error.message,
      },
    };
  }

  /**
   * Render timeline as ASCII art
   */
  renderAscii(timeline: FlowTimeline): string {
    const lines: string[] = [];

    // Header
    lines.push(`${timeline.flowId} Timeline`);
    lines.push('═'.repeat(40));
    lines.push('');

    // Events
    for (const event of timeline.events) {
      const time = this.formatTime(event.timestamp);
      const icon = this.getEventIcon(event.type);
      const status = this.getEventStatus(event.type);

      let line = `${time}  ${icon} ${event.symbol}`;
      if (status) {
        line += ` (${status})`;
      }

      lines.push(line);

      // Add details for error events
      if (event.type === 'error' && event.data) {
        lines.push(`             └─ ${event.data.message}`);
        if (
          event.data.missing &&
          Array.isArray(event.data.missing) &&
          event.data.missing.length > 0
        ) {
          lines.push(
            `             └─ Expected: ${event.data.missing.join(', ')}`
          );
        }
      }
    }

    // Missing signals summary
    const missing = timeline.events.find((e) => e.type === 'error')?.data
      ?.missing as string[] | undefined;
    if (missing && missing.length > 0) {
      lines.push('');
      lines.push(`Missing signals: ${missing.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Render timeline as structured data (for MCP/JSON output)
   */
  renderStructured(timeline: FlowTimeline): object {
    return {
      incidentId: timeline.incidentId,
      flow: {
        id: timeline.flowId,
        eventCount: timeline.events.length,
      },
      events: timeline.events.map((event) => ({
        time: this.formatTime(event.timestamp),
        symbol: event.symbol,
        type: event.type,
        status: this.getEventStatus(event.type),
        data: event.data,
      })),
      failure: {
        at: this.formatTime(timeline.failure.at),
        symbol: timeline.failure.symbol,
        reason: timeline.failure.reason,
      },
    };
  }

  /**
   * Infer event type from symbol prefix
   */
  private inferEventType(symbol: string): FlowEvent['type'] {
    if (symbol.startsWith('^')) {
      return 'gate-passed';
    }
    if (symbol.startsWith('!')) {
      return 'signal-emitted';
    }
    if (symbol.startsWith('%')) {
      return 'state-changed';
    }
    return 'signal-emitted';
  }

  /**
   * Get icon for event type
   */
  private getEventIcon(type: FlowEvent['type']): string {
    switch (type) {
      case 'flow-started':
        return '▶';
      case 'flow-ended':
        return '■';
      case 'gate-passed':
        return '✓';
      case 'gate-failed':
        return '✗';
      case 'signal-emitted':
        return '⚡';
      case 'state-changed':
        return '◆';
      case 'error':
        return '✗';
      default:
        return '•';
    }
  }

  /**
   * Get status text for event type
   */
  private getEventStatus(type: FlowEvent['type']): string {
    switch (type) {
      case 'gate-passed':
        return 'PASSED';
      case 'gate-failed':
        return 'FAILED';
      case 'signal-emitted':
        return 'EMITTED';
      case 'state-changed':
        return 'CHANGED';
      case 'error':
        return 'ERROR';
      default:
        return '';
    }
  }

  /**
   * Format timestamp for display
   */
  private formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const millis = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
  }
}
