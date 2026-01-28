# @horizon/purpose-core

> Purpose file parsing, validation, and aggregation

Core library for working with `.purpose` files - the structured documentation format that provides AI-friendly context about your codebase.

## Installation

```bash
npm install @horizon/purpose-core
```

## Usage

```typescript
import { 
  findPurposeFiles, 
  parsePurposeFile, 
  validatePurposeFile 
} from '@horizon/purpose-core';

// Find all .purpose files in a directory
const files = await findPurposeFiles('./src');

// Parse a .purpose file
const purpose = await parsePurposeFile('./src/.purpose');

// Validate a .purpose file
const result = validatePurposeFile(purpose);
if (!result.valid) {
  console.error(result.errors);
}
```

## Purpose File Format

```yaml
purpose: User authentication module
context:
  - Handles login, logout, and session management
  - Integrates with OAuth providers
features:
  - "@email-login": Email/password authentication
  - "@oauth-google": Google OAuth integration
components:
  - "#AuthProvider": React context for auth state
  - "#LoginForm": Login form component
```

## Documentation

See the [main repository](https://github.com/ascend42/a-horizon) for full documentation.

## License

MIT
