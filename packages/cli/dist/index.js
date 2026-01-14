#!/usr/bin/env node
import {
  detectIDE,
  loadHorizonFiles,
  syncToIDE
} from "./chunk-4U5Z2TAL.js";
import "./chunk-5GIGQCQC.js";

// src/index.ts
import { Command } from "commander";
import chalk4 from "chalk";

// src/commands/init.ts
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import ora from "ora";
import { getDefaultPurposeContent } from "@horizon/purpose-core";
import { getDefaultGateConfig } from "@horizon/gate-core";
import { getDefaultDreamContent } from "@horizon/dream-core";
function getTemplatesDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const possiblePaths = [
    path.join(__dirname, "..", "..", "templates", "horizon"),
    path.join(__dirname, "..", "templates", "horizon"),
    path.join(__dirname, "..", "..", "src", "templates", "horizon")
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.join(__dirname, "..", "templates", "horizon");
}
function copyDir(src, dest, projectName) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, projectName);
    } else {
      let content = fs.readFileSync(srcPath, "utf8");
      content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
      fs.writeFileSync(destPath, content, "utf8");
    }
  }
}
async function initCommand(options) {
  const cwd = process.cwd();
  const projectName = options.name || path.basename(cwd);
  console.log(chalk.blue("\n\u{1F305} Initializing Horizon...\n"));
  const spinner = ora();
  const templatesDir = getTemplatesDir();
  const horizonDir = path.join(cwd, ".horizon");
  const legacyHorizonFile = path.join(cwd, ".horizon");
  if (fs.existsSync(horizonDir)) {
    const stat = fs.statSync(horizonDir);
    if (stat.isFile()) {
      if (!options.force) {
        console.log(chalk.yellow("  \u26A0 Legacy .horizon file found."));
        console.log(chalk.gray("    Run `horizon upgrade --all` to migrate to new format."));
        console.log(chalk.gray("    Or use --force to overwrite.\n"));
        return;
      }
      fs.unlinkSync(legacyHorizonFile);
    } else if (stat.isDirectory() && !options.force) {
      console.log(chalk.yellow("  \u26A0 .horizon/ directory already exists (use --force to overwrite)"));
      return;
    }
  }
  spinner.start("Creating .horizon/ directory...");
  try {
    if (!fs.existsSync(horizonDir)) {
      fs.mkdirSync(horizonDir, { recursive: true });
    }
    if (fs.existsSync(templatesDir)) {
      copyDir(templatesDir, horizonDir, projectName);
      spinner.succeed(chalk.green(".horizon/ directory created with specs, docs, and prompts"));
    } else {
      spinner.warn(chalk.yellow("Templates not found, creating minimal structure"));
      fs.mkdirSync(path.join(horizonDir, "specs"), { recursive: true });
      fs.mkdirSync(path.join(horizonDir, "docs"), { recursive: true });
      fs.mkdirSync(path.join(horizonDir, "prompts"), { recursive: true });
      const minimalConfig = `# Horizon Configuration
version: "1.0"
project: "${projectName}"

agent-guidelines:
  overview: |
    This project uses Horizon for structured AI-assisted development.
  how-to-use:
    - Check .horizon/specs/ for philosophy and patterns
    - Use symbol prefixes: @feature #component ^gate !signal %state $flow
    - Use the Horizon logger instead of raw console.log/print

symbol-system:
  "@":
    name: Feature
    description: User-facing capabilities
    owner: purpose
    examples: ["@login", "@checkout"]
  "#":
    name: Component
    description: Reusable code units
    owner: purpose
    examples: ["#Button", "#api-client"]
  "^":
    name: Gate
    description: Access control points
    owner: gate
    examples: ["^authenticated", "^admin-only"]
  "!":
    name: Signal
    description: Events and side effects
    owner: gate
    examples: ["!login-success", "!payment-failed"]
  "%":
    name: State
    description: Application state
    owner: purpose
    examples: ["%user.authenticated", "%cart.items"]
  "$":
    name: Flow
    description: Multi-step processes
    owner: shared
    examples: ["$checkout-flow", "$onboarding"]

logging:
  enforce: true
  default-level: debug

scan:
  enabled: true

conventions:
  - Use kebab-case for symbol IDs
  - ALWAYS use Horizon logger, NEVER raw console.log/print
`;
      fs.writeFileSync(path.join(horizonDir, "config.yaml"), minimalConfig, "utf8");
      spinner.succeed(chalk.green(".horizon/ directory created (minimal)"));
    }
  } catch (error) {
    spinner.fail(chalk.red(`Failed to create .horizon/: ${error.message}`));
    return;
  }
  const dreamPath = path.join(cwd, ".dream");
  if (fs.existsSync(dreamPath) && !options.force) {
    console.log(chalk.yellow("  \u26A0 .dream file already exists"));
  } else {
    spinner.start("Creating .dream file...");
    fs.writeFileSync(dreamPath, getDefaultDreamContent(projectName));
    spinner.succeed(chalk.green(".dream file created"));
  }
  const purposePath = path.join(cwd, ".purpose");
  if (fs.existsSync(purposePath) && !options.force) {
    console.log(chalk.yellow("  \u26A0 .purpose file already exists"));
  } else {
    spinner.start("Creating .purpose file...");
    fs.writeFileSync(purposePath, getDefaultPurposeContent());
    spinner.succeed(chalk.green(".purpose file created"));
  }
  const gatePath = path.join(cwd, "gate.yaml");
  if (fs.existsSync(gatePath)) {
    console.log(chalk.green("  \u2713 Detected existing gate.yaml"));
  } else if (options.force) {
    spinner.start("Creating gate.yaml...");
    fs.writeFileSync(gatePath, getDefaultGateConfig());
    spinner.succeed(chalk.green("gate.yaml created"));
  } else {
    console.log(chalk.gray("  \u25CB No gate.yaml found (optional)"));
  }
  spinner.start("Detecting IDE...");
  const detection = detectIDE(cwd);
  if (detection.detected) {
    spinner.succeed(`Detected ${chalk.cyan(detection.detected)}`);
    const files = loadHorizonFiles(cwd);
    if (files) {
      spinner.start(`Generating IDE instructions...`);
      const result = syncToIDE(cwd, detection.detected, files, true);
      if (result.success) {
        spinner.succeed(chalk.green(`${result.outputPath} generated`));
      } else {
        spinner.warn(chalk.yellow(`Could not generate IDE file: ${result.message}`));
      }
    }
  } else {
    spinner.info("No IDE detected, skipping sync (run `horizon sync` later)");
  }
  console.log(chalk.blue("\n\u2728 Horizon initialized!\n"));
  console.log(chalk.gray("Created:"));
  console.log(chalk.white("  \u2022 .horizon/           - Configuration & specifications"));
  console.log(chalk.white("    \u251C\u2500\u2500 config.yaml     - Main configuration"));
  console.log(chalk.white("    \u251C\u2500\u2500 specs/          - Logger, scan, symbols specs"));
  console.log(chalk.white("    \u251C\u2500\u2500 docs/           - Commands, patterns, troubleshooting"));
  console.log(chalk.white("    \u2514\u2500\u2500 prompts/        - Pre-written task prompts"));
  console.log(chalk.white("  \u2022 .dream              - Project overview & ideas"));
  console.log(chalk.white("  \u2022 .purpose            - Feature & component context"));
  if (detection.detected) {
    const outputFile = detection.detected === "cursor" ? ".cursorrules" : detection.detected === "copilot" ? ".github/copilot-instructions.md" : ".windsurfrules";
    console.log(chalk.white(`  \u2022 ${outputFile}  - IDE instructions`));
  }
  console.log("");
  console.log(chalk.gray("Next steps:"));
  console.log(chalk.white("  1. Review " + chalk.cyan(".horizon/config.yaml") + " and customize"));
  console.log(chalk.white("  2. Check " + chalk.cyan(".horizon/specs/") + " for logging & scan specs"));
  console.log(chalk.white("  3. Edit " + chalk.cyan(".purpose") + " to define your project context"));
  console.log(chalk.white("  4. Run " + chalk.cyan("horizon sync") + " after config changes"));
  console.log(chalk.white("  5. Run " + chalk.cyan("horizon doctor") + " to verify setup\n"));
}

