import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage<string>();

export function createCorrelationId(): string {
  return randomUUID();
}

export function withCorrelation<T>(id: string, fn: () => T): T {
  return storage.run(id, fn);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore();
}
