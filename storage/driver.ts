export type SqlValue = string | number | null;

/** The small SQLite surface used by the repository; also exercised with real SQLite in tests. */
export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
}

export interface SqlDatabase extends SqlConnection {
  withExclusiveTransactionAsync(task: (transaction: SqlConnection) => Promise<void>): Promise<void>;
}
