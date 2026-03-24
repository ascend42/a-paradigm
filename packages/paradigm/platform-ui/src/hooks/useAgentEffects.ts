/**
 * useAgentEffects — Apply agent commands to the Platform UI
 *
 * Listens for WebSocket messages and dispatches to agentStore.
 * Also handles the 'agent-navigate' custom event by updating platformStore.
 */

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';
import { usePlatformStore, type SectionId } from '../store/platformStore';

export function useAgentEffects() {
  const handleAgentMessage = useAgentStore(s => s.handleAgentMessage);
  const setActiveSection = usePlatformStore(s => s.setActiveSection);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type?.startsWith('agent:')) {
            handleAgentMessage(msg);
          }
          // Forward sentinel:* messages to sentinel stores via CustomEvent
          if (msg.type?.startsWith('sentinel:')) {
            window.dispatchEvent(new CustomEvent('sentinel-ws', { detail: msg }));
          }
          // Forward symphony:* messages to symphony stores via CustomEvent
          if (msg.type?.startsWith('symphony:')) {
            window.dispatchEvent(new CustomEvent('symphony-ws', { detail: msg }));
          }
        } catch {
          // Ignore malformed
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [handleAgentMessage]);

  // Handle agent navigation events
  useEffect(() => {
    function onAgentNavigate(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      const validSections: SectionId[] = ['overview', 'lore', 'graph', 'canvas', 'git', 'sentinel', 'university', 'symphony', 'docs', 'ambient', 'team'];
      if (detail.section && validSections.includes(detail.section)) {
        setActiveSection(detail.section);
      }
    }

    window.addEventListener('agent-navigate', onAgentNavigate);
    return () => window.removeEventListener('agent-navigate', onAgentNavigate);
  }, [setActiveSection]);

  return wsRef;
}
