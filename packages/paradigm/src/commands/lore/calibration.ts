import chalk from 'chalk';
import { loadLoreEntries, type LoreEntry } from '../../core/lore/index.js';

export async function loreCalibrationCommand(options: {
  symbol?: string;
  tag?: string;
  author?: string;
  groupBy?: string;
  json?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();

  const entries = await loadLoreEntries(rootDir, {
    symbol: options.symbol,
    tag: options.tag,
    author: options.author,
    hasAssessment: true,
  });

  if (entries.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ totalAssessed: 0, message: 'No assessed entries found' }, null, 2));
    } else {
      console.log(chalk.gray('\n  No assessed lore entries found.\n'));
      console.log(chalk.gray('  Use `paradigm lore assess <id> <correct|partial|incorrect>` to assess entries.\n'));
    }
    return;
  }

  const withConfidence = entries.filter(e => e.confidence != null);
  const totalAssessed = entries.length;
  const totalWithConfidence = withConfidence.length;

  // Compute stats
  const verdictBreakdown = { correct: 0, partial: 0, incorrect: 0 };
  let totalImpliedScore = 0;
  let totalConfidence = 0;
  let totalAbsDelta = 0;

  for (const e of entries) {
    const v = e.assessment!.verdict;
    verdictBreakdown[v]++;
    const implied = v === 'correct' ? 1.0 : v === 'partial' ? 0.5 : 0.0;
    totalImpliedScore += implied;
    if (e.confidence != null) {
      totalConfidence += e.confidence;
      totalAbsDelta += Math.abs(implied - e.confidence);
    }
  }

  const accuracyRate = totalImpliedScore / totalAssessed;
  const avgConfidence = totalWithConfidence > 0 ? totalConfidence / totalWithConfidence : null;
  const calibrationScore = totalWithConfidence > 0 ? 1 - totalAbsDelta / totalWithConfidence : null;

  // Grouping
  type GroupStat = { key: string; total: number; accuracyRate: number; avgConfidence: number | null; calibrationScore: number | null; verdictBreakdown: { correct: number; partial: number; incorrect: number } };
  let groups: GroupStat[] | undefined;

  if (options.groupBy && totalAssessed > 0) {
    const groupMap = new Map<string, LoreEntry[]>();

    for (const e of entries) {
      let keys: string[] = [];
      if (options.groupBy === 'symbol') {
        keys = e.symbols_touched || [];
      } else if (options.groupBy === 'tag') {
        keys = e.tags || [];
      } else if (options.groupBy === 'type') {
        keys = [e.type || 'agent-session'];
      }

      for (const key of keys) {
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(e);
      }
    }

    groups = Array.from(groupMap.entries())
      .map(([key, gEntries]) => {
        const gWithConf = gEntries.filter(e => e.confidence != null);
        const gBreakdown = { correct: 0, partial: 0, incorrect: 0 };
        let gImplied = 0;
        let gConf = 0;
        let gAbsDelta = 0;

        for (const e of gEntries) {
          const v = e.assessment!.verdict;
          gBreakdown[v]++;
          const implied = v === 'correct' ? 1.0 : v === 'partial' ? 0.5 : 0.0;
          gImplied += implied;
          if (e.confidence != null) {
            gConf += e.confidence;
            gAbsDelta += Math.abs(implied - e.confidence);
          }
        }

        return {
          key,
          total: gEntries.length,
          accuracyRate: gImplied / gEntries.length,
          avgConfidence: gWithConf.length > 0 ? gConf / gWithConf.length : null,
          calibrationScore: gWithConf.length > 0 ? 1 - gAbsDelta / gWithConf.length : null,
          verdictBreakdown: gBreakdown,
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  if (options.json) {
    console.log(JSON.stringify({
      totalAssessed,
      totalWithConfidence,
      accuracyRate: Math.round(accuracyRate * 1000) / 1000,
      avgConfidence: avgConfidence != null ? Math.round(avgConfidence * 1000) / 1000 : null,
      calibrationScore: calibrationScore != null ? Math.round(calibrationScore * 1000) / 1000 : null,
      verdictBreakdown,
      ...(groups ? { groups } : {}),
    }, null, 2));
    return;
  }

  // Human-readable output
  const caveat = totalAssessed < 5
    ? chalk.gray(`  (Low sample: N=${totalAssessed}. Stats may not be representative.)`)
    : totalAssessed < 15
      ? chalk.gray(`  (Moderate sample: N=${totalAssessed}. Trends are directional.)`)
      : '';

  console.log(chalk.magenta(`\n  Calibration Report (${totalAssessed} assessed entries)\n`));
  if (caveat) console.log(caveat + '\n');

  // Verdict breakdown
  const total = totalAssessed;
  console.log(chalk.white('  Verdicts:'));
  console.log(`    ${chalk.green('correct')}:   ${verdictBreakdown.correct}/${total} (${(verdictBreakdown.correct / total * 100).toFixed(0)}%)`);
  console.log(`    ${chalk.yellow('partial')}:   ${verdictBreakdown.partial}/${total} (${(verdictBreakdown.partial / total * 100).toFixed(0)}%)`);
  console.log(`    ${chalk.red('incorrect')}: ${verdictBreakdown.incorrect}/${total} (${(verdictBreakdown.incorrect / total * 100).toFixed(0)}%)`);
  console.log();

  // Accuracy & calibration
  console.log(chalk.white('  Scores:'));
  const accColor = accuracyRate >= 0.8 ? chalk.green : accuracyRate >= 0.5 ? chalk.yellow : chalk.red;
  console.log(`    Accuracy rate:    ${accColor(accuracyRate.toFixed(3))}`);

  if (avgConfidence != null) {
    console.log(`    Avg confidence:   ${avgConfidence.toFixed(3)}`);
  }

  if (calibrationScore != null) {
    const calColor = calibrationScore >= 0.9 ? chalk.green : calibrationScore >= 0.7 ? chalk.yellow : chalk.red;
    console.log(`    Calibration:      ${calColor(calibrationScore.toFixed(3))} (1.0 = perfect)`);
  }
  console.log();

  // Groups
  if (groups && groups.length > 0) {
    console.log(chalk.white(`  By ${options.groupBy}:`));
    for (const g of groups.slice(0, 15)) {
      const gAccColor = g.accuracyRate >= 0.8 ? chalk.green : g.accuracyRate >= 0.5 ? chalk.yellow : chalk.red;
      const calStr = g.calibrationScore != null ? ` cal:${g.calibrationScore.toFixed(2)}` : '';
      console.log(`    ${chalk.cyan(g.key.padEnd(25))} ${gAccColor(`acc:${g.accuracyRate.toFixed(2)}`)}${calStr}  (${g.verdictBreakdown.correct}/${g.verdictBreakdown.partial}/${g.verdictBreakdown.incorrect}) N=${g.total}`);
    }
    console.log();
  }
}
