// src/types.ts
var SYMBOL_PREFIXES = {
  feature: "@",
  component: "#",
  flow: "$",
  state: "%",
  aspect: "~",
  gate: "^",
  signal: "!",
  idea: "?"
};
var PREFIX_TO_TYPE = {
  "@": "feature",
  "#": "component",
  "$": "flow",
  "%": "state",
  "~": "aspect",
  "^": "gate",
  "!": "signal",
  "?": "idea"
};

// src/parser.ts
import * as fs from "fs";
import * as yaml from "js-yaml";
import { z } from "zod";
var PositionSchema = z.object({
  x: z.number(),
  y: z.number()
});
var ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number()
});
var DreamSourceConfigSchema = z.object({
  path: z.string(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional()
});
var DreamNodeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  type: z.enum(["feature", "component", "flow", "state", "aspect", "gate", "signal", "idea"]),
  content: z.string().optional(),
  position: PositionSchema,
  tags: z.array(z.string()).optional(),
  created: z.string(),
  modified: z.string().optional()
});
var DreamConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  type: z.string().optional()
});
var DreamGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(z.string()),
  color: z.string().optional()
});
var DreamLayoutSchema = z.object({
  viewport: ViewportSchema,
  groups: z.array(DreamGroupSchema).optional()
});
var DreamSnapshotStateSchema = z.object({
  nodes: z.array(DreamNodeSchema),
  connections: z.array(DreamConnectionSchema),
  layout: DreamLayoutSchema
});
var DreamSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  timestamp: z.string(),
  description: z.string().optional(),
  state: DreamSnapshotStateSchema
});
var DreamFileSchema = z.object({
  version: z.string(),
  metadata: z.object({
    name: z.string(),
    created: z.string(),
    modified: z.string()
  }),
  sources: z.object({
    purpose: z.array(DreamSourceConfigSchema).optional(),
    gate: z.array(DreamSourceConfigSchema).optional()
  }),
  nodes: z.array(DreamNodeSchema),
  connections: z.array(DreamConnectionSchema),
  layout: DreamLayoutSchema,
  snapshots: z.array(DreamSnapshotSchema).optional()
});
function parseDreamFile(filePath) {
  const errors = [];
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    errors.push(`Cannot read file: ${e.message}`);
    return { data: null, errors, rawContent: void 0 };
  }
  return parseDreamContent(rawContent);
}
function parseDreamContent(content) {
  const errors = [];
  let data = null;
  try {
    data = yaml.load(content);
  } catch (e) {
    const yamlError = e;
    const line = yamlError.mark?.line ? yamlError.mark.line + 1 : void 0;
    errors.push(`YAML syntax error: ${yamlError.reason || e.message}${line ? ` (line ${line})` : ""}`);
    return { data: null, errors, rawContent: content };
  }
  if (data === null || data === void 0) {
    return {
      data: createEmptyDreamFile(),
      errors: [],
      rawContent: content
    };
  }
  const parseResult = DreamFileSchema.safeParse(data);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path2 = issue.path.join(".");
      errors.push(`Schema error at ${path2 || "/"}: ${issue.message}`);
    }
    return { data, errors, rawContent: content };
  }
  return { data: parseResult.data, errors: [], rawContent: content };
}
function createEmptyDreamFile(name = "Untitled") {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    version: "1.0.0",
    metadata: {
      name,
      created: now,
      modified: now
    },
    sources: {
      purpose: [{ path: "./" }],
      gate: [{ path: "./gate.yaml" }]
    },
    nodes: [],
    connections: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}
