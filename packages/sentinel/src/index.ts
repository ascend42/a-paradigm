/**
 * Sentinel
 *
 * Semantic error monitoring — errors that speak your language.
 * Maps runtime errors back to symbolic intent for faster triage.
 *
 * @packageDocumentation
 */

// SDK
export { Sentinel, FlowTracker } from './sdk.js';

// Client SDK
export { SentinelClient, createSentinelClient, type SentinelClientOptions, type SpanContext } from './client.js';

// Types
export * from './types.js';

// Config
export { loadConfig, writeConfig, loadServerConfig, type SentinelYamlConfig } from './config.js';

// Detection
export { detectSymbols, generateConfig } from './detector.js';

// Storage
export { SentinelStorage } from './storage.js';

// Pattern Matching
export { PatternMatcher } from './matcher.js';

// Incident Grouping
export { IncidentGrouper } from './grouper.js';

// Timeline Builder
export { TimelineBuilder } from './timeline.js';

// Statistics
export { StatsCalculator } from './stats.js';

// Context Enrichment
export { ContextEnricher } from './enricher.js';

// Pattern Suggestions
export { PatternSuggester } from './suggester.js';

// Import/Export
export { PatternImporter } from './importer.js';

// Seed Patterns
export { loadUniversalPatterns, loadParadigmPatterns, loadAllSeedPatterns } from './seeds/loader.js';

// Logger Transport Bridge
export { SentinelTransport, createSentinelTransport, enableSentinel } from './transport.js';

// Practice Events (Habits System)
// Types are exported from ./types.js via `export * from './types.js'`
// Storage methods are on SentinelStorage (recordPracticeEvent, getPracticeEvents, etc.)

// Schema Registry
export { PARADIGM_SCHEMA } from './schema/builtin-paradigm.js';
export { SYMPHONY_SCHEMA } from './schema/builtin-symphony.js';
