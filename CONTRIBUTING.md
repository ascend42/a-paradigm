# Contributing to Paradigm

Thank you for your interest in contributing to Paradigm! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher

### Getting Started

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/a-horizon.git
   cd a-horizon
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build all packages**

   ```bash
   npm run build
   ```

4. **Link the CLI globally (for testing)**

   ```bash
   cd packages/paradigm
   npm link
   ```

5. **Verify installation**

   ```bash
   paradigm --version
   ```

### Development Workflow

```bash
# Start Prism in dev mode
npm run dev:prism

# Watch CLI for changes
cd packages/paradigm && npm run dev

# Run typechecks
npm run typecheck
```

## Project Structure

```
a-horizon/
├── packages/
│   ├── paradigm/         # Main CLI (@a-company/paradigm)
│   ├── purpose/core/     # Purpose file parser (@a-company/purpose-core)
│   ├── portal/
│   │   ├── core/         # Portal config parser (@a-company/portal-core)
│   │   ├── sdk/          # Runtime SDK (@a-company/portal-sdk)
│   │   └── manager/      # Portal testing (@a-company/portal-manager)
│   ├── premise/core/     # Symbol aggregation (@a-company/premise-core)
│   ├── probe/core/       # Visual discovery (@a-company/probe-core)
│   └── prism/            # Prism UI (@a-company/prism)
├── examples/
│   └── shopflow/         # Example project
└── package.json          # Workspace root
```

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation only
- `refactor/description` - Code refactoring

### Commit Messages

We use conventional commits:

```
feat: add new symbol type
fix: resolve visualizer loading issue
docs: update README with examples
chore: update dependencies
```

### Creating a Changeset

When making changes that affect published packages, create a changeset:

```bash
npm run changeset
```

Follow the prompts to describe your changes and select affected packages.

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run build` to ensure everything builds
4. Run `npm run typecheck` to verify types
5. Create a changeset if needed
6. Open a PR with a clear description

## Code Style

- We use Prettier for formatting
- Run `npm run format` before committing
- TypeScript strict mode is enabled

## Testing Changes

### Testing the CLI

```bash
# Build and link
npm run build
cd packages/paradigm && npm link

# Test in any project
cd /path/to/your/project
paradigm init
paradigm visualize
```

### Testing the Visualizer

```bash
# Dev mode with hot reload
npm run dev:prism

# Then open http://localhost:5173
```

## Package Dependencies

The packages have internal dependencies:

```
paradigm
├── premise-core
│   ├── purpose-core
│   └── portal-core
├── portal-sdk → portal-core
├── portal-manager → portal-core, portal-sdk
├── purpose-core
└── probe-core
```

When modifying a core package, rebuild dependent packages:

```bash
npm run build  # Rebuilds all in correct order
```

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions

Thank you for contributing! 🚀
