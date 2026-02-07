import type { LogLevel, LogData, SymbolType } from './types';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',  // gray
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};

const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function formatTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatData(data?: LogData): string {
  if (!data || Object.keys(data).length === 0) return '';
  return ' ' + JSON.stringify(data);
}

export function formatPretty(
  level: LogLevel,
  symbol: string,
  _symbolType: SymbolType,
  message: string,
  data?: LogData,
  correlationId?: string,
): string {
  const color = LEVEL_COLORS[level];
  const lvl = level.toUpperCase().padEnd(5);
  const time = formatTime();
  const dataStr = formatData(correlationId ? { correlationId, ...data } : data);
  return `${color}${time}${RESET} ${BOLD}${symbol}${RESET} ${color}${lvl}${RESET} ${message}${dataStr}`;
}

export function formatJSON(
  level: LogLevel,
  symbol: string,
  symbolType: SymbolType,
  message: string,
  data?: LogData,
  correlationId?: string,
): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    symbol,
    symbolType,
    message,
    ...data,
  };
  if (correlationId) entry.correlationId = correlationId;
  return JSON.stringify(entry);
}
