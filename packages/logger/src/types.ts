export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogData = Record<string, unknown>;

export type SymbolType = 'component' | 'gate' | 'signal' | 'flow' | 'aspect' | 'raw';

export interface SymbolLogger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  start(message: string, data?: LogData): DurationTracker;
}

export interface DurationTracker {
  success(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  end(level: LogLevel, message: string, data?: LogData): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  symbols?: string[];
  format?: 'pretty' | 'json';
  output?: (line: string) => void;
}
