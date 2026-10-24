/**
 * @symbol #gnomon-kernel
 *
 * Gnomon CLI output helpers — the instrument-readout voice (spec §22 OPEN 9,
 * P8-D57): aligned `label  value` readings, refusals as
 * `REFUSED  <CODE>  <reason>` with the message and indented `next:` steps.
 * The kernel has zero deps (G-SEC-01), so these write plain text to the
 * streams they are given; no colour, no decoration.
 */
export interface Out {
  write(chunk: string): unknown;
}

/** Aligned readings: one `label  value` per line, labels padded to the longest. */
export function readout(out: Out, rows: ReadonlyArray<readonly [string, string | number]>): void {
  const w = Math.max(0, ...rows.map(([l]) => l.length));
  for (const [l, v] of rows) out.write(`  ${l.padEnd(w)}  ${v}\n`);
}

/** A one-line heading reading, e.g. `QUARANTINED  log:…`. */
export function heading(out: Out, word: string, detail = ''): void {
  out.write(`${word.toUpperCase()}${detail ? `  ${detail}` : ''}\n`);
}

/** `REFUSED  CODE  reason`, the message indented, then each `next:` step. */
export function refused(out: Out, code: string, reason: string, message: string, next: readonly string[] = []): void {
  out.write(`REFUSED  ${code.toUpperCase()}  ${reason}\n`);
  if (message) out.write(`  ${message}\n`);
  for (const n of next) out.write(`  next: ${n}\n`);
}
