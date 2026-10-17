#!/usr/bin/env node
/**
 * gnomon-web — the transport child (spec §2.1, §11.2): loopback HTTP + RFC 6455
 * framing over node:http, forwarding records to the kernel over stdio. PR-0
 * placeholder only.
 */
import { runPlaceholderBin } from '../cli/placeholder.js';

process.exitCode = runPlaceholderBin('gnomon-web', process.argv.slice(2));
