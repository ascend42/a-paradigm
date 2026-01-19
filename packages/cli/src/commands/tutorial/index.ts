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
 * Generate default curriculum for shopflow example
 */
function generateDefaultCurriculum(rootDir: string): void {
  const tutorialDir = path.join(rootDir, '.horizon/tutorial');
  if (!fs.existsSync(tutorialDir)) {
    fs.mkdirSync(tutorialDir, { recursive: true });
  }

  const curriculum = {
    title: 'Horizon Tutorial - ShopFlow Example',
    description: 'Learn Horizon by exploring the ShopFlow e-commerce example',
    steps: [
      {
        id: 'step-1-explore-structure',
        title: 'Explore Project Structure',
        description: 'Understand how Horizon organizes project knowledge',
        file: 'step-1-explore-structure.md',
        checkpoints: [
          {
            type: 'file-exists',
            path: '.purpose'
          },
          {
            type: 'file-exists',
            path: 'gate.yaml'
          },
          {
            type: 'file-exists',
            path: '.horizon/config.yaml'
          }
        ]
      },
      {
        id: 'step-2-understand-purpose',
        title: 'Understanding Purpose Files',
        description: 'Learn how Purpose files define features and components',
        file: 'step-2-understand-purpose.md',
        checkpoints: [
          {
            type: 'file-exists',
            path: '.purpose'
          }
        ]
      },
      {
        id: 'step-3-understand-gates',
        title: 'Understanding Gates',
        description: 'Learn how Gates define authorization and access control',
        file: 'step-3-understand-gates.md',
        checkpoints: [
          {
            type: 'file-exists',
            path: 'gate.yaml'
          }
        ]
      },
      {
        id: 'step-4-explore-symbols',
        title: 'Exploring Symbols',
        description: 'Understand Horizon\'s symbol system and how they connect',
        file: 'step-4-explore-symbols.md',
        checkpoints: [
          {
            type: 'command-success',
            command: 'horizon status'
          }
        ]
      },
      {
        id: 'step-5-visualize',
        title: 'Visualize in Dreamscape',
        description: 'See your project knowledge visualized in the Dreamscape',
        file: 'step-5-visualize.md',
        checkpoints: [
          {
            type: 'command-success',
            command: 'horizon dream aggregate'
          }
        ]
      }
    ],
    bugs: []
  };

  // Write curriculum.yaml
  const curriculumPath = path.join(tutorialDir, 'curriculum.yaml');
  fs.writeFileSync(curriculumPath, yaml.dump(curriculum), 'utf8');

  // Generate step files
  const stepFiles = [
    {
      file: 'step-1-explore-structure.md',
      content: `# Step 1: Explore Project Structure

Welcome to the Horizon tutorial! In this step, you'll explore how Horizon organizes project knowledge.

## What You'll Learn

- How Horizon uses files to structure project knowledge
- The purpose of different Horizon files
- How to navigate a Horizon project

## Tasks

1. **Examine the root .purpose file**
   - Open \`.purpose\` in the root directory
   - Notice how it defines features (\`@\`) and components (\`#\`)
   - See how features reference components and gates

2. **Check the gate.yaml file**
   - Open \`gate.yaml\`
   - Notice how gates (\`^\`) define authorization rules
   - See how gates have locks, keys, and prizes

3. **Explore .horizon directory**
   - Look at \`.horizon/config.yaml\` - this is the Horizon configuration
   - Check \`.horizon/specs/\` - these define the symbol system
   - Browse \`.horizon/docs/\` - reference documentation

4. **Notice the nested structure**
   - Check \`auth/.purpose\`, \`payments/.purpose\`, etc.
   - See how Purpose files can be organized by domain

## Checkpoint

When you're ready, run:
\`\`\`bash
horizon tutorial checkpoint
\`\`\`

This will verify you've explored the key files.
`
    },
    {
      file: 'step-2-understand-purpose.md',
      content: `# Step 2: Understanding Purpose Files

Purpose files are the foundation of Horizon. They define what your project does and how it's structured.

## What You'll Learn

- How Purpose files define features (\`@\`) and components (\`#\`)
- How to read and understand Purpose file syntax
- How features reference other symbols

## Tasks

1. **Read the root .purpose file**
   - Open \`.purpose\` and read through it
   - Identify all features (lines starting with \`- id: "@\`)
   - Identify all components (lines starting with \`- id: "#\`)

2. **Understand feature definitions**
   - Look at \`@product-browse\` - what components does it use?
   - Look at \`@checkout-flow\` - what gates does it require?
   - Notice how features reference other features

3. **Explore nested Purpose files**
   - Open \`auth/.purpose\` - what features are defined here?
   - Open \`payments/.purpose\` - how does it relate to checkout?
   - See how domain-specific Purpose files organize knowledge

4. **Trace a feature**
   - Pick a feature like \`@checkout-flow\`
   - Follow its references to see what it depends on
   - Understand the relationships between features, components, and gates

## Key Concepts

- **Features (\`@\`)** - User-facing capabilities
- **Components (\`#\`)** - Reusable code units
- **References** - How features connect to components and gates

## Checkpoint

Run:
\`\`\`bash
horizon tutorial checkpoint
\`\`\`
`
    },
    {
      file: 'step-3-understand-gates.md',
      content: `# Step 3: Understanding Gates

Gates define authorization and access control in Horizon. They're like security checkpoints.

## What You'll Learn

- How gates (\`^\`) define access control
- The structure of locks, keys, and prizes
- How gates protect features

## Tasks

1. **Examine gate.yaml**
   - Open \`gate.yaml\` and read through it
   - Notice the structure: gates → locks → keys
   - See how prizes are awarded when gates pass

2. **Understand a simple gate**
   - Look at \`^auth-required\`
   - What lock does it have?
   - What key expression checks authentication?
   - What prize is awarded?

3. **Explore a complex gate**
   - Look at \`^admin-panel\`
   - How many locks does it have?
   - What conditions must be met?
   - What prizes are available?

4. **See gates in action**
   - Go back to \`.purpose\` files
   - Find features that reference gates (like \`^auth-required\`)
   - Understand how gates protect features

## Key Concepts

- **Gates (\`^\`)** - Access control points
- **Locks** - Conditions that must be met
- **Keys** - Expressions that unlock locks
- **Prizes** - Rewards when gates pass

## Checkpoint

Run:
\`\`\`bash
horizon tutorial checkpoint
\`\`\`
`
    },
    {
      file: 'step-4-explore-symbols.md',
      content: `# Step 4: Exploring Symbols

Horizon uses a symbol system to create a shared language between code, developers, and AI.

## What You'll Learn

- All the symbol types in Horizon
- Concatenated symbols (compound ideas like \`?@\`, \`?#\`, \`?!\`)
- How symbols reference each other
- How to use horizon commands to explore symbols

## Tasks

1. **Run horizon status**
   \`\`\`bash
   horizon status
   \`\`\`
   - See how many features, components, gates, etc. are defined
   - Notice the symbol counts

2. **Understand symbol types**
   - \`@\` - Features (user-facing capabilities)
   - \`#\` - Components (reusable code units)
   - \`$\` - Flows (multi-step processes)
   - \`%\` - State (global/user state)
   - \`~\` - Aspects (cross-cutting concerns)
   - \`^\` - Gates (access control)
   - \`!\` - Signals (events/errors)
   - \`?\` - Ideas (exploration)

3. **Understand concatenated symbols (compound ideas)**
   Ideas can specify what type of symbol they're exploring by using a compound prefix:
   - \`?@subscription-model\` - Idea for a feature
   - \`?#dark-mode-toggle\` - Idea for a component
   - \`?$express-checkout\` - Idea for a flow
   - \`?%user-preferences\` - Idea for state
   - \`?~performance-optimization\` - Idea for an aspect
   - \`?^premium-access\` - Idea for a gate
   - \`?!payment-webhook\` - Idea for a signal
   
   **Why use compound ideas?**
   - **Categorization**: Makes it clear what type of symbol the idea relates to
   - **Discoverability**: In the Dreamscape visualizer, compound ideas connect to their target symbol type
   - **Planning**: Helps organize ideas by what they would become if implemented
   
   **Simple vs Compound:**
   - \`?subscription-model\` - General idea, no specific type
   - \`?@subscription-model\` - Idea specifically for a feature

4. **Trace symbol relationships**
   - Pick a feature like \`@checkout-flow\`
   - See what gates it requires
   - See what components it uses
   - See what flows it's part of
   - Look for compound ideas in \`.dream\` files

5. **Explore with horizon commands**
   \`\`\`bash
   horizon purpose validate
   horizon gate validate
   \`\`\`
   - Validate your Purpose files
   - Validate your gate configuration

## Key Concepts

- Symbols create a traceable web of relationships
- Compound ideas (\`?@\`, \`?#\`, etc.) categorize ideas by their target symbol type
- In the Dreamscape visualizer, compound ideas visually connect to their symbol type
- AI agents can follow these relationships
- Symbols make project knowledge discoverable

## Checkpoint

Run:
\`\`\`bash
horizon tutorial checkpoint
\`\`\`
`
    },
    {
      file: 'step-5-visualize.md',
      content: `# Step 5: Visualize in Dreamscape

The Dreamscape is Horizon's infinite canvas where all project knowledge flows together.

## What You'll Learn

- How to aggregate all symbols into the Dreamscape
- How to visualize your project knowledge
- How to explore relationships visually

## Tasks

1. **Aggregate symbols**
   \`\`\`bash
   horizon dream aggregate
   \`\`\`
   - This combines all Purpose and Gate files
   - Creates a unified symbol index
   - Prepares data for visualization

2. **Open the Dreamscape**
   \`\`\`bash
   horizon visualize
   \`\`\`
   - This opens the visualizer in your browser
   - You'll see all your symbols as nodes
   - Connections show relationships

3. **Explore visually**
   - Click on features to see their connections
   - See how gates protect features
   - Understand the flow of information
   - Notice how everything connects

4. **Understand the big picture**
   - See how ShopFlow is structured
   - Understand feature dependencies
   - Visualize authorization topology

## Key Concepts

- The Dreamscape shows everything at once
- Visual exploration helps understand relationships
- Symbols become nodes, references become connections

## Checkpoint

Run:
\`\`\`bash
horizon tutorial checkpoint
\`\`\`

## Next Steps

Congratulations! You've completed the tutorial. You now understand:
- How Horizon structures project knowledge
- How Purpose files define features and components
- How Gates define authorization
- How symbols create relationships
- How to visualize everything in the Dreamscape

Continue exploring ShopFlow, or start using Horizon in your own projects!
`
    }
  ];

  for (const stepFile of stepFiles) {
    const stepPath = path.join(tutorialDir, stepFile.file);
    fs.writeFileSync(stepPath, stepFile.content, 'utf8');
  }
}

