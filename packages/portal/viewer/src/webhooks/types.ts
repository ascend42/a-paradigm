/**
 * Webhook Types
 */

export type WebhookType = 'slack' | 'discord' | 'email' | 'http';
export type WebhookTrigger = 'session-end' | 'gate-fail' | 'flow-complete';

export interface WebhookConfig {
  id: string;
  name: string;
  type: WebhookType;
  url: string;
  enabled: boolean;
  triggers: WebhookTrigger[];
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  customFields?: Record<string, unknown>;
}

export interface WebhooksConfig {
  webhooks: Record<string, Omit<WebhookConfig, 'id'>>;
}

export interface WebhookResult {
  webhookId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  timestamp: string;
}

export interface WebhookPayload {
  type: 'session-report' | 'gate-alert' | 'flow-complete';
  timestamp: string;
  data: unknown;
  customFields: Record<string, unknown>;
}
