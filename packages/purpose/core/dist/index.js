// src/parser.ts
import * as fs from "fs";
import * as yaml from "js-yaml";
import { z } from "zod";
var PurposeItemSchema = z.object({
  description: z.string(),
  endpoints: z.array(z.string()).optional(),
  tests: z.array(z.string()).optional(),
  rules: z.record(z.unknown()).optional(),
  aspects: z.record(z.unknown()).optional(),
  // Symbol reference arrays
  flows: z.array(z.string()).optional(),
  gates: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  // Extra fields preserved
  tags: z.array(z.string()).optional(),
  location: z.string().optional(),
  locations: z.array(z.string()).optional(),
  uses: z.array(z.string()).optional(),
  "used-by": z.array(z.string()).optional(),
  "used-for": z.array(z.string()).optional(),
  exports: z.array(z.string()).optional(),
  status: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  handles: z.array(z.string()).optional()
}).passthrough();
var PurposeItemArraySchema = PurposeItemSchema.extend({
  id: z.string()
});
var SignalDefinitionObjectSchema = z.object({
  description: z.string().optional(),
  category: z.string().optional(),
  severity: z.enum(["info", "warn", "error"]).optional(),
  emitters: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  data: z.record(z.unknown()).optional()
});
var SignalDefinitionSchema = z.union([
  SignalDefinitionObjectSchema,
  z.string().transform((desc) => ({ description: desc }))
]);
var RelationshipObjectSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  description: z.string().optional()
});
var RelationshipSchema = z.union([RelationshipObjectSchema, z.string()]);
var FlowStepObjectSchema = z.object({
  component: z.string(),
  action: z.string(),
  description: z.string().optional()
});
var FlowStepSchema = z.union([FlowStepObjectSchema, z.string()]);
var FlowWithStepsSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(FlowStepSchema)
});
var FlowDefinitionSchema = z.object({
  description: z.string().optional(),
  gates: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  steps: z.array(FlowStepSchema).optional()
});
var GateDefinitionSchema = z.object({
  description: z.string().optional(),
  requires: z.array(z.string()).optional(),
  keys: z.array(z.string()).optional(),
  signals: z.array(z.string()).optional()
});
var StateDefinitionSchema = z.object({
  description: z.string().optional(),
  default: z.unknown().optional(),
  type: z.string().optional()
});
var AspectDefinitionSchema = z.object({
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  anchors: z.array(z.string()).optional(),
  "applies-to": z.array(z.string()).optional(),
  enforcement: z.string().optional()
});
var ReferenceSchema = z.object({
  target: z.string(),
  type: z.string(),
  path: z.string()
});
var PurposeFileSchema = z.object({
  version: z.string().optional(),
  description: z.string().optional(),
  apiSpec: z.string().optional(),
  context: z.array(z.string()).optional(),
  rules: z.record(z.unknown()).optional(),
  // Support both array format [{ id, description }] and record format { id: { description } }
  features: z.union([
    z.array(PurposeItemArraySchema),
    z.record(PurposeItemSchema)
  ]).optional(),
  components: z.union([
    z.array(PurposeItemArraySchema),
    z.record(PurposeItemSchema)
  ]).optional(),
  gates: z.record(GateDefinitionSchema).optional(),
  states: z.record(StateDefinitionSchema).optional(),
  signals: z.record(SignalDefinitionSchema).optional(),
  aspects: z.record(AspectDefinitionSchema).optional(),
  relationships: z.array(RelationshipSchema).optional(),
  // Support both array format and record format for flows
  flows: z.union([
    z.array(FlowWithStepsSchema),
    z.record(FlowDefinitionSchema)
  ]).optional(),
  references: z.array(ReferenceSchema).optional()
});
function parsePurposeFile(filePath) {
  const result = parsePurposeFileDetailed(filePath);
  return { data: result.data, errors: result.errors };
}
function parsePurposeFileDetailed(filePath) {
  const errors = [];
  const detailedErrors = [];
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    const error = `Cannot read file: ${e.message}`;
    errors.push(error);
    detailedErrors.push({ message: error, type: "file" });
    return { data: null, errors, detailedErrors, rawContent: void 0, isYamlValid: false };
  }
  let data = null;
  try {
    data = yaml.load(rawContent);
  } catch (e) {
    const yamlError = e;
    const line = yamlError.mark?.line ? yamlError.mark.line + 1 : void 0;
    const message = `YAML syntax error: ${yamlError.reason || e.message}`;
    errors.push(`${message}${line ? ` (line ${line})` : ""}`);
    detailedErrors.push({
      message,
      line,
      type: "yaml"
    });
    return { data: null, errors, detailedErrors, rawContent, isYamlValid: false };
  }
  if (data === null || data === void 0) {
    return {
      data: {},
      errors: [],
      detailedErrors: [],
      rawContent,
      isYamlValid: true
    };
  }
  const parseResult = PurposeFileSchema.safeParse(data);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path2 = issue.path.join(".");
      const message = issue.message;
      errors.push(`Schema error at ${path2 || "/"}: ${message}`);
      detailedErrors.push({
        message,
        path: path2 || "/",
        type: "schema"
      });
    }
    return { data, errors, detailedErrors, rawContent, isYamlValid: true };
  }
  return { data: parseResult.data, errors: [], detailedErrors: [], rawContent, isYamlValid: true };
}
function parsePurposeContent(content) {
  const errors = [];
  const detailedErrors = [];
  let data = null;
  try {
    data = yaml.load(content);
  } catch (e) {
    const yamlError = e;
    const line = yamlError.mark?.line ? yamlError.mark.line + 1 : void 0;
    const message = `YAML syntax error: ${yamlError.reason || e.message}`;
    errors.push(`${message}${line ? ` (line ${line})` : ""}`);
    detailedErrors.push({
      message,
      line,
      type: "yaml"
    });
    return { data: null, errors, detailedErrors, rawContent: content, isYamlValid: false };
  }
  if (data === null || data === void 0) {
    return {
      data: {},
      errors: [],
      detailedErrors: [],
      rawContent: content,
      isYamlValid: true
    };
  }
  const parseResult = PurposeFileSchema.safeParse(data);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path2 = issue.path.join(".");
      const message = issue.message;
      errors.push(`Schema error at ${path2 || "/"}: ${message}`);
      detailedErrors.push({
        message,
        path: path2 || "/",
        type: "schema"
      });
    }
    return { data, errors, detailedErrors, rawContent: content, isYamlValid: true };
  }
  return { data: parseResult.data, errors: [], detailedErrors: [], rawContent: content, isYamlValid: true };
}
function serializePurposeFile(data) {
  return yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}
