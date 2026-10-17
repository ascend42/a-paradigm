/**
 * @symbol #gnomon-kernel
 *
 * Gnomon kernel (spec §2.1, §3, §18). PR-0 scaffold: no primitives yet.
 *
 * IMPORT FENCE (G-KRN-02, test/fence.test.ts): every import under src/kernel/**
 * is `node:*`, a relative path, or `@a-company/gnomon-contracts`. Nothing else.
 */
import { CONTRACTS_PACKAGE } from '@a-company/gnomon-contracts';

/** The thirteen kernel modules of spec §18, in spec order. */
export const KERNEL_MODULES = [
  'identity',
  'log',
  'runner',
  'supervisor',
  'broker',
  'budget',
  'scheduler',
  'manifest',
  'refs',
  'socket',
  'web',
  'sandbox',
  'modhost',
] as const;
export type KernelModule = (typeof KERNEL_MODULES)[number];

/** The single non-`node:` package the kernel may import (G-KRN-02). */
export const KERNEL_ALLOWED_PACKAGE = CONTRACTS_PACKAGE;
