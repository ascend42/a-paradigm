# FTUX Friction Report — Paradigm University
**Simulated by:** Nora (ftux agent, tier-1)
**Date:** 2026-05-06
**Environment:** http://localhost:3839

---

## Task Attempted

Full first-time-user walkthrough of Paradigm University:
1. Visit homepage and find a course
2. Open PARA-001 (entry point)
3. Complete a lesson
4. Take a quiz
5. Find and take the PLSAT exam

---

## Step-by-Step Walkthrough

### Step 1 — Homepage (`/`)

`GET /api/courses` returns valid JSON with a `courses` array of 10 courses. Each course has `id`, `title`, `description`, `lessonCount`, and `lessons[]`. The `HomeView` renders all of these correctly — course cards, progress rings, lesson tags. The page loads cleanly.

**Quick Links** section shows: "Take the PLSAT", "Reference Library", "View Certificates", "Start Learning". The PLSAT link is correctly gated on `hasPassed()` to show "Retake" vs "Take".

No friction here. Homepage is clean and functional.

### Step 2 — Open PARA-001 (`/course/para-001`)

`GET /api/courses/para-001` returns full lesson objects with `content` and `quiz` arrays — correct shape. The `CourseView` auto-redirects to the first lesson (`/course/para-001/shift-setup`) via `navigate(..., { replace: true })`. Sidebar shows all 3 lessons. Content renders via `renderMarkdown`.

The lesson content for `shift-setup` references `paradigm shift`, multiple config files, and hooks setup. Content is well-structured.

**Minor friction:** When arriving at `/course/para-001` with no lesson in the URL, the view briefly renders with no lesson content visible (loading state) before the redirect fires. The loading message "Opening the textbook..." appears then the redirect happens — on slower connections, the user sees a flash. Not blocking.

### Step 3 — Complete a lesson

After reading the lesson, the user sees two buttons: "Mark Complete" and "Take Quiz" (gold button, visible when quiz exists). A "Next Lesson" button also appears. The user can mark a lesson complete without taking the quiz — this is valid, intentional design.

The lesson content is comprehensive. `renderMarkdown` handles code blocks and markdown. No crash risk found.

### Step 4 — Take a quiz (`/course/para-001/quiz/shift-setup`)

`QuizView` loads the lesson quiz by fetching the course via `loadCourse`. The quiz for `shift-setup` has 3 questions, all with `id`, `question`, `choices`, `correct`, `explanation` present in the API response — no null fields.

`QuestionCard` in uncontrolled mode (quiz) works correctly: `onAnswered` fires, local state tracks the answer, explanation shows immediately on selection. Auto-submits when all questions are answered (`Object.keys(newAnswers).length === lesson.quiz.length`).

**Minor friction — UX:** Questions auto-advance the result immediately on click — there is no confirmation step. The user cannot change their answer after clicking. This is intentional but not communicated upfront. A first-time user may click accidentally and be locked in.

**Minor friction — completion flow:** After quiz completion, the "Next Lesson" link goes to `/course/para-001/meet-the-team` (the next lesson), not back to the quiz view or course page. This is correct but the user has no summary screen — just the score text and an immediate navigation option. No "back to course" option appears when `nextLessonId` exists (the code only shows "Return to Course" when on the last lesson). A user who wants to review the course progress screen has no direct way back without using the browser back button.

### Step 5 — Find and take the PLSAT (`/plsat`)

**CRITICAL BUG — BROKEN EXAM:**

`PLSATView` hardcodes `fetch('/api/plsat/3.0')` at line 68. Version `3.0` does not exist on the server. Only version `2.0` is present (`content/quizzes/Q-plsat-v2.yaml`).

The server responds: `{"error":"Failed to parse PLSAT exam"}` (HTTP 500 from the catch block in plsat.ts, line 213 — actually a 500 because `Q-plsat-v3.yaml` does not exist, so the `!fs.existsSync(examFile)` check at line 193 returns a 404 `{"error": "PLSAT version '3.0' not found"}`).

The `PLSATView` fetch catches the error via `.catch(() => setIsLoading(false))` — it silently swallows the error and sets `exam` to `null`. The user sees the "PLSAT Unavailable" fallback state:

```
PLSAT Unavailable
Could not load the examination. Please try again.
```

There is no retry button in the error state. The message says "try again" but provides no mechanism to do so. The user is stuck.

**Secondary finding — `/api/plsat/versions` and `/api/plsat/current` are not valid routes:**

The server's PLSAT router defines:
- `GET /` — returns versions list (maps to `/api/plsat`)
- `GET /:version` — returns exam for a version (maps to `/api/plsat/2.0`)

The paths `/api/plsat/versions` and `/api/plsat/current` both hit the `/:version` handler with `versions` and `current` as the version param, returning 404 errors. These routes do not exist, though the `HomeView` does not call them directly. The mismatch exists in the project's stated test surface but is not user-visible at runtime.

---

## Friction Summary

| Step | Type | Severity | Description |
|------|------|----------|-------------|
| Open course | `broken_flow` | low | Brief flash of loading state before lesson redirect fires |
| Quiz — answer lock | `assumed_context` | low | Clicking an answer immediately locks it; no undo affordance or warning |
| Quiz — no back-to-course | `missing_coverage` | medium | After completing a non-final-lesson quiz, there is no "Back to Course" button — only "Next Lesson" |
| PLSAT — hardcoded v3.0 | `broken_flow` | **critical** | `PLSATView.tsx:68` fetches `/api/plsat/3.0` but only `2.0` exists; the entire exam is inaccessible |
| PLSAT — silent error | `broken_flow` | **critical** | fetch `.catch()` swallows the error silently; user sees "PLSAT Unavailable" with no retry button |
| PLSAT — no retry | `broken_flow` | high | The unavailable state contains no retry mechanism despite saying "Please try again" |

---

## Verdict

**The PLSAT exam is completely inaccessible to first-time users.** The hardcoded version string `3.0` in `PLSATView.tsx` does not match the deployed exam version `2.0`. Every user who navigates to `/plsat` will hit the unavailable state. This is a showstopper for the exam flow.

The course and quiz flows (Steps 1–4) are fully functional. Content is solid, quiz mechanics work, progress tracking works. The quiz UX has minor friction (no answer undo, no back-to-course after a mid-course quiz) but nothing breaking.

**Immediate fix required:** `PLSATView.tsx` line 68 — change `fetch('/api/plsat/3.0')` to `fetch('/api/plsat/2.0')` or, preferably, dynamically fetch the latest version from `GET /api/plsat` first and use the highest available version.

---

```yaml
# Agent Relay
status: partial
summary: |
  Course and quiz flows (Steps 1–4) are functional with minor UX friction.
  The PLSAT exam (Step 5) is completely broken: PLSATView.tsx hardcodes
  fetch('/api/plsat/3.0') but only version 2.0 exists on the server.
  The silent error handler shows a dead-end "PLSAT Unavailable" screen
  with no retry. Fix: update the fetch URL or resolve the version
  dynamically from GET /api/plsat.
  
  Key file: packages/university/ui/src/views/PLSATView.tsx:68
  Server file: packages/university/src/server/routes/plsat.ts:193
```
