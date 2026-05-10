# University Triage — 2026-05-06

Scope: all views, routes, stores, types, content loaders, and tests under
`packages/university/`. Pre-session fixes (CourseView:114 keyConcepts guard,
CourseView:143 quiz guard, courses.ts lesson builder initialization) are
excluded — they landed before this audit began.

---

## P0 — Crash-level bugs

None confirmed for the current content set. The P1 server crash below
(reference.json unguarded JSON.parse) is a latent P0 that only fires on
corrupted content.

---

## P1 — Logic bugs (wrong behavior / data loss)

### 1. `parseSimpleYaml` cannot parse block-style YAML lists — keyConcepts always empty

**File:** `packages/university/src/server/routes/courses.ts:85-114` (parser),
`courses.ts:166` (consumer)

**Description:**
`parseFrontmatter` calls `parseSimpleYaml` to parse note frontmatter without
using `js-yaml` (which is already a project dependency and is used for quiz and
path YAML files). `parseSimpleYaml` only handles inline scalar values and
flow-style lists (`[a, b, c]`). Every note uses block-style lists for its
`tags:` field:

```yaml
tags:
  - course
  - para-101
```

The parser sees `tags:` with an empty inline value and stores `fm.tags = ""`
(an empty string). The subsequent `  - item` lines fail the
`/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/` key regex and are skipped. At
line 166 the check `Array.isArray(fm.tags)` returns `false` so `keyConcepts`
is always returned as `[]` for every lesson, regardless of how many tags the
note actually declares.

The keyConcepts guard added to CourseView.tsx (the pre-session fix) prevents a
crash but masks this bug — no keyConcepts ever render in the UI.

**Reproduction:**
1. Visit any course lesson in the running app.
2. The key-concepts tag strip is never visible, even for notes that declare
   `tags: [course, para-101, ...]` in block style.
3. Add a `console.log(fm)` inside `readLessonsForCourse` — `fm.tags` is `""`.

**Proposed fix:**
Replace `parseSimpleYaml(match[1])` inside `parseFrontmatter` with
`yaml.load(match[1]) as Record<string, unknown>`. `js-yaml` is already
imported at line 17 (`import * as yaml from 'js-yaml'`). Remove the
`parseSimpleYaml` function entirely.

---

### 2. `completeLesson` called unconditionally on quiz submit — zero-score passes

**File:** `packages/university/ui/src/views/QuizView.tsx:69`

**Description:**
When the last question of a lesson quiz is answered, auto-submit fires at
lines 46-70. `completeLesson(courseId, lessonId)` is called unconditionally
regardless of the user's score. A user can answer every question wrong and the
lesson is still marked complete. The `passRequired: true` flag in path YAML
files is loaded server-side but is never surfaced to the client and is ignored
entirely by the quiz completion flow.

**Reproduction:**
1. Open any course lesson that has a quiz attached.
2. Answer all questions with the wrong answer.
3. Observe that the lesson shows as completed in the sidebar.

**Proposed fix:**
Add a pass threshold check before calling `completeLesson`. The quiz YAML
files carry a `passThreshold` field (e.g., `passThreshold: 0.7`). The server
could include this on the `ClientLesson` (or `ClientQuizQuestion` wrapper), or
the UI can default to `0.7` if not present. In QuizView:

```typescript
const correctCount = Object.entries(newAnswers).filter(
  ([qId, ans]) => lesson.quiz.find(q => q.id === qId)?.correct === ans
).length;
const passed = correctCount / lesson.quiz.length >= (lesson.passThreshold ?? 0.7);
if (passed) completeLesson(courseId, lessonId);
```

Show a "not yet — try again" message when `!passed`.

---

### 3. Diploma endpoint is dead code — certificates lost on storage clear

**Files:**
- `packages/university/ui/src/store/plsatStore.ts` (`addCertificate`)
- `packages/university/src/server/routes/plsat.ts:219-268` (`POST /api/plsat/diploma`)

