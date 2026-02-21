import chalk from 'chalk';
import { addReview } from '../../core/lore/index.js';

export async function loreReviewCommand(id: string, options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();

  const completeness = parseInt(options.completeness as string || '3', 10) as 1|2|3|4|5;
  const quality = parseInt(options.quality as string || '3', 10) as 1|2|3|4|5;

  const success = await addReview(rootDir, id, {
    reviewer: options.reviewer as string || 'unknown',
    completeness,
    quality,
    notes: options.notes as string,
    reviewed_at: new Date().toISOString(),
  });

  if (success) {
    console.log(chalk.green(`\n  ✓ Review added to ${id}\n`));
  } else {
    console.error(chalk.red(`\n  Entry not found: ${id}\n`));
    process.exit(1);
  }
}
