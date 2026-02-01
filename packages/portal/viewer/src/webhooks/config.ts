/**
 * Webhook Configuration Loader
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { WebhookConfig, WebhooksConfig } from './types.js';

const CONFIG_FILENAME = 'portal-webhooks.yaml';

/**
 * Load webhook configuration from .paradigm directory
 */
export async function loadWebhookConfig(
  projectDir: string = process.cwd()
): Promise<WebhookConfig[]> {
  const configPath = path.join(projectDir, '.paradigm', CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(content) as WebhooksConfig;

    if (!config || !config.webhooks) {
      return [];
    }

    // Convert to array and inject IDs
    const webhooks: WebhookConfig[] = Object.entries(config.webhooks).map(
      ([id, webhook]) => ({
        id,
        ...webhook,
        // Expand environment variables in URL and headers
        url: expandEnvVars(webhook.url),
        headers: webhook.headers
          ? Object.fromEntries(
              Object.entries(webhook.headers).map(([k, v]) => [
                k,
                expandEnvVars(v),
              ])
            )
          : undefined,
      })
    );

    return webhooks;
  } catch (error) {
    console.error(`Failed to load webhook config from ${configPath}:`, error);
    return [];
  }
}

/**
 * Save webhook configuration
 */
export async function saveWebhookConfig(
  webhooks: WebhookConfig[],
  projectDir: string = process.cwd()
): Promise<void> {
  const configDir = path.join(projectDir, '.paradigm');
  const configPath = path.join(configDir, CONFIG_FILENAME);

  // Ensure .paradigm directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Convert array to record format
  const config: WebhooksConfig = {
    webhooks: Object.fromEntries(
      webhooks.map((webhook) => {
        const { id, ...rest } = webhook;
        return [id, rest];
      })
    ),
  };

  const content = yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });

  fs.writeFileSync(configPath, content, 'utf-8');
}

/**
 * Expand environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

/**
 * Get default webhook configuration template
 */
export function getWebhookTemplate(): string {
  return `# Portal Webhooks Configuration
# 
# Define webhooks to receive portal session reports and alerts.
# Environment variables can be used with \${VAR_NAME} syntax.

webhooks:
  # Example Slack webhook
  # slack-qa:
  #   type: slack
  #   url: https://hooks.slack.com/services/xxx/yyy/zzz
  #   enabled: true
  #   triggers: [session-end, gate-fail]
  #   customFields:
  #     channel: "#qa-alerts"
  
  # Example Discord webhook
  # discord-dev:
  #   type: discord
  #   url: https://discord.com/api/webhooks/xxx/yyy
  #   enabled: true
  #   triggers: [session-end]
  
  # Example custom HTTP endpoint
  # custom-endpoint:
  #   type: http
  #   url: https://api.example.com/portal-reports
  #   method: POST
  #   headers:
  #     Authorization: "Bearer \${API_TOKEN}"
  #     Content-Type: "application/json"
  #   enabled: true
  #   triggers: [session-end]
  #   customFields:
  #     environment: "staging"
`;
}
