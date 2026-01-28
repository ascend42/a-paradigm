# Step 2: Understanding Purpose Files

Purpose files are the foundation of Paradigm. They define what your project does and how it's structured.

## What You'll Learn

- How Purpose files define features (`@`) and components (`#`)
- How to read and understand Purpose file syntax
- How features reference other symbols

## Tasks

1. **Read the root .purpose file**
   - Open `.purpose` and read through it
   - Identify all features (lines starting with `- id: "@`)
   - Identify all components (lines starting with `- id: "#`)

2. **Understand feature definitions**
   - Look at `@product-browse` - what components does it use?
   - Look at `@checkout-flow` - what gates does it require?
   - Notice how features reference other features

3. **Explore nested Purpose files**
   - Open `auth/.purpose` - what features are defined here?
   - Open `payments/.purpose` - how does it relate to checkout?
   - See how domain-specific Purpose files organize knowledge

4. **Trace a feature**
   - Pick a feature like `@checkout-flow`
   - Follow its references to see what it depends on
   - Understand the relationships between features, components, and gates

## Key Concepts

- **Features (`@`)** - User-facing capabilities
- **Components (`#`)** - Reusable code units
- **References** - How features connect to components and gates

## Checkpoint

Run:
```bash
paradigm tutorial checkpoint
```
