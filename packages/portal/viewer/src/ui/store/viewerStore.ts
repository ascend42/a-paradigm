/**
 * Viewer state management with Zustand
 */

import { create } from 'zustand';
import type {
  PortalNode,
  FlowNode,
  ViewerEvent,
  PortalSession,
  ViewMode,
  ServerMessage,
  InitMessage,
  PortalEventMessage,
  SessionUpdateMessage,
  StateSyncMessage,
  ClientMessage,
} from '../../types';

interface ViewerState {
  // Connection state
  isConnected: boolean;
  error: string | null;
  ws: WebSocket | null;

  // Data
  portals: PortalNode[];
  flows: FlowNode[];
  events: ViewerEvent[];
  session: PortalSession | null;

  // UI state
  viewMode: ViewMode;
  selectedPortalId: string | null;
  selectedFlowId: string | null;
  filterEntityId: string | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  setViewMode: (mode: ViewMode) => void;
  selectPortal: (id: string | null) => void;
  selectFlow: (id: string | null) => void;
  setFilterEntity: (id: string | null) => void;

  // Session actions
  startSession: (name?: string) => void;
  endSession: () => void;
  renameSession: (name: string) => void;
  resetStats: () => void;

  // Internal actions
  _handleMessage: (message: ServerMessage) => void;
  _sendMessage: (message: ClientMessage) => void;
}

const MAX_EVENTS = 500;
const WS_URL = `ws://localhost:42196/ui`; // Marathon + 1

export const useViewerStore = create<ViewerState>((set, get) => ({
  // Initial state
  isConnected: false,
  error: null,
  ws: null,
  portals: [],
  flows: [],
  events: [],
  session: null,
  viewMode: 'constellation',
  selectedPortalId: null,
  selectedFlowId: null,
  filterEntityId: null,

  // Connection management
  connect: () => {
    const { ws } = get();
    if (ws) return;

    try {
      const socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        set({ isConnected: true, error: null, ws: socket });
        console.log('🔌 Connected to Portal Viewer');
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          get()._handleMessage(message);
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      socket.onclose = () => {
        set({ isConnected: false, ws: null });
        console.log('🔌 Disconnected from Portal Viewer');

        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          if (!get().isConnected) {
            get().connect();
          }
        }, 3000);
      };

      socket.onerror = () => {
        set({ error: 'Failed to connect to Portal Viewer server' });
      };
    } catch (err) {
      set({ error: `Connection error: ${err}` });
    }
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
      set({ ws: null, isConnected: false });
    }
  },

  // Handle incoming server messages
  _handleMessage: (message: ServerMessage) => {
    switch (message.type) {
      case 'init': {
        const data = (message as InitMessage).data;
        set({
          portals: data.portals,
          flows: data.flows,
          session: data.session,
        });
        break;
      }

      case 'portal-event': {
        const event = (message as PortalEventMessage).data;
        set((state) => {
          // Update portals with new status
          const updatedPortals = state.portals.map((portal) => {
            if (portal.id === event.gate) {
              return {
                ...portal,
                status: event.decision === 'allow'
                  ? 'passed'
                  : event.decision === 'deny'
                  ? 'failed'
                  : 'checking',
                lastEvent: event,
                lastUpdated: event.timestamp,
                hitCount: portal.hitCount + (event.type === 'gate:check' ? 1 : 0),
                passCount: portal.passCount + (event.decision === 'allow' ? 1 : 0),
                failCount: portal.failCount + (event.decision === 'deny' ? 1 : 0),
              } as PortalNode;
            }
            return portal;
          });

          // Add event to timeline (limit size)
          const newEvents = [event, ...state.events].slice(0, MAX_EVENTS);

          return {
            portals: updatedPortals,
            events: newEvents,
          };
        });

        // Reset portal status after animation (2 seconds)
        if (event.gate) {
          setTimeout(() => {
            set((state) => ({
              portals: state.portals.map((portal) =>
                portal.id === event.gate
                  ? { ...portal, status: 'idle' as const }
                  : portal
              ),
            }));
          }, 2000);
        }
        break;
      }

      case 'session-update': {
        const session = (message as SessionUpdateMessage).data;
        set({ session });
        break;
      }

      case 'state-sync': {
        const data = (message as StateSyncMessage).data;
        set({
          portals: data.portals,
          flows: data.flows,
          session: data.session,
        });
        break;
      }
    }
  },

  // Send message to server
  _sendMessage: (message: ClientMessage) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  },

  // UI actions
  setViewMode: (mode) => set({ viewMode: mode }),
  selectPortal: (id) => set({ selectedPortalId: id }),
  selectFlow: (id) => set({ selectedFlowId: id }),
  setFilterEntity: (id) => set({ filterEntityId: id }),

  // Session actions
  startSession: (name) => {
    get()._sendMessage({ type: 'session-start', data: name });
  },

  endSession: () => {
    get()._sendMessage({ type: 'session-end' });
  },

  renameSession: (name) => {
    get()._sendMessage({ type: 'session-name', data: name });
  },

  resetStats: () => {
    get()._sendMessage({ type: 'reset-stats' });
    set({ events: [] });
  },
}));
