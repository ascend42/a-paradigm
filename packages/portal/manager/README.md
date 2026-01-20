# @horizon/gate-manager

> Gate testing and validation system

Test and validate your gate configurations to ensure authorization rules work as expected.

## Installation

```bash
npm install @horizon/gate-manager
```

## Usage

```typescript
import { 
  generateTests, 
  runGatewayTests,
  scanComponents 
} from '@horizon/gate-manager';

// Generate test cases from gate config
const tests = await generateTests('./gate.yaml');

// Run the tests
const results = await runGatewayTests(tests);

// Check results
for (const result of results) {
  console.log(`${result.gate}: ${result.passed ? 'PASS' : 'FAIL'}`);
}
```

### Component Scanning

```typescript
// Scan codebase for gate usage
const report = await scanComponents('./src', './gate.yaml');

// Find unused gates
console.log('Unused gates:', report.unusedGates);

// Find undeclared gate references
console.log('Undeclared:', report.undeclaredReferences);
```

## Documentation

See the [main repository](https://github.com/ascend42/a-horizon) for full documentation.

## License

MIT
