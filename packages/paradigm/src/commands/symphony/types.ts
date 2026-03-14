/**
 * Symphony command option interfaces
 */

export interface SymphonySendOptions {
  to?: string;
  thread?: string;
}

export interface SymphonyListOptions {
  json?: boolean;
}

export interface SymphonyThreadsOptions {
  json?: boolean;
}

export interface SymphonyStatusOptions {
  json?: boolean;
}

export interface SymphonyResolveOptions {
  decision?: string;
}

export interface SymphonyServeOptions {
  port?: string;
}

export interface SymphonyRequestOptions {
  from?: string;
  reason?: string;
}

export interface SymphonyApproveOptions {
  redact?: boolean;
}

export interface SymphonyDenyOptions {
  reason?: string;
}

export interface SymphonyJoinOptions {
  remote?: string;
}
