/**
 * Agent Presence Manager + User State Tracker
 *
 * Tracks connected agents and accumulates user activity
 * for the `paradigm_platform_observe` MCP tool.
 */

export interface AgentPresence {
  agentId: string;
  color: string;
  connectedAt: string;
  lastActivity: string;
}

export interface UserState {
  section: string;
  selectedSymbol: string | null;
  theme: string;
  lastInteraction: number; // epoch ms
}

export interface Highlight {
  symbols: string[];
  color: string;
  duration: number;
  pulse: boolean;
  label?: string;
  createdAt: number;
}

export interface Annotation {
  id: string;
  type: 'toast' | 'callout' | 'badge';
  message: string;
  symbol?: string;
  severity: string;
  duration: number;
  createdAt: number;
}

/**
 * Deterministic color from agent ID hash
 */
function agentColor(agentId: string): string {
  const colors = [
    '#58a6ff', '#3fb950', '#f85149', '#d29922',
    '#bc8cff', '#f778ba', '#79c0ff', '#56d364',
  ];
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

let annotationCounter = 0;

export class AgentPresenceManager {
  private agents = new Map<string, AgentPresence>();
  private staleTimeout = 2 * 60 * 1000; // 2 minutes

  join(agentId: string): AgentPresence {
    const now = new Date().toISOString();
    const presence: AgentPresence = {
      agentId,
      color: agentColor(agentId),
      connectedAt: now,
      lastActivity: now,
    };
    this.agents.set(agentId, presence);
    return presence;
  }

  touch(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActivity = new Date().toISOString();
    }
  }

  leave(agentId: string): void {
    this.agents.delete(agentId);
  }

  getAll(): AgentPresence[] {
    return Array.from(this.agents.values());
  }

  pruneStale(): string[] {
    const now = Date.now();
    const pruned: string[] = [];
    for (const [id, agent] of this.agents) {
      if (now - new Date(agent.lastActivity).getTime() > this.staleTimeout) {
        this.agents.delete(id);
        pruned.push(id);
      }
    }
    return pruned;
  }
}

export class UserStateTracker {
  private state: UserState = {
    section: 'overview',
    selectedSymbol: null,
    theme: 'dark',
    lastInteraction: Date.now(),
  };

  private highlights: Highlight[] = [];
  private annotations: Annotation[] = [];
  private muted = false;

  updateSection(section: string): void {
    this.state.section = section;
    this.state.lastInteraction = Date.now();
  }

  updateSelectedSymbol(symbol: string | null): void {
    this.state.selectedSymbol = symbol;
    this.state.lastInteraction = Date.now();
  }

  updateTheme(theme: string): void {
    this.state.theme = theme;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  isUserActive(thresholdMs = 5000): boolean {
    return Date.now() - this.state.lastInteraction < thresholdMs;
  }

  getState(): UserState & { muted: boolean } {
    return { ...this.state, muted: this.muted };
  }

  addHighlight(h: Highlight): void {
    this.highlights.push(h);
    // Auto-expire
    if (h.duration > 0) {
      setTimeout(() => {
        this.highlights = this.highlights.filter(x => x !== h);
      }, h.duration);
    }
  }

  addAnnotation(a: Omit<Annotation, 'id' | 'createdAt'>): Annotation {
    const annotation: Annotation = {
      ...a,
      id: `ann-${++annotationCounter}`,
      createdAt: Date.now(),
    };
    this.annotations.push(annotation);
    // Auto-expire
    if (annotation.duration > 0) {
      setTimeout(() => {
        this.annotations = this.annotations.filter(x => x !== annotation);
      }, annotation.duration);
    }
    return annotation;
  }

  clearHighlights(): void {
    this.highlights = [];
  }

  clearAnnotations(): void {
    this.annotations = [];
  }

  clearAll(): void {
    this.highlights = [];
    this.annotations = [];
  }

  getHighlights(): Highlight[] {
    return [...this.highlights];
  }

  getAnnotations(): Annotation[] {
    return [...this.annotations];
  }
}
