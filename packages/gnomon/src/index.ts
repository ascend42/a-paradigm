/**
 * @a-company/gnomon — the Paradigm 8.0 kernel (docs/specs/gnomon.md).
 * PR-0 scaffold (research 29 §4): layout, bins, fences; no behaviour yet.
 */
export { GNOMON_VERSION } from './version.js';
export { KERNEL_MODULES, KERNEL_ALLOWED_PACKAGE, type KernelModule } from './kernel/index.js';
export * as kernelLog from './kernel/log/index.js';
export * as manifestLoader from './kernel/manifest/index.js';
