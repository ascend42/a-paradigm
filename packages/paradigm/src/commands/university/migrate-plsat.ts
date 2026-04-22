/**
 * paradigm university migrate-plsat — one-shot PLSAT content migration.
 *
 * Hidden from --help. Internal tool that transforms packages/university/
 * src/content/{courses,plsat}/*.json into the v6.0 content-pack layout:
 *   content/notes/N-<course>-<lesson>.md
 *   content/quizzes/Q-<course>-<lesson>.yaml
 *   content/quizzes/Q-plsat-v<N>.yaml
 *   content/paths/LP-<course>.yaml
 *
 * Source JSON files are RETAINED by default. Deletion requires an explicit
 * --delete-sources flag (see D4 locked — sources stay until the regression
 * harness certifies byte-normalized equivalence).
 *
 * Idempotent: running twice with identical sources produces identical output.
 * Re-running rejects pre-existing target files unless --force is set.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { out, success, warn, error, dim, header } from '../../utils/cli-output.js';

// ────────────────────────────────────────────────────────────────
// Source JSON shapes (faithful to v2.0 / v3.0 on disk)
// ────────────────────────────────────────────────────────────────

// Canonical shape: choices keyed A–E, correct = letter string.
interface SourceQuizQuestionChoices {
  id: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation?: string;
}

// Alternate shape (para-401/notebooks-permissions, para-501/review-compliance):
// options is an ordered string[] and correct is a 0-based integer index.
interface SourceQuizQuestionOptions {
  id: string;
  question: string;
  options: string[];
  correct: number;
  explanation?: string;
}

type SourceQuizQuestion = SourceQuizQuestionChoices | SourceQuizQuestionOptions;

function isOptionsQuestion(q: SourceQuizQuestion): q is SourceQuizQuestionOptions {
  return Array.isArray((q as SourceQuizQuestionOptions).options);
}

function isChoicesQuestion(q: SourceQuizQuestion): q is SourceQuizQuestionChoices {
  const c = (q as SourceQuizQuestionChoices).choices;
  return typeof c === 'object' && c !== null && !Array.isArray(c);
}

interface SourceLesson {
  id: string;
  title: string;
  content: string;
  keyConcepts?: string[];
  quiz?: SourceQuizQuestion[];
}

interface SourceCourse {
  id: string;
  title: string;
  description: string;
  lessons: SourceLesson[];
}

interface V2Exam {
  version: string;
  frameworkVersion?: string;
  timeLimit: number;
  passThreshold: number;
  title: string;
  description: string;
  questions: Array<{
    id: string;
    course: string;
    scenario?: string;
    question: string;
    choices: Record<string, string>;
    correct: string;
    explanation?: string;
  }>;
}

interface V3Variant {
  id: string;
  scenario: string;
  question: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
}

interface V3StandaloneItem {
  type: 'standalone' | 'variant-group';
  slot: string;
  course: string;
  variants: V3Variant[];
}

interface V3PassageQuestion {
  slot: string;
  variants: V3Variant[];
}

interface V3PassageItem {
  type: 'passage';
  slot: string;
  course: string;
  passage: string;
  questions: V3PassageQuestion[];
}

type V3Item = V3StandaloneItem | V3PassageItem;

interface V3Exam {
  version: string;
  frameworkVersion?: string;
  timeLimit: number;
  totalSlots?: number;
  passThreshold: number;
  title: string;
  description: string;
  items: V3Item[];
}

// ────────────────────────────────────────────────────────────────
// CLI entry
// ────────────────────────────────────────────────────────────────

interface MigratePlsatOptions {
  contentDir?: string;
  force?: boolean;
  deleteSources?: boolean;
  json?: boolean;
}

interface MigrationResult {
  coursesProcessed: number;
  notesWritten: number;
  quizzesWritten: number;
  pathsWritten: number;
  plsatQuizzesWritten: number;
  skipped: string[];
  warnings: string[];
}

export async function universityMigratePlsatCommand(options: MigratePlsatOptions): Promise<void> {
  // Default to packages/university/src/content when invoked from the monorepo
  // root; callers may override with --content-dir.
  const cwd = process.cwd();
  const contentDir = options.contentDir
    ? path.resolve(cwd, options.contentDir)
    : path.resolve(cwd, 'packages/university/src/content');

  if (!fs.existsSync(contentDir)) {
    error(`content dir not found: ${contentDir}`);
    process.exit(1);
  }

  header('paradigm university migrate-plsat');
  dim(`  source: ${path.relative(cwd, contentDir) || contentDir}`);
  dim(`  mode:   ${options.force ? 'force (overwrite existing)' : 'idempotent (skip existing)'}`);
  out('');

  const result: MigrationResult = {
    coursesProcessed: 0,
    notesWritten: 0,
    quizzesWritten: 0,
    pathsWritten: 0,
    plsatQuizzesWritten: 0,
    skipped: [],
    warnings: [],
  };

  // 1. Migrate courses
  const coursesDir = path.join(contentDir, 'courses');
  if (fs.existsSync(coursesDir)) {
    const courseFiles = fs.readdirSync(coursesDir).filter(f => f.endsWith('.json'));
    for (const file of courseFiles) {
      const full = path.join(coursesDir, file);
      try {
        const course = JSON.parse(fs.readFileSync(full, 'utf-8')) as SourceCourse;
        migrateCourse(course, contentDir, options.force === true, result);
        result.coursesProcessed++;
      } catch (err) {
        result.warnings.push(`courses/${file}: ${(err as Error).message}`);
      }
    }
  } else {
    result.warnings.push('courses/ dir not present; skipping course migration');
  }

  // 2. Migrate PLSAT exams
  const plsatDir = path.join(contentDir, 'plsat');
  if (fs.existsSync(plsatDir)) {
    const plsatFiles = fs.readdirSync(plsatDir).filter(f => f.endsWith('.json'));
    for (const file of plsatFiles) {
      const full = path.join(plsatDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as V2Exam | V3Exam;
        migratePlsat(data, file, contentDir, options.force === true, result);
      } catch (err) {
        result.warnings.push(`plsat/${file}: ${(err as Error).message}`);
      }
    }
  } else {
    result.warnings.push('plsat/ dir not present; skipping PLSAT migration');
  }

  // 3. Verify first-party pack manifest exists at the package root.
  //    Spec §1.3: pack discovery expects pack.yaml at node_modules/@a-company/
  //    university/pack.yaml — i.e. the package ROOT, not src/content/.
  //    Walk up from contentDir (src/content) to the package root.
  const packageRoot = path.resolve(contentDir, '..', '..');
  const expectedManifestPath = path.join(packageRoot, 'pack.yaml');
  if (!fs.existsSync(expectedManifestPath)) {
    try {
      writeFirstPartyManifest(expectedManifestPath);
      success(`wrote ${path.relative(cwd, expectedManifestPath) || expectedManifestPath}`);
    } catch (err) {
      result.warnings.push(`pack.yaml write failed: ${(err as Error).message}`);
    }
  } else {
    dim(`  pack.yaml already present at ${path.relative(cwd, expectedManifestPath) || expectedManifestPath}`);
  }

  // 4. Optional source deletion — gated behind --delete-sources per D4
  if (options.deleteSources) {
    warn('--delete-sources: removing source JSON files');
    deleteSources(contentDir, result);
  }

  // Summary
  out('');
  header('Migration summary');
  out(`  courses processed:      ${result.coursesProcessed}`);
  out(`  notes written:          ${result.notesWritten}`);
  out(`  quizzes written:        ${result.quizzesWritten}`);
  out(`  paths written:          ${result.pathsWritten}`);
  out(`  PLSAT quizzes written:  ${result.plsatQuizzesWritten}`);
  if (result.skipped.length > 0) {
    dim(`  skipped (exists):       ${result.skipped.length}`);
  }
  if (result.warnings.length > 0) {
    out('');
    warn('Warnings:');
    for (const w of result.warnings) {
      dim(`  - ${w}`);
    }
  }
  out('');

  if (options.json) {
    out(JSON.stringify(result, null, 2));
  }

  success('migrate-plsat complete');
}

// ────────────────────────────────────────────────────────────────
// Course migration
// ────────────────────────────────────────────────────────────────

function migrateCourse(
  course: SourceCourse,
  contentDir: string,
  force: boolean,
  result: MigrationResult,
): void {
  const notesDir = path.join(contentDir, 'notes');
  const quizzesDir = path.join(contentDir, 'quizzes');
  const pathsDir = path.join(contentDir, 'paths');
  fs.mkdirSync(notesDir, { recursive: true });
  fs.mkdirSync(quizzesDir, { recursive: true });
  fs.mkdirSync(pathsDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const pathSteps: Array<{ content: string; required: boolean; passRequired?: boolean }> = [];

  for (const lesson of course.lessons || []) {
    // Note: N-<course-id>-<lesson-id>.md
    const noteId = `N-${course.id}-${lesson.id}`;
    const notePath = path.join(notesDir, `${noteId}.md`);

    if (!fs.existsSync(notePath) || force) {
      const tags = [
        'course',
        course.id,
        ...(lesson.keyConcepts || [])
          .slice(0, 3)
          .map(kc => kc.toLowerCase().split(/\s+/).slice(0, 3).join('-').replace(/[^a-z0-9-]/g, ''))
          .filter(Boolean),
      ];
      const wordCount = (lesson.content || '').split(/\s+/).length;
      const estimatedMinutes = Math.max(1, Math.ceil(wordCount / 200));

      const frontmatter = {
        id: noteId,
        title: lesson.title,
        type: 'note',
        author: 'paradigm',
        created: today,
        updated: today,
        tags,
        symbols: [],
        difficulty: 'beginner',
        estimatedMinutes,
        prerequisites: [],
        category: 'paradigm-core',
        origin: 'imported',
        source: `courses/${course.id}.json`,
      };

      const fmYaml = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false });
      const body = lesson.content || '';
      fs.writeFileSync(notePath, `---\n${fmYaml}---\n\n${body}\n`, 'utf8');
      result.notesWritten++;
    } else {
      result.skipped.push(`notes/${noteId}.md`);
    }

    pathSteps.push({ content: noteId, required: true });

    // Quiz: Q-<course-id>-<lesson-id>.yaml (only when lesson has a quiz)
    if (lesson.quiz && lesson.quiz.length > 0) {
      const quizId = `Q-${course.id}-${lesson.id}`;
      const quizPath = path.join(quizzesDir, `${quizId}.yaml`);

      if (!fs.existsSync(quizPath) || force) {
        const quiz = {
          id: quizId,
          title: `${course.title} — ${lesson.title}`,
          description: `Quiz for lesson: ${lesson.title}`,
          author: 'paradigm',
          created: today,
          updated: today,
          tags: ['course', course.id],
          symbols: [],
          difficulty: 'beginner',
          passThreshold: 0.7,
          category: 'paradigm-core',
          origin: 'imported',
          source: `courses/${course.id}.json`,
          questions: lesson.quiz.map(q => {
            // Two valid source shapes — preserve whichever is authored so
            // answer-bank fidelity is maintained (v5.39.0 regression: earlier
            // revisions silently dropped the alternate `options[]` form and
            // produced unanswerable questions for para-401 + para-501).
            if (isChoicesQuestion(q)) {
              return {
                id: q.id,
                question: q.question,
                choices: q.choices,
                correct: q.correct,
                ...(q.explanation ? { explanation: q.explanation } : {}),
              };
            }
            if (isOptionsQuestion(q)) {
              return {
                id: q.id,
                question: q.question,
                options: q.options,
                correct: q.correct,
                ...(q.explanation ? { explanation: q.explanation } : {}),
              };
            }
            throw new Error(
              `lesson ${lesson.id}: quiz question ${(q as { id?: string }).id ?? '<no-id>'} has neither 'choices' (object) nor 'options' (array) — cannot migrate.`,
            );
          }),
        };

        fs.writeFileSync(quizPath, yaml.dump(quiz, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf8');
        result.quizzesWritten++;
      } else {
        result.skipped.push(`quizzes/${quizId}.yaml`);
      }

      pathSteps.push({ content: `Q-${course.id}-${lesson.id}`, required: true, passRequired: true });
    }
  }

  // Path: LP-<course-id>.yaml
  const pathId = `LP-${course.id}`;
  const pathFile = path.join(pathsDir, `${pathId}.yaml`);
  if (!fs.existsSync(pathFile) || force) {
    const lp = {
      id: pathId,
      title: course.title,
      description: course.description,
      author: 'paradigm',
      created: today,
      updated: today,
      tags: ['course', course.id],
      ordered: true,
      category: 'paradigm-core',
      origin: 'imported',
      source: `courses/${course.id}.json`,
      steps: pathSteps,
    };
    fs.writeFileSync(pathFile, yaml.dump(lp, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf8');
    result.pathsWritten++;
  } else {
    result.skipped.push(`paths/${pathId}.yaml`);
  }
}

// ────────────────────────────────────────────────────────────────
// PLSAT migration
// ────────────────────────────────────────────────────────────────

function migratePlsat(
  data: V2Exam | V3Exam,
  sourceFile: string,
  contentDir: string,
  force: boolean,
  result: MigrationResult,
): void {
  const quizzesDir = path.join(contentDir, 'quizzes');
  fs.mkdirSync(quizzesDir, { recursive: true });

  const versionMatch = sourceFile.match(/^v(\d+)/);
  const versionNum = versionMatch ? versionMatch[1] : String(data.version || '2').split('.')[0];
  const quizId = `Q-plsat-v${versionNum}`;
  const quizPath = path.join(quizzesDir, `${quizId}.yaml`);

  if (fs.existsSync(quizPath) && !force) {
    result.skipped.push(`quizzes/${quizId}.yaml`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  const questions: Array<Record<string, unknown>> = [];

  if ('items' in data) {
    // v3.0 — flatten items with variants, preserving slot + section.
    for (const item of data.items) {
      if (item.type === 'passage') {
        for (const pq of item.questions) {
          // Record each variant; keep the canonical first-variant question
          // structure and expose remaining variants for client-side selection.
          const variants = pq.variants.map((v: V3Variant) => ({
            id: v.id,
            scenario: v.scenario,
            question: v.question,
            choices: v.choices,
            correct: v.correct,
            explanation: v.explanation,
          }));
          const first = variants[0];
          if (!first) continue;
          questions.push({
            id: first.id,
            scenario: first.scenario,
            question: first.question,
            choices: first.choices,
            correct: first.correct,
            explanation: first.explanation,
            slot: pq.slot,
            section: item.course,
            passageId: item.slot,
            passage: item.passage,
            ...(variants.length > 1 ? { variants: variants.slice(1) } : {}),
          });
        }
      } else {
        const variants = item.variants.map((v: V3Variant) => ({
          id: v.id,
          scenario: v.scenario,
          question: v.question,
          choices: v.choices,
          correct: v.correct,
          explanation: v.explanation,
        }));
        const first = variants[0];
        if (!first) continue;
        questions.push({
          id: first.id,
          scenario: first.scenario,
          question: first.question,
          choices: first.choices,
          correct: first.correct,
          explanation: first.explanation,
          slot: item.slot,
          section: item.course,
          ...(variants.length > 1 ? { variants: variants.slice(1) } : {}),
        });
      }
    }
  } else {
    // v2.0 — flat questions array; just copy + preserve course as section.
    for (const q of data.questions) {
      questions.push({
        id: q.id,
        scenario: q.scenario,
        question: q.question,
        choices: q.choices,
        correct: q.correct,
        ...(q.explanation ? { explanation: q.explanation } : {}),
        section: q.course,
      });
    }
  }

  const quiz: Record<string, unknown> = {
    id: quizId,
    title: data.title,
    description: data.description,
    author: 'paradigm',
    created: today,
    updated: today,
    tags: ['plsat', 'certification'],
    symbols: [],
    difficulty: 'advanced',
    passThreshold: data.passThreshold,
    timeLimit: data.timeLimit,
    ...('totalSlots' in data && data.totalSlots ? { totalSlots: data.totalSlots } : {}),
    exam: {
      kind: 'proctored',
    },
    category: 'paradigm-core',
    origin: 'imported',
    source: `plsat/${sourceFile}`,
    questions,
  };

  fs.writeFileSync(quizPath, yaml.dump(quiz, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf8');
  result.plsatQuizzesWritten++;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function writeFirstPartyManifest(targetPath: string): void {
  const manifest = {
    id: 'paradigm',
    name: 'Paradigm University',
    version: '6.0.0',
    schema_version: '1',
    tenant_kind: 'first-party',
    description: 'Official Paradigm learning content — PARA 001-701 courses + PLSAT certification.',
    authors: ['Paradigm team'],
    license: 'MIT',
    origin_hint: 'authored',
    content_types: ['note', 'quiz', 'path'],
    disciplines: ['engineering'],
    branding: {
      tagline: 'Learn Paradigm',
      institution: 'a-company',
    },
    theme: {
      primary: '#6366f1',
    },
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, yaml.dump(manifest, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf8');
}

function deleteSources(contentDir: string, result: MigrationResult): void {
  const coursesDir = path.join(contentDir, 'courses');
  const plsatDir = path.join(contentDir, 'plsat');

  for (const dir of [coursesDir, plsatDir]) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        fs.unlinkSync(path.join(dir, f));
      }
      // Remove the directory itself if empty
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch (err) {
      result.warnings.push(`delete ${dir}: ${(err as Error).message}`);
    }
  }
  // Silence the "chalk" unused import if CLI output helpers changed shape.
  void chalk;
}
