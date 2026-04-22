/**
 * University metrics snapshot (v6.0, D7 locked).
 *
 * Captured locally on lifecycle boundaries (paradigm shift, paradigm doctor,
 * server start/stop, CLI status invocation). NEVER contains content bodies,
 * entry titles, or user identifiers beyond a hashed project salt.
 *
 * At v6.0 these snapshots are LOCAL-ONLY. Config key
 * `metrics.remote_consent` is seeded to `'pending'` so v6.1 can prompt for
 * opt-in remote sharing without a config-schema migration.
 */
export interface UniversityMetricsSnapshot {
  schema_version: "1";
  captured_at: string;  // ISO 8601
  project_salt_hash: string;

  packs: {
    count: number;
    by_tenant_kind: {
      first_party: number;
      project: number;
      external: number;
    };
  };

  project_pack: {
    exists: boolean;
    entry_counts: {
      notes: number;
      policies: number;
      quizzes: number;
      paths: number;
      diplomas: number;
    };
    disciplines: number;
    last_modified_days_ago: number;
  };

  activity: {
    quiz_completions_last_30d: number;
    entries_created_last_30d: number;
  };
}
