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
  PracticeEvent,
  PracticeEventInput,
  PracticeEventQuery,
  LogEntry,
  LogEntryInput,
  LogQueryOptions,
  LogSymbolType,
  ServiceInfo,
  ServiceRegistration,
  AppState,
  MetricEntry,
  MetricInput,
  MetricQueryOptions,
  MetricAggregation,
  TraceSpan,
  TraceSpanInput,
  TraceView,
} from './types.js';
import type {
  EventSchemaDeclaration,
  GenericEvent,
  GenericEventInput,
  GenericEventQuery,
  ScopeSummary,
  StoredSchema,
} from './schema/types.js';

const SCHEMA_VERSION = 5;

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

      -- Practice events (habits system)
      CREATE TABLE IF NOT EXISTS practice_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        habit_id TEXT NOT NULL,
        habit_category TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('followed', 'skipped', 'partial')),
        engineer TEXT NOT NULL,
        session_id TEXT NOT NULL,
        lore_entry_id TEXT,
        task_description TEXT,
        symbols_touched TEXT DEFAULT '[]',
        files_modified TEXT DEFAULT '[]',
        related_incident_id TEXT,
        notes TEXT
      );

      -- Structured logs table
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
        symbol TEXT NOT NULL,
        symbol_type TEXT NOT NULL DEFAULT 'raw',
        message TEXT NOT NULL,
        data_json TEXT,
        service TEXT NOT NULL,
        session_id TEXT,
        correlation_id TEXT,
        duration_ms REAL,
        environment TEXT
      );

      -- Service registry
      CREATE TABLE IF NOT EXISTS services (
        name TEXT PRIMARY KEY,
        version TEXT,
        pid INTEGER,
        started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        environment TEXT,
        metadata_json TEXT
      );

      -- Live app state snapshots (latest-wins per service+session)
      CREATE TABLE IF NOT EXISTS app_state (
        service TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        state_json TEXT NOT NULL,
        active_flows_json TEXT,
        active_gates_json TEXT,
        PRIMARY KEY (service, session_id)
      );

      -- Metrics table
      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('counter','gauge','histogram')),
        value REAL NOT NULL,
        tags_json TEXT DEFAULT '{}',
        service TEXT NOT NULL,
        environment TEXT
      );

      -- Traces table
      CREATE TABLE IF NOT EXISTS traces (
        trace_id TEXT NOT NULL,
        span_id TEXT PRIMARY KEY,
        parent_span_id TEXT,
        service TEXT NOT NULL,
        symbol TEXT NOT NULL,
        operation TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_ms REAL,
        status TEXT NOT NULL DEFAULT 'ok',
        tags_json TEXT DEFAULT '{}',
        log_ids_json TEXT DEFAULT '[]'
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_incidents_timestamp ON incidents(timestamp);
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE INDEX IF NOT EXISTS idx_incidents_environment ON incidents(environment);
      CREATE INDEX IF NOT EXISTS idx_patterns_source ON patterns(source);
      CREATE INDEX IF NOT EXISTS idx_practice_events_timestamp ON practice_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_practice_events_habit_id ON practice_events(habit_id);
      CREATE INDEX IF NOT EXISTS idx_practice_events_engineer ON practice_events(engineer);
      CREATE INDEX IF NOT EXISTS idx_practice_events_session_id ON practice_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_symbol ON logs(symbol);
      CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
      CREATE INDEX IF NOT EXISTS idx_logs_session_id ON logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_logs_correlation_id ON logs(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
      CREATE INDEX IF NOT EXISTS idx_metrics_service ON metrics(service);
      CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id);
      CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(service);
      CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces(start_time);
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

      // Run migrations
      this.migrateSchema();

      this.initialized = true;
      this.save();
    }
  }

  /**
   * Run schema migrations from older versions
   */
  private migrateSchema(): void {
    if (!this.db) return;

    let currentVersion = 1;
    try {
      const result = this.db.exec(
        "SELECT value FROM metadata WHERE key = 'schema_version'"
      );
      if (result.length > 0 && result[0].values.length > 0) {
        currentVersion = parseInt(result[0].values[0][0] as string, 10) || 1;
      }
    } catch {
      // No metadata table = version 1
    }

    if (currentVersion < 2) {
      // v1 → v2: Add practice_events table
      try {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS practice_events (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            habit_id TEXT NOT NULL,
            habit_category TEXT NOT NULL,
            result TEXT NOT NULL CHECK (result IN ('followed', 'skipped', 'partial')),
            engineer TEXT NOT NULL,
            session_id TEXT NOT NULL,
            lore_entry_id TEXT,
            task_description TEXT,
            symbols_touched TEXT DEFAULT '[]',
            files_modified TEXT DEFAULT '[]',
            related_incident_id TEXT,
            notes TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_practice_events_timestamp ON practice_events(timestamp);
          CREATE INDEX IF NOT EXISTS idx_practice_events_habit_id ON practice_events(habit_id);
          CREATE INDEX IF NOT EXISTS idx_practice_events_engineer ON practice_events(engineer);
          CREATE INDEX IF NOT EXISTS idx_practice_events_session_id ON practice_events(session_id);
        `);
      } catch {
        // Table might already exist
      }

      this.db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '2')"
      );
      currentVersion = 2;
    }

    if (currentVersion < 3) {
      // v2 → v3: Add logs, services, and app_state tables
      try {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
            symbol TEXT NOT NULL,
            symbol_type TEXT NOT NULL DEFAULT 'raw',
            message TEXT NOT NULL,
            data_json TEXT,
            service TEXT NOT NULL,
            session_id TEXT,
            correlation_id TEXT,
            duration_ms REAL,
            environment TEXT
          );

          CREATE TABLE IF NOT EXISTS services (
            name TEXT PRIMARY KEY,
            version TEXT,
            pid INTEGER,
            started_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            environment TEXT,
            metadata_json TEXT
          );

          CREATE TABLE IF NOT EXISTS app_state (
            service TEXT NOT NULL,
            session_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            state_json TEXT NOT NULL,
            active_flows_json TEXT,
            active_gates_json TEXT,
            PRIMARY KEY (service, session_id)
          );

          CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
          CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
          CREATE INDEX IF NOT EXISTS idx_logs_symbol ON logs(symbol);
          CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service);
          CREATE INDEX IF NOT EXISTS idx_logs_session_id ON logs(session_id);
          CREATE INDEX IF NOT EXISTS idx_logs_correlation_id ON logs(correlation_id);
        `);
      } catch {
        // Tables might already exist
      }

      this.db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '3')"
      );
      currentVersion = 3;
    }

    if (currentVersion < 4) {
      // v3 → v4: Add metrics and traces tables
      try {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS metrics (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('counter','gauge','histogram')),
            value REAL NOT NULL,
            tags_json TEXT DEFAULT '{}',
            service TEXT NOT NULL,
            environment TEXT
          );

          CREATE TABLE IF NOT EXISTS traces (
            trace_id TEXT NOT NULL,
            span_id TEXT PRIMARY KEY,
            parent_span_id TEXT,
            service TEXT NOT NULL,
            symbol TEXT NOT NULL,
            operation TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_ms REAL,
            status TEXT NOT NULL DEFAULT 'ok',
            tags_json TEXT DEFAULT '{}',
            log_ids_json TEXT DEFAULT '[]'
          );

          CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
          CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
          CREATE INDEX IF NOT EXISTS idx_metrics_service ON metrics(service);
          CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id);
          CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(service);
          CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces(start_time);
        `);
      } catch {
        // Tables might already exist
      }

      this.db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '4')"
      );
      currentVersion = 4;
    }

    if (currentVersion < 5) {
      // v4 → v5: Add schemas and events tables (schema-driven observability)
      try {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS schemas (
            id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            scope_json TEXT NOT NULL,
            event_types_json TEXT NOT NULL,
            causality_json TEXT,
            visualization_json TEXT,
            tags_json TEXT DEFAULT '[]',
            registered_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            schema_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            category TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            scope_value TEXT,
            scope_ordinal INTEGER,
            session_id TEXT,
            service TEXT NOT NULL,
            data_json TEXT,
            severity TEXT DEFAULT 'info',
            parent_event_id TEXT,
            depth INTEGER DEFAULT 0
          );

          CREATE INDEX IF NOT EXISTS idx_events_schema ON events(schema_id);
          CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
          CREATE INDEX IF NOT EXISTS idx_events_scope ON events(schema_id, scope_value);
          CREATE INDEX IF NOT EXISTS idx_events_scope_ord ON events(schema_id, scope_ordinal);
          CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
          CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
          CREATE INDEX IF NOT EXISTS idx_events_service ON events(service);
        `);
      } catch {
        // Tables might already exist
      }

      this.db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '5')"
      );
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

  resolveIncident(id: string, options?: { notes?: string; patternId?: string }): void {
    this.updateIncident(id, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
    });
    if (options?.notes) {
      this.addIncidentNote(id, {
        author: 'system',
        content: options.notes,
        timestamp: new Date().toISOString(),
      });
    }
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

  // ─── Practice Events ─────────────────────────────────────────────

  recordPracticeEvent(input: PracticeEventInput): string {
    this.initializeSync();
    const id = `PE-${uuidv4().substring(0, 8)}`;
    const now = new Date().toISOString();

    this.db!.run(
      `INSERT INTO practice_events (
        id, timestamp, habit_id, habit_category, result,
        engineer, session_id, lore_entry_id, task_description,
        symbols_touched, files_modified, related_incident_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        now,
        input.habitId,
        input.habitCategory,
        input.result,
        input.engineer,
        input.sessionId,
        input.loreEntryId || null,
        input.taskDescription || null,
        JSON.stringify(input.symbolsTouched || []),
        JSON.stringify(input.filesModified || []),
        input.relatedIncidentId || null,
        input.notes || null,
      ]
    );

    this.save();
    return id;
  }

  getPracticeEvents(options: PracticeEventQuery = {}): PracticeEvent[] {
    this.initializeSync();
    const { limit = 100, offset = 0 } = options;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.habitId) {
      conditions.push('habit_id = ?');
      params.push(options.habitId);
    }

    if (options.habitCategory) {
      conditions.push('habit_category = ?');
      params.push(options.habitCategory);
    }

    if (options.result) {
      conditions.push('result = ?');
      params.push(options.result);
    }

    if (options.engineer) {
      conditions.push('engineer = ?');
      params.push(options.engineer);
    }

    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
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
      `SELECT * FROM practice_events ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToPracticeEvent(result[0].columns, row)
    );
  }

  getPracticeEventCount(options: PracticeEventQuery = {}): number {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.habitId) {
      conditions.push('habit_id = ?');
      params.push(options.habitId);
    }

    if (options.habitCategory) {
      conditions.push('habit_category = ?');
      params.push(options.habitCategory);
    }

    if (options.result) {
      conditions.push('result = ?');
      params.push(options.result);
    }

    if (options.engineer) {
      conditions.push('engineer = ?');
      params.push(options.engineer);
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
      `SELECT COUNT(*) as count FROM practice_events ${whereClause}`,
      params
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  getComplianceRate(options: PracticeEventQuery = {}): {
    total: number;
    followed: number;
    skipped: number;
    partial: number;
    rate: number;
  } {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.habitId) {
      conditions.push('habit_id = ?');
      params.push(options.habitId);
    }

    if (options.habitCategory) {
      conditions.push('habit_category = ?');
      params.push(options.habitCategory);
    }

    if (options.engineer) {
      conditions.push('engineer = ?');
      params.push(options.engineer);
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
      `SELECT result, COUNT(*) as count
       FROM practice_events ${whereClause}
       GROUP BY result`,
      params
    );

    let followed = 0;
    let skipped = 0;
    let partial = 0;

    if (result.length > 0) {
      for (const row of result[0].values) {
        const r = row[0] as string;
        const count = row[1] as number;
        if (r === 'followed') followed = count;
        else if (r === 'skipped') skipped = count;
        else if (r === 'partial') partial = count;
      }
    }

    const total = followed + skipped + partial;
    const rate = total > 0 ? ((followed + partial * 0.5) / total) * 100 : 100;

    return { total, followed, skipped, partial, rate: Math.round(rate) };
  }

  private rowToPracticeEvent(
    columns: string[],
    row: SqlValue[]
  ): PracticeEvent {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      timestamp: obj.timestamp as string,
      habitId: obj.habit_id as string,
      habitCategory: obj.habit_category as PracticeEvent['habitCategory'],
      result: obj.result as PracticeEvent['result'],
      engineer: obj.engineer as string,
      sessionId: obj.session_id as string,
      loreEntryId: (obj.lore_entry_id as string) || undefined,
      taskDescription: (obj.task_description as string) || undefined,
      symbolsTouched: JSON.parse((obj.symbols_touched as string) || '[]'),
      filesModified: JSON.parse((obj.files_modified as string) || '[]'),
      relatedIncidentId: (obj.related_incident_id as string) || undefined,
      notes: (obj.notes as string) || undefined,
    };
  }

  // ─── Structured Logs ─────────────────────────────────────────────

  private inferSymbolType(symbol: string): LogSymbolType {
    if (symbol.startsWith('#')) return 'component';
    if (symbol.startsWith('^')) return 'gate';
    if (symbol.startsWith('!')) return 'signal';
    if (symbol.startsWith('$')) return 'flow';
    if (symbol.startsWith('~')) return 'aspect';
    return 'raw';
  }

  insertLog(input: LogEntryInput): string {
    this.initializeSync();
    const id = input.id || uuidv4();
    const timestamp = input.timestamp || new Date().toISOString();
    const symbolType = input.symbolType || this.inferSymbolType(input.symbol);

    this.db!.run(
      `INSERT INTO logs (
        id, timestamp, level, symbol, symbol_type, message, data_json,
        service, session_id, correlation_id, duration_ms, environment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        timestamp,
        input.level,
        input.symbol,
        symbolType,
        input.message,
        input.data ? JSON.stringify(input.data) : null,
        input.service,
        input.sessionId || null,
        input.correlationId || null,
        input.durationMs ?? null,
        input.environment || null,
      ]
    );

    this.save();
    return id;
  }

  insertLogBatch(entries: LogEntryInput[]): { accepted: number; errors: string[] } {
    this.initializeSync();
    let accepted = 0;
    const errors: string[] = [];

    for (const input of entries) {
      try {
        const id = input.id || uuidv4();
        const timestamp = input.timestamp || new Date().toISOString();
        const symbolType = input.symbolType || this.inferSymbolType(input.symbol);

        this.db!.run(
          `INSERT INTO logs (
            id, timestamp, level, symbol, symbol_type, message, data_json,
            service, session_id, correlation_id, duration_ms, environment
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            timestamp,
            input.level,
            input.symbol,
            symbolType,
            input.message,
            input.data ? JSON.stringify(input.data) : null,
            input.service,
            input.sessionId || null,
            input.correlationId || null,
            input.durationMs ?? null,
            input.environment || null,
          ]
        );
        accepted++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    this.save();
    return { accepted, errors };
  }

  queryLogs(options: LogQueryOptions = {}): LogEntry[] {
    this.initializeSync();
    const { limit = 100, offset = 0 } = options;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.level) {
      conditions.push('level = ?');
      params.push(options.level);
    }

    if (options.symbol) {
      conditions.push('symbol LIKE ?');
      params.push(`%${options.symbol}%`);
    }

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }

    if (options.correlationId) {
      conditions.push('correlation_id = ?');
      params.push(options.correlationId);
    }

    if (options.search) {
      conditions.push('message LIKE ?');
      params.push(`%${options.search}%`);
    }

    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToLogEntry(result[0].columns, row)
    );
  }

  getLogCount(options: LogQueryOptions = {}): number {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.level) {
      conditions.push('level = ?');
      params.push(options.level);
    }

    if (options.symbol) {
      conditions.push('symbol LIKE ?');
      params.push(`%${options.symbol}%`);
    }

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT COUNT(*) as count FROM logs ${whereClause}`,
      params
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  pruneLogs(maxCount: number): number {
    this.initializeSync();
    if (maxCount <= 0) return 0;

    const currentCount = this.getLogCount();
    if (currentCount <= maxCount) return 0;

    const deleteCount = currentCount - maxCount;
    this.db!.run(
      `DELETE FROM logs WHERE id IN (
        SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?
      )`,
      [deleteCount]
    );

    this.save();
    return deleteCount;
  }

  private rowToLogEntry(columns: string[], row: SqlValue[]): LogEntry {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      timestamp: obj.timestamp as string,
      level: obj.level as LogEntry['level'],
      symbol: obj.symbol as string,
      symbolType: (obj.symbol_type as LogEntry['symbolType']) || 'raw',
      message: obj.message as string,
      data: obj.data_json ? JSON.parse(obj.data_json as string) : undefined,
      service: obj.service as string,
      sessionId: (obj.session_id as string) || undefined,
      correlationId: (obj.correlation_id as string) || undefined,
      durationMs: (obj.duration_ms as number) || undefined,
      environment: (obj.environment as string) || undefined,
    };
  }

  // ─── Service Registry ──────────────────────────────────────────

  registerService(reg: ServiceRegistration): void {
    this.initializeSync();
    const now = new Date().toISOString();

    this.db!.run(
      `INSERT INTO services (name, version, pid, started_at, last_seen_at, environment, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         version = excluded.version,
         pid = excluded.pid,
         last_seen_at = excluded.last_seen_at,
         environment = excluded.environment,
         metadata_json = excluded.metadata_json`,
      [
        reg.name,
        reg.version || null,
        reg.pid ?? null,
        now,
        now,
        reg.environment || null,
        reg.metadata ? JSON.stringify(reg.metadata) : null,
      ]
    );

    this.save();
  }

  updateServiceLastSeen(name: string): void {
    this.initializeSync();
    const now = new Date().toISOString();
    this.db!.run(
      'UPDATE services SET last_seen_at = ? WHERE name = ?',
      [now, name]
    );
    this.save();
  }

  getServices(): ServiceInfo[] {
    this.initializeSync();
    const result = this.db!.exec(
      'SELECT * FROM services ORDER BY last_seen_at DESC'
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      result[0].columns.forEach((col, i) => {
        obj[col] = row[i];
      });

      return {
        name: obj.name as string,
        version: (obj.version as string) || undefined,
        pid: (obj.pid as number) || undefined,
        startedAt: obj.started_at as string,
        lastSeenAt: obj.last_seen_at as string,
        environment: (obj.environment as string) || undefined,
        metadata: obj.metadata_json ? JSON.parse(obj.metadata_json as string) : undefined,
      };
    });
  }

  // ─── App State ──────────────────────────────────────────────────

  upsertAppState(state: AppState): void {
    this.initializeSync();

    this.db!.run(
      `INSERT INTO app_state (service, session_id, timestamp, state_json, active_flows_json, active_gates_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(service, session_id) DO UPDATE SET
         timestamp = excluded.timestamp,
         state_json = excluded.state_json,
         active_flows_json = excluded.active_flows_json,
         active_gates_json = excluded.active_gates_json`,
      [
        state.service,
        state.sessionId,
        state.timestamp || new Date().toISOString(),
        JSON.stringify(state.state),
        state.activeFlows ? JSON.stringify(state.activeFlows) : null,
        state.activeGates ? JSON.stringify(state.activeGates) : null,
      ]
    );

    this.save();
  }

  getAppState(service: string, sessionId?: string): AppState[] {
    this.initializeSync();

    let query = 'SELECT * FROM app_state WHERE service = ?';
    const params: string[] = [service];

    if (sessionId) {
      query += ' AND session_id = ?';
      params.push(sessionId);
    }

    query += ' ORDER BY timestamp DESC';

    const result = this.db!.exec(query, params);

    if (result.length === 0) return [];
    return result[0].values.map((row) => this.rowToAppState(result[0].columns, row));
  }

  getAllAppStates(): AppState[] {
    this.initializeSync();
    const result = this.db!.exec(
      'SELECT * FROM app_state ORDER BY timestamp DESC'
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) => this.rowToAppState(result[0].columns, row));
  }

  private rowToAppState(columns: string[], row: SqlValue[]): AppState {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      service: obj.service as string,
      sessionId: obj.session_id as string,
      timestamp: obj.timestamp as string,
      state: JSON.parse(obj.state_json as string),
      activeFlows: obj.active_flows_json ? JSON.parse(obj.active_flows_json as string) : undefined,
      activeGates: obj.active_gates_json ? JSON.parse(obj.active_gates_json as string) : undefined,
    };
  }

  // ─── Metrics ───────────────────────────────────────────────────

  insertMetric(input: MetricInput): string {
    this.initializeSync();
    const id = uuidv4();
    const timestamp = input.timestamp || new Date().toISOString();

    this.db!.run(
      `INSERT INTO metrics (
        id, timestamp, name, type, value, tags_json, service, environment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        timestamp,
        input.name,
        input.type,
        input.value,
        JSON.stringify(input.tags || {}),
        input.service,
        input.environment || null,
      ]
    );

    this.save();
    return id;
  }

  insertMetricBatch(entries: MetricInput[]): { accepted: number; errors: string[] } {
    this.initializeSync();
    let accepted = 0;
    const errors: string[] = [];

    for (const input of entries) {
      try {
        const id = uuidv4();
        const timestamp = input.timestamp || new Date().toISOString();

        this.db!.run(
          `INSERT INTO metrics (
            id, timestamp, name, type, value, tags_json, service, environment
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            timestamp,
            input.name,
            input.type,
            input.value,
            JSON.stringify(input.tags || {}),
            input.service,
            input.environment || null,
          ]
        );
        accepted++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    this.save();
    return { accepted, errors };
  }

  queryMetrics(options: MetricQueryOptions = {}): MetricEntry[] {
    this.initializeSync();
    const { limit = 100, offset = 0 } = options;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.name) {
      conditions.push('name = ?');
      params.push(options.name);
    }

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.tag) {
      // Parse "key=value" format
      const eqIdx = options.tag.indexOf('=');
      if (eqIdx > 0) {
        const tagKey = options.tag.substring(0, eqIdx);
        const tagValue = options.tag.substring(eqIdx + 1);
        conditions.push('tags_json LIKE ?');
        params.push(`%"${tagKey}":"${tagValue}"%`);
      }
    }

    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT * FROM metrics ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToMetricEntry(result[0].columns, row)
    );
  }

  getMetricCount(options: MetricQueryOptions = {}): number {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.name) {
      conditions.push('name = ?');
      params.push(options.name);
    }

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.tag) {
      const eqIdx = options.tag.indexOf('=');
      if (eqIdx > 0) {
        const tagKey = options.tag.substring(0, eqIdx);
        const tagValue = options.tag.substring(eqIdx + 1);
        conditions.push('tags_json LIKE ?');
        params.push(`%"${tagKey}":"${tagValue}"%`);
      }
    }

    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT COUNT(*) as count FROM metrics ${whereClause}`,
      params
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  aggregateMetric(
    name: string,
    options?: { service?: string; since?: string; until?: string }
  ): MetricAggregation {
    this.initializeSync();
    const conditions: string[] = ['name = ?'];
    const params: (string | number)[] = [name];

    if (options?.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options?.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options?.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = this.db!.exec(
      `SELECT COUNT(*) as count, SUM(value) as sum, MIN(value) as min, MAX(value) as max, AVG(value) as avg
       FROM metrics ${whereClause}`,
      params
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return { name, count: 0, sum: 0, min: 0, max: 0, avg: 0 };
    }

    const row = result[0].values[0];
    return {
      name,
      count: (row[0] as number) || 0,
      sum: (row[1] as number) || 0,
      min: (row[2] as number) || 0,
      max: (row[3] as number) || 0,
      avg: (row[4] as number) || 0,
    };
  }

  pruneMetrics(maxCount: number): number {
    this.initializeSync();
    if (maxCount <= 0) return 0;

    const currentCount = this.getMetricCount();
    if (currentCount <= maxCount) return 0;

    const deleteCount = currentCount - maxCount;
    this.db!.run(
      `DELETE FROM metrics WHERE id IN (
        SELECT id FROM metrics ORDER BY timestamp ASC LIMIT ?
      )`,
      [deleteCount]
    );

    this.save();
    return deleteCount;
  }

  private rowToMetricEntry(columns: string[], row: SqlValue[]): MetricEntry {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      timestamp: obj.timestamp as string,
      name: obj.name as string,
      type: obj.type as MetricEntry['type'],
      value: obj.value as number,
      tags: obj.tags_json ? JSON.parse(obj.tags_json as string) : {},
      service: obj.service as string,
      environment: (obj.environment as string) || undefined,
    };
  }

  // ─── Traces ───────────────────────────────────────────────────

  insertSpan(input: TraceSpanInput): string {
    this.initializeSync();
    const spanId = input.spanId || uuidv4();
    const startTime = input.startTime || new Date().toISOString();

    this.db!.run(
      `INSERT INTO traces (
        trace_id, span_id, parent_span_id, service, symbol, operation,
        start_time, end_time, duration_ms, status, tags_json, log_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.traceId,
        spanId,
        input.parentSpanId || null,
        input.service,
        input.symbol,
        input.operation,
        startTime,
        input.endTime || null,
        input.durationMs ?? null,
        input.status || 'ok',
        JSON.stringify(input.tags || {}),
        JSON.stringify(input.logIds || []),
      ]
    );

    this.save();
    return spanId;
  }

  getTrace(traceId: string): TraceView | null {
    this.initializeSync();
    const result = this.db!.exec(
      'SELECT * FROM traces WHERE trace_id = ? ORDER BY start_time ASC',
      [traceId]
    );

    if (result.length === 0 || result[0].values.length === 0) return null;

    const spans = result[0].values.map((row) =>
      this.rowToTraceSpan(result[0].columns, row)
    );

    const services = [...new Set(spans.map((s) => s.service))];

    // Compute overall timing from spans
    const startTimes = spans.map((s) => s.startTime);
    const endTimes = spans
      .filter((s) => s.endTime)
      .map((s) => s.endTime as string);

    const startTime = startTimes.sort()[0];
    const endTime = endTimes.length > 0 ? endTimes.sort().reverse()[0] : startTime;

    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const totalDurationMs = endMs - startMs;

    return {
      traceId,
      spans,
      services,
      totalDurationMs: totalDurationMs > 0 ? totalDurationMs : 0,
      startTime,
      endTime,
    };
  }

  queryTraces(
    options: { service?: string; symbol?: string; since?: string; limit?: number } = {}
  ): TraceView[] {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.symbol) {
      conditions.push('symbol = ?');
      params.push(options.symbol);
    }

    if (options.since) {
      conditions.push('start_time >= ?');
      params.push(options.since);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const traceLimit = Math.min(options.limit || 20, 20);

    const result = this.db!.exec(
      `SELECT DISTINCT trace_id FROM traces ${whereClause} ORDER BY start_time DESC LIMIT ?`,
      [...params, traceLimit]
    );

    if (result.length === 0) return [];

    const traces: TraceView[] = [];
    for (const row of result[0].values) {
      const traceId = row[0] as string;
      const trace = this.getTrace(traceId);
      if (trace) {
        traces.push(trace);
      }
    }

    return traces;
  }

  private rowToTraceSpan(columns: string[], row: SqlValue[]): TraceSpan {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      traceId: obj.trace_id as string,
      spanId: obj.span_id as string,
      parentSpanId: (obj.parent_span_id as string) || undefined,
      service: obj.service as string,
      symbol: obj.symbol as string,
      operation: obj.operation as string,
      startTime: obj.start_time as string,
      endTime: (obj.end_time as string) || undefined,
      durationMs: (obj.duration_ms as number) || undefined,
      status: (obj.status as TraceSpan['status']) || 'ok',
      tags: obj.tags_json ? JSON.parse(obj.tags_json as string) : {},
      logs: obj.log_ids_json ? JSON.parse(obj.log_ids_json as string) : [],
    };
  }

  // ─── Schema Registry ─────────────────────────────────────────────

  registerSchema(schema: EventSchemaDeclaration): StoredSchema {
    this.initializeSync();
    const now = new Date().toISOString();

    this.db!.run(
      `INSERT INTO schemas (
        id, version, name, description, scope_json, event_types_json,
        causality_json, visualization_json, tags_json, registered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         name = excluded.name,
         description = excluded.description,
         scope_json = excluded.scope_json,
         event_types_json = excluded.event_types_json,
         causality_json = excluded.causality_json,
         visualization_json = excluded.visualization_json,
         tags_json = excluded.tags_json,
         updated_at = excluded.updated_at`,
      [
        schema.id,
        schema.version,
        schema.name,
        schema.description || null,
        JSON.stringify(schema.scope),
        JSON.stringify(schema.eventTypes),
        schema.causality ? JSON.stringify(schema.causality) : null,
        schema.visualization ? JSON.stringify(schema.visualization) : null,
        JSON.stringify(schema.tags || []),
        now,
        now,
      ]
    );

    this.save();
    return {
      id: schema.id,
      version: schema.version,
      name: schema.name,
      description: schema.description,
      scope: schema.scope,
      eventTypes: schema.eventTypes,
      causality: schema.causality,
      visualization: schema.visualization,
      tags: schema.tags || [],
      registeredAt: now,
      updatedAt: now,
    };
  }

  getSchema(id: string): StoredSchema | null {
    this.initializeSync();
    const result = this.db!.exec('SELECT * FROM schemas WHERE id = ?', [id]);

    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.rowToSchema(result[0].columns, result[0].values[0]);
  }

  listSchemas(): StoredSchema[] {
    this.initializeSync();
    const result = this.db!.exec('SELECT * FROM schemas ORDER BY name ASC');

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToSchema(result[0].columns, row)
    );
  }

  private rowToSchema(columns: string[], row: SqlValue[]): StoredSchema {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      version: obj.version as string,
      name: obj.name as string,
      description: (obj.description as string) || undefined,
      scope: JSON.parse(obj.scope_json as string),
      eventTypes: JSON.parse(obj.event_types_json as string),
      causality: obj.causality_json ? JSON.parse(obj.causality_json as string) : undefined,
      visualization: obj.visualization_json ? JSON.parse(obj.visualization_json as string) : undefined,
      tags: JSON.parse((obj.tags_json as string) || '[]'),
      registeredAt: obj.registered_at as string,
      updatedAt: obj.updated_at as string,
    };
  }

  // ─── Generic Events ────────────────────────────────────────────

  insertEventBatch(
    schemaId: string,
    service: string,
    inputs: GenericEventInput[]
  ): { accepted: number; errors: string[] } {
    this.initializeSync();

    // Resolve categories from schema
    const schema = this.getSchema(schemaId);
    const typeMap = new Map<string, { category: string; severity: string }>();
    if (schema) {
      for (const et of schema.eventTypes) {
        typeMap.set(et.type, {
          category: et.category,
          severity: et.severity || 'info',
        });
      }
    }

    let accepted = 0;
    const errors: string[] = [];

    for (const input of inputs) {
      try {
        const id = input.id || uuidv4();
        const timestamp = input.timestamp || new Date().toISOString();
        const resolved = typeMap.get(input.type);
        const category = resolved?.category || 'unknown';
        const severity = input.severity || resolved?.severity || 'info';
        const scopeValue = input.scopeValue != null ? String(input.scopeValue) : null;
        const scopeOrdinal = typeof input.scopeValue === 'number' ? input.scopeValue : null;

        this.db!.run(
          `INSERT INTO events (
            id, schema_id, event_type, category, timestamp, scope_value,
            scope_ordinal, session_id, service, data_json, severity,
            parent_event_id, depth
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            schemaId,
            input.type,
            category,
            timestamp,
            scopeValue,
            scopeOrdinal,
            input.sessionId || null,
            service,
            input.data ? JSON.stringify(input.data) : null,
            severity,
            input.parentEventId || null,
            input.depth ?? 0,
          ]
        );
        accepted++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    this.save();
    return { accepted, errors };
  }

  queryEvents(options: GenericEventQuery = {}): GenericEvent[] {
    this.initializeSync();
    const { limit = 100, offset = 0 } = options;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.schemaId) {
      conditions.push('schema_id = ?');
      params.push(options.schemaId);
    }

    if (options.eventType) {
      conditions.push('event_type = ?');
      params.push(options.eventType);
    }

    if (options.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }

    if (options.scopeValue) {
      conditions.push('scope_value = ?');
      params.push(options.scopeValue);
    }

    if (options.scopeFrom) {
      conditions.push('scope_value >= ?');
      params.push(options.scopeFrom);
    }

    if (options.scopeTo) {
      conditions.push('scope_value <= ?');
      params.push(options.scopeTo);
    }

    if (options.severity) {
      conditions.push('severity = ?');
      params.push(options.severity);
    }

    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    if (options.search) {
      conditions.push('data_json LIKE ?');
      params.push(`%${options.search}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT * FROM events ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToGenericEvent(result[0].columns, row)
    );
  }

  queryEventsByScope(
    schemaId: string,
    scopeValue: string
  ): GenericEvent[] {
    this.initializeSync();

    const result = this.db!.exec(
      `SELECT * FROM events
       WHERE schema_id = ? AND scope_value = ?
       ORDER BY timestamp ASC`,
      [schemaId, scopeValue]
    );

    if (result.length === 0) return [];
    return result[0].values.map((row) =>
      this.rowToGenericEvent(result[0].columns, row)
    );
  }

  getEventScopes(
    schemaId: string,
    options: { limit?: number; offset?: number; sessionId?: string } = {}
  ): ScopeSummary[] {
    this.initializeSync();
    const { limit = 100, offset = 0 } = options;
    const conditions: string[] = ['schema_id = ?'];
    const params: (string | number)[] = [schemaId];

    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const result = this.db!.exec(
      `SELECT
        scope_value,
        MIN(scope_ordinal) as scope_ordinal,
        COUNT(*) as event_count,
        MIN(timestamp) as first_timestamp,
        MAX(timestamp) as last_timestamp
       FROM events
       ${whereClause}
       AND scope_value IS NOT NULL
       GROUP BY scope_value
       ORDER BY MIN(COALESCE(scope_ordinal, 0)) DESC, MIN(timestamp) DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    if (result.length === 0) return [];

    // For each scope, get category counts
    const scopes: ScopeSummary[] = [];
    for (const row of result[0].values) {
      const scopeValue = row[0] as string;
      const scopeOrdinal = row[1] != null ? (row[1] as number) : undefined;
      const eventCount = row[2] as number;
      const firstTimestamp = row[3] as string;
      const lastTimestamp = row[4] as string;

      // Get category breakdown for this scope
      const catResult = this.db!.exec(
        `SELECT category, COUNT(*) as count FROM events
         WHERE schema_id = ? AND scope_value = ?
         GROUP BY category`,
        [schemaId, scopeValue]
      );

      const categories: Record<string, number> = {};
      if (catResult.length > 0) {
        for (const catRow of catResult[0].values) {
          categories[catRow[0] as string] = catRow[1] as number;
        }
      }

      scopes.push({
        scopeValue,
        scopeOrdinal,
        eventCount,
        categories,
        firstTimestamp,
        lastTimestamp,
      });
    }

    return scopes;
  }

  getEventCount(options: GenericEventQuery = {}): number {
    this.initializeSync();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.schemaId) {
      conditions.push('schema_id = ?');
      params.push(options.schemaId);
    }

    if (options.eventType) {
      conditions.push('event_type = ?');
      params.push(options.eventType);
    }

    if (options.service) {
      conditions.push('service = ?');
      params.push(options.service);
    }

    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since);
    }

    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = this.db!.exec(
      `SELECT COUNT(*) as count FROM events ${whereClause}`,
      params
    );

    if (result.length === 0 || result[0].values.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  pruneEvents(maxCount: number): number {
    this.initializeSync();
    if (maxCount <= 0) return 0;

    const currentCount = this.getEventCount();
    if (currentCount <= maxCount) return 0;

    const deleteCount = currentCount - maxCount;
    this.db!.run(
      `DELETE FROM events WHERE id IN (
        SELECT id FROM events ORDER BY timestamp ASC LIMIT ?
      )`,
      [deleteCount]
    );

    this.save();
    return deleteCount;
  }

  private rowToGenericEvent(columns: string[], row: SqlValue[]): GenericEvent {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });

    return {
      id: obj.id as string,
      schemaId: obj.schema_id as string,
      eventType: obj.event_type as string,
      category: obj.category as string,
      timestamp: obj.timestamp as string,
      scopeValue: (obj.scope_value as string) || undefined,
      scopeOrdinal: obj.scope_ordinal != null ? (obj.scope_ordinal as number) : undefined,
      sessionId: (obj.session_id as string) || undefined,
      service: obj.service as string,
      data: obj.data_json ? JSON.parse(obj.data_json as string) : undefined,
      severity: (obj.severity as GenericEvent['severity']) || 'info',
      parentEventId: (obj.parent_event_id as string) || undefined,
      depth: (obj.depth as number) || 0,
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
