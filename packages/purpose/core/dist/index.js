// src/parser.ts
import * as fs from "fs";
import * as yaml from "js-yaml";
import { z } from "zod";
var PurposeItemSchema = z.object({
  description: z.string(),
  endpoints: z.array(z.string()).optional(),
  tests: z.array(z.string()).optional(),
  rules: z.record(z.unknown()).optional(),
  aspects: z.record(z.unknown()).optional()
});
var RelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  description: z.string().optional()
});
var FlowStepSchema = z.object({
  component: z.string(),
  action: z.string(),
  description: z.string().optional()
});
var FlowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(FlowStepSchema)
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
  features: z.record(PurposeItemSchema).optional(),
  components: z.record(PurposeItemSchema).optional(),
  relationships: z.array(RelationshipSchema).optional(),
  flows: z.array(FlowSchema).optional(),
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
    basePurpose.features = { ...basePurpose.features, ...data.features || {} };
    basePurpose.components = { ...basePurpose.components, ...data.components || {} };
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
    if (data.features) {
      for (const [id, item] of Object.entries(data.features)) {
        features.set(id, { item, filePath });
      }
    }
  }
  return features;
}
function extractComponents(parsedFiles) {
  const components = /* @__PURE__ */ new Map();
  for (const { filePath, data } of parsedFiles) {
    if (data.components) {
      for (const [id, item] of Object.entries(data.components)) {
        components.set(id, { item, filePath });
      }
    }
  }
  return components;
}

// src/validator.ts
function validatePurposeFile(data, filePath) {
  const issues = [];
  const prefix = filePath ? `${filePath}: ` : "";
  if (data.features) {
    for (const [id, feature] of Object.entries(data.features)) {
      validatePurposeItem(id, feature, "feature", prefix, issues);
    }
  }
  if (data.components) {
    for (const [id, component] of Object.entries(data.components)) {
      validatePurposeItem(id, component, "component", prefix, issues);
    }
  }
  if (data.relationships) {
    const allIds = /* @__PURE__ */ new Set([
      ...Object.keys(data.features || {}),
      ...Object.keys(data.components || {})
    ]);
    for (const rel of data.relationships) {
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
    const componentIds = new Set(Object.keys(data.components || {}));
    for (const flow of data.flows) {
      if (!flow.name) {
        issues.push({
          type: "error",
          message: `${prefix}Flow missing required "name" field`,
          path: "flows"
        });
      }
      if (flow.steps) {
        for (const step of flow.steps) {
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
  extractComponents,
  extractFeatures,
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
