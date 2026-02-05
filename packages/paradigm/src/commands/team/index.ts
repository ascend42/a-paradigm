/**
 * paradigm team - Multi-agent orchestration commands
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import {
  AgentsManifest,
  Handoff,
  TeamState,
} from './types.js';
import {
  loadAgentsManifest,
  saveAgentsManifest,
  loadTeamState,
  saveTeamState,
  saveHandoff,
  loadHandoff,
  getPendingHandoffs,
  listHandoffs,
  generateDefaultManifest,
  agentsConfigured,
  getAgentsPath,
  setCurrentAgent,
  clearCurrentAgent,
  addActivity,
  getAgent,
  getParadigmDir,
} from './loader.js';
import { BackgroundOrchestrator } from '../../core/background-orchestrator.js';

interface InitOptions {
  force?: boolean;
  json?: boolean;
}

interface StatusOptions {
  json?: boolean;
  /** Show only running orchestrations */
  running?: boolean;
  /** Show specific orchestration ID */
  id?: string;
}

interface HandoffOptions {
  to: string;
  summary?: string;
  json?: boolean;
}

interface AcceptOptions {
  note?: string;
  json?: boolean;
}

interface CheckOptions {
  json?: boolean;
}

/**
 * paradigm team init - Initialize team configuration
 */
export async function teamInitCommand(targetPath: string | undefined, options: InitOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const projectName = path.basename(rootDir);
  const agentsPath = getAgentsPath(rootDir);
  
  if (!options.json) {
    console.log(chalk.blue('\n👥 Initialize Paradigm Team\n'));
  }
  
  // Check if already exists
  if (agentsConfigured(rootDir) && !options.force) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team already configured', path: agentsPath }));
    } else {
      console.log(chalk.yellow(`Team already configured at ${agentsPath}`));
      console.log(chalk.gray('Use --force to reinitialize.\n'));
    }
    return;
  }
  
  // Generate default manifest
  const manifest = generateDefaultManifest(projectName);
  
  // Save it
  saveAgentsManifest(rootDir, manifest);
  
  // Initialize empty team state
  const state: TeamState = {
    current: null,
    queue: [],
    recent: [],
    blocked: [],
  };
  saveTeamState(rootDir, state);
  
  if (options.json) {
    console.log(JSON.stringify({ 
      success: true, 
      path: agentsPath,
      agents: Object.keys(manifest.agents),
    }));
    return;
  }
  
  console.log(chalk.green('✓ Team configuration created\n'));
  console.log(chalk.gray(`  ${agentsPath}\n`));
  
  console.log(chalk.cyan('Available agents:'));
  for (const [name, agent] of Object.entries(manifest.agents)) {
    console.log(`  ${chalk.yellow(name.padEnd(12))} ${agent.role.split('\n')[0]}`);
  }
  
  console.log(chalk.cyan('\nNext steps:'));
  console.log(chalk.gray('  1. Review .paradigm/agents.yaml and customize roles'));
  console.log(chalk.gray('  2. Run `paradigm team status` to see team state'));
  console.log(chalk.gray('  3. Start a task with any agent (AI will auto-detect)'));
  console.log(chalk.gray('  4. Use `paradigm team handoff --to <agent>` to hand off work\n'));
}

/**
 * paradigm team status - Show current team status
 */
