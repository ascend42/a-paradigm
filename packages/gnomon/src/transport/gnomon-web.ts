#!/usr/bin/env node
/**
 * @symbol #web-endpoint
 *
 * gnomon-web — the transport child entry (spec §2.1, §11.2 rule 1b). Spawned
 * by the kernel from its own package under the `transport` sandbox profile
 * (§15.5); talks to the kernel over stdio only (web-child.ts). Takes no
 * arguments beyond `--version`: its configuration is the first stdin record,
 * and no token ever reaches it on argv or env.
 */
import { GNOMON_VERSION } from '../version.js';
import { runWebChild } from './web-child.js';

if (process.argv.includes('--version')) {
  process.stdout.write(`gnomon-web ${GNOMON_VERSION}\n`);
} else {
  runWebChild({ input: process.stdin, output: process.stdout, exit: (code) => process.exit(code) });
}
