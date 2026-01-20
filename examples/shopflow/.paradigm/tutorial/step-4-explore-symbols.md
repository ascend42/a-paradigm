# Step 4: Exploring Symbols

Paradigm uses a symbol system to create a shared language between code, developers, and AI.

## What You'll Learn

- All the symbol types in Paradigm
- Concatenated symbols (compound ideas like `?@`, `?#`, `?!`)
- How symbols reference each other
- How to use paradigm commands to explore symbols

## Tasks

1. **Run paradigm status**
   ```bash
   paradigm status
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
   Ideas can specify what type of symbol they're exploring by using a compound prefix:
   - `?@subscription-model` - Idea for a feature
   - `?#dark-mode-toggle` - Idea for a component
   - `?$express-checkout` - Idea for a flow
   - `?%user-preferences` - Idea for state
   - `?~performance-optimization` - Idea for an aspect
   - `?^premium-access` - Idea for a gate
   - `?!payment-webhook` - Idea for a signal
   
   **Why use compound ideas?**
   - **Categorization**: Makes it clear what type of symbol the idea relates to
   - **Discoverability**: In the Dreamscape visualizer, compound ideas connect to their target symbol type
   - **Planning**: Helps organize ideas by what they would become if implemented
   
   **Simple vs Compound:**
   - `?subscription-model` - General idea, no specific type
   - `?@subscription-model` - Idea specifically for a feature

4. **Trace symbol relationships**
   - Pick a feature like `@checkout-flow`
   - See what gates it requires
   - See what components it uses
   - See what flows it's part of
   - Look for compound ideas in `.premise` files

5. **Explore with paradigm commands**
   ```bash
   paradigm purpose validate
   paradigm gate validate
   ```
   - Validate your Purpose files
   - Validate your gate configuration

## Key Concepts

- Symbols create a traceable web of relationships
- Compound ideas (`?@`, `?#`, etc.) categorize ideas by their target symbol type
- In the Dreamscape visualizer, compound ideas visually connect to their symbol type
- AI agents can follow these relationships
- Symbols make project knowledge discoverable

## Checkpoint

Run:
```bash
paradigm tutorial checkpoint
```