export async function teamStatusCommand(targetPath: string | undefined, options: StatusOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  // Check for specific orchestration ID
  if (options.id) {
    return showOrchestrationStatus(rootDir, options.id, options);
  }

  // Check for --running flag (show active orchestrations)
  if (options.running) {
    return showRunningOrchestrations(rootDir, options);
  }

  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }

  const state = loadTeamState(rootDir);
  const pending = getPendingHandoffs(rootDir);

  // Also check for running orchestrations
  const bgOrchestrator = new BackgroundOrchestrator(rootDir);
  const running = bgOrchestrator.getRunning();

  if (options.json) {
    console.log(JSON.stringify({
      team: manifest.team,
      agents: Object.keys(manifest.agents),
      current: state.current,
      queue: state.queue,
      pending_handoffs: pending.length,
      running_orchestrations: running.length,
      recent: state.recent.slice(0, 5),
    }, null, 2));
    return;
  }

  console.log(chalk.blue('\n👥 Paradigm Team Status\n'));
  console.log(chalk.gray('─'.repeat(50)));

  // Team info
  console.log(chalk.white(`Team: ${manifest.team.name}`));
  console.log(chalk.gray(`Agents: ${Object.keys(manifest.agents).join(', ')}`));
  console.log();

  // Running orchestrations
  if (running.length > 0) {
    console.log(chalk.cyan('Running Orchestrations:'));
    for (const orch of running) {
      const elapsed = orch.started
        ? Math.floor((Date.now() - new Date(orch.started).getTime()) / 60000)
        : 0;
      console.log(`  ${chalk.yellow('▶')} ${orch.id}`);
      console.log(chalk.gray(`    ${orch.task.slice(0, 40)}${orch.task.length > 40 ? '...' : ''}`));
      console.log(chalk.gray(`    Running for ${elapsed}m | Mode: ${orch.mode}`));
    }
    console.log(chalk.gray(`\n  Use --running to see details, or \`tail -f <output_file>\` for logs`));
    console.log();
  }

  // Current agent
  if (state.current) {
    const elapsed = Date.now() - new Date(state.current.started).getTime();
    const mins = Math.floor(elapsed / 60000);
    console.log(chalk.cyan('Current Agent:'));
    console.log(`  ${chalk.yellow(state.current.agent.toUpperCase())} - ${state.current.task}`);
    console.log(chalk.gray(`  Started ${mins}m ago`));
    if (state.current.symbols_touched.length > 0) {
      console.log(chalk.gray(`  Touched: ${state.current.symbols_touched.join(', ')}`));
    }
    console.log();
  } else {
    console.log(chalk.cyan('Current Agent:'));
    console.log(chalk.gray('  No active agent'));
    console.log();
  }

  // Pending handoffs
  if (pending.length > 0) {
    console.log(chalk.cyan('Pending Handoffs:'));
    for (const h of pending) {
      console.log(`  ${chalk.yellow(h.from)} → ${chalk.green(h.to)}: ${h.context.summary.substring(0, 50)}...`);
    }
    console.log(chalk.gray(`\n  Run \`paradigm team accept\` to accept a handoff`));
    console.log();
  }

  // Queue
  if (state.queue.length > 0) {
    console.log(chalk.cyan('Queue:'));
    for (const q of state.queue) {
      console.log(`  ${chalk.yellow(q.agent)} waiting for ${q.waiting_for}: ${q.task}`);
    }
    console.log();
  }

  // Blocked
  if (state.blocked.length > 0) {
    console.log(chalk.red('Blocked:'));
    for (const b of state.blocked) {
      console.log(`  ${chalk.yellow(b.agent)}: ${b.reason}`);
    }
    console.log();
  }

  // Recent activity
  if (state.recent.length > 0) {
    console.log(chalk.cyan('Recent Activity:'));
    for (const a of state.recent.slice(0, 5)) {
      const time = new Date(a.timestamp).toLocaleTimeString();
      const status = a.result === 'success' ? chalk.green('✓') :
                     a.result === 'failed' ? chalk.red('✗') :
                     a.result === 'blocked' ? chalk.yellow('⊘') : chalk.gray('○');
      const handoff = a.handed_to ? ` → ${a.handed_to}` : '';
      console.log(`  ${status} ${time} ${chalk.gray(a.agent)}: ${a.task}${handoff}`);
    }
    console.log();
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray('Commands: team status | team status --running | team diff <id> | team accept <id>'));
  console.log();
}

/**
 * Show running orchestrations in detail
 */
