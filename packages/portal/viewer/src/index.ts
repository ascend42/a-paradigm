/**
 * @a-company/portal-viewer
 *
 * Real-time visualization and testing dashboard for portal activations.
 *
 * Features:
 * - Live constellation view of portal gates
 * - Real-time event monitoring
 * - Testing checklist mode
 * - Session logging and reporting
 * - Webhook integrations (Slack, Discord, email)
 *
 * @example
 * ```typescript
 * import { ViewerServer } from '@a-company/portal-viewer';
 *
 * const server = new ViewerServer({
 *   port: 42196,     // WebSocket port for SDK connections (marathon + 1)
 *   uiPort: 42195,   // HTTP port for UI (marathon: 42.195km)
 *   configPath: './portal.yaml',
 * });
 *
 * await server.start();
 * ```
 */

export { ViewerServer } from './server.js';
export type { ViewerServerOptions } from './server.js';

// Types
export type {
  // Portal types
  PortalNode,
  PortalStatus,
  FlowNode,

  // Event types
  ViewerEvent,
  WatcherEvent,
  WatcherEventType,

  // Session types
  PortalSession,
  SessionStatus,
  EntityJourney,

  // Webhook types
  WebhookConfig,
  WebhookPayload,
  WebhookType,
  WebhookTrigger,

  // Message types
  ServerMessage,
  ServerMessageType,
  ClientMessage,
  ClientMessageType,

  // UI types
  ViewMode,
  Position,
} from './types.js';

// State (for advanced usage)
export { ViewerState } from './state.js';

// Session and reporting
export * from './session/index.js';

// Webhooks
export * from './webhooks/index.js';

/**
 * Quick start function to launch the viewer server
 */
export async function startViewer(options?: {
  port?: number;
  uiPort?: number;
  configPath?: string;
}): Promise<void> {
  const { ViewerServer } = await import('./server.js');

  const server = new ViewerServer(options);
  await server.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down Portal Viewer...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });
}

// CLI entry point
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  startViewer().catch(console.error);
}
