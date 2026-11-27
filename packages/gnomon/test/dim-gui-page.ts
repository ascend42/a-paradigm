/**
 * S1.4 P5: one GUI page on the real kernel's socket for the real-kernel board tests: the launch token, a raw RFC 6455
 * socket carrying the page's Origin, the GUI client, its stores and DimSessions, following the log as ui/app.ts does.
 * Everything it opens is pushed onto `cleanups`.
 */
import { webcrypto } from 'node:crypto';
import { followLog, GnomonClient, type Transport } from '../../gnomon-gui/src/core/client.js';
import { DimSessions } from '../../gnomon-gui/src/core/dim-session.js';
import { DimStore } from '../../gnomon-gui/src/core/dim-store.js';
import { parseLaunchFragment } from '../../gnomon-gui/src/core/launch.js';
import { GuiStore } from '../../gnomon-gui/src/core/store.js';
import type { DevKernel } from '../src/cli/dev-cli.js';
import { GOOD, wsConnect } from './web-helpers.js';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

export async function guiPage(k: DevKernel, cleanups: Array<() => unknown>): Promise<{ client: GnomonClient; sessions: DimSessions; dims: DimStore; sent: string[]; answered: string[] }> {
  const g = await k.launch();
  const frag = parseLaunchFragment(new URL(g.url).hash)!;
  const ws = await wsConnect(g.port, GOOD(g.port));
  cleanups.push(() => ws.end());
  const t: Transport = { send: (x) => ws.sendText(x), close: () => ws.end(), onMessage: null, onClose: null };
  const timer = setInterval(() => {
    for (let i = 0; i < ws.frames.length; ) {
      const f = ws.frames[i]!;
      if (f.op === 0x1) {
        ws.frames.splice(i, 1);
        t.onMessage?.(f.payload.toString('utf8'));
      } else if (f.op === 0x8) {
        clearInterval(timer);
        return t.onClose?.(f.closeCode ?? 1005);
      } else i++;
    }
  }, 2);
  cleanups.push(() => clearInterval(timer));
  const client = new GnomonClient(t);
  const out = await client.connect({ surface: 'browser', endpointPath: `ws://127.0.0.1:${g.port}/rpc`, verifyKey: frag.kernelPublicKey, auth: { launchToken: frag.launchToken }, subtle });
  if (!out.ok) throw new Error(`connect: ${JSON.stringify(out)}`);
  const sent: string[] = [];
  const call = client.call.bind(client);
  /** S1.4 P5 review (Judge M5): every command id whose answer came back, in order (a refusal too) */
  const answered: string[] = [];
  client.call = ((method: string, params?: unknown) => {
    if (method === 'log.read') return call(method, params);
    const key = String((params as { commandId?: string } | undefined)?.commandId ?? method);
    sent.push(key);
    const p = call(method, params);
    void p.then(() => answered.push(key), () => answered.push(key));
    return p;
  }) as typeof client.call;
  const gui = new GuiStore();
  const dims = new DimStore();
  const sessions = new DimSessions({ store: dims });
  const take = (rows: unknown[]): void => (gui.apply(rows), sessions.apply(rows));
  client.onNotification((method, params) => {
    const p = (params ?? {}) as { row?: unknown };
    if (method === 'event' && p.row) take([p.row]);
  });
  await followLog(client, { cursor: () => gui.cursor(), adopt: (id: string) => gui.adopt(id), apply: take, advance: (n: number) => gui.advance(n), reset: () => (gui.reset(), sessions.reset()) } as unknown as GuiStore);
  sessions.connect({ client, principal: out.session.principal, connId: out.session.connId });
  cleanups.push(() => sessions.destroy());
  return { client, sessions, dims, sent, answered };
}

