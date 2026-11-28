// #ledger-mod (the context and budget meter; first-party, mod-abi:v1, no
// effects beyond `read`). The #workshop-mod stdio loop, verbatim but for its
// two views. Runs under #mod-host from its pinned snapshot. Self-contained on
// purpose: it imports nothing outside this folder, so its packageHash (pinned
// in the kernel's first-party allowlist) never depends on a build of the SDK.
// State comes ONLY from the host's projected kernel-event feed (`event`
// notifications, granted by `log.read`); a fixture render (host-initiated, no
// relayedFor) may replay `input.fixtureEvents` — a relayed render never can.
import { apply, emptyState, VIEWS } from './model.mjs';

const ABI = 'mod-abi:v1';
// Echoed at init; the host refuses any other id (a mod-ABI change needs a new Ledger build).
const MOD_ABI_ID = 'sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082';
const MAX_FIXTURE_EVENTS = 1024;

const live = emptyState();
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

function handle(method, p) {
  switch (method) {
    case 'init':
      if (p.abi !== ABI) throw Object.assign(new Error(`unsupported abi ${String(p.abi)}`), { code: -32602 });
      return { abi: ABI, features: [], modAbiId: MOD_ABI_ID };
    case 'health':
      return { ok: true, abi: ABI };
    case 'shutdown':
      setImmediate(() => process.exit(0));
      return {};
    case 'view.render': {
      const render = Object.hasOwn(VIEWS, p.viewId) ? VIEWS[p.viewId] : null;
      if (!render) throw Object.assign(new Error(`no view ${String(p.viewId)}`), { code: -32601 });
      const prefs = p.prefs && typeof p.prefs === 'object' ? p.prefs : {};
      const fx = !p.relayedFor && p.input && Array.isArray(p.input.fixtureEvents) ? p.input.fixtureEvents.slice(0, MAX_FIXTURE_EVENTS) : null;
      let state = live;
      if (fx) {
        state = emptyState();
        for (const e of fx) apply(state, e);
      }
      // a relayed input may name the focused session (display only); it never carries events
      const input = p.input && typeof p.input === 'object' && typeof p.input.hsid === 'string' ? { hsid: p.input.hsid } : {};
      return { block: render(state, prefs, input) };
    }
    default:
      throw Object.assign(new Error(`unknown method ${method}`), { code: -32601 });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof msg.method !== 'string') continue; // the Ledger makes no mod → host requests
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    if (msg.method === 'event') {
      apply(live, params.event);
      continue;
    }
    if (msg.method === 'cancel' || msg.id === undefined) continue;
    try {
      send({ id: msg.id, result: handle(msg.method, params) });
    } catch (e) {
      send({ id: msg.id, error: { code: typeof e.code === 'number' ? e.code : -32000, message: String(e.message) } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
