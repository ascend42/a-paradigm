/**
 * Session Report Generator
 *
 * Generates structured reports from portal sessions in various formats.
 */

import { randomUUID } from 'crypto';
import type { PortalSession, PortalNode } from '../types.js';
import type { SessionReport, GateReport, EntityReport, ReportFormat } from './types.js';

export interface ReporterOptions {
  includeEvents?: boolean;
  maxEvents?: number;
}

/**
 * Generate a session report
 */
export function generateReport(
  session: PortalSession,
  portals: PortalNode[],
  options: ReporterOptions = {}
): SessionReport {
  const { includeEvents = false, maxEvents = 100 } = options;

  const startTime = new Date(session.startedAt).getTime();
  const endTime = session.endedAt
    ? new Date(session.endedAt).getTime()
    : Date.now();
  const duration = Math.floor((endTime - startTime) / 1000);

  const passRate =
    session.gatesChecked > 0
      ? Math.round((session.gatesPassed / session.gatesChecked) * 100)
      : 0;

  // Build gate reports
  const gates: GateReport[] = portals.map((portal) => ({
    id: portal.id,
    description: portal.gate.description,
    hitCount: portal.hitCount,
    passCount: portal.passCount,
    failCount: portal.failCount,
    passRate:
      portal.hitCount > 0
        ? Math.round((portal.passCount / portal.hitCount) * 100)
        : 0,
    lastDecision: portal.lastEvent?.decision,
    lastReason: portal.lastEvent?.reason,
  }));

  // Build entity reports
  const entities: EntityReport[] = Object.values(session.entities).map(
    (journey) => ({
      entityId: journey.entityId,
      firstSeen: journey.firstSeen,
      lastSeen: journey.lastSeen,
      eventCount: journey.events.length,
      gatesVisited: journey.gatesVisited,
      flowProgress: journey.flowProgress,
    })
  );

  // Get failures
  const failures = session.events.filter((e) => e.decision === 'deny');

  const report: SessionReport = {
    id: randomUUID(),
    name: `Report: ${session.name}`,
    generatedAt: new Date().toISOString(),
    format: 'json',

    session: {
      id: session.id,
      name: session.name || 'Unnamed Session',
      startedAt: session.startedAt,
      endedAt: session.endedAt || new Date().toISOString(),
      duration,
      status: session.status,
    },

    summary: {
      totalEvents: session.totalEvents,
      gatesChecked: session.gatesChecked,
      gatesPassed: session.gatesPassed,
      gatesFailed: session.gatesFailed,
      passRate,
      uniqueEntities: Object.keys(session.entities).length,
      flowsCompleted: session.flowsCompleted,
    },

    gates,
    entities,
    failures,
  };

  if (includeEvents) {
    report.events = session.events.slice(0, maxEvents);
  }

  return report;
}

/**
 * Format report as Markdown
 */
