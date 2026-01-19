# Step 4: Exploring Symbols

Horizon uses a symbol system to create a shared language between code, developers, and AI.

## What You'll Learn

- All the symbol types in Horizon
- How symbols reference each other
- How to use horizon commands to explore symbols

## Tasks

1. **Run horizon status**
   ```bash
   horizon status
   ```
   - See how many features, components, gates, etc. are defined
   - Notice the symbol counts

2. **Understand symbol types**
   - `@` - Features (user-facing capabilities)
   - `#` - Components (reusable code units)
   - `$` - Flows (multi-step processes)
   - `%` - State (global/user state)
   - `~` - Aspects (cross-cutting concerns)
   - `^` - Gates (access control)
   - `!` - Signals (events/errors)
   - `?` - Ideas (exploration)

3. **Understand concatenated symbols (compound ideas)**
   Ideas can specify what type of symbol they're exploring:
   - `?@subscription-model` - Idea for a feature
   - `?#dark-mode-toggle` - Idea for a component
   - `?$checkout-express` - Idea for a flow
   - `?%user-preferences` - Idea for state
   - `?~performance-optimization` - Idea for an aspect
   - `?^premium-access` - Idea for a gate
   - `?!payment-webhook` - Idea for a signal
   
   These compound symbols help categorize ideas and make them more discoverable. In the Dreamscape visualizer, they'll appear as ideas connected to their target symbol type.

4. **Trace symbol relationships**
   - Pick a feature like `@checkout-flow`
   - See what gates it requires
   - See what components it uses
   - See what flows it's part of

5. **Explore with horizon commands**
   ```bash
   horizon purpose validate
   horizon gate validate
   ```
   - Validate your Purpose files
   - Validate your gate configuration

## Key Concepts

- Symbols create a traceable web of relationships
- AI agents can follow these relationships
- Symbols make project knowledge discoverable

## Checkpoint

Run:
```bash
horizon tutorial checkpoint
```
