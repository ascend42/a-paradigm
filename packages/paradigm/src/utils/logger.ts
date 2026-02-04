/**
 * Paradigm CLI Logger
 * 
 * Internal logger for Paradigm CLI operations.
 * Follows Paradigm symbol patterns while maintaining CLI aesthetics.
 */

import chalk from 'chalk';

type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

interface LogData {
  [key: string]: unknown;
}

class SymbolLogger {
  constructor(
    private symbol: string,
    private type: 'command' | 'component' | 'operation'
  ) {}

  private format(level: LogLevel, message: string, data?: LogData): string {
    const prefix = this.getPrefix(level);
    const symbolStr = this.formatSymbol();
    const dataStr = data ? chalk.gray(` ${JSON.stringify(data)}`) : '';
    
    return `${prefix} ${symbolStr} ${message}${dataStr}`;
  }

  private getPrefix(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return chalk.gray('○');
      case 'info':
        return chalk.blue('ℹ');
      case 'success':
        return chalk.green('✔');
      case 'warn':
        return chalk.yellow('⚠');
      case 'error':
        return chalk.red('✖');
    }
  }

  private formatSymbol(): string {
    switch (this.type) {
      case 'command':
        return chalk.cyan(`[${this.symbol}]`);
      case 'component':
        return chalk.magenta(`#${this.symbol}`);
      case 'operation':
        return chalk.blue(this.symbol);
    }
  }

  debug(message: string, data?: LogData): void {
    if (process.env.DEBUG) {
      console.log(this.format('debug', message, data));
    }
  }

  info(message: string, data?: LogData): void {
    console.log(this.format('info', message, data));
  }

  success(message: string, data?: LogData): void {
    console.log(this.format('success', message, data));
  }

  warn(message: string, data?: LogData): void {
    console.log(this.format('warn', message, data));
  }

  error(message: string, data?: LogData): void {
    console.error(this.format('error', message, data));
  }

  // For operations with duration tracking
  start(message: string, data?: LogData): DurationTracker {
    this.info(message, data);
    return new DurationTracker(this.symbol, this.type);
  }
}

class DurationTracker {
  private startTime: number;

  constructor(
    private symbol: string,
    private type: 'command' | 'component' | 'operation'
  ) {
    this.startTime = Date.now();
  }

  private getDuration(): number {
    return Date.now() - this.startTime;
  }

  success(message: string, data?: LogData): void {
    const duration = this.getDuration();
    const logger = new SymbolLogger(this.symbol, this.type);
    logger.success(message, { ...data, duration: `${duration}ms` });
  }

  error(message: string, data?: LogData): void {
    const duration = this.getDuration();
    const logger = new SymbolLogger(this.symbol, this.type);
    logger.error(message, { ...data, duration: `${duration}ms` });
  }
}

/**
 * Main logger interface for CLI operations
 */
export const log = {
  /**
   * Log for CLI commands (paradigm init, paradigm sync, etc.)
   * @example log.command('init').success('Created .paradigm/')
   */
  command(name: string): SymbolLogger {
    return new SymbolLogger(name, 'command');
  },

  /**
   * Log for internal components (file writers, parsers, etc.)
   * @example log.component('mcp-config').error('Failed to write')
   */
  component(name: string): SymbolLogger {
    return new SymbolLogger(name, 'component');
  },

  /**
   * Log for operations (sync, build, analyze, etc.)
   * @example log.operation('sync').info('Syncing IDE files')
   */
  operation(name: string): SymbolLogger {
    return new SymbolLogger(name, 'operation');
  },
};

/**
 * Standalone formatters for visual output (headers, sections, etc.)
 * These maintain existing CLI aesthetics while being explicit about structure.
 */
export const format = {
  header(text: string): string {
    return chalk.bold.cyan(text);
  },

  section(text: string): string {
    return chalk.bold(text);
  },

  success(text: string): string {
    return chalk.green(text);
  },

  error(text: string): string {
    return chalk.red(text);
  },

  warning(text: string): string {
    return chalk.yellow(text);
  },

  info(text: string): string {
    return chalk.blue(text);
  },

  dim(text: string): string {
    return chalk.gray(text);
  },

  path(text: string): string {
    return chalk.cyan(text);
  },

  symbol(text: string): string {
    return chalk.magenta(text);
  },
};
