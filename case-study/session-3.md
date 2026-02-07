# Session 3: Cold Handoff

> Fresh agent — zero conversation history. Orient from codebase and documentation only.

## Context

You are picking up an existing project management API called TaskFlow. You have never seen this codebase before. Orient yourself from the code, any project documentation, and configuration files before making changes.

The system has multiple projects with cross-membership:
- project-1: "Alpha Project" — alice (admin), bob (member)
- project-2: "Beta Project" — bob (admin), alice (member)
- user-outsider has no project memberships

## Features to Add

### 1. Project Activity Feed

Add `GET /api/projects/:id/activity` — returns a chronological feed of recent actions in the project.

Requirements:
- Project members only (return 403 for non-members)
- Returns an array of activity entries
- Each entry should include: action type, actor (user ID), target (entity ID), timestamp
- Should include at minimum: task creates, task updates, and comment additions
- Most recent entries first

You may source activity data from audit logs (if they exist), a new activity table, or any mechanism that captures project events. The implementation approach is up to you.

### 2. Cross-Project Dashboard

Add `GET /api/dashboard` — returns a summary of all projects the authenticated user belongs to.

Requirements:
- Authenticated users only
- Returns data for ALL projects the user is a member of
- Each project entry should include at minimum: project id, project name, and the user's role
- Users with no project memberships get an empty result (not an error)

## Validation

Run `bash case-study/verify.sh 3` — all 28 tests must pass (24 from sessions 1-2 + 4 new).

This is a full regression run. All prior session tests are re-executed.

## Report

Write to `results/session-3-report.md` using the template from `protocol.md`.
