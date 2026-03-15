/**
 * useSymphonyWs — Listens for symphony:* CustomEvents dispatched by useAgentEffects
 * and routes them to the symphony store.
 *
 * Called from SymphonySection.tsx (active only when symphony section is mounted).
 */

import { useEffect } from 'react';
import { useSymphonyStore } from '../store/symphonyStore';

export function useSymphonyWs() {
  useEffect(() => {
    function handleSymphonyWs(e: Event) {
      const msg = (e as CustomEvent).detail;
      if (!msg?.type) return;

      if (msg.type === 'symphony:message' || msg.type === 'symphony:thread_resolved') {
        useSymphonyStore.getState().handleWsMessage(msg);
      }
    }

    window.addEventListener('symphony-ws', handleSymphonyWs);
    return () => window.removeEventListener('symphony-ws', handleSymphonyWs);
  }, []);
}
