/**
 * #constellation-mod (packages/gnomon-mods/constellation, TD-2026-10-20-812 slice S2): the Constellation idea map as
 * a first-party Desk mod. Manifest, offers, the MCP override surface, the playbook skill, the offer fixture goldens
 * and the first-party pin (test/desk-mod-helpers.ts). Platform-independent.
 */
import { deskModSuite } from './desk-mod-helpers.js';

deskModSuite({
  name: 'constellation',
  dir: 'constellation',
  server: 'gnomon-constellation',
  symbol: '#constellation-mod',
  // registered by a-constellation mcp/server.ts
  serverTools: ['start', 'status', 'get', 'wait', 'apply', 'done', 'reply', 'say', 'summary', 'summarize', 'list_spaces', 'list_sessions', 'open', 'automation_list', 'automation_save', 'automation_run', 'automation_enable', 'run_get', 'follow', 'tasks', 'search'],
  env: ['CONSTELLATION_NO_AUTOSTART'],
  offerFixtures: ['map-the-idea', 'summarize-the-session'],
  phases: ['diverge', 'synthesize'],
  negativeFixtures: ['two-blocks'],
  override: { command: '/usr/local/bin/node', args: ['/opt/constellation/mcp/server.ts'], env: {} },
});
