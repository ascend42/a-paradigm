/**
 * paradigm flow — Flow management commands
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { log } from '../utils/logger.js';
import { loadFlowsConfig, getAllFlows, generateMermaidDiagram } from '../core/flow-validator.js';

interface DiagramOptions {
  output?: string;
}

export async function flowDiagramCommand(flowId: string, options: DiagramOptions) {
  const rootDir = process.cwd();

  const config = loadFlowsConfig(rootDir);
  if (!config) {
    console.log(chalk.red('\n❌ No flows.yaml found'));
    console.log(chalk.gray('Create .paradigm/flows.yaml to define flows.\n'));
    process.exit(1);
  }

  const flows = getAllFlows(rootDir);

  // Normalize flowId — allow with or without $ prefix
  const normalizedId = flowId.startsWith('$') ? flowId : `$${flowId}`;
  const flow = flows.find(f => f.id === normalizedId || f.id === flowId);

  if (!flow) {
    console.log(chalk.red(`\n❌ Flow not found: ${flowId}`));
    console.log(chalk.gray(`\nAvailable flows:`));
    for (const f of flows) {
      console.log(chalk.gray(`  ${f.id} — ${f.name}`));
    }
    console.log('');
    process.exit(1);
  }

  log.command('flow-diagram').info('Generating Mermaid diagram', { flowId: flow.id });

  const diagram = generateMermaidDiagram(flow);

  if (options.output) {
    const outputPath = path.resolve(rootDir, options.output);
    fs.writeFileSync(outputPath, diagram, 'utf-8');
    console.log(chalk.green(`\n✓ Diagram written to ${path.relative(rootDir, outputPath)}\n`));
  } else {
    console.log('');
    console.log(chalk.blue(`Flow: ${flow.name} (${flow.id})`));
    console.log(chalk.gray(`Trigger: ${flow.trigger}`));
    console.log('');
    console.log(diagram);
    console.log('');
  }
}
