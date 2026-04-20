/**
 * Purpose & Portal File Management Tools
 *
 * 13 MCP tools for creating/modifying .purpose files and portal.yaml.
 * AI agents pass structured parameters; all YAML formatting, validation,
 * and symbol prefix normalization is handled internally.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ProjectContext } from '../utils/index-loader.js';
import {
  resolvePurposeFilePath,
  readPurposeFile,
  writePurposeFile,
  normalizeToRecord,
  normalizeFlowsToRecord,
  stripSymbolPrefix,
  ensurePrefix,
  mergeArrayField,
  renameSymbolAcrossFiles,
} from '../utils/purpose-writer.js';
import {
  addGateToPortal,
  addRouteToPortal,
  readPortalFile,
} from '../utils/portal-writer.js';
import {
  parsePurposeFileDetailed,
  validatePurposeFile,
  findPurposeFiles,
} from '@a-company/purpose-core';
import type {
  PurposeFile,
  PurposeItem,
  FlowDefinition,
} from '@a-company/purpose-core';

// ============================================
// Tool Definitions
// ============================================

const purposeInitTool: Tool = {
  name: 'paradigm_purpose_init',
  description: 'Create or update file-level metadata on a .purpose file. Does NOT overwrite existing components/signals/etc — only touches top-level metadata (name, description, context, version). ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory (relative to project root)',
      },
      name: {
        type: 'string',
        description: 'Name/title for this purpose file',
      },
      description: {
        type: 'string',
        description: 'Description of what this directory/module does',
      },
      context: {
        type: 'array',
        items: { type: 'string' },
        description: 'Context notes for AI agents',
      },
      version: {
        type: 'string',
        description: 'Version string (default: "1.0.0")',
      },
    },
    required: ['purposeFile', 'name'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeAddComponentTool: Tool = {
  name: 'paradigm_purpose_add_component',
  description: 'Add or update a component (#) or feature in a .purpose file. Strips # prefix from id automatically. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      id: {
        type: 'string',
        description: 'Component ID (e.g. "payment-service" or "#payment-service")',
      },
      description: {
        type: 'string',
        description: 'What this component does',
      },
      section: {
        type: 'string',
        enum: ['components', 'features'],
        description: 'Which section to add to (default: "components")',
      },
      file: {
        type: 'string',
        description: 'Source file path for this component',
      },
      status: {
        type: 'string',
        description: 'Component status (e.g. "active", "deprecated")',
      },
      endpoints: {
        type: 'array',
        items: { type: 'string' },
        description: 'API endpoints (e.g. ["POST /api/payments"])',
      },
      tests: {
        type: 'array',
        items: { type: 'string' },
        description: 'Test file paths',
      },
      flows: {
        type: 'array',
        items: { type: 'string' },
        description: 'Flow references (e.g. ["$checkout-flow"])',
      },
      gates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Gate references (e.g. ["^authenticated"])',
      },
      signals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Signal references (e.g. ["!payment-completed"])',
      },
      aspects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Aspect references (e.g. ["~audit-required"])',
      },
      components: {
        type: 'array',
        items: { type: 'string' },
        description: 'Component references (e.g. ["#stripe-service"])',
      },
      type: {
        type: 'string',
        description: 'Component type (e.g., "view", "service", "model", "tool"). Open string per project vocabulary.',
      },
      parent: {
        type: 'string',
        description: 'Parent component (e.g., "#payment-page"). Establishes hierarchy.',
      },
    },
    required: ['purposeFile', 'id', 'description'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeAddAspectTool: Tool = {
  name: 'paradigm_purpose_add_aspect',
  description: 'Add or update an aspect (~) with ENFORCED anchors. Anchors are required and must point to code locations. Strips ~ prefix automatically. This prevents the common "~aspect:name" format error. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      id: {
        type: 'string',
        description: 'Aspect ID (e.g. "audit-required" or "~audit-required")',
      },
      description: {
        type: 'string',
        description: 'What this aspect enforces',
      },
      anchors: {
        type: 'array',
        items: { type: 'string' },
        description: 'REQUIRED. Code anchor locations (e.g. ["src/middleware/audit.ts:15-35"])',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Classification tags (e.g. ["compliance", "security"])',
      },
      appliesTo: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns for symbols this applies to (e.g. ["#*Service"])',
      },
      enforcement: {
        type: 'string',
        description: 'How this aspect is enforced (e.g. "middleware", "decorator")',
      },
    },
    required: ['purposeFile', 'id', 'description', 'anchors'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeAddSignalTool: Tool = {
  name: 'paradigm_purpose_add_signal',
  description: 'Add a signal (!) definition. Handles YAML ! quoting automatically. Strips ! prefix from id. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      id: {
        type: 'string',
        description: 'Signal ID (e.g. "payment-completed" or "!payment-completed")',
      },
      description: {
        type: 'string',
        description: 'What this signal represents',
      },
      category: {
        type: 'string',
        description: 'Signal category (e.g. "business", "system", "security")',
      },
      severity: {
        type: 'string',
        enum: ['info', 'warn', 'error'],
        description: 'Severity level',
      },
      emitters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Components that emit this signal (e.g. ["#payment-service"])',
      },
      related: {
        type: 'array',
        items: { type: 'string' },
        description: 'Related signals or symbols',
      },
      data: {
        type: 'object',
        description: 'Schema/shape of data emitted with this signal',
      },
    },
    required: ['purposeFile', 'id', 'description'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeAddFlowTool: Tool = {
  name: 'paradigm_purpose_add_flow',
  description: 'Add a flow ($) definition. Strips $ prefix from id. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      id: {
        type: 'string',
        description: 'Flow ID (e.g. "checkout-flow" or "$checkout-flow")',
      },
      description: {
        type: 'string',
        description: 'What this flow does',
      },
      gates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Gate references in this flow',
      },
      signals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Signals emitted during this flow',
      },
      components: {
        type: 'array',
        items: { type: 'string' },
        description: 'Components involved in this flow',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            component: { type: 'string' },
            action: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['component', 'action'],
        },
        description: 'Ordered steps in the flow',
      },
    },
    required: ['purposeFile', 'id', 'description'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeAddGateTool: Tool = {
  name: 'paradigm_purpose_add_gate',
  description: 'Add a gate (^) to a .purpose file\'s gates section. This is for purpose-level gates, NOT portal.yaml. Strips ^ prefix. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      id: {
        type: 'string',
        description: 'Gate ID (e.g. "authenticated" or "^authenticated")',
      },
      description: {
        type: 'string',
        description: 'What this gate checks',
      },
      requires: {
        type: 'array',
        items: { type: 'string' },
        description: 'Requirements for this gate',
      },
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Key expressions for gate evaluation',
      },
      signals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Signals emitted by this gate (e.g. on pass/fail)',
      },
    },
    required: ['purposeFile', 'id', 'description'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeAddStateTool: Tool = {
  name: 'paradigm_purpose_add_state',
  description: 'Add a state definition to a .purpose file. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      id: {
        type: 'string',
        description: 'State ID (e.g. "user-store")',
      },
      description: {
        type: 'string',
        description: 'What this state represents',
      },
      type: {
        type: 'string',
        description: 'Type of state (e.g. "object", "array", "string")',
      },
      default: {
        description: 'Default value for the state',
      },
      properties: {
        type: 'object',
        description: 'State properties as {name: {type, description}}',
      },
    },
    required: ['purposeFile', 'id', 'description'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeLinkTool: Tool = {
  name: 'paradigm_purpose_link',
  description: 'Add references to an existing component without rewriting all fields. Merges into existing arrays (no clobber). Example: add ~rate-limited to #payment-service\'s aspects. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      componentId: {
        type: 'string',
        description: 'Component or feature ID to add references to',
      },
      section: {
        type: 'string',
        enum: ['components', 'features'],
        description: 'Which section the component is in (default: auto-detect)',
      },
      signals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Signal references to add',
      },
      aspects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Aspect references to add',
      },
      gates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Gate references to add',
      },
      flows: {
        type: 'array',
        items: { type: 'string' },
        description: 'Flow references to add',
      },
      components: {
        type: 'array',
        items: { type: 'string' },
        description: 'Component references to add',
      },
    },
    required: ['purposeFile', 'componentId'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeRemoveTool: Tool = {
  name: 'paradigm_purpose_remove',
  description: 'Remove any element by section + id from a .purpose file. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Path to .purpose file or parent directory',
      },
      section: {
        type: 'string',
        enum: ['components', 'features', 'gates', 'signals', 'aspects', 'flows', 'states'],
        description: 'Which section to remove from',
      },
      id: {
        type: 'string',
        description: 'ID of the element to remove',
      },
    },
    required: ['purposeFile', 'section', 'id'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
  },
};

const purposeRenameTool: Tool = {
  name: 'paradigm_purpose_rename',
  description: 'Rename a symbol across ALL .purpose files in the project. Updates both definitions and references. ~200 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      oldId: {
        type: 'string',
        description: 'Current symbol ID (e.g. "payment-service")',
      },
      newId: {
        type: 'string',
        description: 'New symbol ID (e.g. "billing-service")',
      },
      symbolType: {
        type: 'string',
        enum: ['#', '^', '!', '$', '~'],
        description: 'Symbol type prefix',
      },
    },
    required: ['oldId', 'newId', 'symbolType'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const portalAddGateTool: Tool = {
  name: 'paradigm_portal_add_gate',
  description: 'Add or update a gate (^) in portal.yaml. Creates portal.yaml if it doesn\'t exist. Strips ^ prefix. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Gate ID (e.g. "authenticated" or "^authenticated")',
      },
      description: {
        type: 'string',
        description: 'What this gate checks',
      },
      type: {
        type: 'string',
        description: 'Gate type (e.g. "auth", "role", "ownership")',
      },
      location: {
        type: 'string',
        description: 'Where the gate is checked in your code (e.g. "middleware", "route-handler")',
      },
      requires: {
        type: 'array',
        items: { type: 'string' },
        description: 'Prerequisite gates',
      },
      check: {
        type: 'string',
        description: 'Expression to evaluate (e.g. "req.user != null")',
      },
      grants: {
        type: 'array',
        items: { type: 'string' },
        description: 'What passing this gate grants access to',
      },
      emits: {
        type: 'array',
        items: { type: 'string' },
        description: 'Signals emitted when gate is checked',
      },
      prizes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            oneTime: { type: 'boolean' },
          },
          required: ['id'],
        },
        description: 'Side effects triggered on pass',
      },
    },
    required: ['id', 'description'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const portalAddRouteTool: Tool = {
  name: 'paradigm_portal_add_route',
  description: 'Add a route with gates to portal.yaml. Creates routes section if needed. ~100 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      route: {
        type: 'string',
        description: 'Route path (e.g. "/api/users/:id")',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        description: 'HTTP method',
      },
      gates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Gate IDs to apply (e.g. ["^authenticated", "^user-owner"])',
      },
    },
    required: ['route', 'method', 'gates'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },
};

const purposeValidateTool: Tool = {
  name: 'paradigm_purpose_validate',
  description: 'Validate .purpose files and portal.yaml. Returns issues found. If no purposeFile specified, validates all files. ~200 tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      purposeFile: {
        type: 'string',
        description: 'Specific .purpose file to validate (validates all if omitted)',
      },
      includePortal: {
        type: 'boolean',
        description: 'Also validate portal.yaml (default: true)',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },
};

// ============================================
// Tool List Export
// ============================================

export function getPurposePortalToolsList(): Tool[] {
  return [
    purposeInitTool,
    purposeAddComponentTool,
    purposeAddAspectTool,
    purposeAddSignalTool,
    purposeAddFlowTool,
    purposeAddGateTool,
    purposeAddStateTool,
    purposeLinkTool,
    purposeRemoveTool,
    purposeRenameTool,
    portalAddGateTool,
    portalAddRouteTool,
    purposeValidateTool,
  ];
}

// ============================================
// Tool Handler
// ============================================

export async function handlePurposePortalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  switch (name) {
    case 'paradigm_purpose_init':
      return handlePurposeInit(args, ctx, reloadContext);
    case 'paradigm_purpose_add_component':
      return handleAddComponent(args, ctx, reloadContext);
    case 'paradigm_purpose_add_aspect':
      return handleAddAspect(args, ctx, reloadContext);
    case 'paradigm_purpose_add_signal':
      return handleAddSignal(args, ctx, reloadContext);
    case 'paradigm_purpose_add_flow':
      return handleAddFlow(args, ctx, reloadContext);
    case 'paradigm_purpose_add_gate':
      return handleAddGate(args, ctx, reloadContext);
    case 'paradigm_purpose_add_state':
      return handleAddState(args, ctx, reloadContext);
    case 'paradigm_purpose_link':
      return handleLink(args, ctx, reloadContext);
    case 'paradigm_purpose_remove':
      return handleRemove(args, ctx, reloadContext);
    case 'paradigm_purpose_rename':
      return handleRename(args, ctx, reloadContext);
    case 'paradigm_portal_add_gate':
      return handlePortalAddGate(args, ctx, reloadContext);
    case 'paradigm_portal_add_route':
      return handlePortalAddRoute(args, ctx, reloadContext);
    case 'paradigm_purpose_validate':
      return handleValidate(args, ctx);
    default:
      return { handled: false, text: '' };
  }
}

// ============================================
// Handler Implementations
// ============================================

function ok(data: unknown): { handled: boolean; text: string } {
  return { handled: true, text: JSON.stringify(data, null, 2) };
}

function err(message: string): { handled: boolean; text: string } {
  return { handled: true, text: JSON.stringify({ error: message }, null, 2) };
}

// --- 1. paradigm_purpose_init ---

async function handlePurposeInit(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, name, description, context, version } = args as {
    purposeFile: string;
    name: string;
    description?: string;
    context?: string[];
    version?: string;
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);

  // Only update metadata fields — never touch components/signals/etc
  if (version !== undefined) data.version = version;
  else if (!data.version) data.version = '1.0.0';

  // Store name as description if no explicit description
  if (description !== undefined) data.description = description;
  else if (!data.description) data.description = name;

  if (context !== undefined) data.context = context;

  writePurposeFile(filePath, data);
  await reloadContext();

  return ok({
    action: 'purpose_init',
    file: filePath,
    metadata: { name, description: data.description, version: data.version },
  });
}

// --- 2. paradigm_purpose_add_component ---

async function handleAddComponent(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const {
    purposeFile, id, description, section = 'components',
    file, status, endpoints, tests, flows, gates, signals, aspects, components,
    type: componentType, parent,
  } = args as {
    purposeFile: string; id: string; description: string;
    section?: 'components' | 'features';
    file?: string; status?: string;
    endpoints?: string[]; tests?: string[];
    flows?: string[]; gates?: string[];
    signals?: string[]; aspects?: string[];
    components?: string[];
    type?: string; parent?: string;
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);

  const bareId = stripSymbolPrefix(id);
  const sec = section as 'components' | 'features';

  // Normalize section to record format
  const existing = normalizeToRecord(
    (data as Record<string, unknown>)[sec] as PurposeFile['components']
  );

  const item: PurposeItem & Record<string, unknown> = existing[bareId] || { description: '' };
  item.description = description;

  if (file !== undefined) item.file = file;
  if (status !== undefined) item.status = status;
  if (endpoints !== undefined) item.endpoints = endpoints;
  if (tests !== undefined) item.tests = tests;
  if (flows !== undefined) item.flows = flows.map(f => ensurePrefix(f, '$'));
  if (gates !== undefined) item.gates = gates.map(g => ensurePrefix(g, '^'));
  if (signals !== undefined) item.signals = signals.map(s => ensurePrefix(s, '!'));
  if (aspects !== undefined) item.aspects = aspects.map(a => ensurePrefix(a, '~'));
  if (components !== undefined) item.components = components.map(c => ensurePrefix(c, '#'));
  if (componentType !== undefined) item.type = componentType;
  if (parent !== undefined) item.parent = ensurePrefix(parent, '#');

  existing[bareId] = item;
  (data as Record<string, unknown>)[sec] = existing;

  writePurposeFile(filePath, data);
  await reloadContext();

  return ok({
    action: 'add_component',
    file: filePath,
    section: sec,
    id: bareId,
    symbol: `#${bareId}`,
  });
}

// --- 3. paradigm_purpose_add_aspect ---

async function handleAddAspect(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, id, description, anchors, tags, appliesTo, enforcement } = args as {
    purposeFile: string; id: string; description: string;
    anchors: string[]; tags?: string[];
    appliesTo?: string[]; enforcement?: string;
  };

  if (!anchors || anchors.length === 0) {
    return err('Aspects (~) REQUIRE at least one code anchor. Provide anchors like ["src/middleware/audit.ts:15-35"].');
  }

  // Validate anchor format
  const anchorPattern = /^[^\s:]+:\d+(-\d+)?(,\d+)*$/;
  for (const anchor of anchors) {
    if (!anchorPattern.test(anchor)) {
      return err(`Invalid anchor format: "${anchor}". Expected format: "file.ts:15", "file.ts:15-20", or "file.ts:15,25,30".`);
    }
  }

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);

  // Validate anchor files exist (relative to .purpose dir)
  const purposeDir = path.dirname(filePath);
  for (const anchor of anchors) {
    const anchorFile = anchor.replace(/:.*$/, '');
    const resolved = path.resolve(purposeDir, anchorFile);
    if (!fs.existsSync(resolved)) {
      // Check if it's project-root-relative instead
      const rootResolved = path.resolve(ctx.rootDir, anchorFile);
      if (fs.existsSync(rootResolved)) {
        // Convert to .purpose-dir-relative path
        const corrected = path.relative(purposeDir, rootResolved);
        const idx = anchors.indexOf(anchor);
        anchors[idx] = anchor.replace(anchorFile, corrected);
      } else {
        return err(`Anchor file not found: "${anchorFile}". Anchors must be relative to the .purpose file directory (${purposeDir}).`);
      }
    }
  }

  const data = readPurposeFile(filePath);

  if (!data.aspects || Array.isArray(data.aspects)) data.aspects = {};

  const bareId = stripSymbolPrefix(id);

  data.aspects[bareId] = {
    description,
    anchors,
    ...(tags && { tags }),
    ...(appliesTo && { 'applies-to': appliesTo }),
    ...(enforcement && { enforcement }),
  };

  writePurposeFile(filePath, data);

  // Verify the aspect persisted (defense against silent no-op)
  const verifyAspects = readPurposeFile(filePath).aspects;
  if (!verifyAspects || Array.isArray(verifyAspects) || !verifyAspects[bareId]) {
    return err(
      `add_aspect write verification failed: aspect "${bareId}" not found in ${filePath} after write.`,
    );
  }

  await reloadContext();

  return ok({
    action: 'add_aspect',
    file: filePath,
    id: bareId,
    symbol: `~${bareId}`,
    anchors,
  });
}

// --- 4. paradigm_purpose_add_signal ---

async function handleAddSignal(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, id, description, category, severity, emitters, related, data: signalData } = args as {
    purposeFile: string; id: string; description: string;
    category?: string; severity?: 'info' | 'warn' | 'error';
    emitters?: string[]; related?: string[];
    data?: Record<string, unknown>;
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const fileData = readPurposeFile(filePath);

  if (!fileData.signals || Array.isArray(fileData.signals)) fileData.signals = {};

  const bareId = stripSymbolPrefix(id);

  fileData.signals[bareId] = {
    description,
    ...(category && { category }),
    ...(severity && { severity }),
    ...(emitters && { emitters: emitters.map(e => ensurePrefix(e, '#')) }),
    ...(related && { related }),
    ...(signalData && { data: signalData }),
  };

  writePurposeFile(filePath, fileData);

  // Verify the signal persisted (defense against silent no-op)
  const verifySignals = readPurposeFile(filePath).signals;
  if (!verifySignals || Array.isArray(verifySignals) || !verifySignals[bareId]) {
    return err(
      `add_signal write verification failed: signal "${bareId}" not found in ${filePath} after write.`,
    );
  }

  await reloadContext();

  return ok({
    action: 'add_signal',
    file: filePath,
    id: bareId,
    symbol: `!${bareId}`,
  });
}

// --- 5. paradigm_purpose_add_flow ---

async function handleAddFlow(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, id, description, gates, signals, components, steps } = args as {
    purposeFile: string; id: string; description: string;
    gates?: string[]; signals?: string[];
    components?: string[];
    steps?: Array<{ component: string; action: string; description?: string }>;
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);

  // Normalize to record format
  const flows = normalizeFlowsToRecord(data.flows);
  const bareId = stripSymbolPrefix(id);

  const flowDef: FlowDefinition = {
    description,
    ...(gates && { gates: gates.map(g => ensurePrefix(g, '^')) }),
    ...(signals && { signals: signals.map(s => ensurePrefix(s, '!')) }),
    ...(components && { components: components.map(c => ensurePrefix(c, '#')) }),
    ...(steps && { steps }),
  };

  flows[bareId] = flowDef;
  data.flows = flows;

  writePurposeFile(filePath, data);

  // Verify the flow persisted (defense against silent no-op)
  const verifyFlows = normalizeFlowsToRecord(readPurposeFile(filePath).flows);
  if (!verifyFlows[bareId]) {
    return err(
      `add_flow write verification failed: flow "${bareId}" not found in ${filePath} after write.`,
    );
  }

  await reloadContext();

  return ok({
    action: 'add_flow',
    file: filePath,
    id: bareId,
    symbol: `$${bareId}`,
  });
}

// --- 6. paradigm_purpose_add_gate ---

async function handleAddGate(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, id, description, requires, keys, signals } = args as {
    purposeFile: string; id: string; description: string;
    requires?: string[]; keys?: string[]; signals?: string[];
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);

  if (!data.gates || Array.isArray(data.gates)) data.gates = {};

  const bareId = stripSymbolPrefix(id);

  data.gates[bareId] = {
    description,
    ...(requires && { requires }),
    ...(keys && { keys }),
    ...(signals && { signals: signals.map(s => ensurePrefix(s, '!')) }),
  };

  writePurposeFile(filePath, data);

  // Verify the gate persisted (defense against silent no-op)
  const verifyGates = readPurposeFile(filePath).gates;
  if (!verifyGates || Array.isArray(verifyGates) || !verifyGates[bareId]) {
    return err(
      `add_gate write verification failed: gate "${bareId}" not found in ${filePath} after write.`,
    );
  }

  await reloadContext();

  return ok({
    action: 'add_gate',
    file: filePath,
    id: bareId,
    symbol: `^${bareId}`,
  });
}

// --- 7. paradigm_purpose_add_state ---

async function handleAddState(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, id, description, type, default: defaultVal, properties } = args as {
    purposeFile: string; id: string; description: string;
    type?: string; default?: unknown;
    properties?: Record<string, { type: string; description: string }>;
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);

  if (!data.states || Array.isArray(data.states)) data.states = {};

  const bareId = stripSymbolPrefix(id);

  const stateDef: Record<string, unknown> = { description };
  if (type !== undefined) stateDef.type = type;
  if (defaultVal !== undefined) stateDef.default = defaultVal;
  if (properties !== undefined) stateDef.properties = properties;

  data.states[bareId] = stateDef as PurposeFile['states'] extends Record<string, infer V> ? V : never;

  writePurposeFile(filePath, data);

  // Verify the state persisted (defense against silent no-op)
  const verifyStates = readPurposeFile(filePath).states;
  if (!verifyStates || Array.isArray(verifyStates) || !verifyStates[bareId]) {
    return err(
      `add_state write verification failed: state "${bareId}" not found in ${filePath} after write.`,
    );
  }

  await reloadContext();

  return ok({
    action: 'add_state',
    file: filePath,
    id: bareId,
  });
}

// --- 8. paradigm_purpose_link ---

async function handleLink(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const {
    purposeFile, componentId, section,
    signals, aspects, gates, flows, components,
  } = args as {
    purposeFile: string; componentId: string;
    section?: 'components' | 'features';
    signals?: string[]; aspects?: string[];
    gates?: string[]; flows?: string[];
    components?: string[];
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);
  const bareId = stripSymbolPrefix(componentId);

  // Auto-detect section if not provided
  let targetSection = section;
  if (!targetSection) {
    const comps = normalizeToRecord(data.components);
    const feats = normalizeToRecord(data.features);
    if (bareId in comps) targetSection = 'components';
    else if (bareId in feats) targetSection = 'features';
    else return err(`Component "${bareId}" not found in components or features. Specify section explicitly.`);
  }

  const items = normalizeToRecord(
    (data as Record<string, unknown>)[targetSection] as PurposeFile['components']
  );

  if (!(bareId in items)) {
    return err(`Component "${bareId}" not found in ${targetSection} section.`);
  }

  const item = items[bareId];

  // Merge (not replace) each reference array
  if (signals) item.signals = mergeArrayField(item.signals, signals.map(s => ensurePrefix(s, '!')));
  if (gates) item.gates = mergeArrayField(item.gates, gates.map(g => ensurePrefix(g, '^')));
  if (flows) item.flows = mergeArrayField(item.flows, flows.map(f => ensurePrefix(f, '$')));
  if (components) item.components = mergeArrayField(item.components, components.map(c => ensurePrefix(c, '#')));

  if (aspects) item.aspects = mergeArrayField(item.aspects, aspects.map(a => ensurePrefix(a, '~')));

  items[bareId] = item;
  (data as Record<string, unknown>)[targetSection] = items;

  writePurposeFile(filePath, data);
  await reloadContext();

  const added: string[] = [];
  if (signals) added.push(`signals: ${signals.join(', ')}`);
  if (aspects) added.push(`aspects: ${aspects.join(', ')}`);
  if (gates) added.push(`gates: ${gates.join(', ')}`);
  if (flows) added.push(`flows: ${flows.join(', ')}`);
  if (components) added.push(`components: ${components.join(', ')}`);

  return ok({
    action: 'link',
    file: filePath,
    componentId: bareId,
    section: targetSection,
    added,
  });
}

// --- 9. paradigm_purpose_remove ---

async function handleRemove(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, section, id } = args as {
    purposeFile: string;
    section: 'components' | 'features' | 'gates' | 'signals' | 'aspects' | 'flows' | 'states';
    id: string;
  };

  const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
  const data = readPurposeFile(filePath);
  const bareId = stripSymbolPrefix(id);

  // Handle flows specially (may be array format)
  if (section === 'flows') {
    const flows = normalizeFlowsToRecord(data.flows);
    if (!(bareId in flows)) {
      return err(`Flow "${bareId}" not found in flows section.`);
    }
    delete flows[bareId];
    data.flows = flows;
  } else if (section === 'components' || section === 'features') {
    const items = normalizeToRecord(
      (data as Record<string, unknown>)[section] as PurposeFile['components']
    );
    if (!(bareId in items)) {
      return err(`"${bareId}" not found in ${section} section.`);
    }
    delete items[bareId];
    (data as Record<string, unknown>)[section] = items;
  } else {
    const sectionData = (data as Record<string, unknown>)[section] as Record<string, unknown> | undefined;
    if (!sectionData || !(bareId in sectionData)) {
      return err(`"${bareId}" not found in ${section} section.`);
    }
    delete sectionData[bareId];
  }

  writePurposeFile(filePath, data);
  await reloadContext();

  return ok({
    action: 'remove',
    file: filePath,
    section,
    id: bareId,
  });
}

// --- 10. paradigm_purpose_rename ---

async function handleRename(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { oldId, newId, symbolType } = args as {
    oldId: string; newId: string; symbolType: string;
  };

  const modifiedFiles = await renameSymbolAcrossFiles(
    ctx.rootDir,
    oldId,
    newId,
    symbolType,
  );

  await reloadContext();

  return ok({
    action: 'rename',
    oldSymbol: `${symbolType}${stripSymbolPrefix(oldId)}`,
    newSymbol: `${symbolType}${stripSymbolPrefix(newId)}`,
    filesModified: modifiedFiles.length,
    files: modifiedFiles,
  });
}

// --- 11. paradigm_portal_add_gate ---

async function handlePortalAddGate(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { id, description, type, location, requires, check, grants, emits, prizes } = args as {
    id: string; description: string;
    type?: string; location?: string;
    requires?: string[]; check?: string;
    grants?: string[]; emits?: string[];
    prizes?: Array<{ id: string; oneTime?: boolean; metadata?: Record<string, unknown> }>;
  };

  const filePath = addGateToPortal(ctx.rootDir, {
    id, description, type, location, requires, check, grants, emits, prizes,
  });

  await reloadContext();

  const bareId = stripSymbolPrefix(id);
  return ok({
    action: 'portal_add_gate',
    file: filePath,
    id: bareId,
    symbol: `^${bareId}`,
  });
}

// --- 12. paradigm_portal_add_route ---

async function handlePortalAddRoute(
  args: Record<string, unknown>,
  ctx: ProjectContext,
  reloadContext: () => Promise<void>,
): Promise<{ handled: boolean; text: string }> {
  const { route, method, gates } = args as {
    route: string; method: string; gates: string[];
  };

  const filePath = addRouteToPortal(ctx.rootDir, { route, method, gates });
  await reloadContext();

  return ok({
    action: 'portal_add_route',
    file: filePath,
    route: `${method} ${route}`,
    gates,
  });
}

// --- Clarification Marker Scanner ---

const CLARIFICATION_REGEX = /\[NEEDS CLARIFICATION:\s*[^\]]+\]/gi;

/**
 * Scan a parsed .purpose file for [NEEDS CLARIFICATION: ...] markers in description fields.
 * Returns an array of warning issues for each marker found.
 */
