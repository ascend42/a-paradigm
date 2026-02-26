/**
 * Type declarations for sql.js
 *
 * Extended from packages/sentinel/src/sql.js.d.ts with prepare/Statement support
 * for the aspect graph search engine.
 */

declare module 'sql.js' {
  type SqlValue = string | number | Uint8Array | null;

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  interface Statement {
    bind(params?: SqlValue[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, SqlValue>;
    free(): boolean;
    reset(): void;
  }

  interface Database {
    run(sql: string, params?: SqlValue[]): void;
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export default initSqlJs;
  export type { Database, SqlJsStatic, QueryExecResult, SqlValue, Statement };
}
