/**
 * SentinelTransport — Bridge between Paradigm Logger and Sentinel Client
 *
 * Uses structural typing to match LogTransport interface without
 * importing from @a-company/paradigm-logger (avoids hard dependency).
 *
 * Usage:
 *   import { enableSentinel } from '@a-company/sentinel/transport';
 *   import { log } from '@a-company/paradigm-logger';
 *   enableSentinel(log, { service: 'my-app' });
 */

import { SentinelClient, type SentinelClientOptions } from './client.js';

// ═══════════════════════════════════════════════════════════════════
// STRUCTURAL TYPES (match LogTransport without importing it)
// ═══════════════════════════════════════════════════════════════════

/** Structurally matches LogTransport.send() entry shape */
interface LogEntry {
  level: string;
  symbol: string;
  symbolType: string;
  message: string;
  data?: Record<string, unknown>;
  correlationId?: string;
  timestamp: string;
}

/** Structurally matches ParadigmLogger.addTransport() */
interface LoggerWithTransports {
  addTransport(transport: { send(entry: LogEntry): void }): void;
  removeTransport(transport: { send(entry: LogEntry): void }): void;
}

// ═══════════════════════════════════════════════════════════════════
// SENTINEL TRANSPORT
// ═══════════════════════════════════════════════════════════════════

export class SentinelTransport {
  readonly client: SentinelClient;

  constructor(client: SentinelClient) {
    this.client = client;
  }

  send(entry: LogEntry): void {
    this.client.log(
      entry.level as 'debug' | 'info' | 'warn' | 'error',
      entry.symbol,
      entry.message,
      {
        ...entry.data,
        symbolType: entry.symbolType,
        correlationId: entry.correlationId,
      },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACTORIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a SentinelTransport from an existing client or options.
 *
 *   const transport = createSentinelTransport(client);
 *   log.addTransport(transport);
 */
export function createSentinelTransport(
  clientOrOptions: SentinelClient | SentinelClientOptions,
): SentinelTransport {
  const client = clientOrOptions instanceof SentinelClient
    ? clientOrOptions
    : new SentinelClient(clientOrOptions);
  return new SentinelTransport(client);
}

/**
 * One-line setup: creates a SentinelTransport and attaches it to a logger.
 *
 *   import { log } from '@a-company/paradigm-logger';
 *   const transport = enableSentinel(log, { service: 'my-app' });
 */
export function enableSentinel(
  logger: LoggerWithTransports,
  clientOrOptions: SentinelClient | SentinelClientOptions,
): SentinelTransport {
  const transport = createSentinelTransport(clientOrOptions);
  logger.addTransport(transport);
  return transport;
}
