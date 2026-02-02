/**
 * Wisdom Types - Team preferences, antipatterns, decisions, expertise
 *
 * The Wisdom system captures the social/cultural dimension of development:
 * what patterns the team prefers, what to avoid, who knows what, and
 * architectural decisions that inform future choices.
 */

/**
 * Symbol-indexed preferences for how to implement features
 */
export interface WisdomPreferences {
  version: string;
  updated: string; // ISO timestamp

  /** Preferences indexed by symbol */
  by_symbol: Record<string, SymbolPreference>;

  /** Global preferences that apply to all code */
  global: GlobalPreference;
}

export interface SymbolPreference {
  /** Preferred patterns for this symbol (what TO do) */
  patterns?: string[];
  /** Testing requirements */
  testing?: string;
  /** Performance considerations */
  performance?: string;
  /** UX guidelines */
  ux?: string;
  /** Notes or context */
  notes?: string;
}

export interface GlobalPreference {
  /** Code style preferences */
  code_style?: string[];
  /** Testing philosophy */
  testing?: string[];
  /** Error handling approach */
  error_handling?: string[];
  /** Naming conventions */
  naming?: string[];
  /** Documentation requirements */
  documentation?: string[];
}

/**
 * Antipatterns - what NOT to do, with reasons
 */
export interface WisdomAntipatterns {
  version: string;
  antipatterns: WisdomAntipattern[];
}

export interface WisdomAntipattern {
  /** Unique identifier */
  id: string;
  /** Symbols this antipattern applies to */
  symbols: string[];
  /** What not to do */
  description: string;
  /** Why it's an antipattern */
  reason: string;
  /** What to do instead */
  alternative: string;
  /** How this lesson was learned (commit, incident, etc.) */
  learned_from?: string;
  /** Date added */
  added?: string;
  /** Who added it */
  added_by?: string;
}

/**
 * Expertise mapping - who knows what symbols/areas
 */
export interface WisdomExpertise {
  version: string;
  experts: ExpertEntry[];
}

export interface ExpertEntry {
  /** Person's name or identifier */
  name: string;
  /** Symbols they have expertise in */
  symbols?: string[];
  /** General areas of expertise */
  areas?: string[];
  /** Contact info (optional) */
  contact?: string;
  /** Notes */
  notes?: string;
}

/**
 * Architectural Decision Record
 */
export interface WisdomDecision {
  /** Unique ID (e.g., "001") */
  id: string;
  /** Decision title */
  title: string;
  /** Status: proposed, accepted, deprecated, superseded */
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  /** Date of decision */
  date: string;
  /** Related symbols */
  symbols: string[];
  /** Context that prompted the decision */
  context: string;
  /** The actual decision made */
  decision: string;
  /** Rationale behind the decision */
  rationale: {
    factors: string[];
    conclusion: string;
  };
  /** Expected consequences */
  consequences: {
    positive: string[];
    negative: string[];
    mitigations?: string[];
  };
  /** If superseded, which decision replaced it */
  superseded_by?: string;
}

/**
 * Complete wisdom context for a project
 */
export interface WisdomContext {
  preferences: WisdomPreferences | null;
  antipatterns: WisdomAntipattern[];
  decisions: WisdomDecision[];
  expertise: WisdomExpertise | null;
}

/**
 * Wisdom for specific symbols (used in MCP responses)
 */
export interface SymbolWisdom {
  symbol: string;
  preferences: SymbolPreference | null;
  antipatterns: WisdomAntipattern[];
  decisions: WisdomDecision[];
  experts: ExpertEntry[];
}
