/**
 * Ring Buffer — Fixed-size circular buffer for event batching
 *
 * Provides O(1) push/drain with configurable backpressure.
 */

import type { BufferedEvent } from './types.js';

export class RingBuffer {
  private buffer: (BufferedEvent | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private readonly capacity: number;
  private readonly strategy: 'drop-oldest' | 'drop-newest';
  private readonly onDrop?: (count: number) => void;

  constructor(
    capacity: number,
    strategy: 'drop-oldest' | 'drop-newest' = 'drop-oldest',
    onDrop?: (count: number) => void
  ) {
    this.capacity = capacity;
    this.strategy = strategy;
    this.onDrop = onDrop;
    this.buffer = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(event: BufferedEvent): void {
    if (this.count >= this.capacity) {
      if (this.strategy === 'drop-newest') {
        this.onDrop?.(1);
        return;
      }
      // drop-oldest: overwrite head
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      this.onDrop?.(1);
    }

    this.buffer[this.tail] = event;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
  }

  /**
   * Drain up to `max` events from the buffer.
   * Returns the drained events and removes them from the buffer.
   */
  drain(max: number): BufferedEvent[] {
    const result: BufferedEvent[] = [];
    const n = Math.min(max, this.count);

    for (let i = 0; i < n; i++) {
      const event = this.buffer[this.head];
      if (event) {
        result.push(event);
        this.buffer[this.head] = undefined;
      }
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }

    return result;
  }

  /** Drain all events */
  drainAll(): BufferedEvent[] {
    return this.drain(this.count);
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