function getDefaultPurposeContent() {
  const defaultFile = {
    version: "1.0.0",
    description: "Project purpose and context",
    context: [
      "Add contextual notes for AI agents here"
    ],
    features: {},
    components: {}
  };
  return serializePurposeFile(defaultFile);
}

// src/aggregator.ts
import * as fs2 from "fs";
import * as path from "path";
import { glob } from "glob";
function normalizeItemsToEntries(items) {
  if (!items) return [];
  if (Array.isArray(items)) {
    return items.map((item) => [item.id, item]);
  } else {
    return Object.entries(items);
  }
}
function aggregatePurposes(parsedFiles) {
  const basePurpose = {
    description: "",
    context: [],
    rules: {},
    features: {},
    components: {},
    referencedItems: {},
    ruleConflicts: []
  };
  if (!parsedFiles || parsedFiles.length === 0) {
    return basePurpose;
  }
  parsedFiles.forEach(({ data }) => {
    const existingContext = new Set(basePurpose.context);
    for (const ctx of data.context || []) {
      if (!existingContext.has(ctx)) {
        basePurpose.context.push(ctx);
        existingContext.add(ctx);
      }
    }
    if (data.rules) {
      for (const [key, value] of Object.entries(data.rules)) {
        if (basePurpose.rules[key] !== void 0 && basePurpose.rules[key] !== value) {
          basePurpose.ruleConflicts.push(
            `Conflict on rule "${key}": existing value "${basePurpose.rules[key]}" overwritten with "${value}"`
          );
        }
        basePurpose.rules[key] = value;
      }
    }
    const featureEntries = normalizeItemsToEntries(data.features);
    for (const [id, item] of featureEntries) {
      basePurpose.features[id] = item;
    }
    const componentEntries = normalizeItemsToEntries(data.components);
    for (const [id, item] of componentEntries) {
      basePurpose.components[id] = item;
    }
  });
  const lastFile = parsedFiles[parsedFiles.length - 1];
  basePurpose.description = lastFile.data.description || basePurpose.description;
  basePurpose.apiSpec = lastFile.data.apiSpec || basePurpose.apiSpec;
  return basePurpose;
}
async function findPurposeFiles(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  const files = await glob("**/.purpose", {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"]
  });
  return files.sort((a, b) => {
    const depthA = a.split(path.sep).length;
    const depthB = b.split(path.sep).length;
    return depthA - depthB;
  });
}
async function collectPurposeChain(targetPath) {
  const absoluteTarget = path.resolve(targetPath);
  const targetDir = fs2.statSync(absoluteTarget).isDirectory() ? absoluteTarget : path.dirname(absoluteTarget);
  const chain = [];
  let currentDir = targetDir;
  const root = path.parse(currentDir).root;
  while (currentDir !== root) {
    const purposePath = path.join(currentDir, ".purpose");
    if (fs2.existsSync(purposePath)) {
      const { data, errors } = parsePurposeFile(purposePath);
      if (data && errors.length === 0) {
        chain.unshift({ filePath: purposePath, data });
      }
    }
    currentDir = path.dirname(currentDir);
  }
  return chain;
}
async function aggregateForPath(targetPath) {
  const chain = await collectPurposeChain(targetPath);
  return aggregatePurposes(chain);
}
async function getAllPurposeFiles(rootDir) {
  const files = await findPurposeFiles(rootDir);
  const parsed = [];
  for (const filePath of files) {
    const { data, errors } = parsePurposeFile(filePath);
    if (data) {
      parsed.push({ filePath, data });
      if (errors.length > 0) {
        console.warn(`Warnings parsing ${filePath}:`, errors);
      }
    }
  }
  return parsed;
}
function extractFeatures(parsedFiles) {
  const features = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    const entries = normalizeItemsToEntries(data.features);
    for (const [id, item] of entries) {
      features.set(id, { item, filePath });
    }
  }
  return features;
}
function extractComponents(parsedFiles) {
  const components = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    const entries = normalizeItemsToEntries(data.components);
    for (const [id, item] of entries) {
      components.set(id, { item, filePath });
    }
  }
  return components;
}
function extractGates(parsedFiles) {
  const gates = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    if (data.gates) {
      for (const [id, item] of Object.entries(data.gates)) {
        gates.set(id, { item, filePath });
      }
    }
  }
  return gates;
}
function extractStates(parsedFiles) {
  const states = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    if (data.states) {
      for (const [id, item] of Object.entries(data.states)) {
        states.set(id, { item, filePath });
      }
    }
  }
  return states;
}
function extractFlows(parsedFiles) {
  const flows = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    if (data.flows) {
      if (Array.isArray(data.flows)) {
        for (const flow of data.flows) {
          flows.set(flow.name, {
            item: {
              id: flow.name,
              description: flow.description,
              steps: flow.steps
            },
            filePath
          });
        }
      } else {
        for (const [id, flowDef] of Object.entries(data.flows)) {
          flows.set(id, {
            item: {
              id,
              description: flowDef.description,
              gates: flowDef.gates,
              signals: flowDef.signals,
              components: flowDef.components,
              steps: flowDef.steps
            },
            filePath
          });
        }
      }
    }
  }
  return flows;
}
function extractSignals(parsedFiles) {
  const signals = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    if (data.signals) {
      for (const [id, item] of Object.entries(data.signals)) {
        signals.set(id, { item, filePath });
      }
    }
  }
  return signals;
}
function extractAspects(parsedFiles) {
  const aspects = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    if (data.aspects) {
      for (const [id, item] of Object.entries(data.aspects)) {
        aspects.set(id, { item, filePath });
      }
    }
  }
  return aspects;
}
function extractSymbolReferences(parsedFiles) {
  const refs = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { filePath, data } of parsedFiles) {
    const featureEntries = normalizeItemsToEntries(data.features);
    for (const [id, item] of featureEntries) {
      extractRefsFromItem(`#${id}`, item, filePath, refs, seen);
    }
    const componentEntries = normalizeItemsToEntries(data.components);
    for (const [id, item] of componentEntries) {
      extractRefsFromItem(`#${id}`, item, filePath, refs, seen);
    }
  }
  return refs;
}
function extractRefsFromItem(sourceSymbol, item, filePath, refs, seen) {
  if (item.flows) {
    for (const flow of item.flows) {
      const symbol = flow.startsWith("$") ? flow : `$${flow}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: "flow", sourceSymbol, filePath });
      }
    }
  }
  if (item.gates) {
    for (const gate of item.gates) {
      const symbol = gate.startsWith("^") ? gate : `^${gate}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: "gate", sourceSymbol, filePath });
      }
    }
  }
  if (item.signals) {
    for (const signal of item.signals) {
      const symbol = signal.startsWith("!") ? signal : `!${signal}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: "signal", sourceSymbol, filePath });
      }
    }
  }
  if (item.states) {
    for (const state of item.states) {
      const symbol = state.startsWith("#") ? state : state.startsWith("%") ? `#${state.slice(1)}` : `#${state}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: "component", sourceSymbol, filePath });
      }
    }
  }
  if (item.components) {
    for (const comp of item.components) {
      const symbol = comp.startsWith("#") ? comp : `#${comp}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type: "component", sourceSymbol, filePath });
      }
    }
  }
  if (item.description) {
    const descRefs = extractSymbolsFromText(item.description);
    for (const { symbol, type } of descRefs) {
      if (!seen.has(symbol)) {
        seen.add(symbol);
        refs.push({ symbol, type, sourceSymbol, filePath });
      }
    }
  }
}
var SYMBOL_BLOCKLIST = /* @__PURE__ */ new Set([
  "$lib",
  "$env",
  "$app",
  "$service-worker",
  "$virtual",
  "$schema",
  "$ref",
  "$id",
  "$type"
]);
function extractSymbolsFromText(text) {
  const results = [];
  const pattern = /([$^!#~%])([a-zA-Z][a-zA-Z0-9._-]*)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1];
    const id = match[2];
    let symbol;
    let type;
    switch (prefix) {
      case "#":
        type = "component";
        symbol = `#${id}`;
        break;
      case "$":
        type = "flow";
        symbol = `$${id}`;
        break;
      case "^":
        type = "gate";
        symbol = `^${id}`;
        break;
      case "!":
        type = "signal";
        symbol = `!${id}`;
        break;
      case "~":
        type = "aspect";
        symbol = `~${id}`;
        break;
      // Legacy: %state → #component
      case "%":
        type = "component";
        symbol = `#${id}`;
        break;
      default:
        continue;
    }
    if (SYMBOL_BLOCKLIST.has(symbol)) continue;
    results.push({ symbol, type });
  }
  return results;
}

