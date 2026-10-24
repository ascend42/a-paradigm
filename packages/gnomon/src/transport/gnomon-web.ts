#!/usr/bin/env node
/**
 * @symbol #web-endpoint
 *
 * gnomon-web — the transport child entry (spec §2.1, §11.2 rule 1b). Spawned
 * by the kernel from its own package under the `transport` sandbox profile
 * (§15.5); talks to the kernel over stdio (web-child.ts) and receives the
 * kernel's accepted sockets over the IPC channel — it listens on nothing. Takes no
 * arguments beyond `--version`: its configuration is the first stdin record,
 * and no token ever reaches it on argv or env.
 */
import { Socket } from 'node:net';
import { WEB_CONN_MESSAGE } from '../kernel/web/protocol.js';
import { GNOMON_VERSION } from '../version.js';
import { runWebChild } from './web-child.js';

if (process.argv.includes('--version')) {
  process.stdout.write(`gnomon-web ${GNOMON_VERSION}\n`);
} else {
  runWebChild({
    input: process.stdin,
    output: process.stdout,
    exit: (code) => process.exit(code),
    // The IPC channel carries only the connected sockets the kernel accepted (§15.5); anything else is dropped.
    onSocket: (accept) =>
      void process.on('message', (m: unknown, handle: unknown) => {
        if (m === WEB_CONN_MESSAGE && handle instanceof Socket) accept(handle);
        else if (handle && typeof (handle as { destroy?: unknown }).destroy === 'function') (handle as { destroy: () => void }).destroy();
        else if (handle && typeof (handle as { close?: unknown }).close === 'function') (handle as { close: () => void }).close();
      }),
  });
}