// src/commands/visualize.ts
import chalk2 from "chalk";
import ora2 from "ora";
import open from "open";
async function visualizeCommand(options) {
  const port = parseInt(options.port, 10);
  console.log(chalk2.blue("\n\u{1F30C} Starting Dreamscape...\n"));
  const spinner = ora2("Aggregating symbols...").start();
  await new Promise((resolve) => setTimeout(resolve, 500));
  spinner.succeed("Aggregated symbols");
  spinner.start("Starting visualizer server...");
  await new Promise((resolve) => setTimeout(resolve, 300));
  spinner.succeed("Visualizer ready");
  const url = `http://localhost:${port}`;
  console.log(chalk2.blue(`
\u2728 Dreamscape running at ${chalk2.cyan(url)}
`));
  console.log(chalk2.gray("Press Ctrl+C to stop\n"));
  if (options.open !== false) {
    await open(url);
  }
  console.log(chalk2.yellow("Note: In development, run the visualizer with:"));
  console.log(chalk2.cyan("  npm run dev:visualizer\n"));
}

// src/commands/status.ts
import * as fs2 from "fs";
import * as path2 from "path";
import chalk3 from "chalk";
import ora3 from "ora";
import {
  aggregateFromDirectory,
  buildSymbolIndex,
  getSymbolCounts
} from "@horizon/dream-core";
import { findPurposeFiles } from "@horizon/purpose-core";
import { findGateFiles } from "@horizon/gate-core";
async function statusCommand() {
  const cwd = process.cwd();
  console.log(chalk3.blue("\n\u{1F4CA} Horizon Status\n"));
  console.log(chalk3.gray("\u2500".repeat(40)));
  const spinner = ora3("Scanning project...").start();
  const hasDream = fs2.existsSync(path2.join(cwd, ".dream"));
  const hasPurpose = fs2.existsSync(path2.join(cwd, ".purpose"));
  const hasGate = fs2.existsSync(path2.join(cwd, "gate.yaml"));
  spinner.stop();
  console.log(chalk3.white("\nConfiguration Files"));
  console.log(chalk3.gray("\u2500".repeat(40)));
  console.log(`  .dream:     ${hasDream ? chalk3.green("\u2713 Found") : chalk3.yellow("\u25CB Not found")}`);
  console.log(`  .purpose:   ${hasPurpose ? chalk3.green("\u2713 Found") : chalk3.yellow("\u25CB Not found")}`);
  console.log(`  gate.yaml:  ${hasGate ? chalk3.green("\u2713 Found") : chalk3.yellow("\u25CB Not found")}`);
  spinner.start("Counting files...");
  const purposeFiles = await findPurposeFiles(cwd);
  const gateFiles = await findGateFiles(cwd);
  spinner.stop();
  console.log(chalk3.white("\nSource Files"));
  console.log(chalk3.gray("\u2500".repeat(40)));
  console.log(`  Purpose files:  ${chalk3.cyan(purposeFiles.length.toString())}`);
  console.log(`  Gate files:     ${chalk3.cyan(gateFiles.length.toString())}`);
  if (hasDream || hasPurpose || hasGate) {
    spinner.start("Aggregating symbols...");
    try {
      const result = await aggregateFromDirectory(cwd);
      const index = buildSymbolIndex(result);
      const counts = getSymbolCounts(index);
      spinner.stop();
      console.log(chalk3.white("\nSymbol Index"));
      console.log(chalk3.gray("\u2500".repeat(40)));
      const symbolLines = [
        { prefix: "@", name: "Features", count: counts.feature, color: chalk3.blue },
        { prefix: "#", name: "Components", count: counts.component, color: chalk3.green },
        { prefix: "$", name: "Flows", count: counts.flow, color: chalk3.yellow },
        { prefix: "%", name: "States", count: counts.state, color: chalk3.magenta },
        { prefix: "^", name: "Gates", count: counts.gate, color: chalk3.red },
        { prefix: "!", name: "Signals", count: counts.signal, color: chalk3.yellow },
        { prefix: "?", name: "Ideas", count: counts.idea, color: chalk3.white }
      ];
      for (const { prefix, name, count, color } of symbolLines) {
        if (count > 0) {
          console.log(`  ${color(prefix)} ${name.padEnd(12)} ${chalk3.cyan(count.toString())}`);
        }
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(chalk3.gray("\u2500".repeat(40)));
      console.log(`  Total:          ${chalk3.cyan(total.toString())}`);
      if (result.errors.length > 0) {
        console.log(chalk3.white("\nWarnings"));
        console.log(chalk3.gray("\u2500".repeat(40)));
        for (const error of result.errors) {
          console.log(chalk3.yellow(`  \u26A0 ${error.source}: ${error.message}`));
        }
      }
    } catch (error) {
      spinner.fail("Failed to aggregate");
      console.log(chalk3.red(`  Error: ${error.message}`));
    }
  }
  console.log("");
}

// src/index.ts
var VERSION = "0.1.0";
var program = new Command();
var banner = `
${chalk4.blue("\u2566 \u2566")}${chalk4.cyan("\u250C\u2500\u2510\u252C\u2500\u2510\u252C\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2510\u250C")}
${chalk4.blue("\u2560\u2550\u2563")}${chalk4.cyan("\u2502 \u2502\u251C\u252C\u2518\u2502\u250C\u2500\u2518\u2502 \u2502\u2502\u2502\u2502")}
${chalk4.blue("\u2569 \u2569")}${chalk4.cyan("\u2514\u2500\u2518\u2534\u2514\u2500\u2534\u2514\u2500\u2518\u2514\u2500\u2518\u2518\u2514\u2518")} ${chalk4.gray(`v${VERSION}`)}
`;
program.name("horizon").description("Unified developer tools ecosystem").version(VERSION).addHelpText("before", banner);
program.command("init").description("Initialize Horizon in the current project").option("-f, --force", "Overwrite existing files").option("--name <name>", "Project name for .dream file").action(initCommand);
program.command("setup [path]").description("Interactive setup wizard for Horizon").option("-y, --yes", "Accept all defaults (non-interactive)").option("-f, --force", "Overwrite existing .horizon config").action(async (path3, options) => {
  const { setupCommand } = await import("./setup-4UYSOV6V.js");
  await setupCommand(path3, options);
});
program.command("visualize").alias("vis").alias("v").description("Launch the Dreamscape visualizer").option("-p, --port <port>", "Port to run the visualizer on", "3000").option("--no-open", "Do not auto-open browser").action(visualizeCommand);
program.command("status").alias("st").description("Show project status and symbol counts").action(statusCommand);
var purposeCmd = program.command("purpose").description("Purpose-related commands");
purposeCmd.command("remember [path]").description("Aggregate and display purpose context").action(async (path3 = ".") => {
  const { purposeRememberCommand } = await import("./remember-G744KHPC.js");
  await purposeRememberCommand(path3);
});
purposeCmd.command("validate [path]").description("Validate purpose files").action(async (path3 = ".") => {
  const { purposeValidateCommand } = await import("./validate-TAKI5OK7.js");
  await purposeValidateCommand(path3);
});
var gateCmd = program.command("gate").description("Gate-related commands");
gateCmd.command("validate [path]").description("Validate gate.yaml configuration").action(async (path3 = "./gate.yaml") => {
  const { gateValidateCommand } = await import("./validate-UO6B2N6R.js");
  await gateValidateCommand(path3);
});
var dreamCmd = program.command("dream").description("Dream-related commands");
dreamCmd.command("aggregate [path]").description("Aggregate all sources into symbol index").action(async (path3 = ".") => {
  const { dreamAggregateCommand } = await import("./aggregate-JFYXHXEC.js");
  await dreamAggregateCommand(path3);
});
dreamCmd.command("snapshot <name>").description("Create a timeline snapshot").option("-d, --description <desc>", "Snapshot description").action(async (name, options) => {
  const { dreamSnapshotCommand } = await import("./snapshot-C5OH6WZJ.js");
  await dreamSnapshotCommand(name, options.description);
});
program.command("sync [ide]").description("Generate IDE instruction files from .horizon/ config").option("--all", "Sync all supported IDEs").option("-f, --force", "Overwrite existing files").action(async (ide, options) => {
  const { syncCommand } = await import("./sync-IPLN5UY4.js");
  await syncCommand(ide, options);
});
program.command("cursorrules [path]").description("[DEPRECATED] Use `horizon sync cursor` instead").option("-a, --append", "Append to existing .cursorrules").option("-f, --force", "Overwrite existing .cursorrules").option("-p, --preview", "Preview output without writing").option("--init", "Create default .horizon config if missing").option("--with-scan", "Include scan protocol section").action(async (path3, options) => {
  console.log("\x1B[33m\u26A0\uFE0F  `horizon cursorrules` is deprecated. Use `horizon sync cursor` instead.\x1B[0m\n");
  const { cursorrrulesCommand } = await import("./cursorrules-VK4SO7NF.js");
  await cursorrrulesCommand(path3, options);
});
program.command("index [path]").description("Generate scan index for visual discovery").option("-o, --output <path>", "Output path for scan-index.json").option("-q, --quiet", "Suppress output").action(async (path3, options) => {
  const { indexCommand } = await import("./scan-TDCOQDGX.js");
  await indexCommand(path3, options);
});
var scanCmd = program.command("scan").description("Scan-related commands");
scanCmd.command("index [path]").description("Generate scan index (alias for `horizon index`)").option("-o, --output <path>", "Output path for scan-index.json").option("-q, --quiet", "Suppress output").action(async (path3, options) => {
  const { indexCommand } = await import("./scan-TDCOQDGX.js");
  await indexCommand(path3, options);
});
program.command("upgrade [path]").description("Upgrade project with new Horizon features").option("--features <features...>", "Features to upgrade (scan, logger)").option("--all", "Apply all available upgrades").option("--dry-run", "Show what would be upgraded without making changes").option("-f, --force", "Force re-upgrade even if already configured").action(async (path3, options) => {
  const { upgradeCommand } = await import("./upgrade-ZI6FOW4E.js");
  await upgradeCommand(path3, options);
});
program.command("doctor").description("Health check - validate Horizon setup").action(async () => {
  const { doctorCommand } = await import("./doctor-L4GZELY2.js");
  await doctorCommand();
});
program.command("watch").description("Watch for changes and auto-sync IDE files").action(async () => {
  const { watchCommand } = await import("./watch-EDLA657X.js");
  await watchCommand();
});
program.command("summary").description("Generate .horizon/project.md with project stats").action(async () => {
  const { summaryCommand } = await import("./summary-3K6HACHI.js");
  await summaryCommand();
});
program.parse();
