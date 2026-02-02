/**
 * Type declarations for sql.js
 */

declare module 'sql.js' {
  type SqlValue = string | number | Uint8Array | null;

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  interface Database {
    run(sql: string, params?: SqlValue[]): void;
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export default initSqlJs;
  export type { Database as SqlJsDatabase, SqlJsStatic, QueryExecResult, SqlValue };
}
