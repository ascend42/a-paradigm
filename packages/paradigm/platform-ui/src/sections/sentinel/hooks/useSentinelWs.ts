/**
 * useSentinelWs — Listens for sentinel:* CustomEvents dispatched by useAgentEffects
 * and routes them to the appropriate sentinel stores.
 *
 * Called from SentinelSection.tsx (active only when sentinel section is mounted).
 */

import { useEffect } from 'react';
import { useSentinelLogsStore } from '../store/sentinelLogsStore';
import { useSentinelEventsStore } from '../store/sentinelEventsStore';

export function useSentinelWs() {
  useEffect(() => {
    function handleSentinelWs(e: Event) {
      const msg = (e as CustomEvent).detail;
      if (!msg?.type) return;

      if (msg.type === 'sentinel:log' || msg.type === 'sentinel:flow_event') {
        useSentinelLogsStore.getState().handleWsMessage(msg);
      }

      if (msg.type === 'sentinel:event') {
        useSentinelEventsStore.getState().handleWsMessage(msg);
      }
    }

    window.addEventListener('sentinel-ws', handleSentinelWs);
    return () => window.removeEventListener('sentinel-ws', handleSentinelWs);
  }, []);
}
