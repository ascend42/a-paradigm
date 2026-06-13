---
id: N-para-801-orchestration-emits-dag
title: 'Lesson 2: Orchestration Emits the DAG'
type: note
author: paradigm
created: '2026-06-13'
updated: '2026-06-13'
tags:
  - course
  - para-801
  - close-the-loop
  - orchestration
  - agent-relay
symbols: []
difficulty: intermediate
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
---

## The Graph That Used to Be Thrown Away

When orchestration plans a multi-agent run, it computes a handoff graph: which agent goes first, which stages depend on which, how outputs flow forward. Before v7, that graph was *computed and then discarded* — the orchestration audit found it built at `orchestration.ts:1780-1830` and then dropped on the floor, with only a frozen `logOrchestration` blob recording `status: 'pending'` that nothing ever advanced.

This was the orchestration-to-task disconnect: the engine knew the shape of the work but never wrote it down anywhere the rest of the framework could see. v7 fixes this by having orchestration **emit the DAG as real tasks**.

## `emitTaskDag()`: Epic + Stage Children

In `execute` mode (and only `execute` — `plan` and `quick` emit nothing), orchestration now calls a new `emitTaskDag()` at the point it builds its stage prompts. It persists:

- **One epic task** — the orchestration root, with `claimant: orchestrator` and `external_ref: { kind: 'orchestration' }`.
- **One child task per stage-agent** — each carrying `parentTaskId` (the epic), its `stage` ordinal, `dependsOn` (the resolved handoff edges), and a `claimant: { kind: 'archetype', ref: <role> }`.

The frozen `status: 'pending'` blob is replaced by this live epic task. Emission **degrades gracefully**: if a task-write fails, the orchestration run still proceeds — emission is additive instrumentation, never a gate on the work.

## Status Flows Back

A DAG is only useful if the nodes' statuses stay current. v7 wires status back through the agents themselves: each spawned agent's prompt now carries its own `taskId` with instructions to flip the task to `in-progress` on start and `done` on finish (via `paradigm_task_update`). So the spine the orchestrator emits is the same spine the agents update as they work — and the same spine the learning loop settles on (Lesson 3).

> **v7.0 scope note:** loop-closure is scoped to the **MCP path** — the dominant Claude-Code-agent path where agents drive `paradigm_task_*`. The Symphony (Cursor/peer) status-flow-back watcher, which maps `metadata.task.taskId → updateTask`, is a fast-follow. The standalone CLI `orchestrate` binary emits no tasks in v7.0; a thin `task-bridge` adapter is the planned fast-follow. The spec states this cost plainly rather than claiming coverage the code does not have.

## The Typed Handoff: `AgentRelay`

The DAG emission rides on a second v7 cleanup: the **typed agent handoff**. Before v7, agents handed off to each other in free-text prose, and a hand-rolled regex parser (`parseFilePlan` / `parseFilePlanFromResponse`) tried to scrape structure back out of that prose. v7 deletes those regex parsers entirely and replaces the prose with one typed contract:

```typescript
interface AgentRelay {
  taskId?: string;
  agent: string;
  status: string;
  artifacts: string[];
  decisions: string[];
  handoffTo?: string;
  handoffContext?: string;
  filePlan?: string[];     // now a typed field, consumed directly
  blockedOn?: string;
}
```

`TaskPayload` (the assignment) and `AgentRelay` (the completion) are the **request/response halves** of one exchange, kept separate and bound by an explicit map: `relay.taskId + status → updateTask`. Because `filePlan` is now a typed field, `planBuilderStages` consumes it directly — the brittle "parse my teammate's English" step is gone. Typed structure in, typed status out: that is the channel the loop closes over.
