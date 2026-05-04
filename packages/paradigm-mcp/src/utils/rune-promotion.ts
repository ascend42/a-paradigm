import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type PromotionState = 'pending' | 'snoozed' | 'opted-in' | 'never';
export type PromotionResponse = 'minimal' | 'balanced' | 'snooze' | 'never';
export type PromotionSignal =
  | 'symbol-syntax'
  | 'dependency-question'
  | 'auth-question'
  | 'feature-named'
  | 'purpose-mentioned'
  | 'multi-file-session';

const TIER_A: Set<PromotionSignal> = new Set([
  'symbol-syntax',
  'dependency-question',
  'auth-question',
]);

export interface RunePromotionConfig {
  state: PromotionState;
  snoozed_until: string | null;
  snooze_count: number;
  opted_in_level: string | null;
}

const DEFAULT_CONFIG: RunePromotionConfig = {
  state: 'pending',
  snoozed_until: null,
  snooze_count: 0,
  opted_in_level: null,
};

function configPath(rootDir: string): string {
  return path.join(rootDir, '.paradigm', 'config.yaml');
}

export function getRunePromotionState(rootDir: string): RunePromotionConfig {
  const p = configPath(rootDir);
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    const rune = raw?.rune as Record<string, unknown> | undefined;
    const promo = rune?.promotion as Partial<RunePromotionConfig> | undefined;
    return {
      state: (promo?.state as PromotionState) ?? 'pending',
      snoozed_until: (promo?.snoozed_until as string | null) ?? null,
      snooze_count: (promo?.snooze_count as number) ?? 0,
      opted_in_level: (promo?.opted_in_level as string | null) ?? null,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function recordPromotion(rootDir: string, response: PromotionResponse): void {
  const p = configPath(rootDir);
  if (!fs.existsSync(p)) return;
  let raw: Record<string, unknown>;
  try {
    raw = yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return;
  } catch {
    return;
  }

  const rune = ((raw.rune as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const promo = ((rune.promotion as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

  if (response === 'snooze') {
    const until = new Date();
    until.setDate(until.getDate() + 7);
    promo.state = 'snoozed';
    promo.snoozed_until = until.toISOString().slice(0, 10);
    promo.snooze_count = ((promo.snooze_count as number) ?? 0) + 1;
  } else if (response === 'never') {
    promo.state = 'never';
    promo.snoozed_until = null;
  } else {
    promo.state = 'opted-in';
    promo.opted_in_level = response;
    promo.snoozed_until = null;
  }

  rune.promotion = promo;
  raw.rune = rune;
  fs.writeFileSync(p, yaml.dump(raw, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: "'" }), 'utf8');
}

export function shouldPromote(rootDir: string, signals: PromotionSignal[]): boolean {
  const cfg = getRunePromotionState(rootDir);
  if (cfg.state === 'opted-in' || cfg.state === 'never') return false;
  if (cfg.state === 'snoozed' && cfg.snoozed_until) {
    if (new Date() < new Date(cfg.snoozed_until)) return false;
  }
  const tierAHit = signals.some(s => TIER_A.has(s));
  if (tierAHit) return true;
  return signals.filter(s => !TIER_A.has(s)).length >= 2;
}

export function buildAskText(): string {
  return [
    '## Symbol Tracking Available',
    '',
    "Paradigm's symbol system (#components, $flows, ^gates, !signals, ~aspects) helps document and enforce",
    'architecture across sessions. Enforcement is currently set to **none** — all checks are off.',
    '',
    'Would you like to enable symbol tracking?',
    '',
    '**Options:**',
    '- `minimal` — warnings only, no blocking. Good starting point.',
    '- `balanced` — blocks on missing purpose files, warns on everything else.',
    "- `snooze` — ask me again in 7 days.",
    "- `never` — don't ask again.",
    '',
    'Call `paradigm_compliance_promote` with your choice, or just tell me which you prefer.',
  ].join('\n');
}