/**
 * Load curriculum
 */
function loadCurriculum(rootDir: string): any {
  const curriculumPath = path.join(rootDir, CURRICULUM_FILE);
  if (!fs.existsSync(curriculumPath)) {
    // Generate default curriculum if it doesn't exist
    generateDefaultCurriculum(rootDir);
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
    // Check if curriculum exists, generate if not
    const curriculumPath = path.join(rootDir, CURRICULUM_FILE);
    if (!fs.existsSync(curriculumPath)) {
      console.log(chalk.blue('\n📚 Generating tutorial curriculum...\n'));
      generateDefaultCurriculum(rootDir);
      console.log(chalk.green('✅ Tutorial curriculum generated!\n'));
    }

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
      
      // Show next step information
      const currentIndex = curriculum.steps.findIndex((s: any) => s.id === state.currentStep);
      if (currentIndex < curriculum.steps.length - 1) {
        const nextStep = curriculum.steps[currentIndex + 1];
        const nextStepFile = path.join(rootDir, '.horizon/tutorial', nextStep.file);
        
        if (fs.existsSync(nextStepFile)) {
          console.log(chalk.cyan(`\n📖 Next Step: ${nextStep.title}\n`));
          console.log(chalk.gray(nextStep.description));
          console.log(chalk.gray(`\nRun 'horizon tutorial step ${currentIndex + 2}' to view full instructions.\n`));
        }
      } else {
        console.log(chalk.green('\n🎉 Congratulations! You\'ve completed all steps!\n'));
        console.log(chalk.gray('Run \'horizon tutorial next\' to mark this step as complete.\n'));
      }
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
