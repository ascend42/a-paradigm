---
name: conduct
description: Register this Claude Code session with Paradigm Conductor. Use when the user says "conduct", "surface to conductor", "register with conductor", or wants this terminal visible in the Conductor overlay.
---

# Register with Paradigm Conductor

You are registering this Claude Code session with Paradigm Conductor — the
multimodal overlay that enables voice, gesture, and gaze dispatch across
Claude Code sessions.

## What This Does

Writes a registration file to `~/.conductor/sessions/{pid}.json` so that
the Conductor macOS app can instantly discover this session. This enables:
- Voice commands dispatched to this terminal
- Gaze-targeted selection of this window
- Gesture-based buffer editing and dispatch
- Context-enriched payloads with Paradigm symbols

## Step 1: Register

Call `paradigm_conductor_register` with an optional label from the user's arguments.

If the user provided a label via arguments, use it: $ARGUMENTS

```
paradigm_conductor_register({
  label: "optional label from user"
})
```

If no label was provided, omit it — the tool will auto-detect project dir,
branch, terminal, and PID.

## Step 2: Confirm

After registration, tell the user:
- The session is now visible in Conductor
- Show the PID and project directory
- Mention they can unregister with `paradigm_conductor_unregister`
- If Conductor isn't running, mention they can start it with `paradigm conductor`

## When to Suggest This

You may proactively suggest `/conduct` when:
- The user mentions Conductor or multi-session workflows
- The user is working across multiple Claude Code terminals
- The user asks about voice or gesture control
