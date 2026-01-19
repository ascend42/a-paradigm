/**
 * horizon tutorial command
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { execSync } from 'child_process';

/**
 * Tutorial state file location
 */
const TUTORIAL_STATE_FILE = '.horizon/tutorial/state.json';

/**
 * Tutorial curriculum file
 */
const CURRICULUM_FILE = '.horizon/tutorial/curriculum.yaml';

/**
 * Tutorial state interface
 */
interface TutorialState {
  currentStep: string | null;
  completedSteps: string[];
  fixedBugs: string[];
}

/**
 * Load tutorial state
 */
function loadState(rootDir: string): TutorialState {
  const statePath = path.join(rootDir, TUTORIAL_STATE_FILE);
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      // Invalid state file, start fresh
    }
  }
  return {
    currentStep: null,
    completedSteps: [],
    fixedBugs: [],
  };
}

/**
 * Save tutorial state
 */
function saveState(rootDir: string, state: TutorialState): void {
  const statePath = path.join(rootDir, TUTORIAL_STATE_FILE);
  const stateDir = path.dirname(statePath);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Load curriculum
 */
function loadCurriculum(rootDir: string): any {
  const curriculumPath = path.join(rootDir, CURRICULUM_FILE);
  if (!fs.existsSync(curriculumPath)) {
    throw new Error(`Curriculum not found at ${curriculumPath}`);
  }
  return yaml.load(fs.readFileSync(curriculumPath, 'utf8'));
}

/**
 * Validate checkpoint
 */
async function validateCheckpoint(rootDir: string, stepId: string, curriculum: any): Promise<boolean> {
  const step = curriculum.steps.find((s: any) => s.id === stepId);
  if (!step) {
    return false;
  }

  for (const checkpoint of step.checkpoints || []) {
    switch (checkpoint.type) {
      case 'file-exists': {
        const filePath = path.join(rootDir, checkpoint.path);
        if (!fs.existsSync(filePath)) {
          console.log(chalk.red(`❌ Missing: ${checkpoint.path}`));
          return false;
        }
        break;
      }
      case 'symbol-count': {
        // This would require running horizon commands
        // Simplified for now
        break;
      }
      case 'gate-count': {
        // This would require parsing gate.yaml
        // Simplified for now
        break;
      }
      case 'command-success': {
        try {
          execSync(checkpoint.command, { cwd: rootDir, stdio: 'pipe' });
        } catch {
          console.log(chalk.red(`❌ Command failed: ${checkpoint.command}`));
          return false;
        }
        break;
      }
      case 'bug-fixed': {
        const state = loadState(rootDir);
        if (!state.fixedBugs.includes(checkpoint.bug)) {
          console.log(chalk.red(`❌ Bug not fixed: ${checkpoint.bug}`));
          return false;
        }
        break;
      }
    }
  }

  return true;
}

/**
 * Start tutorial command
 */
export async function tutorialStartCommand(targetPath: string | undefined): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  
  try {
    const curriculum = loadCurriculum(rootDir);
    const state = loadState(rootDir);

    // Set first step as current if not started
    if (!state.currentStep && curriculum.steps.length > 0) {
      state.currentStep = curriculum.steps[0].id;
      saveState(rootDir, state);
    }

    console.log(chalk.blue('\n🎓 Horizon Tutorial\n'));
    console.log(`Current Step: ${state.currentStep || 'Not started'}`);
    console.log(`Completed Steps: ${state.completedSteps.length}/${curriculum.steps.length}\n`);

    if (state.currentStep) {
      const step = curriculum.steps.find((s: any) => s.id === state.currentStep);
      if (step) {
        const stepFile = path.join(rootDir, '.horizon/tutorial', step.file);
        if (fs.existsSync(stepFile)) {
          console.log(chalk.cyan(`📖 ${step.title}`));
          console.log(chalk.gray(step.description));
          console.log(chalk.gray(`\nView full instructions: ${stepFile}\n`));
        }
      }
    }

    console.log('Commands:');
    console.log('  horizon tutorial step <n>     Show step n');
    console.log('  horizon tutorial checkpoint   Validate current checkpoint');
    console.log('  horizon tutorial next         Move to next step');
    console.log('  horizon tutorial status       Show progress');
    console.log('  horizon tutorial reset        Reset tutorial\n');
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Show step command
 */
export async function tutorialStepCommand(
  targetPath: string | undefined,
  stepNum: string | undefined
): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  try {
    const curriculum = loadCurriculum(rootDir);
    const stepIndex = stepNum ? parseInt(stepNum, 10) - 1 : 0;

    if (stepIndex < 0 || stepIndex >= curriculum.steps.length) {
      console.error(chalk.red(`❌ Invalid step number: ${stepNum}`));
      process.exit(1);
    }

    const step = curriculum.steps[stepIndex];
    const stepFile = path.join(rootDir, '.horizon/tutorial', step.file);

    if (fs.existsSync(stepFile)) {
      console.log(chalk.blue(`\n📖 Step ${stepIndex + 1}: ${step.title}\n`));
      const content = fs.readFileSync(stepFile, 'utf8');
      console.log(content);
    } else {
      console.error(chalk.red(`❌ Step file not found: ${stepFile}`));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Checkpoint command
 */
export async function tutorialCheckpointCommand(targetPath: string | undefined): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  try {
    const curriculum = loadCurriculum(rootDir);
    const state = loadState(rootDir);

    if (!state.currentStep) {
      console.log(chalk.yellow('⚠️  No active step. Run `horizon tutorial start` first.'));
      return;
    }

    console.log(chalk.blue(`\n🔍 Validating checkpoint for step: ${state.currentStep}\n`));

    const passed = await validateCheckpoint(rootDir, state.currentStep, curriculum);
    
    if (passed) {
      console.log(chalk.green('✅ All checkpoints passed!\n'));
    } else {
      console.log(chalk.red('❌ Some checkpoints failed. Review the errors above.\n'));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Next step command
 */
export async function tutorialNextCommand(targetPath: string | undefined): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  try {
    const curriculum = loadCurriculum(rootDir);
    const state = loadState(rootDir);

    if (!state.currentStep) {
      console.log(chalk.yellow('⚠️  No active step. Run `horizon tutorial start` first.'));
      return;
    }

    // Validate current step first
    const passed = await validateCheckpoint(rootDir, state.currentStep, curriculum);
    if (!passed) {
      console.log(chalk.red('\n❌ Cannot proceed. Please complete current step checkpoints first.\n'));
      process.exit(1);
    }

    // Mark current step as completed
    if (!state.completedSteps.includes(state.currentStep)) {
      state.completedSteps.push(state.currentStep);
    }

    // Move to next step
    const currentIndex = curriculum.steps.findIndex((s: any) => s.id === state.currentStep);
    if (currentIndex < curriculum.steps.length - 1) {
      state.currentStep = curriculum.steps[currentIndex + 1].id;
      saveState(rootDir, state);
      console.log(chalk.green(`\n✅ Step completed! Moving to next step.\n`));
      await tutorialStepCommand(targetPath, String(currentIndex + 2));
    } else {
      state.currentStep = null;
      saveState(rootDir, state);
      console.log(chalk.green('\n🎉 Congratulations! You\'ve completed the tutorial!\n'));
    }
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Status command
 */
export async function tutorialStatusCommand(targetPath: string | undefined): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  try {
    const curriculum = loadCurriculum(rootDir);
    const state = loadState(rootDir);

    console.log(chalk.blue('\n📊 Tutorial Progress\n'));
    console.log(`Current Step: ${state.currentStep || 'Not started'}`);
    console.log(`Completed: ${state.completedSteps.length}/${curriculum.steps.length}`);
    console.log(`Bugs Fixed: ${state.fixedBugs.length}\n`);

    if (state.currentStep) {
      const step = curriculum.steps.find((s: any) => s.id === state.currentStep);
      if (step) {
        console.log(chalk.cyan(`Current: ${step.title}`));
        console.log(chalk.gray(step.description));
      }
    }
    console.log('');
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Reset command
 */
export async function tutorialResetCommand(targetPath: string | undefined): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  const statePath = path.join(rootDir, TUTORIAL_STATE_FILE);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }

  console.log(chalk.green('\n✅ Tutorial reset. Run `horizon tutorial start` to begin again.\n'));
}

/**
 * Bugs command
 */
export async function tutorialBugsCommand(targetPath: string | undefined): Promise<void> {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();

  try {
    const curriculum = loadCurriculum(rootDir);
    const state = loadState(rootDir);

    console.log(chalk.blue('\n🐛 Intentional Bugs\n'));

    for (const bug of curriculum.bugs || []) {
      const fixed = state.fixedBugs.includes(bug.id);
      console.log(`${fixed ? chalk.green('✅') : chalk.yellow('⏳')} ${bug.title}`);
      console.log(chalk.gray(`   ${bug.description}`));
      if (bug.hint) {
        console.log(chalk.gray(`   Hint: ${bug.hint}`));
      }
      console.log('');
    }
  } catch (error) {
    console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
    process.exit(1);
  }
}
