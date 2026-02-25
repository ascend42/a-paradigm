import type { LogLevel, LogData, SymbolType, SymbolLogger, DurationTracker, LoggerOptions, LogTransport } from './types';
import { formatPretty, formatJSON } from './formatters';
import { getCorrelationId } from './correlation';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SYMBOL_PREFIXES: Record<Exclude<SymbolType, 'raw'>, string> = {
  component: '#',
  gate: '^',
  signal: '!',
  flow: '$',
  aspect: '~',
};

function resolveLevel(): LogLevel {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
  const explicit = env.LOG_LEVEL as LogLevel | undefined;
  if (explicit && LEVEL_PRIORITY[explicit] !== undefined) return explicit;
  return env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function resolveFormat(): 'pretty' | 'json' {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
  if (env.PARADIGM_LOG_FORMAT === 'json') return 'json';
  if (env.NODE_ENV === 'production') return 'json';
  return 'pretty';
}

function resolveSymbolFilter(): string[] | null {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
  const raw = env.PARADIGM_SYMBOLS;
  if (!raw) return null;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

class DurationTrackerImpl implements DurationTracker {
  private startTime: number;

  constructor(
    private emit: (level: LogLevel, message: string, data?: LogData) => void,
  ) {
    this.startTime = Date.now();
  }

  success(message: string, data?: LogData): void {
    this.end('info', message, data);
  }

  error(message: string, data?: LogData): void {
    this.end('error', message, data);
  }

  end(level: LogLevel, message: string, data?: LogData): void {
    const duration = Date.now() - this.startTime;
    this.emit(level, message, { ...data, duration: `${duration}ms` });
  }
}

class SymbolLoggerImpl implements SymbolLogger {
  constructor(
    private symbol: string,
    private symbolType: SymbolType,
    private minLevel: LogLevel,
    private symbolFilter: string[] | null,
    private format: 'pretty' | 'json',
    private output: (line: string) => void,
    private transports: LogTransport[] = [],
  ) {}

  debug(message: string, data?: LogData): void { this.emit('debug', message, data); }
  info(message: string, data?: LogData): void { this.emit('info', message, data); }
  warn(message: string, data?: LogData): void { this.emit('warn', message, data); }
  error(message: string, data?: LogData): void { this.emit('error', message, data); }

  start(message: string, data?: LogData): DurationTracker {
    this.emit('info', message, data);
    return new DurationTrackerImpl((level, msg, d) => this.emit(level, msg, d));
  }

  private emit(level: LogLevel, message: string, data?: LogData): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    if (this.symbolFilter) {
      const prefix = this.symbol.charAt(0);
      if (!this.symbolFilter.includes(prefix)) return;
    }

    const correlationId = getCorrelationId();
    const formatter = this.format === 'json' ? formatJSON : formatPretty;
    const line = formatter(level, this.symbol, this.symbolType, message, data, correlationId);
    this.output(line);

    if (this.transports.length > 0) {
      const entry = {
        level,
        symbol: this.symbol,
        symbolType: this.symbolType,
        message,
        data,
        correlationId,
        timestamp: new Date().toISOString(),
      };
      for (const transport of this.transports) {
        transport.send(entry);
      }
    }
  }
}

export class ParadigmLogger {
  private level: LogLevel;
  private symbolFilter: string[] | null;
  private format: 'pretty' | 'json';
  private output: (line: string) => void;
  private transports: LogTransport[];

  constructor(options?: LoggerOptions) {
    this.level = options?.level ?? resolveLevel();
    this.symbolFilter = options?.symbols ?? resolveSymbolFilter();
    this.format = options?.format ?? resolveFormat();
    this.output = options?.output ?? ((line: string) => console.log(line));
    this.transports = options?.transports ?? [];
  }

  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  removeTransport(transport: LogTransport): void {
    const idx = this.transports.indexOf(transport);
    if (idx !== -1) this.transports.splice(idx, 1);
  }

  component(symbol: string): SymbolLogger {
    return this.create(symbol, 'component', '#');
  }

  gate(symbol: string): SymbolLogger {
    return this.create(symbol, 'gate', '^');
  }

  signal(symbol: string): SymbolLogger {
    return this.create(symbol, 'signal', '!');
  }

  flow(symbol: string): SymbolLogger {
    return this.create(symbol, 'flow', '$');
  }

  aspect(symbol: string): SymbolLogger {
    return this.create(symbol, 'aspect', '~');
  }

  raw(symbol: string): SymbolLogger {
    return new SymbolLoggerImpl(symbol, 'raw', this.level, this.symbolFilter, this.format, this.output, this.transports);
  }

  private create(symbol: string, type: SymbolType, expectedPrefix: string): SymbolLogger {
    const normalized = symbol.startsWith(expectedPrefix) ? symbol : `${expectedPrefix}${symbol}`;
    return new SymbolLoggerImpl(normalized, type, this.level, this.symbolFilter, this.format, this.output, this.transports);
  }
}

export const log = new ParadigmLogger();
