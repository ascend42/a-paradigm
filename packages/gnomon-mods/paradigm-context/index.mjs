// #paradigm-context-mod (Paradigm Context; first-party, mod-abi:v1, no effects
// beyond `read`, egress none). The #ledger-mod stdio loop, minus the feed:
// this mod requires paradigm.read:summary only, so it gets no kernel events.
// Its ONLY input is the host-composed view input: `input.paradigm`, the K1
// paradigm-slice:v1 the KERNEL computed for the focused LIVE session's repo
// (the host joins {focus:{hsid}} server-side, K3). It reads no file and
// never sees a path. Self-contained on purpose: it imports nothing outside
// this folder, so its packageHash (pinned in the kernel's first-party
// allowlist) never depends on a build of the SDK.
import { VIEWS } from './model.mjs';

const ABI = 'mod-abi:v1';
// Echoed at init; the host refuses any other id (a mod-ABI change needs a new build).
const MOD_ABI_ID = 'sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082';

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
      return { block: render(p.input && typeof p.input === 'object' ? p.input : {}, prefs) };
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
    if (typeof msg.method !== 'string') continue; // the mod makes no mod → host requests
    if (msg.method === 'event' || msg.method === 'cancel' || msg.id === undefined) continue;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    try {
      send({ id: msg.id, result: handle(msg.method, params) });
    } catch (e) {
      send({ id: msg.id, error: { code: typeof e.code === 'number' ? e.code : -32000, message: String(e.message) } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
