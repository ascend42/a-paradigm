import chalk from 'chalk';
import { addAssessment, loadLoreEntry, type AssessmentVerdict } from '../../core/lore/index.js';

export async function loreAssessCommand(id: string, verdict: string, options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();

  const validVerdicts: AssessmentVerdict[] = ['correct', 'partial', 'incorrect'];
  if (!validVerdicts.includes(verdict as AssessmentVerdict)) {
    console.error(chalk.red(`\n  Invalid verdict: "${verdict}". Must be one of: correct, partial, incorrect\n`));
    process.exit(1);
  }

  // Load entry first to show context
  const entry = await loadLoreEntry(rootDir, id);
  if (!entry) {
    console.error(chalk.red(`\n  Entry not found: ${id}\n`));
    process.exit(1);
  }

  const success = await addAssessment(rootDir, id, {
    verdict: verdict as AssessmentVerdict,
    assessed_by: (options.assessor as string) || 'unknown',
    assessed_at: new Date().toISOString(),
    notes: options.notes as string | undefined,
  });

  if (success) {
    const verdictColors: Record<string, (s: string) => string> = {
      correct: chalk.green,
      partial: chalk.yellow,
      incorrect: chalk.red,
    };
    const colorFn = verdictColors[verdict] || chalk.white;

    console.log(chalk.green(`\n  Assessment recorded for ${id}`));
    console.log(`  Verdict: ${colorFn(verdict)}`);

    if (entry.confidence != null) {
      const impliedScore = verdict === 'correct' ? 1.0 : verdict === 'partial' ? 0.5 : 0.0;
      const delta = impliedScore - entry.confidence;
      const deltaStr = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
      const deltaColor = Math.abs(delta) <= 0.1 ? chalk.green : Math.abs(delta) <= 0.3 ? chalk.yellow : chalk.red;
      console.log(`  Confidence: ${entry.confidence.toFixed(2)} | Delta: ${deltaColor(deltaStr)}`);

      if (delta > 0.1) {
        console.log(chalk.gray('  Under-confident (outcome better than predicted)'));
      } else if (delta < -0.1) {
        console.log(chalk.gray('  Over-confident (outcome worse than predicted)'));
      } else {
        console.log(chalk.gray('  Well-calibrated'));
      }
    } else {
      console.log(chalk.gray('  No confidence recorded — delta not computed'));
    }
    console.log();
  } else {
    console.error(chalk.red(`\n  Failed to assess entry: ${id}\n`));
    process.exit(1);
  }
}
