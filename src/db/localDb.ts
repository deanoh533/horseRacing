import { existsSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

type Row = Record<string, unknown>;
type DbResult<T> = { data: T | null; error: Error | null };

export interface ReadClient {
  from(table: string): QueryBuilder;
}

export class QueryBuilder implements PromiseLike<DbResult<any>> {
  private _cols = '*';
  private _filters: Array<{ sql: string; params: unknown[] }> = [];
  private _orders: Array<{ col: string; asc: boolean }> = [];
  private _offset = 0;
  private _limitVal: number | null = null;
  private _mode: 'array' | 'single' | 'maybeSingle' = 'array';

  constructor(private _conn: any, private _table: string) {}

  select(cols: string): this { this._cols = cols; return this; }

  eq(col: string, val: unknown): this {
    this._filters.push({ sql: `"${col}" = ?`, params: [val] });
    return this;
  }
  neq(col: string, val: unknown): this {
    this._filters.push({ sql: `"${col}" <> ?`, params: [val] });
    return this;
  }
  gt(col: string, val: unknown): this {
    this._filters.push({ sql: `"${col}" > ?`, params: [val] });
    return this;
  }
  gte(col: string, val: unknown): this {
    this._filters.push({ sql: `"${col}" >= ?`, params: [val] });
    return this;
  }
  lt(col: string, val: unknown): this {
    this._filters.push({ sql: `"${col}" < ?`, params: [val] });
    return this;
  }
  lte(col: string, val: unknown): this {
    this._filters.push({ sql: `"${col}" <= ?`, params: [val] });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    const ph = vals.map(() => '?').join(', ');
    this._filters.push({ sql: `"${col}" IN (${ph})`, params: vals });
    return this;
  }
  is(col: string, _val: null): this {
    this._filters.push({ sql: `"${col}" IS NULL`, params: [] });
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    if (op === 'is' && val === null) {
      this._filters.push({ sql: `"${col}" IS NOT NULL`, params: [] });
    }
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this._orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  range(from: number, to: number): this {
    this._offset = from;
    this._limitVal = to - from + 1;
    return this;
  }
  limit(n: number): this { this._limitVal = n; return this; }
  single(): this { this._mode = 'single'; return this; }
  maybeSingle(): this { this._mode = 'maybeSingle'; return this; }

  then<TResult1 = DbResult<any>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this._execute().then(onfulfilled, onrejected);
  }

  private async _execute(): Promise<DbResult<any>> {
    try {
      const params: unknown[] = [];
      const whereClauses = this._filters.map(f => {
        params.push(...f.params);
        return f.sql;
      });

      let sql = `SELECT ${this._cols} FROM "${this._table}"`;
      if (whereClauses.length) sql += ` WHERE ${whereClauses.join(' AND ')}`;
      if (this._orders.length) {
        sql += ' ORDER BY ' + this._orders
          .map(o => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`)
          .join(', ');
      }
      if (this._limitVal !== null) sql += ` LIMIT ${this._limitVal}`;
      if (this._offset) sql += ` OFFSET ${this._offset}`;

      const reader = await this._conn.runAndReadAll(sql, params);
      // DuckDB는 INTEGER를 BigInt로 반환 → supabase-js(number)와 호환되도록 변환
      const rows = (reader.getRowObjects() as Row[]).map(row =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
        )
      ) as Row[];

      if (this._mode === 'single') {
        if (rows.length !== 1) {
          return { data: null, error: new Error(`Expected 1 row, got ${rows.length}`) };
        }
        return { data: rows[0]!, error: null };
      }
      if (this._mode === 'maybeSingle') {
        if (rows.length > 1) {
          return { data: null, error: new Error(`Expected 0-1 rows, got ${rows.length}`) };
        }
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }
}

export function makeLocalClient(conn: any): ReadClient {
  return { from: (table: string) => new QueryBuilder(conn, table) };
}

// ── 싱글턴 연결 ──────────────────────────────────────────────────
let _instance: any = null;
let _conn: any = null;
const DB_PATH = 'data/local.duckdb';

export async function getLocalDb(): Promise<ReadClient> {
  if (_conn) return makeLocalClient(_conn);
  if (!existsSync(DB_PATH)) {
    throw new Error(`${DB_PATH} 없음 — npm run db:pull 먼저 실행하세요`);
  }
  _instance = await DuckDBInstance.create(DB_PATH);
  _conn = await _instance.connect();
  return makeLocalClient(_conn);
}

export async function getReadClient(): Promise<ReadClient> {
  const { getEnv } = await import('../utils/env.js');
  const env = getEnv();
  if (env.DB_SOURCE === 'supabase') {
    const { getSupabaseAdmin } = await import('./supabase.js');
    return getSupabaseAdmin() as unknown as ReadClient;
  }
  return getLocalDb();
}
