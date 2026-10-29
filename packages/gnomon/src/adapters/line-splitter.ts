/**
 * @symbol #backend-adapter
 *
 * Line splitter with the §3.3 caps, shared by both lanes (moved from
 * claude-code/adapter.ts, which re-exports it): a stdout line over `maxLine`
 * bytes is dropped and reported ONCE (with its total size, at its end), never
 * buffered without bound. Linear: each chunk is measured once (no re-measuring
 * of the accumulated buffer).
 */
export class LineSplitter {
  #parts: string[] = [];
  #bytes = 0;
  #dropping = false;
  readonly #maxLine: number;
  constructor(maxLine: number) {
    this.#maxLine = maxLine;
  }
  push(chunk: string, onLine: (line: string) => void, onDropped: (bytes: number) => void): void {
    const segs = chunk.split('\n');
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      const segBytes = Buffer.byteLength(seg);
      this.#bytes += segBytes;
      if (!this.#dropping) {
        if (this.#bytes > this.#maxLine) {
          this.#dropping = true;
          this.#parts = [];
        } else this.#parts.push(seg);
      }
      if (i === segs.length - 1) break; // no newline yet: the line continues in the next chunk
      if (this.#dropping) onDropped(this.#bytes);
      else {
        const line = this.#parts.join('');
        if (line.trim()) onLine(line);
      }
      this.#parts = [];
      this.#bytes = 0;
      this.#dropping = false;
    }
  }
}