**Description:**
`POST /api/plsat/diploma` is fully implemented server-side (lines 219-268 of
plsat.ts): it validates the payload, writes a `DiplomaRecord` to
`content/diplomas/<id>.yaml`, and returns a diploma object. The frontend
`addCertificate` in `plsatStore.ts` writes only to `localStorage` and never
calls this endpoint. Certificates are therefore ephemeral — clearing browser
storage silently deletes all earned certificates with no server-side backup.

**Reproduction:**
1. Pass the PLSAT exam.
2. Open DevTools → Application → Local Storage.
3. Clear `paradigm-university-plsat` key (or clear all site data).
4. Refresh — certificate is gone. Server-side diplomas directory is empty.

**Proposed fix:**
In `plsatStore.ts`, after writing to `localStorage`, fire a
fire-and-forget POST to the diploma endpoint:

```typescript
fetch('/api/plsat/diploma', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    examVersion: cert.examVersion,
    score: cert.score,
    passed: cert.passed,
    completedAt: cert.completedAt,
  }),
}).catch(() => { /* non-blocking */ });
```

This gives every passing attempt a server-side record. Recovery from lost
localStorage is then possible by building a `GET /api/plsat/diploma/:id` or
listing endpoint.

---

### 4. Unguarded `JSON.parse` on reference.json — server crash on malformed file

**File:** `packages/university/src/server/index.ts:120`

**Description:**
The `/api/reference` route reads and parses `reference.json` with no
try/catch:

```typescript
const data = JSON.parse(fs.readFileSync(refPath, 'utf-8')); // no guard
```

A malformed or partially-written `reference.json` throws a `SyntaxError` that
propagates as an unhandled exception, crashing the entire Express server
process. All university routes become unavailable until the process restarts.

**Reproduction:**
1. Corrupt `content/reference.json` (e.g., truncate it mid-write).
2. Make any request to `/api/reference`.
3. Server process exits with an uncaught SyntaxError.

**Proposed fix:**
Wrap in try/catch and return HTTP 500:

```typescript
try {
  const data = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
  res.json(data);
} catch {
  res.status(500).json({ error: 'Reference data could not be parsed' });
}
```

---

### 5. Two Q-para-451 quiz files are unreachable — orphaned content

**Files:**
- `packages/university/src/content/paths/LP-para-451.yaml:66-69`
- `packages/university/src/server/routes/courses.ts:150`

**Description:**
`LP-para-451.yaml` includes two standalone Q- steps that are not anchored to
any N- note:

```yaml
- content: Q-para-451-when-to-invoke
  required: true
- content: Q-para-451-foundations
  required: true
```

`readLessonsForCourse` skips any step that doesn't start with `N-` (line 150).
`Q-para-451-when-to-invoke.yaml` and `Q-para-451-foundations.yaml` exist on
disk but are never loaded. The PARA 451 course exposes 12 lessons, all with
`quiz: []`, even though the two quiz files above are the primary routing and
foundations knowledge checks. Students cannot take either quiz.

**Reproduction:**
1. Navigate to the PARA 451 course.
2. Every lesson shows no "Take Quiz" button.
3. The quiz files are present at `content/quizzes/Q-para-451-when-to-invoke.yaml`
   and `content/quizzes/Q-para-451-foundations.yaml`.

**Proposed fix (option A — preferred):**
Add stub notes `N-para-451-when-to-invoke.md` and `N-para-451-foundations.md`
that serve as thin landing pages for those quiz topics. Attach the quiz by
placing the Q- step immediately after the corresponding N- step in the path
YAML (matching the `Q-${courseId}-${lessonId}` filename convention the server
already handles in `readLessonsForCourse:171`).

**Proposed fix (option B):**
Extend `readLessonsForCourse` to also process Q-only steps: synthesize a
minimal `ClientLesson` whose `id` derives from the quiz filename and whose
`content` is empty or a short auto-generated stub. Lower risk than option A
but produces UI lessons with no textual content.

---

## P2 — Wrong behavior / UX rough edges

### 6. `frameworkVersion` hardcoded as `'2.0'` — certificates display wrong version

**File:** `packages/university/src/server/routes/plsat.ts:176, 204`

