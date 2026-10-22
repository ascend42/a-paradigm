/**
 * @symbol #loop-schema
 *
 * `@a-company/gnomon/loops` — the public entry for loop definitions (docs/specs/gnomon-loops.md §2). Paradigm's
 * CLI and MCP family import it to validate and compile `.paradigm/loops/*.yaml`; the kernel reads only the
 * compiled `<id>.loop.json`. Zero runtime dependencies (bundled like the rest of the kernel).
 */
export * from './schema.js';
