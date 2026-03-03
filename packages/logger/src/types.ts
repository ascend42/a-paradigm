/** @public @stable Log severity levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** @public @stable Arbitrary structured data attached to log entries */
export type LogData = Record<string, unknown>;

/** @public @stable Paradigm symbol types that map to logger methods */
export type SymbolType = 'component' | 'gate' | 'signal' | 'flow' | 'aspect' | 'raw';

/** @public @stable Per-symbol logger returned by component/gate/signal/flow/aspect methods */
export interface SymbolLogger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  start(message: string, data?: LogData): DurationTracker;
}

/** @public @stable Tracks operation duration — returned by SymbolLogger.start() */
export interface DurationTracker {
  success(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  end(level: LogLevel, message: string, data?: LogData): void;
}

/** @public @stable Transport interface for routing log entries to external systems */
export interface LogTransport {
  send(entry: {
    level: LogLevel;
    symbol: string;
    symbolType: SymbolType;
    message: string;
    data?: LogData;
    correlationId?: string;
    timestamp: string;
  }): void;
}

/** @public @stable Configuration options for ParadigmLogger */
export interface LoggerOptions {
  level?: LogLevel;
  symbols?: string[];
  format?: 'pretty' | 'json';
  output?: (line: string) => void;
  transports?: LogTransport[];
}
