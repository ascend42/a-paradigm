/**
 * @a-company/portal-manager
 *
 * Gate testing and validation system
 */

// Gateway system
export { Gateway, checkGateway, validateGateway } from './gateway.js';
export type { GatewayOptions, GatewayTestCase, ValidationResult } from './types.js';

// Test generator
export { generateTests } from './test-generator.js';
export type { TestGeneratorOptions } from './test-generator.js';

// Component tagger
export { scanComponents, generateComponentReport } from './component-tagger.js';
export type { ComponentTaggerOptions } from './component-tagger.js';
export type { ComponentAccessInfo } from './types.js';

// Flow tester
export { testFlow, validateFlowConfig, runFlowTests } from './flow-tester.js';
export type { FlowTestConfig } from './types.js';