async function showRunningOrchestrations(rootDir: string, options: StatusOptions): Promise<void> {
  const bgOrchestrator = new BackgroundOrchestrator(rootDir);
  const running = bgOrchestrator.listOrchestrations({ status: ['running', 'pending'] });
  const completed = bgOrchestrator.listOrchestrations({ status: 'completed', limit: 5 });

  if (options.json) {
    console.log(JSON.stringify({
      running,
      recently_completed: completed,
    }, null, 2));
    return;
  }

  console.log(chalk.blue('\n🔄 Running Orchestrations\n'));
  console.log(chalk.gray('─'.repeat(60)));

  if (running.length === 0) {
    console.log(chalk.gray('  No orchestrations currently running.'));
    console.log();
  } else {
    for (const orch of running) {
      const elapsed = orch.started
        ? Math.floor((Date.now() - new Date(orch.started).getTime()) / 60000)
        : 0;
      const statusIcon = orch.status === 'running' ? chalk.yellow('▶') : chalk.gray('○');

      console.log(`  ${statusIcon} ${chalk.cyan(orch.id)}`);
      console.log(chalk.white(`    Task: ${orch.task.slice(0, 50)}${orch.task.length > 50 ? '...' : ''}`));
      console.log(chalk.gray(`    Status: ${orch.status} | Mode: ${orch.mode} | Duration: ${elapsed}m`));
      console.log(chalk.gray(`    Output: ${orch.outputFile}`));
      console.log();
    }
  }

  if (completed.length > 0) {
    console.log(chalk.cyan('Recently Completed:'));
    for (const orch of completed) {
      const statusIcon = orch.status === 'completed' ? chalk.green('✓') :
                         orch.status === 'failed' ? chalk.red('✗') :
                         orch.status === 'accepted' ? chalk.green('✓✓') :
                         chalk.gray('○');
      console.log(`  ${statusIcon} ${orch.id} - ${orch.task.slice(0, 40)}${orch.task.length > 40 ? '...' : ''}`);
    }
    console.log();
  }

  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('Commands: team status <id> | team diff <id> | team accept <id>'));
  console.log();
}

/**
 * Show specific orchestration status
 */
async function showOrchestrationStatus(rootDir: string, id: string, options: StatusOptions): Promise<void> {
  const bgOrchestrator = new BackgroundOrchestrator(rootDir);
  const orch = bgOrchestrator.getOrchestration(id);

  if (!orch) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Orchestration not found', id }));
    } else {
      console.log(chalk.red(`\nOrchestration not found: ${id}\n`));
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(orch, null, 2));
    return;
  }

  const statusIcon = orch.status === 'running' ? chalk.yellow('▶') :
                     orch.status === 'completed' ? chalk.green('✓') :
                     orch.status === 'failed' ? chalk.red('✗') :
                     orch.status === 'accepted' ? chalk.green('✓✓') :
                     orch.status === 'rejected' ? chalk.red('✗✗') :
                     chalk.gray('○');

  console.log();
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue(`  Orchestration: ${orch.id}`));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();
  console.log(`  Status: ${statusIcon} ${orch.status}`);
  console.log(chalk.gray(`  Task: ${orch.task}`));
  console.log(chalk.gray(`  Mode: ${orch.mode}`));
  console.log(chalk.gray(`  Created: ${orch.created}`));
  if (orch.started) {
    console.log(chalk.gray(`  Started: ${orch.started}`));
  }
  if (orch.completed) {
    console.log(chalk.gray(`  Completed: ${orch.completed}`));
  }
  console.log();

  if (orch.parallelBuilderStats) {
    console.log(chalk.cyan('  Parallel Builders:'));
    console.log(chalk.gray(`    Used file plan: ${orch.parallelBuilderStats.usedFilePlan ? 'Yes' : 'No'}`));
    console.log(chalk.gray(`    Sub-phases: ${orch.parallelBuilderStats.totalSubPhases}`));
    console.log(chalk.gray(`    Parallel builders: ${orch.parallelBuilderStats.totalParallelBuilders}`));
    console.log(chalk.gray(`    Files created: ${orch.parallelBuilderStats.filesCreated}`));
    console.log();
  }

  if (orch.artifacts.length > 0) {
    console.log(chalk.cyan('  Artifacts:'));
    for (const artifact of orch.artifacts) {
      const icon = artifact.action === 'created' ? chalk.green('+') :
                   artifact.action === 'modified' ? chalk.yellow('~') :
                   chalk.red('-');
      console.log(`    ${icon} ${artifact.path}`);
    }
    console.log();
  }

  if (orch.result) {
    console.log(chalk.cyan('  Result:'));
    console.log(chalk.gray(`    Agents spawned: ${orch.result.agentsSpawned}`));
    console.log(chalk.gray(`    Total tokens: ${orch.result.totalTokens.total}`));
    console.log(chalk.gray(`    Total cost: $${orch.result.totalCost.toFixed(4)}`));
    console.log(chalk.gray(`    Duration: ${(orch.result.duration_ms / 1000).toFixed(1)}s`));
    console.log();
  }

  if (orch.error) {
    console.log(chalk.red(`  Error: ${orch.error}`));
    console.log();
  }

  console.log(chalk.gray(`  Output file: ${orch.outputFile}`));
  console.log();

  if (orch.status === 'completed') {
    console.log(chalk.cyan('  Actions:'));
    console.log(chalk.gray(`    paradigm team diff ${orch.id}    # View changes`));
    console.log(chalk.gray(`    paradigm team accept ${orch.id}  # Accept changes`));
    console.log(chalk.gray(`    paradigm team reject ${orch.id}  # Reject changes`));
    console.log();
  }
}

