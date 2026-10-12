/**
 * Minimal D1Database implementation over node:sqlite for tests. It applies the
 * real SQL files in ./migrations, so tests exercise the same schema that
 * `wrangler d1 migrations apply` creates.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Param = string | number | bigint | null | Uint8Array;

function toParam(value: unknown): Param {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as Param;
}

class TestStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new TestStatement(this.db, this.sql, values.map(toParam));
  }

  private rows(): Record<string, unknown>[] {
    return this.db.prepare(this.sql).all(...this.params) as Record<string, unknown>[];
  }

  async all() {
    return { results: this.rows(), success: true, meta: {} };
  }

  async first(column?: string) {
    const row = this.rows()[0];
    if (!row) return null;
    return column ? (row[column] ?? null) : row;
  }

  async raw() {
    return this.rows().map((row) => Object.values(row));
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  /** Used by batch(): statements with RETURNING produce rows, others run. */
  execute() {
    return { results: this.rows(), success: true, meta: {} };
  }
}

export function createTestD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const dir = join(process.cwd(), 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(dir, file), 'utf8'));
  }

  const d1 = {
    prepare: (sql: string) => new TestStatement(sqlite, sql),
    async batch(statements: TestStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => s.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
    withSession: () => d1,
  };
  return { d1: d1 as unknown as D1Database, sqlite };
}