function scanClarificationMarkers(
  data: PurposeFile,
  filePath: string,
): Array<{ type: string; message: string; path?: string }> {
  const issues: Array<{ type: string; message: string; path?: string }> = [];

  function checkField(value: unknown, fieldPath: string) {
    if (typeof value === 'string') {
      const matches = value.match(CLARIFICATION_REGEX);
      if (matches) {
        for (const match of matches) {
          issues.push({
            type: 'warning',
            message: `Clarification needed: ${match}`,
            path: fieldPath,
          });
        }
      }
    }
  }

  // Top-level description
  checkField(data.description, 'description');

  // Scan all sections that contain description fields
  const sections: Array<{ key: string; items?: Record<string, { description?: string }> | unknown }> = [
    { key: 'components', items: data.components },
    { key: 'features', items: data.features },
    { key: 'gates', items: data.gates },
    { key: 'signals', items: data.signals },
    { key: 'aspects', items: data.aspects },
  ];

  for (const section of sections) {
    if (section.items && typeof section.items === 'object') {
      for (const [id, item] of Object.entries(section.items as Record<string, Record<string, unknown>>)) {
        if (item && typeof item.description === 'string') {
          checkField(item.description, `${section.key}.${id}.description`);
        }
      }
    }
  }

  // Scan flows (may be record or array format)
  if (data.flows && typeof data.flows === 'object') {
    const flowEntries = Array.isArray(data.flows) ? [] : Object.entries(data.flows);
    for (const [id, flow] of flowEntries) {
      if (flow && typeof (flow as Record<string, unknown>).description === 'string') {
        checkField((flow as Record<string, unknown>).description, `flows.${id}.description`);
      }
    }
  }

  return issues;
}