/**
 * paradigm team handoff - Hand off current task to another agent
 */
export async function teamHandoffCommand(targetPath: string | undefined, options: HandoffOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }
  
  const state = loadTeamState(rootDir);
  
  // Validate target agent
  if (!manifest.agents[options.to]) {
    if (options.json) {
      console.log(JSON.stringify({ 
        error: 'Unknown agent', 
        agent: options.to,
        available: Object.keys(manifest.agents),
      }));
    } else {
      console.log(chalk.red(`\nUnknown agent: ${options.to}`));
      console.log(chalk.gray(`Available agents: ${Object.keys(manifest.agents).join(', ')}\n`));
    }
    return;
  }
  
  // Determine current agent
  const fromAgent = state.current?.agent || manifest.team.default_agent;
  
  // Generate handoff ID
  const handoffId = `${Date.now()}-${fromAgent}-${options.to}`;
  
  // Create handoff
  const handoff: Handoff = {
    id: handoffId,
    from: fromAgent,
    to: options.to,
    timestamp: new Date().toISOString(),
    status: 'pending',
    completed: {
      symbols: state.current?.symbols_touched || [],
      artifacts: [],
    },
    context: {
      summary: options.summary || `Task handed off from ${fromAgent} to ${options.to}`,
      key_symbols: [],
      warnings: [],
    },
  };
  
  // Save handoff
  saveHandoff(rootDir, handoff);
  
  // Update state
  addActivity(rootDir, {
    agent: fromAgent,
    task: state.current?.task || 'Unknown task',
    result: 'success',
    handed_to: options.to,
  });
  
  clearCurrentAgent(rootDir);
  
  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      handoff_id: handoffId,
      from: fromAgent,
      to: options.to,
    }));
    return;
  }
  
  console.log(chalk.blue('\n✋ Handoff Created\n'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  From: ${chalk.yellow(fromAgent)}`);
  console.log(`  To:   ${chalk.green(options.to)}`);
  console.log(`  ID:   ${chalk.gray(handoffId)}`);
  console.log(chalk.gray('─'.repeat(50)));
  
  // Show target agent role
  const targetAgent = manifest.agents[options.to];
  console.log(chalk.cyan('\nTarget agent role:'));
  for (const line of targetAgent.role.split('\n')) {
    console.log(chalk.gray(`  ${line}`));
  }
  
  console.log(chalk.cyan('\nNext steps:'));
  console.log(chalk.gray(`  1. The ${options.to} agent will see this handoff`));
  console.log(chalk.gray(`  2. Run \`paradigm team accept\` as ${options.to} to accept`));
  console.log();
}

/**
 * paradigm team accept - Accept a pending handoff
 */
