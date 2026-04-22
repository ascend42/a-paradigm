import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { recordLore, normalizeLoreEntry, type LoreEntry, type LoreType } from '../../core/lore/index.js';

interface OldAssessmentAuthor {
  type: 'human' | 'agent';
  id: string;
  model?: string;
}

interface AssessmentEntry {
  id: string;
  arc_id: string;
  title: string;
  summary: string;
  body?: string;
  symbols?: string[];
  tags?: string[];
  linked_lore?: string[];
  linked_tasks?: string[];
  linked_commits?: string[];
  date: string;
  author: OldAssessmentAuthor;
  type: 'retro' | 'insight' | 'decision' | 'milestone';
}

const ASSESSMENTS_DIR = '.paradigm/assessments';

export async function loreMigrateAssessmentsCommand(options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();
  const arcsDir = path.join(rootDir, ASSESSMENTS_DIR, 'arcs');
  const dryRun = !!options.dryRun;

  if (!fs.existsSync(arcsDir)) {
    console.log(chalk.yellow('\n  No assessments found at .paradigm/assessments/arcs/\n'));
    return;
  }

  const arcDirs = fs.readdirSync(arcsDir).filter(d => {
    const stat = fs.statSync(path.join(arcsDir, d));
    return stat.isDirectory();
  });

  let migrated = 0;
  let skipped = 0;
  const arcsProcessed: string[] = [];

  for (const arcDir of arcDirs) {
    const entriesDir = path.join(arcsDir, arcDir, 'entries');
    if (!fs.existsSync(entriesDir)) continue;

    const entryFiles = fs.readdirSync(entriesDir)
      .filter(f => f.endsWith('.yaml') && !f.endsWith('.migrated'));

    for (const file of entryFiles) {
      const filePath = path.join(entriesDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const assessment = yaml.load(content) as AssessmentEntry;

        // Build tags: arc:{arc_id}, assessment:{type}, plus original tags
        const tags: string[] = [
          `arc:${assessment.arc_id}`,
          `assessment:${assessment.type}`,
          ...(assessment.tags || []),
          'migrated-from-assessment',
        ];

        // v6.0: 'decision' is no longer a valid LoreType. Any legacy assessment
        // tagged type:'decision' is remapped to 'insight' so it survives
        // migration. The original type is retained in the assessment:* tag.
        const remappedType: LoreType = (assessment.type as string) === 'decision'
          ? 'insight'
          : (assessment.type as LoreType);

        // Normalize author using the lore pattern
        const rawEntry: Record<string, unknown> = {
          id: '', // Will be generated
          type: remappedType,
          timestamp: assessment.date,
          author: assessment.author, // Will be normalized
          title: assessment.title,
          summary: assessment.summary,
          body: assessment.body,
          symbols_touched: assessment.symbols || [],
          tags,
          linked_lore: assessment.linked_lore,
          linked_tasks: assessment.linked_tasks,
          linked_commits: assessment.linked_commits,
        };

        const normalized = normalizeLoreEntry(rawEntry);
        const entry: LoreEntry = {
          ...normalized,
          id: '', // Let recordLore generate a new ID
        };

        if (dryRun) {
          console.log(chalk.gray(`  [dry-run] Would migrate: ${assessment.id} → lore (arc:${assessment.arc_id})`));
        } else {
          await recordLore(rootDir, entry);
          // Rename original to .migrated
          fs.renameSync(filePath, filePath.replace('.yaml', '.migrated'));
          console.log(chalk.green(`  Migrated: ${assessment.id} → ${entry.id} (arc:${assessment.arc_id})`));
        }

        migrated++;
        if (!arcsProcessed.includes(assessment.arc_id)) {
          arcsProcessed.push(assessment.arc_id);
        }
      } catch (err) {
        console.error(chalk.red(`  Failed to migrate ${file}: ${err}`));
        skipped++;
      }
    }
  }

  console.log();
  if (dryRun) {
    console.log(chalk.yellow(`  Dry run complete: ${migrated} entries would be migrated from ${arcsProcessed.length} arcs`));
  } else {
    console.log(chalk.green(`  Migration complete: ${migrated} entries migrated from ${arcsProcessed.length} arcs`));
  }
  if (skipped > 0) {
    console.log(chalk.yellow(`  ${skipped} entries skipped due to errors`));
  }
  console.log(chalk.gray(`  Arcs preserved as tags: ${arcsProcessed.map(a => `arc:${a}`).join(', ')}`));
  console.log();
}