// --- 13. paradigm_purpose_validate ---

async function handleValidate(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const { purposeFile, includePortal = true } = args as {
    purposeFile?: string;
    includePortal?: boolean;
  };

  interface FileIssue {
    file: string;
    valid: boolean;
    issues: Array<{ type: string; message: string; path?: string }>;
  }
  const results: FileIssue[] = [];

  if (purposeFile) {
    // Validate single file
    const filePath = resolvePurposeFilePath(purposeFile, ctx.rootDir);
    const parseResult = parsePurposeFileDetailed(filePath);

    if (!parseResult.data) {
      results.push({
        file: filePath,
        valid: false,
        issues: parseResult.errors.map(e => ({ type: 'error', message: e })),
      });
    } else {
      const validation = validatePurposeFile(parseResult.data, filePath);

      // Additional: check aspects have anchors
      if (parseResult.data.aspects) {
        for (const [aspId, aspect] of Object.entries(parseResult.data.aspects)) {
          if (!aspect.anchors || aspect.anchors.length === 0) {
            validation.issues.push({
              type: 'error',
              message: `Aspect "${aspId}" is missing required anchors`,
              path: `aspects.${aspId}`,
            });
            validation.valid = false;
          }
        }
      }

      // Check for clarification markers
      const clarificationIssues = scanClarificationMarkers(parseResult.data, filePath);
      validation.issues.push(...clarificationIssues);

      results.push({
        file: filePath,
        valid: validation.valid,
        issues: validation.issues,
      });
    }
  } else {
    // Validate all .purpose files
    const files = await findPurposeFiles(ctx.rootDir);
    for (const filePath of files) {
      const parseResult = parsePurposeFileDetailed(filePath);

      if (!parseResult.data) {
        results.push({
          file: filePath,
          valid: false,
          issues: parseResult.errors.map(e => ({ type: 'error', message: e })),
        });
        continue;
      }

      const validation = validatePurposeFile(parseResult.data, filePath);

      // Check aspects have anchors
      if (parseResult.data.aspects) {
        for (const [aspId, aspect] of Object.entries(parseResult.data.aspects)) {
          if (!aspect.anchors || aspect.anchors.length === 0) {
            validation.issues.push({
              type: 'error',
              message: `Aspect "${aspId}" is missing required anchors`,
              path: `aspects.${aspId}`,
            });
            validation.valid = false;
          }
        }
      }

      // Check for clarification markers
      const clarificationIssues = scanClarificationMarkers(parseResult.data, filePath);
      validation.issues.push(...clarificationIssues);

      results.push({
        file: filePath,
        valid: validation.valid,
        issues: validation.issues,
      });
    }
  }

  // Validate portal.yaml
  if (includePortal) {
    const { data: portalData, filePath: portalPath } = readPortalFile(ctx.rootDir);
    const portalIssues: Array<{ type: string; message: string; path?: string }> = [];

    if (portalData.gates) {
      for (const [gateId, gate] of Object.entries(portalData.gates)) {
        if (!gate.description) {
          portalIssues.push({
            type: 'warning',
            message: `Gate "${gateId}" has no description`,
            path: `gates.${gateId}`,
          });
        }
        if (!gate.prizes) {
          portalIssues.push({
            type: 'warning',
            message: `Gate "${gateId}" is missing prizes array (v2 requirement)`,
            path: `gates.${gateId}`,
          });
        }
      }
    }

    if (portalIssues.length > 0) {
      results.push({
        file: portalPath,
        valid: portalIssues.every(i => i.type !== 'error'),
        issues: portalIssues,
      });
    }
  }

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const allValid = results.every(r => r.valid);

  return ok({
    action: 'validate',
    valid: allValid,
    totalFiles: results.length,
    totalIssues,
    results,
  });
}