**Description:**
Both the versions listing route (line 176) and the full exam response (line
204) include `frameworkVersion: '2.0'`. The current framework is v6.3.0. Every
certificate ever issued by this server displays "Framework Version: v2.0"
regardless of the actual deployed version.

**Proposed fix:**
Import `version` from the package manifest or from a shared constant, and use
it in both places:

```typescript
import { version } from '../../package.json';
// ...
frameworkVersion: version,  // e.g., "6.3.0"
```

Or expose a `PARADIGM_VERSION` env var and fall back to a semver constant
updated at release time.

---

### 7. PLSAT exam version hardcoded to `'3.0'` — will not auto-upgrade

**File:** `packages/university/ui/src/views/PLSATView.tsx:68`

**Description:**
The PLSAT view fetches `fetch('/api/plsat/3.0')` directly. The server exposes
`GET /api/plsat` to list available exam versions. If a `4.0` pack ships, the
UI will silently keep serving the old `3.0` exam until this string is changed
in source code. The listing endpoint exists precisely to decouple version
selection from the UI.

**Proposed fix:**
On mount, fetch `/api/plsat` to get the versions list, then select the latest
(or prompt the user if multiple are available):

```typescript
const versionsRes = await fetch('/api/plsat');
const { versions } = await versionsRes.json();
const latest = versions[versions.length - 1].version;
const examRes = await fetch(`/api/plsat/${latest}`);
```

---

### 8. Timer interval torn down and re-created on every answer — user gains ~1-2 minutes

**Files:**
- `packages/university/ui/src/components/Timer.tsx:19-34`
- `packages/university/ui/src/views/PLSATView.tsx:102-104`

**Description:**
`Timer.tsx`'s `useEffect` depends on `[running, handleTimeUp]`. When `running`
is stable, the effect only re-runs when `handleTimeUp` changes identity.

In `PLSATView.tsx`, `handleTimeUp` is memoized with `useCallback` but depends
on `calculateResults`, which in turn depends on the `answers` state. Each time
the user selects an answer, `answers` updates → `calculateResults` is
recreated → `handleTimeUp` is recreated → Timer's `useEffect` fires → the
existing `setInterval` is cleared and a new one starts. The new interval's
first tick is `now + 1000ms`, not where the old interval left off. With 99
questions, the user can gain up to ~99 seconds (≈1.65 minutes) over the
90-minute exam window.

**Reproduction:**
1. Start the PLSAT exam.
2. Answer all 99 questions rapidly.
3. Observe that the displayed time remaining is higher than expected (or log
   `Date.now()` inside the Timer interval to see gaps).

**Proposed fix:**
Decouple `handleTimeUp` from `answers` by using a ref:

```typescript
// In PLSATView
const answersRef = useRef(answers);
useEffect(() => { answersRef.current = answers; }, [answers]);

const handleTimeUp = useCallback(() => {
  calculateResults(answersRef.current);  // read from ref, not closure
}, [calculateResults_stable]);
```

This keeps `handleTimeUp` identity stable across answer selections. Alternatively,
pass `onTimeUp` through a ref inside `Timer` itself so the effect never
re-fires on callback identity change:

```typescript
// In Timer.tsx
const onTimeUpRef = useRef(handleTimeUp);
useEffect(() => { onTimeUpRef.current = handleTimeUp; });
// useEffect only depends on [running] and calls onTimeUpRef.current()
```

---

### 9. No error state displayed — failed course fetches show empty catalog silently

**Files:**
- `packages/university/ui/src/views/HomeView.tsx`
- `packages/university/ui/src/views/CoursesView.tsx`

**Description:**
Both views read `courses` and `isLoading` from `coursesStore` but never read
the `error` field. If the `/api/courses` fetch fails (network error, server
crash, cold-start timeout), the loading spinner disappears and the user sees an
empty course catalog with no explanation. This is particularly bad during a
PLSAT study session if the content server restarts.

**Proposed fix:**
Read `error` from the store and render a user-visible message:

