/**
 * Incident triage copy and rules (React-free, so it can be unit-tested in node).
 */

export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'wont-fix';
export type IncidentStatusFilter = 'all' | IncidentStatus;

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  'wont-fix': "Won't Fix",
};

/** Statuses that still need someone to act. Closed ones are drawn quieter in the list. */
export function isActiveStatus(status: IncidentStatus): boolean {
  return status === 'open' || status === 'investigating';
}

/** The server can resolve any incident that is still active, including one under investigation. */
export function canResolve(status: IncidentStatus): boolean {
  return isActiveStatus(status);
}

/** "Matched: <name> (87%)": the pattern hint shown on each card. */
export function patternMatchLabel(patternName: string, confidence: number): string {
  return `Matched: ${patternName} (${Math.round(confidence)}%)`;
}

export interface EmptyCopy {
  title: string;
  hint: string;
  /** True when a filter hides existing incidents, so the UI should offer to clear it. */
  canClearFilter: boolean;
}

export function emptyStateCopy(filter: IncidentStatusFilter, totalIncidents: number): EmptyCopy {
  if (filter !== 'all' && totalIncidents > 0) {
    return {
      title: `No ${STATUS_LABELS[filter].toLowerCase()} incidents.`,
      hint: `${totalIncidents} incident${totalIncidents !== 1 ? 's are' : ' is'} hidden by the status filter.`,
      canClearFilter: true,
    };
  }
  return {
    title: 'No incidents found.',
    hint: 'Incidents are recorded when errors occur in your application.',
    canClearFilter: false,
  };
}

export interface LoadErrorCopy {
  title: string;
  detail: string;
  /** A command that usually fixes it, shown as code. */
  command: string;
}

/**
 * Plain-words explanation for a failed incidents load.
 * `status` is the HTTP status, or null when the request never reached a server.
 */
export function describeLoadError(status: number | null): LoadErrorCopy {
  if (status === null || status === 502 || status === 503 || status === 504) {
    return {
      title: "Can't reach the Paradigm server",
      detail: 'The Sentinel service runs inside it. Start it in this project, then retry:',
      command: 'paradigm serve',
    };
  }
  if (status === 404) {
    return {
      title: 'Sentinel is not available on this server',
      detail: 'The server did not mount Sentinel routes. Check that this project has a .paradigm directory, then restart the server:',
      command: 'paradigm serve',
    };
  }
  return {
    title: 'Failed to load incidents',
    detail: `The server returned an error (HTTP ${status}). Check the output of the server, then retry:`,
    command: 'paradigm serve',
  };
}
