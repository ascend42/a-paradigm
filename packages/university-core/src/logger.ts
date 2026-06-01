/**
 * Logger seam for @a-company/university-core (extract-university-core spec §2).
 *
 * Core code MUST NEVER import a concrete logger (mcp-logger, cli-output, the
 * server's chalk log). Instead it logs through a narrow injected interface with
 * a no-op default. Consumers wire their own logger once at startup:
 *
 *   // paradigm-mcp
 *   setUniversityCoreLogger({ warn: (m, d) => log.component('#university-loader').warn(m, d) });
 *
 * The loader only ever emits `warn(message, data?)` (verified — no info/error/
 * gate usage on the warn path inside the loader). The no-op default means a
 * consumer that forgets to wire stays silent rather than crashing — matching
 * today's "warnings are advisory" behavior.
 */

export interface UniversityCoreLogger {
  warn(message: string, data?: Record<string, unknown>): void;
}

const NOOP_LOGGER: UniversityCoreLogger = { warn() {} };

let activeLogger: UniversityCoreLogger = NOOP_LOGGER;

/** Inject the active logger. Called once per process by each consumer. */
export function setUniversityCoreLogger(logger: UniversityCoreLogger): void {
  activeLogger = logger;
}

/**
 * Internal accessor for core modules. Returns the live singleton so a late
 * `setUniversityCoreLogger` call is honored by call sites that captured it
 * indirectly through this function.
 */
export function getUniversityCoreLogger(): UniversityCoreLogger {
  return activeLogger;
}
