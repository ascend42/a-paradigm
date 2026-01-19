# Step 3: Understanding Gates

Gates define authorization and access control in Horizon. They're like security checkpoints.

## What You'll Learn

- How gates (`^`) define access control
- The structure of locks, keys, and prizes
- How gates protect features

## Tasks

1. **Examine gate.yaml**
   - Open `gate.yaml` and read through it
   - Notice the structure: gates → locks → keys
   - See how prizes are awarded when gates pass

2. **Understand a simple gate**
   - Look at `^auth-required`
   - What lock does it have?
   - What key expression checks authentication?
   - What prize is awarded?

3. **Explore a complex gate**
   - Look at `^admin-panel`
   - How many locks does it have?
   - What conditions must be met?
   - What prizes are available?

4. **See gates in action**
   - Go back to `.purpose` files
   - Find features that reference gates (like `^auth-required`)
   - Understand how gates protect features

## Key Concepts

- **Gates (`^`)** - Access control points
- **Locks** - Conditions that must be met
- **Keys** - Expressions that unlock locks
- **Prizes** - Rewards when gates pass

## Checkpoint

Run:
```bash
horizon tutorial checkpoint
```
