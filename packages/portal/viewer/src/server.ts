/**
 * Portal Viewer WebSocket Server
 *
 * Receives WatcherEvents from Portal SDK clients and broadcasts to UI viewers.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import sirv from 'sirv';
import { parseGateConfig } from '@a-company/portal-core';
import { ViewerState } from './state.js';
import type {
  WatcherEvent,
  ServerMessage,
  ClientMessage,
  InitMessage,
  PortalEventMessage,
  SessionUpdateMessage,
  StateSyncMessage,
} from './types.js';

export interface ViewerServerOptions {
  port?: number;
  uiPort?: number;
  configPath?: string;
  staticDir?: string;
}

export class ViewerServer {
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private state: ViewerState;
  private options: Required<ViewerServerOptions>;

  // Track connected clients
  private sdkClients: Set<WebSocket> = new Set();
  private uiClients: Set<WebSocket> = new Set();

  constructor(options: ViewerServerOptions = {}) {
    this.options = {
      port: options.port ?? 42196,      // Marathon + 1 (WebSocket)
      uiPort: options.uiPort ?? 42195,  // Marathon distance: 42.195km
      configPath: options.configPath ?? './portal.yaml',
      staticDir: options.staticDir ?? path.join(process.cwd(), 'dist', 'ui'),
    };

    this.state = new ViewerState();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Load config and initialize state
    await this.loadConfig();

    // Start WebSocket server for SDK connections
    this.startWebSocketServer();

    // Start HTTP server for UI
    this.startHttpServer();

    console.log(`🚪 Portal Viewer started`);
    console.log(`   SDK WebSocket: ws://localhost:${this.options.port}`);
    console.log(`   UI Server: http://localhost:${this.options.uiPort}`);
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.sdkClients.clear();
    this.uiClients.clear();
  }

  /**
   * Load portal configuration
   */
  private async loadConfig(): Promise<void> {
    const configPath = path.resolve(this.options.configPath);

    if (!fs.existsSync(configPath)) {
      console.warn(`⚠️  No portal.yaml found at ${configPath}, starting with empty config`);
      return;
    }

    try {
      const config = await parseGateConfig(configPath);
      this.state.initializeFromConfig(config.gates, config.flows);
      console.log(`📋 Loaded ${config.gates.length} gates, ${config.flows.length} flows`);
    } catch (error) {
      console.error(`❌ Failed to load config:`, error);
    }
  }

  /**
   * Start WebSocket server for SDK connections
   */
  private startWebSocketServer(): void {
    this.wss = new WebSocketServer({ port: this.options.port });

    this.wss.on('connection', (ws, req) => {
      // Determine if this is an SDK client or UI client based on path
      const isUI = req.url === '/ui' || req.url?.startsWith('/ui');

      if (isUI) {
        this.handleUIConnection(ws);
      } else {
        this.handleSDKConnection(ws);
      }
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  /**
   * Handle SDK client connection
   */
  private handleSDKConnection(ws: WebSocket): void {
    this.sdkClients.add(ws);
    console.log(`🔌 SDK client connected (${this.sdkClients.size} total)`);

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as WatcherEvent;
        this.handleWatcherEvent(event);
      } catch (error) {
        console.error('Failed to parse SDK message:', error);
      }
    });

    ws.on('close', () => {
      this.sdkClients.delete(ws);
      console.log(`🔌 SDK client disconnected (${this.sdkClients.size} remaining)`);
    });

    ws.on('error', (error) => {
      console.error('SDK client error:', error);
      this.sdkClients.delete(ws);
    });
  }

  /**
   * Handle UI client connection
   */
  private handleUIConnection(ws: WebSocket): void {
    this.uiClients.add(ws);
    console.log(`🖥️  UI client connected (${this.uiClients.size} total)`);

    // Send initial state
    this.sendToUI(ws, {
      type: 'init',
      data: {
        portals: this.state.getPortals(),
        flows: this.state.getFlows(),
        session: this.state.getSession(),
      },
    } as InitMessage);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        this.handleClientMessage(ws, message);
      } catch (error) {
        console.error('Failed to parse UI message:', error);
      }
    });

    ws.on('close', () => {
      this.uiClients.delete(ws);
      console.log(`🖥️  UI client disconnected (${this.uiClients.size} remaining)`);
    });

    ws.on('error', (error) => {
      console.error('UI client error:', error);
      this.uiClients.delete(ws);
    });
  }

  /**
   * Handle incoming watcher event from SDK
   */
  private handleWatcherEvent(event: WatcherEvent): void {
    // Process event and update state
    const viewerEvent = this.state.processEvent(event);

    // Broadcast to all UI clients
    const message: PortalEventMessage = {
      type: 'portal-event',
      data: viewerEvent,
    };

    this.broadcastToUI(message);
  }

  /**
   * Handle client message from UI
   */
  private handleClientMessage(ws: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case 'session-start': {
        const session = this.state.startSession(message.data as string | undefined);
        this.broadcastSessionUpdate(session);
        break;
      }

      case 'session-end': {
        const session = this.state.endSession();
        if (session) {
          this.broadcastSessionUpdate(session);
        }
        break;
      }

      case 'session-name': {
        const session = this.state.renameSession(message.data as string);
        if (session) {
          this.broadcastSessionUpdate(session);
        }
        break;
      }

      case 'reset-stats': {
        this.state.resetStats();
        this.broadcastStateSync();
        break;
      }

      case 'session-export':
      case 'send-webhook':
        // TODO: Implement export and webhook functionality
        console.log(`📤 ${message.type} requested (not yet implemented)`);
        break;

      default:
        console.warn(`Unknown client message type: ${message.type}`);
    }
  }

  /**
   * Send message to specific UI client
   */
  private sendToUI(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all UI clients
   */
  private broadcastToUI(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.uiClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Broadcast session update to all UI clients
   */
  private broadcastSessionUpdate(session: ReturnType<ViewerState['getSession']>): void {
    if (!session) return;

    const message: SessionUpdateMessage = {
      type: 'session-update',
      data: session,
    };

    this.broadcastToUI(message);
  }

  /**
   * Broadcast full state sync to all UI clients
   */
  private broadcastStateSync(): void {
    const message: StateSyncMessage = {
      type: 'state-sync',
      data: {
        portals: this.state.getPortals(),
        flows: this.state.getFlows(),
        session: this.state.getSession(),
      },
    };

    this.broadcastToUI(message);
  }

  /**
   * Start HTTP server for UI
   */
  private startHttpServer(): void {
    const staticDir = this.options.staticDir;

    // Check if UI build exists
    const hasUI = fs.existsSync(path.join(staticDir, 'index.html'));

    this.httpServer = http.createServer((req, res) => {
      // Handle API endpoints
      if (req.url?.startsWith('/api/')) {
        this.handleApiRequest(req, res);
        return;
      }

      // Serve static UI files
      if (hasUI) {
        const serve = sirv(staticDir, { dev: true, single: true });
        serve(req, res, () => {
          res.writeHead(404);
          res.end('Not found');
        });
      } else {
        // Return a simple HTML page with WebSocket connection info
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Portal Viewer</title>
            <style>
              body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; }
              code { background: #f4f4f4; padding: 0.2rem 0.5rem; border-radius: 4px; }
              .status { padding: 1rem; background: #e8f5e9; border-radius: 8px; margin: 1rem 0; }
            </style>
          </head>
          <body>
            <h1>🚪 Portal Viewer</h1>
            <div class="status">
              <strong>Server Running</strong>
              <p>SDK WebSocket: <code>ws://localhost:${this.options.port}</code></p>
              <p>UI not built. Run <code>npm run build:ui</code> in the viewer package.</p>
            </div>
            <h2>Connected Clients</h2>
            <p>SDK Clients: ${this.sdkClients.size}</p>
            <p>UI Clients: ${this.uiClients.size}</p>
            <h2>Current State</h2>
            <p>Portals: ${this.state.getPortals().length}</p>
            <p>Flows: ${this.state.getFlows().length}</p>
            <p>Session: ${this.state.getSession()?.name ?? 'None'}</p>
          </body>
          </html>
        `);
      }
    });

    this.httpServer.listen(this.options.uiPort);
  }

  /**
   * Handle API requests
   */
  private handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url!, `http://localhost:${this.options.uiPort}`);

    switch (url.pathname) {
      case '/api/state':
        res.writeHead(200);
        res.end(JSON.stringify({
          portals: this.state.getPortals(),
          flows: this.state.getFlows(),
          session: this.state.getSession(),
        }));
        break;

      case '/api/info':
        res.writeHead(200);
        res.end(JSON.stringify({
          sdkClients: this.sdkClients.size,
          uiClients: this.uiClients.size,
          wsPort: this.options.port,
          uiPort: this.options.uiPort,
        }));
        break;

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  }
}
