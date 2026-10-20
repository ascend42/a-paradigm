/**
 * #neurons-mod (packages/gnomon-mods/neurons, id gnomon.neurons since S0b; TD-2026-10-20-812 slice S2): the Neurons knowledge brain as a
 * first-party Desk mod. Manifest, offers, the MCP override surface, the playbook skill, the offer fixture goldens
 * and the first-party pin (test/desk-mod-helpers.ts). Platform-independent.
 */
import { deskModSuite } from './desk-mod-helpers.js';

deskModSuite({
  name: 'gnomon.neurons',
  dir: 'neurons',
  server: 'gm_gnomon_neurons',
  symbol: '#neurons-mod',
  // registered by a-neurons src/mcp/server.ts
  serverTools: ['neuron_search', 'neuron_get', 'neuron_related', 'neuron_write', 'source_ingest', 'source_note', 'source_frames', 'source_get', 'inbox_list', 'recipe_run', 'artifact_write', 'vault_status'],
  env: ['NEURONS_VAULT'],
  offerFixtures: ['search-the-brain', 'capture-a-learning', 'capture-a-decision'],
  negativeFixtures: ['undeclared-kind'],
  phases: ['diverge', 'synthesize', 'commit'],
  override: { command: '/usr/local/bin/node', args: ['/opt/neurons/dist/cli/main.js', 'mcp'], env: { NEURONS_VAULT: '/opt/neurons-vault' } },
});
