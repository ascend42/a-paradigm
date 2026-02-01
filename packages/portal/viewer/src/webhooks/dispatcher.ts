/**
 * Webhook Dispatcher
 *
 * Sends portal reports to configured webhooks.
 */

import type { WebhookConfig, WebhookResult, WebhookTrigger } from './types.js';
import type { SessionReport } from '../session/types.js';
import { formatSlack, formatDiscord, formatMarkdown } from '../session/reporter.js';

/**
 * Dispatch a report to all matching webhooks
 */
export async function dispatchReport(
  report: SessionReport,
  webhooks: WebhookConfig[],
  trigger: WebhookTrigger
): Promise<WebhookResult[]> {
  const results: WebhookResult[] = [];

  // Filter to enabled webhooks that match the trigger
  const matchingWebhooks = webhooks.filter(
    (w) => w.enabled && w.triggers.includes(trigger)
  );

  // Send to each webhook in parallel
  const promises = matchingWebhooks.map((webhook) =>
    sendToWebhook(webhook, report, trigger)
  );

  const settled = await Promise.allSettled(promises);

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const webhook = matchingWebhooks[i];

    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      results.push({
        webhookId: webhook.id,
        success: false,
        error: result.reason?.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
}

/**
 * Send report to a single webhook
 */
async function sendToWebhook(
  webhook: WebhookConfig,
  report: SessionReport,
  trigger: WebhookTrigger
): Promise<WebhookResult> {
  const timestamp = new Date().toISOString();

  try {
    // Format payload based on webhook type
    const payload = formatPayload(webhook, report, trigger);

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...webhook.headers,
    };

    // Send request
    const response = await fetch(webhook.url, {
      method: webhook.method || 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    return {
      webhookId: webhook.id,
      success: response.ok,
      statusCode: response.status,
      error: response.ok ? undefined : await response.text(),
      timestamp,
    };
  } catch (error) {
    return {
      webhookId: webhook.id,
      success: false,
      error: (error as Error).message,
      timestamp,
    };
  }
}

/**
 * Format payload based on webhook type
 */
function formatPayload(
  webhook: WebhookConfig,
  report: SessionReport,
  trigger: WebhookTrigger
): unknown {
  switch (webhook.type) {
    case 'slack':
      return formatSlack(report);

    case 'discord':
      return formatDiscord(report);

    case 'email':
      return {
        type: trigger,
        subject: `Portal Test Report: ${report.session.name}`,
        body: formatMarkdown(report),
        html: formatEmailHtml(report),
        ...webhook.customFields,
      };

    case 'http':
    default:
      return {
        type: trigger,
        timestamp: new Date().toISOString(),
        report,
        customFields: webhook.customFields || {},
      };
  }
}

/**
 * Format report as HTML email
 */
function formatEmailHtml(report: SessionReport): string {
  const passColor = report.summary.passRate >= 90 ? '#22c55e' : report.summary.passRate >= 50 ? '#f59e0b' : '#ef4444';

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; color: #333; max-width: 600px; margin: 0 auto; }
    h1 { color: #1a1a2e; }
    .summary { background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; }
    .stat-label { font-size: 12px; color: #666; }
    .pass { color: #22c55e; }
    .fail { color: #ef4444; }
    .failures { background: #fef2f2; padding: 16px; border-radius: 8px; margin: 16px 0; }
    .failure-item { margin: 8px 0; padding: 8px; background: white; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>🚪 Portal Test Report</h1>
  <h2>${report.session.name}</h2>
  
  <div class="summary">
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${formatDuration(report.session.duration)}</div>
        <div class="stat-label">Duration</div>
      </div>
      <div class="stat pass">
        <div class="stat-value">${report.summary.gatesPassed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat fail">
        <div class="stat-value">${report.summary.gatesFailed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat" style="color: ${passColor}">
        <div class="stat-value">${report.summary.passRate}%</div>
        <div class="stat-label">Pass Rate</div>
      </div>
    </div>
  </div>
  
  ${report.failures.length > 0 ? `
  <div class="failures">
    <h3>❌ Failures (${report.failures.length})</h3>
    ${report.failures.slice(0, 10).map(f => `
      <div class="failure-item">
        <strong>${f.gate}</strong><br>
        ${f.reason}<br>
        <small>Entity: ${f.entityId}</small>
      </div>
    `).join('')}
    ${report.failures.length > 10 ? `<p><em>+${report.failures.length - 10} more failures</em></p>` : ''}
  </div>
  ` : ''}
  
  <h3>Gate Results</h3>
  <table>
    <tr>
      <th>Gate</th>
      <th>Checks</th>
      <th>Passed</th>
      <th>Failed</th>
      <th>Rate</th>
    </tr>
    ${report.gates.filter(g => g.hitCount > 0).map(g => `
      <tr>
        <td>${g.id}</td>
        <td>${g.hitCount}</td>
        <td class="pass">${g.passCount}</td>
        <td class="fail">${g.failCount}</td>
        <td>${g.passRate}%</td>
      </tr>
    `).join('')}
  </table>
  
  <p style="color: #666; font-size: 12px; margin-top: 32px;">
    Generated by Portal Viewer at ${new Date(report.generatedAt).toLocaleString()}
  </p>
</body>
</html>
  `.trim();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

/**
 * Test a webhook configuration
 */
export async function testWebhook(webhook: WebhookConfig): Promise<WebhookResult> {
  const testReport: SessionReport = {
    id: 'test-report',
    name: 'Test Report',
    generatedAt: new Date().toISOString(),
    format: 'json',
    session: {
      id: 'test-session',
      name: 'Test Session',
      startedAt: new Date(Date.now() - 60000).toISOString(),
      endedAt: new Date().toISOString(),
      duration: 60,
      status: 'completed',
    },
    summary: {
      totalEvents: 10,
      gatesChecked: 5,
      gatesPassed: 4,
      gatesFailed: 1,
      passRate: 80,
      uniqueEntities: 1,
      flowsCompleted: ['test-flow'],
    },
    gates: [
      {
        id: '^test-gate',
        description: 'Test gate',
        hitCount: 5,
        passCount: 4,
        failCount: 1,
        passRate: 80,
        lastDecision: 'allow',
        lastReason: 'Test passed',
      },
    ],
    entities: [
      {
        entityId: 'test-entity',
        firstSeen: new Date(Date.now() - 60000).toISOString(),
        lastSeen: new Date().toISOString(),
        eventCount: 10,
        gatesVisited: ['^test-gate'],
        flowProgress: { 'test-flow': 100 },
      },
    ],
    failures: [
      {
        id: 'test-failure',
        type: 'gate:fail',
        timestamp: new Date().toISOString(),
        entityId: 'test-entity',
        gate: '^test-gate',
        decision: 'deny',
        reason: 'Test failure for webhook verification',
        raw: {} as any,
      },
    ],
  };

  return sendToWebhook(webhook, testReport, 'session-end');
}
