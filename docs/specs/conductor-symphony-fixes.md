# Conductor Symphony Fixes: Seamless Cross-Session Communication

> Making Symphony threads visible, real-time, and bidirectional in Conductor.
> Written March 27, 2026 after field-testing cross-session communication between a-paradigm and a-neverland.
> Amended after team review (Apex + Jinx).

---

## The Problem

When two Claude Code sessions communicate via Symphony (e.g., Paradigm team discussing with Neverland team), Conductor is blind to it. The user has to manually run `paradigm_symphony_peek` and `paradigm_symphony_poll` in a loop, track thread IDs by hand, and watch for responses with no notifications. Messages sent to the wrong thread ID go unnoticed.

**Field test results (March 27, 2026):**
- Thread ID mismatch: Paradigm sent to `thr-452a6090`, Neverland posted to `thr-orch-orch-mn6wyut0-cwv2`. Responses were invisible until manually resent to the correct thread.
- No notification when Neverland responded — had to poll manually.
- Conductor overlay showed nothing — threads were filtered out by `thr-orch-*` prefix requirement.
- Required a `/loop 1m` cron to watch for messages — this is not a UX, it's a workaround.

**Note:** These fixes make Conductor real-time for the human observer. Claude-to-Claude message delivery still depends on each session's own `paradigm_symphony_peek` poll interval. Conductor becomes the monitor, not the transport.

---

## Five Fixes (ordered by implementation priority)

### Fix 1: Remove Thread Prefix Filter (HIGH — 30 min)

**Current:** `SymphonyThreadWatcher.swift` hard-filters for `thr-orch-*` prefix. All non-orchestration threads are silently ignored.

**Fix:** Remove the hard filter. Show threads with activity in the last 2 hours by default. Add an "all threads" toggle for historical threads.

**Files:** `SymphonyThreadWatcher.swift`

### Fix 2: Multi-Workspace Agent Discovery (HIGH — 1-2 hrs)

**Current:** Both `SymphonyThreadWatcher` and `SymphonyMonitor` are initialized with agents from a single workspace only. Messages from agents in other projects are invisible.

**Fix:** Scan `~/.paradigm/score/agents/` for ALL project directories. Build a unified agent list. Pass it to BOTH `SymphonyThreadWatcher.startWatching()` AND `SymphonyMonitor.startPolling()`.

Add a re-scan trigger when the user opens the Team Thread view (handles agents that link after Conductor launches). Full dynamic re-scanning via FSEvents is deferred to optional polish.

**Files:** `AppDelegate.swift` (`setupSymphony()`), `SymphonyThreadWatcher.swift`, `SymphonyMonitor.swift`

### Fix 3: General Message Notifications (HIGH — 2-3 hrs)

**Current:** Only `approval-request` and `file-request` intents trigger notifications.

**Fix:** Notify on any new message from a different session/project, with priority levels:

- **Banner (interrupts):** `alert`, `approval-request`, `pan-invoke`, `task`
- **Toast (non-interrupting):** `question`, `proposal`, `decision`, `context`
- **Silent (badge only):** `clarification`, `reference`, `progress`, `task-ack`

**Files:** New `SymphonyNotificationManager.swift`, updates to `SymphonyMonitor.swift`

### Fix 4: Bidirectional Conductor Messaging (MEDIUM — 1-2 hrs)

**Current:** When Conductor sends a message, it writes to the agent's inbox but doesn't update `monitor.threadMessages`. The message appears in the UI after a 5-second poll delay.

**Fix:** After writing to the agent inbox, immediately append the note to `monitor.threadMessages[threadRoot]` so it appears in the thread view instantly. The existing `id`-based dedup in `SymphonyMonitor` (line 113-120) prevents duplicates when the poll cycle picks it up.

**Files:** `TeamThreadView.swift` (send action), `SymphonyMonitor.swift`

### Fix 5: Project Context Badges (LOW — 1 hr)

**Current:** Messages show `[role]` or `[role@project]` but threads don't indicate which project they originated from.

**Fix:** Add a color-coded project badge to thread headers. Deterministic color from project name hash.

**Files:** `TeamThreadView.swift`

### Deferred: FSEvents Real-Time (OPTIONAL POLISH)

FSEvents would reduce message detection from 3s to ~100ms. The team agreed this is nice-to-have — the prefix filter removal (Fix 1) is what actually unblocks visibility. The 3-second polling on `SymphonyThreadWatcher` is acceptable for async cross-session communication. If implemented later, use `FSEventStreamCreate` (not `DispatchSource`) for recursive directory watching on `~/.paradigm/score/`.

---

## Implementation Order

| # | Fix | Effort | Impact | Dependencies |
|---|-----|--------|--------|-------------|
| 1 | Thread prefix filter removal + staleness cutoff | 30 min | HIGH | None |
| 2 | Multi-workspace discovery (both watchers + re-scan) | 1-2 hrs | HIGH | None |
| 3 | General message notifications | 2-3 hrs | HIGH | Fix 1+2 |
| 4 | Bidirectional messaging | 1-2 hrs | MEDIUM | None |
| 5 | Project context badges | 1 hr | LOW | Fix 2 |

**Total: 6-9 hours.** FSEvents deferred.

---

*Spec amended March 27, 2026 after Apex + Jinx review.*