export async function teamAcceptCommand(handoffId: string | undefined, targetPath: string | undefined, options: AcceptOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }
  
  // Get pending handoffs
  const pending = getPendingHandoffs(rootDir);
  
  if (pending.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No pending handoffs' }));
    } else {
      console.log(chalk.yellow('\nNo pending handoffs to accept.\n'));
    }
    return;
  }
  
  // Select handoff
  let handoff: Handoff | undefined;
  if (handoffId) {
    handoff = pending.find(h => h.id === handoffId);
    if (!handoff) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'Handoff not found', id: handoffId }));
      } else {
        console.log(chalk.red(`\nHandoff not found: ${handoffId}\n`));
      }
      return;
    }
  } else {
    // Take the most recent pending handoff
    handoff = pending[0];
  }
  
  // Accept the handoff
  handoff.status = 'accepted';
  handoff.accepted_at = new Date().toISOString();
  handoff.acceptance_note = options.note;
  
  saveHandoff(rootDir, handoff);
  
  // Set current agent
  setCurrentAgent(rootDir, handoff.to, `Accepted from ${handoff.from}: ${handoff.context.summary}`);
  
  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      handoff_id: handoff.id,
      agent: handoff.to,
      from: handoff.from,
      context: handoff.context,
    }));
    return;
  }
  
  console.log(chalk.blue('\n✓ Handoff Accepted\n'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  You are now: ${chalk.green(handoff.to.toUpperCase())}`);
  console.log(`  From:        ${chalk.yellow(handoff.from)}`);
  console.log(chalk.gray('─'.repeat(50)));
  
  // Show context
  console.log(chalk.cyan('\nContext from previous agent:'));
  console.log(chalk.white(`  ${handoff.context.summary}`));
  
  if (handoff.completed.symbols.length > 0) {
    console.log(chalk.cyan('\nSymbols touched:'));
    for (const sym of handoff.completed.symbols) {
      console.log(chalk.gray(`  • ${sym}`));
    }
  }
  
  if (handoff.context.warnings.length > 0) {
    console.log(chalk.yellow('\nWarnings:'));
    for (const warn of handoff.context.warnings) {
      console.log(chalk.yellow(`  ⚠ ${warn}`));
    }
  }
  
  // Show agent role
  const agent = manifest.agents[handoff.to];
  console.log(chalk.cyan('\nYour role:'));
  for (const line of agent.role.split('\n')) {
    console.log(chalk.gray(`  ${line}`));
  }
  
  console.log();
}

/**
 * paradigm team check - Check for conflicts and issues
 */
export async function teamCheckCommand(targetPath: string | undefined, options: CheckOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }
  
  const state = loadTeamState(rootDir);
  const pending = getPendingHandoffs(rootDir);
  const issues: Array<{ type: string; message: string; severity: 'error' | 'warning' }> = [];
  
  // Check for stale handoffs (> 24h)
  for (const h of pending) {
    const age = Date.now() - new Date(h.timestamp).getTime();
    const hours = Math.floor(age / 3600000);
    if (hours > 24) {
      issues.push({
        type: 'stale_handoff',
        message: `Handoff from ${h.from} to ${h.to} pending for ${hours}h`,
        severity: 'warning',
      });
    }
  }
  
  // Check for blocked agents
  for (const b of state.blocked) {
    issues.push({
      type: 'blocked_agent',
      message: `${b.agent} blocked: ${b.reason}`,
      severity: 'error',
    });
  }
  
  // Check for long-running current task (> 8h)
  if (state.current) {
    const elapsed = Date.now() - new Date(state.current.started).getTime();
    const hours = Math.floor(elapsed / 3600000);
    if (hours > 8) {
      issues.push({
        type: 'long_task',
        message: `Current task running for ${hours}h - consider handing off`,
        severity: 'warning',
      });
    }
  }
  
  // Check for missing handoff paths
  for (const [name, agent] of Object.entries(manifest.agents)) {
    for (const target of agent.handoff_to) {
      if (!manifest.agents[target]) {
        issues.push({
          type: 'invalid_handoff',
          message: `${name} can handoff to unknown agent: ${target}`,
          severity: 'error',
        });
      }
    }
  }
  
  if (options.json) {
    console.log(JSON.stringify({
      issues,
      current: state.current,
      pending_count: pending.length,
    }, null, 2));
    return;
  }
  
  console.log(chalk.blue('\n🔍 Team Health Check\n'));
  console.log(chalk.gray('─'.repeat(50)));
  
  if (issues.length === 0) {
    console.log(chalk.green('✓ No issues found\n'));
  } else {
    console.log(chalk.yellow(`Found ${issues.length} issue(s):\n`));
    
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
      console.log(`  ${icon} ${issue.message}`);
    }
    console.log();
  }
  
  // Summary
  console.log(chalk.cyan('Status:'));
  console.log(`  Current agent: ${state.current ? chalk.green(state.current.agent) : chalk.gray('none')}`);
  console.log(`  Pending handoffs: ${pending.length}`);
  console.log(`  Blocked agents: ${state.blocked.length}`);
  console.log();
}

interface HistoryOptions {
  limit?: number;
  json?: boolean;
}

/**
 * paradigm team history - Show full activity log
 */
export async function teamHistoryCommand(targetPath: string | undefined, options: HistoryOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }
  
  const state = loadTeamState(rootDir);
  const handoffs = listHandoffs(rootDir);
  const limit = options.limit || 50;
  
  // Combine activities and handoffs into timeline
  const timeline: Array<{
    timestamp: string;
    type: 'activity' | 'handoff';
    agent: string;
    description: string;
    details?: Record<string, unknown>;
  }> = [];
  
  // Add activities
  for (const activity of state.recent) {
    timeline.push({
      timestamp: activity.timestamp,
      type: 'activity',
      agent: activity.agent,
      description: activity.task,
      details: {
        result: activity.result,
        handed_to: activity.handed_to,
        artifacts: activity.artifacts,
      },
    });
  }
  
  // Add handoffs
  for (const handoff of handoffs) {
    timeline.push({
      timestamp: handoff.timestamp,
      type: 'handoff',
      agent: handoff.from,
      description: `Handoff to ${handoff.to}: ${handoff.context.summary}`,
      details: {
        to: handoff.to,
        status: handoff.status,
        symbols: handoff.completed.symbols,
      },
    });
  }
  
  // Sort by timestamp (newest first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  // Limit results
  const limited = timeline.slice(0, limit);
  
  if (options.json) {
    console.log(JSON.stringify({
      total: timeline.length,
      showing: limited.length,
      timeline: limited,
    }, null, 2));
    return;
  }
  
  console.log(chalk.blue('\n📜 Team History\n'));
  console.log(chalk.gray('─'.repeat(60)));
  
  if (limited.length === 0) {
    console.log(chalk.gray('No activity recorded yet.\n'));
    return;
  }
  
  for (const entry of limited) {
    const time = new Date(entry.timestamp).toLocaleString();
    const icon = entry.type === 'handoff' ? '✋' : 
                 (entry.details?.result === 'success' ? '✓' : 
                  entry.details?.result === 'failed' ? '✗' : '○');
    const color = entry.type === 'handoff' ? chalk.cyan :
                  (entry.details?.result === 'success' ? chalk.green :
                   entry.details?.result === 'failed' ? chalk.red : chalk.gray);
    
    console.log(`${color(icon)} ${chalk.gray(time)}`);
    console.log(`  ${chalk.yellow(entry.agent)}: ${entry.description}`);
    
    if (entry.details?.handed_to) {
      console.log(chalk.gray(`  → handed to ${entry.details.handed_to}`));
    }
    if (entry.details?.symbols && (entry.details.symbols as string[]).length > 0) {
      console.log(chalk.gray(`  symbols: ${(entry.details.symbols as string[]).join(', ')}`));
    }
    console.log();
  }
  
  if (timeline.length > limit) {
    console.log(chalk.gray(`Showing ${limit} of ${timeline.length} entries. Use --limit to see more.\n`));
  }
}

interface ResetOptions {
  force?: boolean;
  json?: boolean;
}

/**
 * paradigm team reset - Reset team state for fresh start
 */
export async function teamResetCommand(targetPath: string | undefined, options: ResetOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Team not configured' }));
    } else {
      console.log(chalk.yellow('\nTeam not configured. Run `paradigm team init` first.\n'));
    }
    return;
  }
  
  const state = loadTeamState(rootDir);
  const pending = getPendingHandoffs(rootDir);
  
  // Check for pending work
  if (!options.force && (state.current || pending.length > 0)) {
    if (options.json) {
      console.log(JSON.stringify({
        error: 'Has pending work',
        current: state.current,
        pending_handoffs: pending.length,
      }));
    } else {
      console.log(chalk.yellow('\n⚠ Cannot reset - there is pending work:\n'));
      if (state.current) {
        console.log(`  Current: ${state.current.agent} working on "${state.current.task}"`);
      }
      if (pending.length > 0) {
        console.log(`  Pending handoffs: ${pending.length}`);
      }
      console.log(chalk.gray('\nUse --force to reset anyway.\n'));
    }
    return;
  }
  
  // Reset state
  const newState: TeamState = {
    current: null,
    queue: [],
    recent: [],
    blocked: [],
  };
  
  saveTeamState(rootDir, newState);
  
  // Optionally clear handoffs
  const handoffsDir = path.join(getParadigmDir(rootDir), 'handoffs');
  if (options.force && fs.existsSync(handoffsDir)) {
    const files = fs.readdirSync(handoffsDir);
    for (const file of files) {
      fs.unlinkSync(path.join(handoffsDir, file));
    }
  }
  
  if (options.json) {
    console.log(JSON.stringify({ success: true, cleared_handoffs: options.force }));
    return;
  }
  
  console.log(chalk.green('\n✓ Team state reset\n'));
  console.log(chalk.gray('  Current agent: cleared'));
  console.log(chalk.gray('  Activity log: cleared'));
  console.log(chalk.gray('  Queue: cleared'));
  if (options.force) {
    console.log(chalk.gray('  Handoff files: deleted'));
  }
  console.log(chalk.gray('\nReady for fresh start. Run `paradigm team status` to verify.\n'));
}
