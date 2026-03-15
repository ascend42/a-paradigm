import { create } from 'zustand';

export interface AgentPresence {
  agentId: string;
  color: string;
  connectedAt: string;
  lastActivity: string;
}

export interface Highlight {
  symbols: string[];
  color: string;
  duration: number;
  pulse: boolean;
  label?: string;
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

export interface PendingNavigation {
  agentId: string;
  section?: string;
  symbol?: string;
  loreId?: string;
}

export interface AgentState {
  agents: AgentPresence[];
  highlights: Highlight[];
  annotations: Annotation[];
  toasts: Annotation[];
  agentMuted: boolean;
  pendingNavigation: PendingNavigation | null;

  handleAgentMessage: (msg: Record<string, unknown>) => void;
  setAgentMuted: (muted: boolean) => void;
  dismissToast: (id: string) => void;
  acceptNavigation: () => void;
  dismissNavigation: () => void;
  clearAll: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  highlights: [],
  annotations: [],
  toasts: [],
  agentMuted: false,
  pendingNavigation: null,

  handleAgentMessage: (msg) => {
    const state = get();
    if (state.agentMuted && msg.type !== 'agent:mute_changed') return;

    switch (msg.type) {
      case 'agent:join': {
        const agent = msg.agent as AgentPresence;
        if (agent) {
          set({ agents: [...state.agents.filter(a => a.agentId !== agent.agentId), agent] });
        }
        break;
      }

      case 'agent:leave': {
        const agentId = msg.agentId as string;
        set({ agents: state.agents.filter(a => a.agentId !== agentId) });
        break;
      }

      case 'agent:navigate': {
        const userActive = msg.userActive as boolean;
        if (userActive) {
          // Show prompt instead of auto-navigating
          set({
            pendingNavigation: {
              agentId: msg.agentId as string,
              section: msg.section as string | undefined,
              symbol: msg.symbol as string | undefined,
              loreId: msg.loreId as string | undefined,
            },
          });
        } else {
          // Auto-navigate — handled by useAgentEffects hook
          // Store the navigation intent so the hook can pick it up
          set({
            pendingNavigation: {
              agentId: msg.agentId as string,
              section: msg.section as string | undefined,
              symbol: msg.symbol as string | undefined,
              loreId: msg.loreId as string | undefined,
            },
          });
          // Auto-accept after a tick
          setTimeout(() => get().acceptNavigation(), 0);
        }
        break;
      }

      case 'agent:highlight': {
        const highlight: Highlight = {
          symbols: (msg.symbols as string[]) || [],
          color: (msg.color as string) || '#58a6ff',
          duration: (msg.duration as number) || 5000,
          pulse: (msg.pulse as boolean) ?? true,
          label: msg.label as string | undefined,
        };
        set({ highlights: [...state.highlights, highlight] });

        // Auto-expire
        if (highlight.duration > 0) {
          setTimeout(() => {
            set({ highlights: get().highlights.filter(h => h !== highlight) });
          }, highlight.duration);
        }
        break;
      }

      case 'agent:annotate': {
        const annotation = msg.annotation as Annotation;
        if (annotation) {
          if (annotation.type === 'toast') {
            set({ toasts: [...state.toasts, annotation] });
            if (annotation.duration > 0) {
              setTimeout(() => {
                set({ toasts: get().toasts.filter(t => t.id !== annotation.id) });
              }, annotation.duration);
            }
          } else {
            set({ annotations: [...state.annotations, annotation] });
            if (annotation.duration > 0) {
              setTimeout(() => {
                set({ annotations: get().annotations.filter(a => a.id !== annotation.id) });
              }, annotation.duration);
            }
          }
        }
        break;
      }

      case 'agent:clear': {
        const target = msg.target as string;
        if (target === 'highlights' || target === 'all') {
          set({ highlights: [] });
        }
        if (target === 'annotations' || target === 'all') {
          set({ annotations: [], toasts: [] });
        }
        break;
      }

      case 'agent:mute_changed': {
        set({ agentMuted: msg.muted as boolean });
        break;
      }
    }
  },

  setAgentMuted: (muted) => {
    set({ agentMuted: muted });
    // If muting, clear all effects
    if (muted) {
      set({ highlights: [], annotations: [], toasts: [], pendingNavigation: null });
    }
  },

  dismissToast: (id) => {
    set({ toasts: get().toasts.filter(t => t.id !== id) });
  },

  acceptNavigation: () => {
    // The hook will read pendingNavigation and apply it
    // After applying, clear it
    const nav = get().pendingNavigation;
    if (nav) {
      // Emit a custom event that the effects hook will catch
      window.dispatchEvent(new CustomEvent('agent-navigate', { detail: nav }));
      set({ pendingNavigation: null });
    }
  },

  dismissNavigation: () => {
    set({ pendingNavigation: null });
  },

  clearAll: () => {
    set({ highlights: [], annotations: [], toasts: [], pendingNavigation: null });
  },
}));
