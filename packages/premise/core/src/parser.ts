/**
 * Parser for .premise files
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { DreamFile, DreamNode, DreamConnection, DreamSnapshot } from './types.js';

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

const DreamSourceConfigSchema = z.object({
  path: z.string(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const DreamNodeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  type: z.enum(['feature', 'component', 'flow', 'state', 'aspect', 'gate', 'signal', 'idea']),
  content: z.string().optional(),
  position: PositionSchema,
  tags: z.array(z.string()).optional(),
  created: z.string(),
  modified: z.string().optional(),
});

const DreamConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
});

const DreamGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(z.string()),
  color: z.string().optional(),
});

const DreamLayoutSchema = z.object({
  viewport: ViewportSchema,
  groups: z.array(DreamGroupSchema).optional(),
});

const DreamSnapshotStateSchema = z.object({
  nodes: z.array(DreamNodeSchema),
  connections: z.array(DreamConnectionSchema),
  layout: DreamLayoutSchema,
});

const DreamSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  timestamp: z.string(),
  description: z.string().optional(),
  state: DreamSnapshotStateSchema,
});

const DreamFileSchema = z.object({
  version: z.string(),
  metadata: z.object({
    name: z.string(),
    created: z.string(),
    modified: z.string(),
  }),
  sources: z.object({
    purpose: z.array(DreamSourceConfigSchema).optional(),
    gate: z.array(DreamSourceConfigSchema).optional(),
  }),
  nodes: z.array(DreamNodeSchema),
  connections: z.array(DreamConnectionSchema),
  layout: DreamLayoutSchema,
  snapshots: z.array(DreamSnapshotSchema).optional(),
});

// ============================================
// Parser Functions
// ============================================

export interface DreamParseResult {
  data: DreamFile | null;
  errors: string[];
  rawContent?: string;
}

/**
 * Parse a .premise file
 */
export function parseDreamFile(filePath: string): DreamParseResult {
  const errors: string[] = [];
  let rawContent: string | undefined;

  // Read file
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (e: unknown) {
    errors.push(`Cannot read file: ${(e as Error).message}`);
    return { data: null, errors, rawContent: undefined };
  }

  return parseDreamContent(rawContent);
}

/**
 * Parse .premise content from a string
 */
export function parseDreamContent(content: string): DreamParseResult {
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
      data: createEmptyDreamFile(),
      errors: [],
      rawContent: content,
    };
  }

  // Validate against schema
  const parseResult = DreamFileSchema.safeParse(data);

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join('.');
      errors.push(`Schema error at ${path || '/'}: ${issue.message}`);
    }
    // Return data even with errors for partial editing
    return { data: data as DreamFile, errors, rawContent: content };
  }

  return { data: parseResult.data as DreamFile, errors: [], rawContent: content };
}

/**
 * Create an empty dream file structure
 */
export function createEmptyDreamFile(name = 'Untitled'): DreamFile {
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
      gate: [{ path: './portal.yaml' }],
    },
    nodes: [],
    connections: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}

/**
 * Serialize a DreamFile back to YAML
 */
export function serializeDreamFile(data: DreamFile): string {
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
export function getDefaultDreamContent(projectName = 'My Project'): string {
  return serializeDreamFile(createEmptyDreamFile(projectName));
}

/**
 * Add a node to a dream file
 */
export function addDreamNode(dreamFile: DreamFile, node: DreamNode): DreamFile {
  return {
    ...dreamFile,
    nodes: [...dreamFile.nodes, node],
    metadata: {
      ...dreamFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Update a node's position
 */
export function updateNodePosition(
  dreamFile: DreamFile,
  nodeId: string,
  position: { x: number; y: number }
): DreamFile {
  return {
    ...dreamFile,
    nodes: dreamFile.nodes.map((n) =>
      n.id === nodeId ? { ...n, position, modified: new Date().toISOString() } : n
    ),
    metadata: {
      ...dreamFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Add a connection between nodes
 */
export function addConnection(dreamFile: DreamFile, connection: DreamConnection): DreamFile {
  // Check if connection already exists
  const exists = dreamFile.connections.some(
    (c) => c.from === connection.from && c.to === connection.to
  );
  if (exists) return dreamFile;

  return {
    ...dreamFile,
    connections: [...dreamFile.connections, connection],
    metadata: {
      ...dreamFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}

/**
 * Create a snapshot of the current state
 */
export function createSnapshot(
  dreamFile: DreamFile,
  name: string,
  description?: string
): DreamFile {
  const snapshot: DreamSnapshot = {
    id: `snap-${Date.now()}`,
    name,
    timestamp: new Date().toISOString(),
    description,
    state: {
      nodes: [...dreamFile.nodes],
      connections: [...dreamFile.connections],
      layout: { ...dreamFile.layout },
    },
  };

  return {
    ...dreamFile,
    snapshots: [...(dreamFile.snapshots || []), snapshot],
    metadata: {
      ...dreamFile.metadata,
      modified: new Date().toISOString(),
    },
  };
}
