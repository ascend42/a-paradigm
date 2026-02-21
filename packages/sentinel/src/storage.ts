/**
 * Paradigm Sentinel - SQLite Storage Layer
 *
 * Persistent storage for incidents, patterns, groups, and resolutions.
 * Uses sql.js for pure JavaScript SQLite (no native compilation needed).
 */

import initSqlJs, { type SqlJsDatabase, type SqlValue } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import type {
  SymbolicIncidentRecord,
  CreateIncidentInput,
  IncidentNote,
  FailurePattern,
  CreatePatternInput,
  PatternConfidence,
  IncidentGroup,
  CreateGroupInput,
  ResolutionRecord,
  SentinelStats,
  SymbolHealth,
  PatternExport,
  BackupExport,
  IncidentQueryOptions,
  PatternQueryOptions,
  ResolutionQueryOptions,
  IncidentStatus,
} from './types.js';

const SCHEMA_VERSION = 1;

// Default confidence for new patterns
const DEFAULT_CONFIDENCE: PatternConfidence = {
  score: 50,
  timesMatched: 0,
  timesResolved: 0,
  timesRecurred: 0,
};

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export class SentinelStorage {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private incidentCounter: number = 0;
  private initialized: boolean = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || this.getDefaultDbPath();
  }

  private getDefaultDbPath(): string {
    // Store in .paradigm directory (or standalone .sentinel directory)
    const dataDir =
      process.env.SENTINEL_DATA_DIR ||
      process.env.PARADIGM_DATA_DIR ||
      path.join(process.cwd(), '.paradigm', 'sentinel');
    return path.join(dataDir, 'sentinel.db');
  }

  private createSchema(): void {
    if (!this.db) return;

    this.db.run(`
      -- Metadata table for schema versioning
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Incidents table
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        error_message TEXT NOT NULL,
        error_stack TEXT,
        error_code TEXT,
        error_type TEXT,
        symbols TEXT NOT NULL,
        flow_position TEXT,
        environment TEXT NOT NULL,
        service TEXT,
        version TEXT,
        user_id TEXT,
        request_id TEXT,
        group_id TEXT,
        notes TEXT DEFAULT '[]',
        related_incidents TEXT DEFAULT '[]',
        resolved_at TEXT,
        resolved_by TEXT,
        resolution TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Patterns table
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        pattern TEXT NOT NULL,
        resolution TEXT NOT NULL,
        confidence TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        private INTEGER NOT NULL DEFAULT 0,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Incident groups
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT,
        common_symbols TEXT,
        common_error_patterns TEXT,
        suggested_pattern_id TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Group members
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (group_id, incident_id)
      );

      -- Resolutions history
      CREATE TABLE IF NOT EXISTS resolutions (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        pattern_id TEXT,
        commit_hash TEXT,
        pr_url TEXT,
        notes TEXT,
        resolved_at TEXT NOT NULL,
        recurred INTEGER DEFAULT 0
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp);
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_incidents_environment ON incidents(environment);
      CREATE INDEX IF NOT EXISTS idx_patterns_source ON patterns(source);
    `);

    // Set schema version
    this.db.run(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', ?)",
      [String(SCHEMA_VERSION)]
    );
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  // ─── Incidents ───────────────────────────────────────────────────

  recordIncident(input: CreateIncidentInput): string {
    const db = this.db;
    if (!db) {
      // Initialize synchronously for this call
      this.initializeSync();
    }

    this.incidentCounter++;
    const id = `INC-${String(this.incidentCounter).padStart(3, '0')}`;
    const now = new Date().toISOString();

    this.db!.run(
      `INSERT INTO incidents (
        id, timestamp, status, error_message, error_stack, error_code, error_type,
        symbols, flow_position, environment, service, version, user_id, request_id,
        group_id, notes, related_incidents, resolved_at, resolved_by, resolution,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.timestamp || now,
        input.status || 'open',
        input.error.message,
        input.error.stack || null,
        input.error.code || null,
        input.error.type || null,
        JSON.stringify(input.symbols),
        input.flowPosition ? JSON.stringify(input.flowPosition) : null,
        input.environment,
        input.service || null,
        input.version || null,
        input.userId || null,
        input.requestId || null,
        input.groupId || null,
        '[]',
        '[]',
        input.resolvedAt || null,
        input.resolvedBy || null,
        input.resolution ? JSON.stringify(input.resolution) : null,
        now,
        now,
      ]
    );

    this.save();
    return id;
  }

  private initializeSync(): void {
    if (this.initialized && this.db) return;

    // For synchronous initialization, SQL must already be loaded
    // Call ensureReady() before using storage methods
    if (!this.db && SQL) {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.dbPath)) {
        const fileData = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(fileData);
      } else {
        this.db = new SQL.Database();
        this.createSchema();
      }

      // Initialize incident counter
      try {
        const result = this.db.exec(
          'SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as max FROM incidents'
        );
        if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
          this.incidentCounter = result[0].values[0][0] as number;
        }
      } catch {
        this.incidentCounter = 0;
      }

      this.initialized = true;
      this.save();
    }
  }

  /**
   * Ensure the storage is ready for use. Must be called once before using storage methods.
   */
  async ensureReady(): Promise<void> {
    if (!SQL) {
      SQL = await initSqlJs();
    }
    this.initializeSync();
  }

  getIncident(id: string): SymbolicIncidentRecord | null {
    this.initializeSync();
    const result = this.db!.exec('SELECT * FROM incidents WHERE id = ?', [id]);

    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToIncident(result[0].columns, result[0].values[0]);
  }

  getRecentIncidents(
    options: IncidentQueryOptions = {}
  ): SymbolicIncidentRecord[] {
    this.initializeSync();
    const { limit = 50, offset = 0 } = options;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.status && options.status !== 'all') {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.environment) {
      conditions.push('environment = ?');
      params.push(options.environment);
    }

    if (options.symbol) {
      conditions.push("symbols LIKE ?");
      params.push(`%${options.symbol}%`);
    }

    if (options.search) {
      conditions.push('(error_message LIKE ? OR notes LIKE ?)');
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    if (options.dateFrom) {
      conditions.push('timestamp >= ?');
      params.push(options.dateFrom);
    }

    if (options.dateTo) {
      conditions.push('timestamp <= ?');
      params.push(options.dateTo);
    }

    if (options.groupId) {
      conditions.push('group_id = ?');
      params.push(options.groupId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT * FROM incidents ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToIncident(result[0].columns, row)
    );
  }

  updateIncident(id: string, updates: Partial<SymbolicIncidentRecord>): void {
    this.initializeSync();
    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }

    if (updates.error !== undefined) {
      setClauses.push('error_message = ?');
      params.push(updates.error.message);
      if (updates.error.stack !== undefined) {
        setClauses.push('error_stack = ?');
        params.push(updates.error.stack || null);
      }
    }

    if (updates.symbols !== undefined) {
      setClauses.push('symbols = ?');
      params.push(JSON.stringify(updates.symbols));
    }

    if (updates.flowPosition !== undefined) {
      setClauses.push('flow_position = ?');
      params.push(
        updates.flowPosition ? JSON.stringify(updates.flowPosition) : null
      );
    }

    if (updates.groupId !== undefined) {
      setClauses.push('group_id = ?');
      params.push(updates.groupId || null);
    }

    if (updates.resolvedAt !== undefined) {
      setClauses.push('resolved_at = ?');
      params.push(updates.resolvedAt || null);
    }

    if (updates.resolvedBy !== undefined) {
      setClauses.push('resolved_by = ?');
      params.push(updates.resolvedBy || null);
    }

    if (updates.resolution !== undefined) {
      setClauses.push('resolution = ?');
      params.push(
        updates.resolution ? JSON.stringify(updates.resolution) : null
      );
    }

    params.push(id);

    this.db!.run(
      `UPDATE incidents SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    this.save();
  }

  addIncidentNote(
    incidentId: string,
    note: Omit<IncidentNote, 'id'>
  ): void {
    this.initializeSync();
    const incident = this.getIncident(incidentId);
    if (!incident) return;

    const newNote: IncidentNote = {
      id: uuidv4(),
      ...note,
    };

    const notes = [...incident.notes, newNote];
    this.db!.run(
      'UPDATE incidents SET notes = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(notes), new Date().toISOString(), incidentId]
    );
    this.save();
  }

  linkIncidents(incidentId: string, relatedId: string): void {
    this.initializeSync();
    const incident = this.getIncident(incidentId);
    if (!incident) return;

    if (!incident.relatedIncidents.includes(relatedId)) {
      const related = [...incident.relatedIncidents, relatedId];
      this.db!.run(
        'UPDATE incidents SET related_incidents = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(related), new Date().toISOString(), incidentId]
      );
    }

    // Also link the other direction
    const relatedIncident = this.getIncident(relatedId);
    if (relatedIncident && !relatedIncident.relatedIncidents.includes(incidentId)) {
      const related = [...relatedIncident.relatedIncidents, incidentId];
      this.db!.run(
        'UPDATE incidents SET related_incidents = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(related), new Date().toISOString(), relatedId]
      );
    }
    this.save();
  }

  getIncidentCount(options: IncidentQueryOptions = {}): number {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.status && options.status !== 'all') {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.environment) {
      conditions.push('environment = ?');
      params.push(options.environment);
    }

    if (options.dateFrom) {
      conditions.push('timestamp >= ?');
      params.push(options.dateFrom);
    }

    if (options.dateTo) {
      conditions.push('timestamp <= ?');
      params.push(options.dateTo);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT COUNT(*) as count FROM incidents ${whereClause}`,
      params
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  // ─── Patterns ────────────────────────────────────────────────────

  addPattern(input: CreatePatternInput): string {
    this.initializeSync();
    const now = new Date().toISOString();
    const confidence: PatternConfidence = {
      ...DEFAULT_CONFIDENCE,
      ...input.confidence,
    };

    this.db!.run(
      `INSERT INTO patterns (
        id, name, description, pattern, resolution, confidence,
        source, private, tags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.description || null,
        JSON.stringify(input.pattern),
        JSON.stringify(input.resolution),
        JSON.stringify(confidence),
        input.source,
        input.private ? 1 : 0,
        JSON.stringify(input.tags || []),
        now,
        now,
      ]
    );

    this.save();
    return input.id;
  }

  getPattern(id: string): FailurePattern | null {
    this.initializeSync();
    const result = this.db!.exec('SELECT * FROM patterns WHERE id = ?', [id]);

    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToPattern(result[0].columns, result[0].values[0]);
  }

  getAllPatterns(options: PatternQueryOptions = {}): FailurePattern[] {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.source) {
      conditions.push('source = ?');
      params.push(options.source);
    }

    if (options.minConfidence !== undefined) {
      conditions.push("json_extract(confidence, '$.score') >= ?");
      params.push(options.minConfidence);
    }

    if (!options.includePrivate) {
      conditions.push('private = 0');
    }

    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConditions.join(' OR ')})`);
      params.push(...options.tags.map((tag) => `%"${tag}"%`));
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT * FROM patterns ${whereClause} ORDER BY json_extract(confidence, '$.score') DESC`,
      params
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToPattern(result[0].columns, row)
    );
  }

  updatePattern(id: string, updates: Partial<FailurePattern>): void {
    this.initializeSync();
    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }

    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      params.push(updates.description || null);
    }

    if (updates.pattern !== undefined) {
      setClauses.push('pattern = ?');
      params.push(JSON.stringify(updates.pattern));
    }

    if (updates.resolution !== undefined) {
      setClauses.push('resolution = ?');
      params.push(JSON.stringify(updates.resolution));
    }

    if (updates.confidence !== undefined) {
      setClauses.push('confidence = ?');
      params.push(JSON.stringify(updates.confidence));
    }

    if (updates.source !== undefined) {
      setClauses.push('source = ?');
      params.push(updates.source);
    }

    if (updates.private !== undefined) {
      setClauses.push('private = ?');
      params.push(updates.private ? 1 : 0);
    }

    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    params.push(id);

    this.db!.run(
      `UPDATE patterns SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    this.save();
  }

  deletePattern(id: string): void {
    this.initializeSync();
    this.db!.run('DELETE FROM patterns WHERE id = ?', [id]);
    this.save();
  }

  updatePatternConfidence(
    patternId: string,
    event: 'matched' | 'resolved' | 'recurred'
  ): void {
    const pattern = this.getPattern(patternId);
    if (!pattern) return;

    const now = new Date().toISOString();
    const confidence = { ...pattern.confidence };

    switch (event) {
      case 'matched':
        confidence.timesMatched++;
        confidence.lastMatched = now;
        break;
      case 'resolved':
        confidence.timesResolved++;
        confidence.lastResolved = now;
        // Increase confidence slightly on successful resolution
        confidence.score = Math.min(100, confidence.score + 2);
        break;
      case 'recurred':
        confidence.timesRecurred++;
        // Decrease confidence on recurrence
        confidence.score = Math.max(10, confidence.score - 5);
        break;
    }

    this.updatePattern(patternId, { confidence });
  }

  // ─── Groups ──────────────────────────────────────────────────────

  createGroup(input: CreateGroupInput): string {
    this.initializeSync();
    const id = `GRP-${uuidv4().substring(0, 8)}`;
    const now = new Date().toISOString();

    this.db!.run(
      `INSERT INTO groups (
        id, name, common_symbols, common_error_patterns,
        suggested_pattern_id, first_seen, last_seen, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name || null,
        JSON.stringify(input.commonSymbols),
        JSON.stringify(input.commonErrorPatterns),
        input.suggestedPattern?.id || null,
        input.firstSeen,
        input.lastSeen,
        now,
        now,
      ]
    );

    // Add incidents to group
    for (const incidentId of input.incidents) {
      this.addToGroup(id, incidentId);
    }

    this.save();
    return id;
  }

  getGroup(id: string): IncidentGroup | null {
    this.initializeSync();
    const result = this.db!.exec('SELECT * FROM groups WHERE id = ?', [id]);

    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToGroup(result[0].columns, result[0].values[0]);
  }

  getGroups(options: { limit?: number } = {}): IncidentGroup[] {
    this.initializeSync();
    const limit = options.limit || 100;
    const result = this.db!.exec(
      'SELECT * FROM groups ORDER BY last_seen DESC LIMIT ?',
      [limit]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToGroup(result[0].columns, row)
    );
  }

  addToGroup(groupId: string, incidentId: string): void {
    this.initializeSync();
    const now = new Date().toISOString();

    // Add to group_members
    this.db!.run(
      'INSERT OR IGNORE INTO group_members (group_id, incident_id, added_at) VALUES (?, ?, ?)',
      [groupId, incidentId, now]
    );

    // Update incident's group_id
    this.db!.run('UPDATE incidents SET group_id = ? WHERE id = ?', [
      groupId,
      incidentId,
    ]);

    // Update group's last_seen
    this.db!.run(
      'UPDATE groups SET last_seen = ?, updated_at = ? WHERE id = ?',
      [now, now, groupId]
    );

    this.save();
  }

  // ─── Resolutions ─────────────────────────────────────────────────

  recordResolution(resolution: {
    incidentId: string;
    patternId?: string;
    commitHash?: string;
    prUrl?: string;
    notes?: string;
  }): void {
    this.initializeSync();
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db!.run(
      `INSERT INTO resolutions (id, incident_id, pattern_id, commit_hash, pr_url, notes, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        resolution.incidentId,
        resolution.patternId || null,
        resolution.commitHash || null,
        resolution.prUrl || null,
        resolution.notes || null,
        now,
      ]
    );

    // Update incident
    this.updateIncident(resolution.incidentId, {
      status: 'resolved' as IncidentStatus,
      resolvedAt: now,
      resolvedBy: resolution.patternId || 'manual',
      resolution: {
        patternId: resolution.patternId,
        commitHash: resolution.commitHash,
        prUrl: resolution.prUrl,
        notes: resolution.notes,
      },
    });

    // Update pattern confidence if used
    if (resolution.patternId) {
      this.updatePatternConfidence(resolution.patternId, 'resolved');
    }

    this.save();
  }

  markRecurred(incidentId: string): void {
    this.initializeSync();
    // Find the resolution and mark as recurred
    this.db!.run(
      'UPDATE resolutions SET recurred = 1 WHERE incident_id = ?',
      [incidentId]
    );

    // Update pattern confidence
    const result = this.db!.exec(
      'SELECT pattern_id FROM resolutions WHERE incident_id = ?',
      [incidentId]
    );

    if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
      this.updatePatternConfidence(result[0].values[0][0] as string, 'recurred');
    }

    this.save();
  }

  getResolutionHistory(
    options: ResolutionQueryOptions = {}
  ): ResolutionRecord[] {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.patternId) {
      conditions.push('pattern_id = ?');
      params.push(options.patternId);
    }

    if (options.symbol) {
      conditions.push(`incident_id IN (
        SELECT id FROM incidents WHERE symbols LIKE ?
      )`);
      params.push(`%${options.symbol}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;

    const result = this.db!.exec(
      `SELECT * FROM resolutions ${whereClause} ORDER BY resolved_at DESC LIMIT ?`,
      [...params, limit]
    );

    if (result.length === 0) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const obj: Record<string, SqlValue> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return {
        id: obj.id as string,
        incidentId: obj.incident_id as string,
        patternId: (obj.pattern_id as string) || undefined,
        commitHash: (obj.commit_hash as string) || undefined,
        prUrl: (obj.pr_url as string) || undefined,
        notes: (obj.notes as string) || undefined,
        resolvedAt: obj.resolved_at as string,
        recurred: obj.recurred === 1,
      };
    });
  }

  // ─── Stats ───────────────────────────────────────────────────────

  getStats(period: { start: string; end: string }): SentinelStats {
    this.initializeSync();
    const { start, end } = period;

    // Incident counts
    const total = this.getIncidentCount({ dateFrom: start, dateTo: end });
    const open = this.getIncidentCount({
      dateFrom: start,
      dateTo: end,
      status: 'open',
    });
    const resolved = this.getIncidentCount({
      dateFrom: start,
      dateTo: end,
      status: 'resolved',
    });

    // By environment
    const envResult = this.db!.exec(
      `SELECT environment, COUNT(*) as count
      FROM incidents
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY environment`,
      [start, end]
    );

    const byEnvironment: Record<string, number> = {};
    if (envResult.length > 0) {
      for (const row of envResult[0].values) {
        byEnvironment[row[0] as string] = row[1] as number;
      }
    }

    // By day
    const dayResult = this.db!.exec(
      `SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM incidents
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY DATE(timestamp)
      ORDER BY date`,
      [start, end]
    );

    const byDay: { date: string; count: number }[] = [];
    if (dayResult.length > 0) {
      for (const row of dayResult[0].values) {
        byDay.push({ date: row[0] as string, count: row[1] as number });
      }
    }

    // Pattern stats
    const patterns = this.getAllPatterns({ includePrivate: true });
    const avgConfidence =
      patterns.length > 0
        ? patterns.reduce((sum, p) => sum + p.confidence.score, 0) /
          patterns.length
        : 0;

    const mostEffective = patterns
      .sort((a, b) => b.confidence.timesResolved - a.confidence.timesResolved)
      .slice(0, 5)
      .map((p) => ({ patternId: p.id, resolvedCount: p.confidence.timesResolved }));

    const leastEffective = patterns
      .filter((p) => p.confidence.timesMatched > 0)
      .map((p) => ({
        patternId: p.id,
        recurrenceRate:
          p.confidence.timesRecurred /
          Math.max(1, p.confidence.timesResolved),
      }))
      .sort((a, b) => b.recurrenceRate - a.recurrenceRate)
      .slice(0, 5);

    // Symbol stats - extract from incidents
    const symbolCounts = new Map<string, number>();
    const incidents = this.getRecentIncidents({
      dateFrom: start,
      dateTo: end,
      limit: 1000,
    });

    for (const incident of incidents) {
      for (const [, value] of Object.entries(incident.symbols)) {
        if (value) {
          symbolCounts.set(value, (symbolCounts.get(value) || 0) + 1);
        }
      }
    }

    const mostIncidents = Array.from(symbolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([symbol, count]) => ({ symbol, count }));

    // Resolution stats
    const resolutions = this.getResolutionHistory({ limit: 1000 });
    const periodResolutions = resolutions.filter(
      (r) => r.resolvedAt >= start && r.resolvedAt <= end
    );
    const resolvedWithPattern = periodResolutions.filter(
      (r) => r.patternId
    ).length;
    const resolvedManually = periodResolutions.length - resolvedWithPattern;

    return {
      period: { start, end },
      incidents: {
        total,
        open,
        resolved,
        byEnvironment,
        byDay,
      },
      patterns: {
        total: patterns.length,
        avgConfidence: Math.round(avgConfidence),
        mostEffective,
        leastEffective,
      },
      symbols: {
        mostIncidents,
        mostResolved: [],
        hotspots: mostIncidents.slice(0, 5).map((s) => ({
          symbol: s.symbol,
          incidentRate: s.count / Math.max(1, total),
        })),
      },
      resolution: {
        avgTimeToResolve: 0,
        resolvedWithPattern,
        resolvedManually,
        resolutionRate: total > 0 ? (resolved / total) * 100 : 0,
      },
    };
  }

  getSymbolHealth(symbol: string): SymbolHealth {
    const incidents = this.getRecentIncidents({ symbol, limit: 1000 });
    const incidentCount = incidents.length;

    // Count patterns used
    const patternCounts = new Map<string, number>();
    for (const incident of incidents) {
      if (incident.resolution?.patternId) {
        const count = patternCounts.get(incident.resolution.patternId) || 0;
        patternCounts.set(incident.resolution.patternId, count + 1);
      }
    }

    const topPatterns = Array.from(patternCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([patternId, count]) => ({ patternId, count }));

    return {
      incidentCount,
      avgTimeToResolve: 0,
      topPatterns,
    };
  }

  // ─── Import/Export ───────────────────────────────────────────────

  exportPatterns(
    options: { includePrivate?: boolean } = {}
  ): PatternExport {
    const patterns = this.getAllPatterns({
      includePrivate: options.includePrivate,
    });

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      patterns,
    };
  }

  importPatterns(
    data: PatternExport,
    options: { overwrite?: boolean } = {}
  ): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;

    for (const pattern of data.patterns) {
      const existing = this.getPattern(pattern.id);

      if (existing && !options.overwrite) {
        skipped++;
        continue;
      }

      if (existing) {
        this.updatePattern(pattern.id, pattern);
      } else {
        this.addPattern({
          ...pattern,
          source: 'imported',
        });
      }
      imported++;
    }

    return { imported, skipped };
  }

  exportBackup(): BackupExport {
    const incidents = this.getRecentIncidents({ limit: 100000 });
    const patterns = this.getAllPatterns({ includePrivate: true });
    const groups = this.getGroups({ limit: 10000 });

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      incidents,
      patterns,
      groups,
    };
  }

  importBackup(data: BackupExport): void {
    this.initializeSync();

    // Clear existing data
    this.db!.run('DELETE FROM group_members');
    this.db!.run('DELETE FROM resolutions');
    this.db!.run('DELETE FROM groups');
    this.db!.run('DELETE FROM incidents');
    this.db!.run('DELETE FROM patterns');

    // Import patterns first
    for (const pattern of data.patterns) {
      this.addPattern(pattern);
    }

    // Import incidents
    for (const incident of data.incidents) {
      const now = incident.timestamp;
      this.db!.run(
        `INSERT INTO incidents (
          id, timestamp, status, error_message, error_stack, error_code, error_type,
          symbols, flow_position, environment, service, version, user_id, request_id,
          group_id, notes, related_incidents, resolved_at, resolved_by, resolution,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          incident.id,
          incident.timestamp,
          incident.status,
          incident.error.message,
          incident.error.stack || null,
          incident.error.code || null,
          incident.error.type || null,
          JSON.stringify(incident.symbols),
          incident.flowPosition ? JSON.stringify(incident.flowPosition) : null,
          incident.environment,
          incident.service || null,
          incident.version || null,
          incident.userId || null,
          incident.requestId || null,
          incident.groupId || null,
          JSON.stringify(incident.notes),
          JSON.stringify(incident.relatedIncidents),
          incident.resolvedAt || null,
          incident.resolvedBy || null,
          incident.resolution ? JSON.stringify(incident.resolution) : null,
          now,
          now,
        ]
      );
    }

    // Update incident counter
    const result = this.db!.exec(
      'SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) as max FROM incidents'
    );
    if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0]) {
      this.incidentCounter = result[0].values[0][0] as number;
    }

    // Import groups
    const now = new Date().toISOString();
    for (const group of data.groups) {
      this.db!.run(
        `INSERT INTO groups (
          id, name, common_symbols, common_error_patterns,
          suggested_pattern_id, first_seen, last_seen, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          group.id,
          group.name || null,
          JSON.stringify(group.commonSymbols),
          JSON.stringify(group.commonErrorPatterns),
          group.suggestedPattern?.id || null,
          group.firstSeen,
          group.lastSeen,
          now,
          now,
        ]
      );

      for (const incidentId of group.incidents) {
        this.db!.run(
          'INSERT OR IGNORE INTO group_members (group_id, incident_id, added_at) VALUES (?, ?, ?)',
          [group.id, incidentId, now]
        );
      }
    }

    this.save();
  }

  // ─── Helper Methods ──────────────────────────────────────────────

  private rowToIncident(
    columns: string[],
    row: SqlValue[]
  ): SymbolicIncidentRecord {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      timestamp: obj.timestamp as string,
      status: obj.status as IncidentStatus,
      error: {
        message: obj.error_message as string,
        stack: (obj.error_stack as string) || undefined,
        code: (obj.error_code as string) || undefined,
        type: (obj.error_type as string) || undefined,
      },
      symbols: JSON.parse((obj.symbols as string) || '{}'),
      flowPosition: obj.flow_position
        ? JSON.parse(obj.flow_position as string)
        : undefined,
      environment: obj.environment as string,
      service: (obj.service as string) || undefined,
      version: (obj.version as string) || undefined,
      userId: (obj.user_id as string) || undefined,
      requestId: (obj.request_id as string) || undefined,
      groupId: (obj.group_id as string) || undefined,
      notes: JSON.parse((obj.notes as string) || '[]'),
      relatedIncidents: JSON.parse((obj.related_incidents as string) || '[]'),
      resolvedAt: (obj.resolved_at as string) || undefined,
      resolvedBy: (obj.resolved_by as string) || undefined,
      resolution: obj.resolution
        ? JSON.parse(obj.resolution as string)
        : undefined,
    };
  }

  private rowToPattern(
    columns: string[],
    row: SqlValue[]
  ): FailurePattern {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      name: obj.name as string,
      description: (obj.description as string) || '',
      pattern: JSON.parse(obj.pattern as string),
      resolution: JSON.parse(obj.resolution as string),
      confidence: JSON.parse(obj.confidence as string),
      source: obj.source as FailurePattern['source'],
      private: obj.private === 1,
      tags: JSON.parse((obj.tags as string) || '[]'),
      createdAt: obj.created_at as string,
      updatedAt: obj.updated_at as string,
    };
  }

  private rowToGroup(
    columns: string[],
    row: SqlValue[]
  ): IncidentGroup {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    // Get group members
    const membersResult = this.db!.exec(
      'SELECT incident_id FROM group_members WHERE group_id = ?',
      [obj.id as string]
    );

    const incidents: string[] = [];
    if (membersResult.length > 0) {
      for (const r of membersResult[0].values) {
        incidents.push(r[0] as string);
      }
    }

    // Get environments from incidents
    const envResult = this.db!.exec(
      `SELECT DISTINCT environment FROM incidents
      WHERE id IN (SELECT incident_id FROM group_members WHERE group_id = ?)`,
      [obj.id as string]
    );

    const environments: string[] = [];
    if (envResult.length > 0) {
      for (const r of envResult[0].values) {
        environments.push(r[0] as string);
      }
    }

    return {
      id: obj.id as string,
      name: (obj.name as string) || undefined,
      incidents,
      commonSymbols: JSON.parse((obj.common_symbols as string) || '{}'),
      commonErrorPatterns: JSON.parse(
        (obj.common_error_patterns as string) || '[]'
      ),
      count: incidents.length,
      firstSeen: obj.first_seen as string,
      lastSeen: obj.last_seen as string,
      environments,
      suggestedPattern: obj.suggested_pattern_id
        ? this.getPattern(obj.suggested_pattern_id as string) || undefined
        : undefined,
    };
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
