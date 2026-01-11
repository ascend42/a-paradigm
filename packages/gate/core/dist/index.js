// src/parser.ts
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { glob } from "glob";
var DEFAULT_DEV_SETTINGS = {
  visualizerPort: 3100,
  watcherPort: 3101,
  autoConnect: true
};
async function parseGateConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const rootDir = path.dirname(absolutePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Gate config not found: ${absolutePath}`);
  }
  const content = fs.readFileSync(absolutePath, "utf8");
  const config = yaml.load(content);
  if (!config.version) {
    throw new Error('Gate config missing required "version" field');
  }
  const gates = [];
  if (config.gates) {
    for (const [id, gateDef] of Object.entries(config.gates)) {
      gates.push(normalizeGate(id, gateDef));
    }
  }
  if (config.include) {
    for (const pattern of config.include) {
      const fullPattern = path.join(rootDir, pattern);
      const files = await glob(fullPattern.replace(/\\/g, "/"));
      for (const file of files) {
        const additionalGates = await parseGateFile(file);
        gates.push(...additionalGates);
      }
    }
  }
  const flows = [];
  if (config.flows) {
    for (const [id, flowDef] of Object.entries(config.flows)) {
      flows.push(normalizeFlow(id, flowDef));
    }
  }
  return {
    version: config.version,
    gates,
    flows,
    settings: {
      dev: {
        ...DEFAULT_DEV_SETTINGS,
        ...config.settings?.dev
      }
    }
  };
}
async function parseGateFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const data = yaml.load(content);
  if (data.id) {
    return [normalizeGate(data.id, data)];
  }
  if (data.gates) {
    const gates = [];
    for (const [id, gateDef] of Object.entries(data.gates)) {
      gates.push(normalizeGate(id, gateDef));
    }
    return gates;
  }
  return [];
}
function normalizeGate(id, def) {
  const locks = [];
  if (def.locks) {
    for (const lockDef of def.locks) {
      locks.push(normalizeLock(lockDef));
    }
  }
  const prizes = [];
  if (def.prizes) {
    for (const prizeDef of def.prizes) {
      prizes.push(normalizePrize(prizeDef));
    }
  }
  return {
    id,
    description: def.description,
    locks,
    prizes,
    position: def.position
  };
}
function normalizeLock(def) {
  const lockDef = def;
  const keys = [];
  if (lockDef.keys) {
    for (const keyDef of lockDef.keys) {
      if (typeof keyDef === "string") {
        keys.push({ expression: keyDef });
      } else if (keyDef.expression) {
        const k = keyDef;
        keys.push({
          expression: k.expression,
          description: k.description
        });
      }
    }
  }
  return {
    id: lockDef.id,
    description: lockDef.description,
    keys,
    mode: lockDef.mode || "all"
  };
}
function normalizePrize(def) {
  const prizeDef = def;
  return {
    id: prizeDef.id,
    oneTime: prizeDef.oneTime ?? false,
    metadata: prizeDef.metadata
  };
}
function normalizeFlow(id, def) {
  return {
    id,
    description: def.description,
    gates: def.gates || [],
    forkable: def.forkable
  };
}
function serializeGateConfig(config) {
  const output = {
    version: config.version,
    gates: {},
    flows: {},
    settings: {
      dev: config.settings.dev
    }
  };
  for (const gate of config.gates) {
    const { id, ...rest } = gate;
    output.gates[id] = rest;
  }
  for (const flow of config.flows) {
    const { id, ...rest } = flow;
    output.flows[id] = rest;
  }
  return yaml.dump(output, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}
function getDefaultGateConfig() {
  const config = {
    version: "1.0.0",
    gates: {
      "example-gate": {
        description: "An example gate to get you started",
        locks: [
          {
            id: "example-lock",
            description: "Requires user to be authenticated",
            keys: [{ expression: "user.isAuthenticated === true" }]
          }
        ],
        prizes: [
          {
            id: "example-prize",
            oneTime: true,
            metadata: { event: "first_access" }
          }
        ]
      }
    },
    flows: {
      "example-flow": {
        description: "An example user journey",
        gates: ["example-gate"]
      }
    },
    settings: {
      dev: {
        visualizerPort: 3100,
        watcherPort: 3101,
        autoConnect: true
      }
    }
  };
  return yaml.dump(config, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}
async function findGateFiles(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  const files = await glob("**/gate.yaml", {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"]
  });
  return files;
}

// src/validator.ts
function validateGateConfig(config) {
  const issues = [];
  if (!config.version) {
    issues.push({
      type: "error",
      message: 'Missing required "version" field',
      path: "version"
    });
  }
  const gateIds = /* @__PURE__ */ new Set();
  for (const gate of config.gates) {
    validateGate(gate, gateIds, issues);
    gateIds.add(gate.id);
  }
  for (const flow of config.flows) {
    validateFlow(flow, gateIds, issues);
  }
  return {
    valid: issues.filter((i) => i.type === "error").length === 0,
    issues
  };
}
function validateGate(gate, existingIds, issues) {
  const path2 = `gates.${gate.id}`;
  if (existingIds.has(gate.id)) {
    issues.push({
      type: "error",
      message: `Duplicate gate ID: "${gate.id}"`,
      path: path2
    });
  }
  if (!/^[a-z][a-z0-9-]*$/.test(gate.id)) {
    issues.push({
      type: "warning",
      message: `Gate ID "${gate.id}" should use kebab-case (e.g., "my-gate")`,
      path: path2
    });
  }
  const lockIds = /* @__PURE__ */ new Set();
  for (const lock of gate.locks) {
    validateLock(lock, lockIds, `${path2}.locks`, issues);
    lockIds.add(lock.id);
  }
  const prizeIds = /* @__PURE__ */ new Set();
  for (const prize of gate.prizes) {
    if (prizeIds.has(prize.id)) {
      issues.push({
        type: "error",
        message: `Duplicate prize ID "${prize.id}" in gate "${gate.id}"`,
        path: `${path2}.prizes`
      });
    }
    prizeIds.add(prize.id);
    if (!/^[a-z][a-z0-9-]*$/.test(prize.id)) {
      issues.push({
        type: "warning",
        message: `Prize ID "${prize.id}" should use kebab-case`,
        path: `${path2}.prizes`
      });
    }
  }
  if (gate.locks.length === 0) {
    issues.push({
      type: "warning",
      message: `Gate "${gate.id}" has no locks - any entity can pass through`,
      path: path2
    });
  }
}
function validateLock(lock, existingIds, basePath, issues) {
  const path2 = `${basePath}.${lock.id}`;
  if (existingIds.has(lock.id)) {
    issues.push({
      type: "error",
      message: `Duplicate lock ID: "${lock.id}"`,
      path: path2
    });
  }
  if (!/^[a-z][a-z0-9-]*$/.test(lock.id)) {
    issues.push({
      type: "warning",
      message: `Lock ID "${lock.id}" should use kebab-case`,
      path: path2
    });
  }
  if (lock.keys.length === 0) {
    issues.push({
      type: "error",
      message: `Lock "${lock.id}" has no keys - it can never be opened`,
      path: path2
    });
  }
  for (const key of lock.keys) {
    if (!key.expression || key.expression.trim() === "") {
      issues.push({
        type: "error",
        message: `Key in lock "${lock.id}" has empty expression`,
        path: `${path2}.keys`
      });
    }
    if (key.expression.includes("==") && !key.expression.includes("===")) {
      issues.push({
        type: "warning",
        message: `Key expression uses "==" instead of "===" - consider using strict equality`,
        path: `${path2}.keys`
      });
    }
  }
  if (lock.mode && !["all", "any"].includes(lock.mode)) {
    issues.push({
      type: "error",
      message: `Invalid lock mode "${lock.mode}" - must be "all" or "any"`,
      path: path2
    });
  }
}
function validateFlow(flow, gateIds, issues) {
  const path2 = `flows.${flow.id}`;
  if (!/^[a-z][a-z0-9-]*$/.test(flow.id)) {
    issues.push({
      type: "warning",
      message: `Flow ID "${flow.id}" should use kebab-case`,
      path: path2
    });
  }
  for (const gateId of flow.gates) {
    if (!gateIds.has(gateId)) {
      issues.push({
        type: "error",
        message: `Flow "${flow.id}" references unknown gate "${gateId}"`,
        path: `${path2}.gates`
      });
    }
  }
  if (flow.gates.length === 0) {
    issues.push({
      type: "warning",
      message: `Flow "${flow.id}" has no gates`,
      path: path2
    });
  }
  const seen = /* @__PURE__ */ new Set();
  for (const gateId of flow.gates) {
    if (seen.has(gateId)) {
      issues.push({
        type: "warning",
        message: `Flow "${flow.id}" contains duplicate gate "${gateId}"`,
        path: `${path2}.gates`
      });
    }
    seen.add(gateId);
  }
}
function formatValidationResult(result) {
  if (result.valid && result.issues.length === 0) {
    return "\u2705 Configuration is valid";
  }
  const lines = [];
  const errors = result.issues.filter((i) => i.type === "error");
  const warnings = result.issues.filter((i) => i.type === "warning");
  if (errors.length > 0) {
    lines.push(`
\u274C ${errors.length} error(s):`);
    for (const issue of errors) {
      lines.push(`  \u2022 ${issue.message}${issue.path ? ` (${issue.path})` : ""}`);
    }
  }
  if (warnings.length > 0) {
    lines.push(`
\u26A0\uFE0F  ${warnings.length} warning(s):`);
    for (const issue of warnings) {
      lines.push(`  \u2022 ${issue.message}${issue.path ? ` (${issue.path})` : ""}`);
    }
  }
  if (result.valid) {
    lines.push("\n\u2705 Configuration is valid (with warnings)");
  } else {
    lines.push("\n\u274C Configuration is invalid");
  }
  return lines.join("\n");
}
export {
  findGateFiles,
  formatValidationResult,
  getDefaultGateConfig,
  parseGateConfig,
  parseGateFile,
  serializeGateConfig,
  validateGateConfig
};