export function formatMarkdown(report: SessionReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Portal Test Report: ${report.session.name}`);
  lines.push('');
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push('');

  // Session Info
  lines.push('## Session Info');
  lines.push('');
  lines.push(`- **ID**: ${report.session.id}`);
  lines.push(`- **Started**: ${new Date(report.session.startedAt).toLocaleString()}`);
  lines.push(`- **Duration**: ${formatDuration(report.session.duration)}`);
  lines.push(`- **Status**: ${report.session.status}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Events | ${report.summary.totalEvents} |`);
  lines.push(`| Gates Checked | ${report.summary.gatesChecked} |`);
  lines.push(`| Gates Passed | ${report.summary.gatesPassed} |`);
  lines.push(`| Gates Failed | ${report.summary.gatesFailed} |`);
  lines.push(`| Pass Rate | ${report.summary.passRate}% |`);
  lines.push(`| Unique Entities | ${report.summary.uniqueEntities} |`);
  lines.push('');

  // Flows Completed
  if (report.summary.flowsCompleted.length > 0) {
    lines.push('### Flows Completed');
    lines.push('');
    for (const flow of report.summary.flowsCompleted) {
      lines.push(`- ${flow}`);
    }
    lines.push('');
  }

  // Gate Breakdown
  lines.push('## Gate Results');
  lines.push('');
  lines.push(`| Gate | Checks | Passed | Failed | Pass Rate |`);
  lines.push(`|------|--------|--------|--------|-----------|`);

  for (const gate of report.gates.filter((g) => g.hitCount > 0)) {
    const status = gate.passRate === 100 ? '✅' : gate.passRate === 0 ? '❌' : '⚠️';
    lines.push(
      `| ${status} ${gate.id} | ${gate.hitCount} | ${gate.passCount} | ${gate.failCount} | ${gate.passRate}% |`
    );
  }
  lines.push('');

  // Failures
  if (report.failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const failure of report.failures) {
      lines.push(`### ${failure.gate}`);
      lines.push('');
      lines.push(`- **Reason**: ${failure.reason}`);
      lines.push(`- **Entity**: ${failure.entityId}`);
      lines.push(`- **Time**: ${new Date(failure.timestamp).toLocaleTimeString()}`);
      if (failure.context && Object.keys(failure.context).length > 0) {
        lines.push(`- **Context**: \`${JSON.stringify(failure.context)}\``);
      }
      lines.push('');
    }
  }

  // Entity Journeys
  if (report.entities.length > 0) {
    lines.push('## Entity Journeys');
    lines.push('');
    for (const entity of report.entities) {
      lines.push(`### ${entity.entityId}`);
      lines.push('');
      lines.push(`- Events: ${entity.eventCount}`);
      lines.push(`- Gates visited: ${entity.gatesVisited.join(', ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format report for Slack Block Kit
 */
export function formatSlack(report: SessionReport): object {
  const passEmoji = report.summary.passRate >= 90 ? '✅' : report.summary.passRate >= 50 ? '⚠️' : '❌';

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚪 Portal Test Report: ${report.session.name}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Duration:*\n${formatDuration(report.session.duration)}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${report.session.status}`,
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*✅ Passed:*\n${report.summary.gatesPassed}`,
        },
        {
          type: 'mrkdwn',
          text: `*❌ Failed:*\n${report.summary.gatesFailed}`,
        },
        {
          type: 'mrkdwn',
          text: `*${passEmoji} Pass Rate:*\n${report.summary.passRate}%`,
        },
        {
          type: 'mrkdwn',
          text: `*📊 Total Events:*\n${report.summary.totalEvents}`,
        },
      ],
    },
  ];

  // Add failures if any
  if (report.failures.length > 0) {
    blocks.push({
      type: 'divider',
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Failures (${report.failures.length}):*`,
      },
    } as any);

    for (const failure of report.failures.slice(0, 5)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• \`${failure.gate}\` - ${failure.reason}\n  _Entity: ${failure.entityId}_`,
        },
      } as any);
    }

    if (report.failures.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_+${report.failures.length - 5} more failures_`,
          },
        ],
      } as any);
    }
  }

  // Add flows completed
  if (report.summary.flowsCompleted.length > 0) {
    blocks.push({
      type: 'divider',
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Flows Completed:* ${report.summary.flowsCompleted.join(', ')}`,
      },
    } as any);
  }

  return { blocks };
}

/**
 * Format report for Discord embed
 */
export function formatDiscord(report: SessionReport): object {
  const color =
    report.summary.passRate >= 90
      ? 0x22c55e // green
      : report.summary.passRate >= 50
      ? 0xf59e0b // amber
      : 0xef4444; // red

  const embed = {
    title: `🚪 Portal Test Report: ${report.session.name}`,
    color,
    fields: [
      {
        name: 'Duration',
        value: formatDuration(report.session.duration),
        inline: true,
      },
      {
        name: 'Status',
        value: report.session.status,
        inline: true,
      },
      {
        name: '\u200B',
        value: '\u200B',
        inline: false,
      },
      {
        name: '✅ Passed',
        value: report.summary.gatesPassed.toString(),
        inline: true,
      },
      {
        name: '❌ Failed',
        value: report.summary.gatesFailed.toString(),
        inline: true,
      },
      {
        name: '📊 Pass Rate',
        value: `${report.summary.passRate}%`,
        inline: true,
      },
    ],
    timestamp: report.generatedAt,
  };

  // Add failures
  if (report.failures.length > 0) {
    const failureText = report.failures
      .slice(0, 5)
      .map((f) => `• \`${f.gate}\` - ${f.reason}`)
      .join('\n');

    (embed.fields as any[]).push({
      name: `Failures (${report.failures.length})`,
      value: failureText + (report.failures.length > 5 ? '\n_...and more_' : ''),
      inline: false,
    });
  }

  // Add flows
  if (report.summary.flowsCompleted.length > 0) {
    (embed.fields as any[]).push({
      name: 'Flows Completed',
      value: report.summary.flowsCompleted.join(', '),
      inline: false,
    });
  }

  return { embeds: [embed] };
}

/**
 * Format duration as human readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