```typescript
const error = useCoursesStore((s) => s.error);
// ...
if (error) return <div className="error-state">Could not load courses: {error}</div>;
```

---

## P3 — Minor polish

### 10. `renderMarkdown` does not support h1 headings

**File:** `packages/university/ui/src/utils/renderMarkdown.ts:59-61` (h2/h3/h4
handling; h1 is absent)

**Description:**
`renderMarkdown` handles `##`, `###`, `####` but not `#` (h1). A bare
`# Heading` line falls through to the paragraph regex and renders as
`<p># Heading</p>` with the literal `#` character visible. Current note files
do not use top-level h1 headings in their body text (the lesson title is
rendered by CourseView as a React `<h1>`, not from markdown), so no content is
currently affected. However, any future note that uses `# ` in its body will
silently corrupt.

**Proposed fix:**
Add h1 to the heading handler:

```typescript
.replace(/^# (.+)$/gm, '<h1>$1</h1>')
```

Insert before the existing `##` handler so the more-specific `###` and `####`
patterns are not consumed by a greedy `#+ ` regex.

---

### 11. Quiz review requires retake — no read-only review path

**File:** `packages/university/ui/src/views/QuizView.tsx`

**Description:**
When a student returns to a lesson with a completed quiz, the `existingResult`
banner shows their previous best score. However the only action available is
to retake — there is no way to review which questions they got wrong without
re-answering all questions. Previous answer choices are not persisted to
`progressStore`, so incorrect answers from prior attempts are unrecoverable.

**Proposed fix:**
Persist the per-question answer map alongside the score in `progressStore`
(e.g., `quizAnswers: Record<lessonId, Record<questionId, string>>`). When
returning to a completed quiz, offer a "Review" button that renders the
`QuestionCard` components in their post-answer state (showing the explanation)
without allowing re-selection.

---

### 12. PLSAT review renders all 99 questions at once — no virtualization

**File:** `packages/university/ui/src/views/PLSATView.tsx:311` (review phase
render)

**Description:**
After completing the exam, the review phase renders every `QuestionCard` for
all 99 questions in a single pass with no pagination or virtual scroll. On
slower devices this causes a noticeable jank spike when entering the review
phase. The DOM mounts ~594 interactive elements simultaneously.

**Proposed fix:**
Paginate the review (e.g., 10 questions per page with Prev/Next controls), or
integrate `react-window`/`react-virtual` for windowed rendering. Pagination is
simpler and sufficient given the structured nature of the review.

---

## Summary table

| # | Priority | File | Description |
|---|----------|------|-------------|
| 1 | P1 | `courses.ts:85-114,166` | `parseSimpleYaml` drops block-list tags → keyConcepts always `[]` |
| 2 | P1 | `QuizView.tsx:69` | Lesson marked complete regardless of quiz score |
| 3 | P1 | `plsatStore.ts` + `plsat.ts:219-268` | Diploma endpoint never called; certs lost on storage clear |
| 4 | P1 | `server/index.ts:120` | `JSON.parse` without try/catch → server crash on bad reference.json |
| 5 | P1 | `LP-para-451.yaml:66-69` + `courses.ts:150` | Two Q-only path steps skipped; no quizzes reachable in PARA 451 |
| 6 | P2 | `plsat.ts:176, 204` | `frameworkVersion: '2.0'` hardcoded; every cert shows wrong version |
| 7 | P2 | `PLSATView.tsx:68` | Exam version `'3.0'` hardcoded; won't auto-upgrade |
| 8 | P2 | `Timer.tsx:19-34` + `PLSATView.tsx:102-104` | Timer reset on every answer; user gains up to ~99s per exam |
| 9 | P2 | `HomeView.tsx`, `CoursesView.tsx` | No error state; silent empty catalog on fetch failure |
| 10 | P3 | `renderMarkdown.ts` | h1 headings not supported; render as paragraph with literal `#` |
| 11 | P3 | `QuizView.tsx` | No read-only quiz review path without retaking |
| 12 | P3 | `PLSATView.tsx:311` | Review phase renders all 99 questions at once; no virtualization |
