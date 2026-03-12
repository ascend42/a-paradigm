/**
 * Mail command option interfaces
 */

export interface MailSendOptions {
  to?: string;
  thread?: string;
}

export interface MailListOptions {
  json?: boolean;
}

export interface MailThreadsOptions {
  json?: boolean;
}

export interface MailStatusOptions {
  json?: boolean;
}

export interface MailResolveOptions {
  decision?: string;
}

export interface MailServeOptions {
  port?: string;
}

export interface MailRequestOptions {
  from?: string;
  reason?: string;
}

export interface MailApproveOptions {
  redact?: boolean;
}

export interface MailDenyOptions {
  reason?: string;
}

export interface MailLinkOptions {
  remote?: string;
}
