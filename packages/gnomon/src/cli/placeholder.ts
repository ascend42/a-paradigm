import { GNOMON_VERSION } from '../version.js';

/**
 * Shared PR-0 bin behaviour: `--version` prints the version, anything else
 * says the bin is not implemented and exits 2. The kernel has zero runtime
 * deps (G-SEC-01), so it writes to stdio directly rather than through the
 * Paradigm logger; the kernel logger lands with #kernel-log (M1.2).
 */
export function runPlaceholderBin(name: string, argv: readonly string[]): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${name} ${GNOMON_VERSION}\n`);
    return 0;
  }
  process.stderr.write(`${name} ${GNOMON_VERSION}: not implemented yet (Gnomon PR-0 scaffold)\n`);
  return 2;
}
