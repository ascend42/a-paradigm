/**
 * @symbol #budget-fuse
 * @symbol ^subscription-only
 *
 * Law 7 inside the broker (spec §3.4 "Law 7 inside the broker", §10 law 7,
 * D35, S22-H2/H3). `permit.reserve{kind: session.spawn | turn}` for
 * `backend: claude-code` is refused BILLING_REFUSED when the scan finds an
 * API-billing path in the env the child would get, any settings layer's `env`
 * block or `apiKeyHelper`, an `mcp.json` server env block, or any
 * `*_BASE_URL` (a loopback override included — the former local-endpoint
 * probe case, D37). The scan reports WHERE and WHICH KEY, never a value.
 *
 * Unreadable or corrupt layers are hits (fail closed, B5). The per-`claude`-
 * version scan list with its managed-policy sources per OS (`G-SUB-01`
 * fixtures) and the mid-session watch (`G-SUB-05`) are M1.7
 * (#claude-adapter): this module takes the layers it is given; it has no
 * platform branch (G-WIN-05).
 */
import * as fs from 'node:fs';

/** Env names that bill API credits (or route Claude elsewhere) — §10 law 7 G-SUB-01 list. */
export const API_BILLING_ENV = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']);
const BASE_URL = /_BASE_URL$/i;

export interface BillingHit {
  where: string;
  key: string;
}

export interface SettingsLayer {
  /** a label: `env`, `user-settings`, `managed:<path>`, `mcp:<path>`, … */
  where: string;
  /** parsed JSON, or `undefined` when the layer exists but could not be read/parsed (a hit) */
  json: unknown;
  kind: 'settings' | 'mcp';
}

export interface BillingScanSource {
  env(): Readonly<Record<string, string | undefined>>;
  layers(): SettingsLayer[];
}

function envHits(where: string, env: unknown): BillingHit[] {
  if (env === null || typeof env !== 'object') return [];
  const out: BillingHit[] = [];
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    if (API_BILLING_ENV.includes(k.toUpperCase()) || BASE_URL.test(k)) out.push({ where, key: k });
  }
  return out;
}

/** Scan the env + layers; empty = subscription-only holds. */
export function scanApiBilling(src: BillingScanSource): BillingHit[] {
  const hits: BillingHit[] = [...envHits('env', src.env())];
  for (const l of src.layers()) {
    if (l.json === undefined) {
      hits.push({ where: l.where, key: '(unreadable)' });
      continue;
    }
    if (l.json === null || typeof l.json !== 'object') {
      hits.push({ where: l.where, key: '(not-an-object)' });
      continue;
    }
    const j = l.json as Record<string, unknown>;
    if (l.kind === 'settings') {
      hits.push(...envHits(l.where, j.env));
      if ('apiKeyHelper' in j && j.apiKeyHelper) hits.push({ where: l.where, key: 'apiKeyHelper' });
    } else {
      const servers = (j.mcpServers ?? {}) as Record<string, unknown>;
      for (const [name, srv] of Object.entries(servers)) {
        if (srv && typeof srv === 'object') hits.push(...envHits(`${l.where}#${name}`, (srv as Record<string, unknown>).env));
      }
    }
  }
  return hits;
}

/** Read JSON layer files: missing ⇒ skipped; present but unreadable/corrupt ⇒ `json: undefined` (a hit). */
export function fileLayers(files: ReadonlyArray<{ where: string; path: string; kind: 'settings' | 'mcp' }>): SettingsLayer[] {
  const out: SettingsLayer[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      out.push({ where: f.where, json: undefined, kind: f.kind });
      continue;
    }
    try {
      out.push({ where: f.where, json: JSON.parse(text) as unknown, kind: f.kind });
    } catch {
      out.push({ where: f.where, json: undefined, kind: f.kind });
    }
  }
  return out;
}
