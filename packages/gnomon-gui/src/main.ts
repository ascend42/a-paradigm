/**
 * @symbol #gui
 *
 * #gui bundle entry (app.js). The launch fragment was already read and
 * cleared by static/boot.js, the first script on the page (§11.2 rule 2).
 * A `#setup=` fragment (#gui-setup, from the #setup-endpoint) runs the
 * setup screens instead of the app; anything else goes to the app.
 */
import { hostSurface, parseSetupFragment } from './core/launch.js';
import { GnomonClient, webSocketTransport } from './core/client.js';
import { SetupFlow } from './setup/route.js';
import { renderSetup, type SDoc, type SEl } from './setup/screens.js';
import { main } from './ui/app.js';

const take = (globalThis as { gnomonTakeLaunch?: () => string }).gnomonTakeLaunch;
const raw = take ? take() : '';
const setup = parseSetupFragment(raw);
if (setup) void setupMain(setup.setupToken, setup.setupPublicKey);
else main(raw);

async function setupMain(setupToken: string, setupPublicKey: string): Promise<void> {
  const shell = document.getElementById('gnomon');
  if (shell) shell.hidden = true;
  const root = document.createElement('div');
  root.id = 'setup';
  root.className = 'setup';
  document.body.appendChild(root);
  const doc = document as unknown as SDoc;
  const endpointPath = `ws://${location.host}/rpc`;
  let transport;
  try {
    transport = await webSocketTransport(endpointPath);
  } catch {
    // never a blank page: say what happened and where to go next (textContent only)
    const h = document.createElement('h1');
    h.textContent = 'Gnomon setup could not connect';
    const p = document.createElement('p');
    p.textContent = 'This page could not reach the setup service on this Mac. It may have stopped or the link may have expired. Go back to the terminal (or reopen Gnomon) for a fresh link.';
    root.append(h, p);
    return;
  }
  const client = new GnomonClient(transport, { callTimeoutMs: 0 });
  const flow: SetupFlow = new SetupFlow(client, hostSurface(), (s) => renderSetup(doc, root as unknown as SEl, s, flow));
  renderSetup(doc, root as unknown as SEl, flow.state, flow);
  await flow.connect({ setupToken, setupPublicKey, endpointPath, subtle: globalThis.crypto?.subtle });
}