function serializeDreamFile(data) {
  data.metadata.modified = (/* @__PURE__ */ new Date()).toISOString();
  return yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  });
}
function getDefaultDreamContent(projectName = "My Project") {
  return serializeDreamFile(createEmptyDreamFile(projectName));
}
function addDreamNode(dreamFile, node) {
  return {
    ...dreamFile,
    nodes: [...dreamFile.nodes, node],
    metadata: {
      ...dreamFile.metadata,
      modified: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function updateNodePosition(dreamFile, nodeId, position) {
  return {
    ...dreamFile,
    nodes: dreamFile.nodes.map(
      (n) => n.id === nodeId ? { ...n, position, modified: (/* @__PURE__ */ new Date()).toISOString() } : n
    ),
    metadata: {
      ...dreamFile.metadata,
      modified: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function addConnection(dreamFile, connection) {
  const exists = dreamFile.connections.some(
    (c) => c.from === connection.from && c.to === connection.to
  );
  if (exists) return dreamFile;
  return {
    ...dreamFile,
    connections: [...dreamFile.connections, connection],
    metadata: {
      ...dreamFile.metadata,
      modified: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function createSnapshot(dreamFile, name, description) {
  const snapshot = {
    id: `snap-${Date.now()}`,
    name,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    description,
    state: {
      nodes: [...dreamFile.nodes],
      connections: [...dreamFile.connections],
      layout: { ...dreamFile.layout }
    }
  };
  return {
    ...dreamFile,
    snapshots: [...dreamFile.snapshots || [], snapshot],
    metadata: {
      ...dreamFile.metadata,
      modified: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}

// src/aggregator.ts
import * as path from "path";
import {
  getAllPurposeFiles,
  extractFeatures,
  extractComponents
} from "@horizon/purpose-core";
import { parseGateConfig, findGateFiles } from "@horizon/gate-core";

// src/symbol-index.ts
function createSymbolIndex() {
  return {
    entries: /* @__PURE__ */ new Map(),
    byType: /* @__PURE__ */ new Map(),
    bySource: /* @__PURE__ */ new Map(),
    timestamp: 0
  };
}
function buildSymbolIndex(result) {
  const index = createSymbolIndex();
  index.timestamp = result.timestamp;
  for (const symbol of result.symbols) {
    index.entries.set(symbol.id, symbol);
    if (!index.byType.has(symbol.type)) {
      index.byType.set(symbol.type, []);
    }
    index.byType.get(symbol.type).push(symbol);
    if (!index.bySource.has(symbol.source)) {
      index.bySource.set(symbol.source, []);
    }
    index.bySource.get(symbol.source).push(symbol);
  }
  return index;
}
function getSymbol(index, symbol) {
  for (const entry of index.entries.values()) {
    if (entry.symbol === symbol) {
      return entry;
    }
  }
  return void 0;
}
function getSymbolById(index, id) {
  return index.entries.get(id);
}
function getSymbolsByType(index, type) {
  return index.byType.get(type) || [];
}
function getSymbolsBySource(index, source) {
  return index.bySource.get(source) || [];
}
function searchSymbols(index, query) {
  const lowerQuery = query.toLowerCase();
  const results = [];
  for (const entry of index.entries.values()) {
    if (entry.symbol.toLowerCase().includes(lowerQuery)) {
      results.push(entry);
      continue;
    }
    if (entry.description?.toLowerCase().includes(lowerQuery)) {
      results.push(entry);
      continue;
    }
    if (entry.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
      results.push(entry);
    }
  }
  return results;
}
function getReferencesTo(index, symbol) {
  const entry = getSymbol(index, symbol);
  if (!entry) return [];
  return entry.referencedBy.map((ref) => getSymbol(index, ref)).filter((e) => e !== void 0);
}
function getReferencesFrom(index, symbol) {
  const entry = getSymbol(index, symbol);
  if (!entry) return [];
  return entry.references.map((ref) => getSymbol(index, ref)).filter((e) => e !== void 0);
}
function getSymbolsByTag(index, tag) {
  const results = [];
  for (const entry of index.entries.values()) {
    if (entry.tags?.includes(tag)) {
      results.push(entry);
    }
  }
  return results;
}
function getAllTags(index) {
  const tags = /* @__PURE__ */ new Set();
  for (const entry of index.entries.values()) {
    for (const tag of entry.tags || []) {
      tags.add(tag);
    }
  }
  return Array.from(tags).sort();
}
function getSymbolCounts(index) {
  const counts = {
    feature: 0,
    component: 0,
    flow: 0,
    state: 0,
    aspect: 0,
    gate: 0,
    signal: 0,
    idea: 0
  };
  for (const [type, symbols] of index.byType) {
    counts[type] = symbols.length;
  }
  return counts;
}
function getAllSymbols(index) {
  return Array.from(index.entries.values());
}
function parseSymbol(symbol) {
  if (symbol.length < 2) return null;
  if (symbol.startsWith("?") && symbol.length >= 3) {
    const secondChar = symbol[1];
    const prefixToType2 = {
      "@": "feature",
      "#": "component",
      "$": "flow",
      "%": "state",
      "~": "aspect",
      "^": "gate",
      "!": "signal"
    };
    if (secondChar in prefixToType2) {
      return {
        type: "idea",
        name: symbol.slice(2),
        // Remove "?@"
        ideaType: prefixToType2[secondChar]
      };
    }
    return { type: "idea", name: symbol.slice(1) };
  }
  const prefix = symbol[0];
  const name = symbol.slice(1);
  const prefixToType = {
    "@": "feature",
    "#": "component",
    "$": "flow",
    "%": "state",
    "~": "aspect",
    "^": "gate",
    "!": "signal",
    "?": "idea"
  };
  const type = prefixToType[prefix];
  if (!type) return null;
  return { type, name };
}
function createSymbolString(type, name) {
  const prefixes = {
    feature: "@",
    component: "#",
    flow: "$",
    state: "%",
    aspect: "~",
    gate: "^",
    signal: "!",
    idea: "?"
  };
  return `${prefixes[type]}${name}`;
}
function isValidSymbol(symbol) {
  return parseSymbol(symbol) !== null;
}
function getAutocompleteSuggestions(index, partial, limit = 10) {
  const lowerPartial = partial.toLowerCase();
  const parsed = parseSymbol(partial);
  if (parsed) {
    const typeSymbols = getSymbolsByType(index, parsed.type);
    return typeSymbols.filter((s) => s.symbol.toLowerCase().includes(lowerPartial)).slice(0, limit);
  }
  return searchSymbols(index, partial).slice(0, limit);
}

// src/aggregator.ts
async function aggregateFromDream(dreamFile, rootDir) {
  const symbols = [];
  const errors = [];
  const purposeFiles = [];
  const gateFiles = [];
  if (dreamFile.sources.purpose) {
    for (const source of dreamFile.sources.purpose) {
      const sourcePath = path.resolve(rootDir, source.path);
      try {
        const parsed = await getAllPurposeFiles(sourcePath);
        purposeFiles.push(...parsed.map((p) => p.filePath));
        const features = extractFeatures(parsed);
        for (const [id, { item, filePath }] of features) {
          symbols.push(createSymbolEntry({
            id: `purpose-feature-${id}`,
            symbol: `@${id}`,
            type: "feature",
            source: "purpose",
            filePath,
            data: item,
            description: item.description
          }));
        }
        const components = extractComponents(parsed);
        for (const [id, { item, filePath }] of components) {
          symbols.push(createSymbolEntry({
            id: `purpose-component-${id}`,
            symbol: `#${id}`,
            type: "component",
            source: "purpose",
            filePath,
            data: item,
            description: item.description
          }));
        }
        for (const { filePath, data } of parsed) {
          if (data.flows) {
            for (const flow of data.flows) {
              symbols.push(createSymbolEntry({
                id: `purpose-flow-${flow.name}`,
                symbol: `$${flow.name}`,
                type: "flow",
                source: "purpose",
                filePath,
                data: flow,
                description: flow.description
              }));
            }
          }
        }
      } catch (e) {
        errors.push({
          source: "purpose",
          filePath: sourcePath,
          message: e.message
        });
      }
    }
  }
  if (dreamFile.sources.gate) {
    for (const source of dreamFile.sources.gate) {
      const sourcePath = path.resolve(rootDir, source.path);
      try {
        let gateConfig;
        if (sourcePath.endsWith(".yaml") || sourcePath.endsWith(".yml")) {
          gateConfig = await parseGateConfig(sourcePath);
          gateFiles.push(sourcePath);
        } else {
          const files = await findGateFiles(sourcePath);
          gateFiles.push(...files);
          if (files.length > 0) {
            gateConfig = await parseGateConfig(files[0]);
            for (let i = 1; i < files.length; i++) {
              const additional = await parseGateConfig(files[i]);
              gateConfig.gates.push(...additional.gates);
              gateConfig.flows.push(...additional.flows);
            }
          } else {
            continue;
          }
        }
        for (const gate of gateConfig.gates) {
          symbols.push(createGateSymbol(gate, sourcePath));
          for (const prize of gate.prizes) {
            symbols.push(createSymbolEntry({
              id: `gate-signal-${gate.id}-${prize.id}`,
              symbol: `!${prize.id}`,
              type: "signal",
              source: "gate",
              filePath: sourcePath,
              data: prize,
              description: `Signal from gate ${gate.id}`
            }));
          }
        }
        for (const flow of gateConfig.flows) {
          symbols.push(createFlowSymbol(flow, sourcePath));
        }
      } catch (e) {
        errors.push({
          source: "gate",
          filePath: sourcePath,
          message: e.message
        });
      }
    }
  }
  for (const node of dreamFile.nodes) {
    if (!node.content && node.type !== "idea") {
      const existing = symbols.find((s) => s.symbol === node.symbol);
      if (existing) {
        existing.position = node.position;
        existing.tags = node.tags;
        continue;
      }
    }
    const parsed = parseSymbol(node.symbol);
    const ideaType = parsed?.ideaType;
    symbols.push(createSymbolEntry({
      id: node.id,
      symbol: node.symbol,
      type: node.type,
      ideaType,
      source: "dream",
      filePath: ".dream",
      data: node,
      description: node.content,
      position: node.position,
      tags: node.tags,
      created: node.created,
      modified: node.modified
    }));
  }
  resolveReferences(symbols);
  return {
    symbols,
    purposeFiles,
    gateFiles,
    errors,
    timestamp: Date.now()
  };
}
function createSymbolEntry(partial) {
  return {
    ...partial,
    data: partial.data ?? null,
    references: partial.references ?? [],
    referencedBy: partial.referencedBy ?? []
  };
}
function createGateSymbol(gate, filePath) {
  return createSymbolEntry({
    id: `gate-${gate.id}`,
    symbol: `^${gate.id}`,
    type: "gate",
    source: "gate",
    filePath,
    data: gate,
    description: gate.description,
    position: gate.position
  });
}
function createFlowSymbol(flow, filePath) {
  return createSymbolEntry({
    id: `gate-flow-${flow.id}`,
    symbol: `$${flow.id}`,
    type: "flow",
    source: "gate",
    filePath,
    data: flow,
    description: flow.description
  });
}
function resolveReferences(symbols) {
  const symbolMap = new Map(symbols.map((s) => [s.symbol, s]));
  for (const symbol of symbols) {
    const dataStr = JSON.stringify(symbol.data);
    const refPattern = /(?:\?[@#$%~^!]|[@#$%~^!?])[\w-]+/g;
    const matches = dataStr.match(refPattern) || [];
    for (const match of matches) {
      if (match !== symbol.symbol && symbolMap.has(match)) {
        if (!symbol.references.includes(match)) {
          symbol.references.push(match);
        }
        const target = symbolMap.get(match);
        if (target && !target.referencedBy.includes(symbol.symbol)) {
          target.referencedBy.push(symbol.symbol);
        }
      }
    }
  }
}
async function aggregateFromDirectory(rootDir) {
  const dreamFile = {
    version: "1.0.0",
    metadata: {
      name: path.basename(rootDir),
      created: (/* @__PURE__ */ new Date()).toISOString(),
      modified: (/* @__PURE__ */ new Date()).toISOString()
    },
    sources: {
      purpose: [{ path: "./" }],
      gate: [{ path: "./" }]
    },
    nodes: [],
    connections: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
  return aggregateFromDream(dreamFile, rootDir);
}
export {
  PREFIX_TO_TYPE,
  SYMBOL_PREFIXES,
  addConnection,
  addDreamNode,
  aggregateFromDirectory,
  aggregateFromDream,
  buildSymbolIndex,
  createEmptyDreamFile,
  createSnapshot,
  createSymbolIndex,
  createSymbolString,
  getAllSymbols,
  getAllTags,
  getAutocompleteSuggestions,
  getDefaultDreamContent,
  getReferencesFrom,
  getReferencesTo,
  getSymbol,
  getSymbolById,
  getSymbolCounts,
  getSymbolsBySource,
  getSymbolsByTag,
  getSymbolsByType,
  isValidSymbol,
  parseDreamContent,
  parseDreamFile,
  parseSymbol,
  searchSymbols,
  serializeDreamFile,
  updateNodePosition
};