// src/validator.ts
function normalizeToEntries(items) {
  if (!items) return [];
  if (Array.isArray(items)) {
    return items.map((item) => [item.id, item]);
  } else {
    return Object.entries(items);
  }
}
function getItemIds(items) {
  if (!items) return [];
  if (Array.isArray(items)) {
    return items.map((item) => item.id);
  } else {
    return Object.keys(items);
  }
}
function validatePurposeFile(data, filePath) {
  const issues = [];
  const prefix = filePath ? `${filePath}: ` : "";
  const featureEntries = normalizeToEntries(data.features);
  for (const [id, feature] of featureEntries) {
    validatePurposeItem(id, feature, "feature", prefix, issues);
  }
  const componentEntries = normalizeToEntries(data.components);
  for (const [id, component] of componentEntries) {
    validatePurposeItem(id, component, "component", prefix, issues);
  }
  if (data.relationships) {
    const allIds = /* @__PURE__ */ new Set([
      ...getItemIds(data.features),
      ...getItemIds(data.components)
    ]);
    for (const rel of data.relationships) {
      if (typeof rel === "string" || !rel || !rel.from || !rel.to) {
        continue;
      }
      const fromId = rel.from.replace(/^[@#$%~^!?]/, "");
      if (!allIds.has(fromId) && !rel.from.includes(".")) {
        issues.push({
          type: "warning",
          message: `${prefix}Relationship references unknown source: "${rel.from}"`,
          path: "relationships"
        });
      }
      const toId = rel.to.replace(/^[@#$%~^!?]/, "");
      if (!allIds.has(toId) && !rel.to.includes(".")) {
        issues.push({
          type: "warning",
          message: `${prefix}Relationship references unknown target: "${rel.to}"`,
          path: "relationships"
        });
      }
    }
  }
  if (data.flows) {
    const componentIds = new Set(getItemIds(data.components));
    if (Array.isArray(data.flows)) {
      for (const flow of data.flows) {
        if (!flow || typeof flow !== "object") continue;
        if (!flow.name) {
          issues.push({
            type: "error",
            message: `${prefix}Flow missing required "name" field`,
            path: "flows"
          });
        }
        if (flow.steps && Array.isArray(flow.steps)) {
          for (const step of flow.steps) {
            if (typeof step === "string" || !step || !step.component) continue;
            const componentId = step.component.replace(/^#/, "");
            if (!componentIds.has(componentId)) {
              issues.push({
                type: "warning",
                message: `${prefix}Flow "${flow.name}" references unknown component: "${step.component}"`,
                path: `flows.${flow.name}`
              });
            }
          }
        }
      }
    } else {
      for (const [flowId, flowDef] of Object.entries(data.flows)) {
        if (!flowDef || typeof flowDef !== "object") continue;
        if (flowDef.steps && Array.isArray(flowDef.steps)) {
          for (const step of flowDef.steps) {
            if (typeof step === "string" || !step || !step.component) continue;
            const componentId = step.component.replace(/^#/, "");
            if (!componentIds.has(componentId)) {
              issues.push({
                type: "warning",
                message: `${prefix}Flow "${flowId}" references unknown component: "${step.component}"`,
                path: `flows.${flowId}`
              });
            }
          }
        }
      }
    }
  }
  return {
    valid: issues.filter((i) => i.type === "error").length === 0,
    issues
  };
}
function validatePurposeItem(id, item, itemType, prefix, issues) {
  const path2 = `${itemType}s.${id}`;
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(id)) {
    issues.push({
      type: "warning",
      message: `${prefix}${itemType} ID "${id}" should use alphanumeric characters and hyphens`,
      path: path2
    });
  }
  if (!item.description || item.description.trim() === "") {
    issues.push({
      type: "warning",
      message: `${prefix}${itemType} "${id}" has no description`,
      path: path2
    });
  }
  if (item.endpoints) {
    for (const endpoint of item.endpoints) {
      if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//.test(endpoint)) {
        issues.push({
          type: "warning",
          message: `${prefix}Endpoint "${endpoint}" in ${itemType} "${id}" may not be in standard format (e.g., "GET /api/users")`,
          path: `${path2}.endpoints`
        });
      }
    }
  }
}
function formatValidationResult(result) {
  if (result.valid && result.issues.length === 0) {
    return "\u2705 Purpose file is valid";
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
    lines.push("\n\u2705 Purpose file is valid (with warnings)");
  } else {
    lines.push("\n\u274C Purpose file is invalid");
  }
  return lines.join("\n");
}
export {
  aggregateForPath,
  aggregatePurposes,
  collectPurposeChain,
  extractAspects,
  extractComponents,
  extractFeatures,
  extractFlows,
  extractGates,
  extractSignals,
  extractStates,
  extractSymbolReferences,
  findPurposeFiles,
  formatValidationResult,
  getAllPurposeFiles,
  getDefaultPurposeContent,
  parsePurposeContent,
  parsePurposeFile,
  parsePurposeFileDetailed,
  serializePurposeFile,
  validatePurposeFile
};
