# Step 1: Explore Project Structure

Welcome to the Horizon tutorial! In this step, you'll explore how Horizon organizes project knowledge.

## What You'll Learn

- How Horizon uses files to structure project knowledge
- The purpose of different Horizon files
- How to navigate a Horizon project

## Tasks

1. **Examine the root .purpose file**
   - Open `.purpose` in the root directory
   - Notice how it defines features (`@`) and components (`#`)
   - See how features reference components and gates

2. **Check the gate.yaml file**
   - Open `gate.yaml`
   - Notice how gates (`^`) define authorization rules
   - See how gates have locks, keys, and prizes

3. **Explore .horizon directory**
   - Look at `.horizon/config.yaml` - this is the Horizon configuration
   - Check `.horizon/specs/` - these define the symbol system
   - Browse `.horizon/docs/` - reference documentation

4. **Notice the nested structure**
   - Check `auth/.purpose`, `payments/.purpose`, etc.
   - See how Purpose files can be organized by domain

## Checkpoint

When you're ready, run:
```bash
horizon tutorial checkpoint
```

This will verify you've explored the key files.
