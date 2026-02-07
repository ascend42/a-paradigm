/**
 * Parser for .premise files
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { PremiseFile, PremiseNode, PremiseConnection, PremiseSnapshot } from './types.js';

// ============================================
// Zod Schema for Validation
// ============================================

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

const PremiseSourceConfigSchema = z.object({
  path: z.string(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const PremiseNodeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  type: z.enum(['feature', 'component', 'flow', 'state', 'aspect', 'gate', 'signal', 'idea']),
  content: z.string().optional(),
  position: PositionSchema,
  tags: z.array(z.string()).optional(),
  created: z.string(),
  modified: z.string().optional(),
});

const PremiseConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
});

const PremiseGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(z.string()),
  color: z.string().optional(),
});

const PremiseLayoutSchema = z.object({
  viewport: ViewportSchema,
  groups: z.array(PremiseGroupSchema).optional(),
});

const PremiseSnapshotStateSchema = z.object({
  nodes: z.array(PremiseNodeSchema),
  connections: z.array(PremiseConnectionSchema),
  layout: PremiseLayoutSchema,
});

const PremiseSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  timestamp: z.string(),
  description: z.string().optional(),
  state: PremiseSnapshotStateSchema,
});

const PremiseFileSchema = z.object({
  version: z.string(),
  metadata: z.object({
    name: z.string(),
    created: z.string(),
    modified: z.string(),
  }),
  sources: z.object({
    purpose: z.array(PremiseSourceConfigSchema).optional(),
    portal: z.array(PremiseSourceConfigSchema).optional(),
  }),
  nodes: z.array(PremiseNodeSchema),
  connections: z.array(PremiseConnectionSchema),
  layout: PremiseLayoutSchema,
  snapshots: z.array(PremiseSnapshotSchema).optional(),
});

// ============================================
// Parser Functions
// ============================================

export interface PremiseParseResult {
  data: PremiseFile | null;
  errors: string[];
  rawContent?: string;
}

/**
 * Parse a .premise file
 */
export function parsePremiseFile(filePath: string): PremiseParseResult {
  const errors: string[] = [];
  let rawContent: string | undefined;

  // Read file
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (e: unknown) {
    errors.push(`Cannot read file: ${(e as Error).message}`);
    return { data: null, errors, rawContent: undefined };
  }

  return parsePremiseContent(rawContent);
}

/**
 * Parse .premise content from a string
 */
export function parsePremiseContent(content: string): PremiseParseResult {
  const errors: string[] = [];

  // Parse YAML
  let data: unknown = null;
  try {
    data = yaml.load(content);
  } catch (e: unknown) {
    const yamlError = e as yaml.YAMLException;
    const line = yamlError.mark?.line ? yamlError.mark.line + 1 : undefined;
    errors.push(`YAML syntax error: ${yamlError.reason || (e as Error).message}${line ? ` (line ${line})` : ''}`);
    return { data: null, errors, rawContent: content };
  }

  // Handle empty files
  if (data === null || data === undefined) {
    return {
      data: createEmptyPremiseFile(),
      errors: [],
      rawContent: content,
    };
  }

  // Validate against schema
  const parseResult = PremiseFileSchema.safeParse(data);

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join('.');
      errors.push(`Schema error at ${path || '/'}: ${issue.message}`);
    }
    // Return data even with errors for partial editing
    return { data: data as PremiseFile, errors, rawContent: content };
  }

  return { data: parseResult.data as PremiseFile, errors: [], rawContent: content };
}

/**
 * Create an empty premise file structure
 */
export function createEmptyPremiseFile(name = 'Untitled'): PremiseFile {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    metadata: {
      name,
      created: now,
      modified: now,
    },
    sources: {
      purpose: [{ path: './' }],
      portal: [{ path: './portal.yaml' }],
    },
    nodes: [],
    connections: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}

/**
 * Serialize a premise file back to YAML
 */
export function serializePremiseFile(data: PremiseFile): string {
  // Update modified timestamp
  data.metadata.modified = new Date().toISOString();

  return yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Get default .premise file content for initialization
 */
export function getDefaultPremiseContent(projectName = 'My Project'): string {
  return serializePremiseFile(createEmptyPremiseFile(projectName));
}

/**
 * Add a node to a premise file
 */
export function addPremiseNode(premiseFile: PremiseFile, node: PremiseNode): PremiseFile {
  return {
    ...premiseFile,
    nodes: [...premiseFile.nodes, node],
    metadata: {
      ...premiseFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Update a node's position
 */
export function updateNodePosition(
  premiseFile: PremiseFile,
  nodeId: string,
  position: { x: number; y: number }
): PremiseFile {
  return {
    ...premiseFile,
    nodes: premiseFile.nodes.map((n) =>
      n.id === nodeId ? { ...n, position, modified: new Date().toISOString() } : n
    ),
    metadata: {
      ...premiseFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Add a connection between nodes
 */
export function addConnection(premiseFile: PremiseFile, connection: PremiseConnection): PremiseFile {
  // Check if connection already exists
  const exists = premiseFile.connections.some(
    (c) => c.from === connection.from && c.to === connection.to
  );
  if (exists) return premiseFile;

  return {
    ...premiseFile,
    connections: [...premiseFile.connections, connection],
    metadata: {
      ...premiseFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Create a snapshot of the current state
 */
export function createSnapshot(
  premiseFile: PremiseFile,
  name: string,
  description?: string
): PremiseFile {
  const snapshot: PremiseSnapshot = {
    id: `snap-${Date.now()}`,
    name,
    timestamp: new Date().toISOString(),
    description,
    state: {
      nodes: [...premiseFile.nodes],
      connections: [...premiseFile.connections],
      layout: { ...premiseFile.layout },
    },
  };

  return {
    ...premiseFile,
    snapshots: [...(premiseFile.snapshots || []), snapshot],
    metadata: {
      ...premiseFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}
