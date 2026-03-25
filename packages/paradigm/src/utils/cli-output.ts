import chalk from 'chalk';

/**
 * CLI output helpers for user-facing messages.
 *
 * The Paradigm project convention requires the Paradigm logger for library code,
 * but CLI commands need direct stdout output. These helpers provide structured
 * output without conflating user messages with debug logging.
 */

/** Print a line to stdout */
export function out(message: string) {
  process.stdout.write(message + '\n');
}

/** Print a success message */
export function success(message: string) {
  out(chalk.green('✓') + ' ' + message);
}

/** Print a warning */
export function warn(message: string) {
  out(chalk.yellow('⚠') + ' ' + message);
}

/** Print an error */
export function error(message: string) {
  process.stderr.write(chalk.red('✗') + ' ' + message + '\n');
}

/** Print a dim/muted line */
export function dim(message: string) {
  out(chalk.dim(message));
}

/** Print a header */
export function header(message: string) {
  out('\n' + chalk.bold(message));
}

/** Print a key-value pair */
export function kv(key: string, value: string) {
  out('  ' + chalk.dim(key + ':') + ' ' + value);
}

/** Print JSON to stdout (for --json flags) */
export function json(data: unknown) {
  out(JSON.stringify(data, null, 2));
}
