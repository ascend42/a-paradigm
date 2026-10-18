// Shared abort/cleanup for the founder-run probes. Cleanups must be
// SYNCHRONOUS (spawnSync, rmSync): they run from SIGINT/SIGTERM handlers and
// from ctx.signal's abort (the run.mjs timeout), newest first, at most once.
const pending = new Set();
const signals = new WeakSet();
let hooked = false;

export function runCleanups() {
  const fns = [...pending].reverse();
  pending.clear();
  for (const f of fns) {
    try {
      f();
    } catch {
      // keep going: every cleanup gets its chance
    }
  }
}

function hook(signal) {
  if (!hooked) {
    hooked = true;
    for (const s of ['SIGINT', 'SIGTERM']) {
      process.once(s, () => {
        process.stderr.write(`\n${s}: running probe cleanups…\n`);
        runCleanups();
        process.exit(130);
      });
    }
  }
  if (signal && !signals.has(signal)) {
    signals.add(signal);
    signal.addEventListener('abort', () => runCleanups(), { once: true });
  }
}

/** Register a synchronous cleanup; returns `done()` which runs it now and unregisters. */
export function onAbort(fn, signal) {
  hook(signal);
  pending.add(fn);
  return () => {
    if (!pending.delete(fn)) return undefined;
    return fn();
  };
}
