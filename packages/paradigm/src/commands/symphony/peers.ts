/**
 * Symphony Peers CLI Commands — Manage trusted remote peers
 *
 * Commands: peers (list), peers revoke <id>, peers forget
 */

import chalk from 'chalk';
import {
  loadPeers,
  revokePeer,
  forgetAllPeers,
  type PeerRecord,
} from '../../../../paradigm-mcp/src/utils/symphony-peers.js';
import type {
  SymphonyPeersOptions,
  SymphonyPeersForgetOptions,
} from './types.js';

// ────────────────────────────────────────────────────────
// symphony peers (list)
// ────────────────────────────────────────────────────────

export async function symphonyPeersCommand(options: SymphonyPeersOptions): Promise<void> {
  const peers = loadPeers();

  if (options.json) {
    console.log(JSON.stringify(peers, null, 2));
    return;
  }

  if (peers.length === 0) {
    console.log(chalk.yellow('No trusted peers. Run "paradigm symphony serve" to accept connections.'));
    return;
  }

  console.log(chalk.cyan(`\n  Trusted Peers (${peers.length})\n`));
  console.log(chalk.gray(`  ${'PEER ID'.padEnd(20)} ${'ADDRESS'.padEnd(22)} ${'STATUS'.padEnd(10)} ${'AGENTS'.padEnd(8)} LAST SEEN`));
  console.log(chalk.gray(`  ${'\u2500'.repeat(20)} ${'\u2500'.repeat(22)} ${'\u2500'.repeat(10)} ${'\u2500'.repeat(8)} ${'\u2500'.repeat(20)}`));

  for (const peer of peers) {
    const status = peer.revoked ? chalk.red('revoked') : chalk.green('trusted');
    const agentCount = (peer.agents || []).length.toString();
    const lastSeen = peer.lastSeen ? formatRelativeTime(peer.lastSeen) : chalk.gray('never');

    console.log(`  ${chalk.white(peer.id.padEnd(20))} ${peer.address.padEnd(22)} ${status.padEnd(10)} ${agentCount.padEnd(8)} ${lastSeen}`);

    // Show agents
    if (peer.agents && peer.agents.length > 0) {
      for (const agent of peer.agents) {
        const agentStatus = agent.status === 'awake' ? chalk.green('awake') : chalk.yellow('asleep');
        console.log(chalk.gray(`    \u2514 ${agent.id} [${agentStatus}]`));
      }
    }
  }
  console.log();
}

// ────────────────────────────────────────────────────────
// symphony peers revoke <id>
// ────────────────────────────────────────────────────────

export async function symphonyPeersRevokeCommand(peerId: string): Promise<void> {
  const success = revokePeer(peerId);

  if (success) {
    console.log(chalk.green(`\u2713 Revoked peer ${chalk.bold(peerId)}`));
    console.log(chalk.gray('  Peer will be disconnected and cannot reconnect until re-paired.'));
  } else {
    console.log(chalk.red(`Peer "${peerId}" not found.`));
    const peers = loadPeers();
    if (peers.length > 0) {
      console.log(chalk.gray('\n  Available peers:'));
      for (const p of peers) {
        console.log(chalk.gray(`    ${p.id} (${p.address})`));
      }
    }
  }
}

// ────────────────────────────────────────────────────────
// symphony peers forget
// ────────────────────────────────────────────────────────

export async function symphonyPeersForgetCommand(options: SymphonyPeersForgetOptions): Promise<void> {
  const peers = loadPeers();

  if (peers.length === 0) {
    console.log(chalk.yellow('No peers to forget.'));
    return;
  }

  if (!options.force) {
    console.log(chalk.yellow(`This will remove all ${peers.length} trusted peer(s). Use --force to confirm.`));
    return;
  }

  const count = forgetAllPeers();
  console.log(chalk.green(`\u2713 Forgot ${count} peer${count !== 1 ? 's' : ''}`));
  console.log(chalk.gray('  All peer trust records deleted. Re-pairing required for remote connections.'));
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
