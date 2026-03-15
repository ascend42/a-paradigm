/**
 * useActivityReporter — Report user actions to the Platform server via WebSocket
 *
 * Watches platformStore for section/symbol/theme changes and sends them
 * to the server so the agent can observe user state.
 */

import { useEffect, type MutableRefObject } from 'react';
import { usePlatformStore } from '../store/platformStore';

export function useActivityReporter(wsRef: MutableRefObject<WebSocket | null>) {
  const activeSection = usePlatformStore(s => s.activeSection);
  const theme = usePlatformStore(s => s.theme);

  // Report section changes
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'user:navigate', section: activeSection }));
    }
  }, [activeSection, wsRef]);

  // Report theme changes
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'user:theme', theme }));
    }
  }, [theme, wsRef]);
}
