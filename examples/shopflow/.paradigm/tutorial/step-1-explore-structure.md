# Step 1: Explore Project Structure

Welcome to the Paradigm tutorial! In this step, you'll explore how Paradigm organizes project knowledge.

## What You'll Learn

- How Paradigm uses files to structure project knowledge
- The purpose of different Paradigm files
- How to navigate a Paradigm project

## Tasks

1. **Examine the root .purpose file**
   - Open `.purpose` in the root directory
   - Notice how it defines features (`@`) and components (`#`)
   - See how features reference components and gates

2. **Check the portal.yaml file**
   - Open `portal.yaml`
   - Notice how gates (`^`) define authorization rules
   - See how gates have locks, keys, and prizes

3. **Explore .paradigm directory**
   - Look at `.paradigm/config.yaml` - this is the Paradigm configuration
   - Check `.paradigm/specs/` - these define the symbol system
   - Browse `.paradigm/docs/` - reference documentation

4. **Notice the nested structure**
   - Check `auth/.purpose`, `payments/.purpose`, etc.
   - See how Purpose files can be organized by domain

## Checkpoint

When you're ready, run:
```bash
paradigm tutorial checkpoint
```

This will verify you've explored the key files.
