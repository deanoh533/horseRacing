import { existsSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

type Row = Record<string, unknown>;
type DbResult<T> = { data: T | null; error: Error | null };

/**
 * DuckDB 값 래퍼(Struct/List/Array/Map)와 BigInt를 supabase-js와 동일한
 * 평범한 JS 값(객체/배열/number)으로 **재귀** 변환한다.
 *
 * 배경: db:pull의 read_json_auto가 jsonb 객체 컬럼(artifact·weights·item_scores 등)을
 * DuckDB STRUCT/MAP으로 추론한다. @duckdb/node-api는 이를 DuckDBStructValue({entries})·
 * DuckDBListValue({items}) 래퍼로 돌려주므로, 변환 없이는 `artifact.features` 같은 접근이
 * undefined가 되어 scoreLogistic이 깨진다. 이 함수가 읽기 경계에서 그 차이를 흡수한다.
 */
export function unwrapDuck(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  switch ((v as { constructor?: { name?: string } }).constructor?.name) {
    case 'DuckDBStructValue':
      return unwrapDuck((v as { entries: Record<string, unknown> }).entries);
    case 'DuckDBMapValue': {
      const out: Record<string, unknown> = {};
      for (const e of (v as { entries: { key: unknown; value: unknown }[] }).entries) {
        out[String(unwrapDuck(e.key))] = unwrapDuck(e.value);
      }
      return out;
    }
    case 'DuckDBListValue':
    case 'DuckDBArrayValue':
      return (v as { items: unknown[] }).items.map(unwrapDuck);

    // 시각 값은 supabase-js REST와 같게 **ISO 문자열**로 돌려준다.
    // 안 하면 DuckDBTimestampValue{micros} 객체가 그대로 새어 나가 Date.parse가 NaN이 된다.
    // 2026-09-27 실제 사고: isLivePrediction(created_at, …)이 전부 false가 되어
    // probe:v7-accuracy가 예측 43,940건을 통째로 "백필"로 제외했다(판정 0행).
    // db:pull이 JSON을 거치며 TIMESTAMPTZ가 TIMESTAMP로 굳지만 값은 UTC라 Z를 붙인다.
    case 'DuckDBTimestampValue':
    case 'DuckDBTimestampMicrosecondsValue':
    case 'DuckDBTimestampTZValue':
      return new Date(Number((v as { micros: bigint }).micros / 1000n)).toISOString();
    case 'DuckDBTimestampMillisecondsValue':
      return new Date(Number((v as { millis: bigint }).millis)).toISOString();
    case 'DuckDBTimestampSecondsValue':
      return new Date(Number((v as { seconds: bigint }) .seconds) * 1000).toISOString();
    case 'DuckDBTimestampNanosecondsValue':
      return new Date(Number((v as { nanos: bigint }).nanos / 1_000_000n)).toISOString();
    case 'DuckDBDateValue':
      return new Date((v as { days: number }).days * 86_400_000).toISOString().slice(0, 10);
  }
  if (Array.isArray(v)) return v.map(unwrapDuck);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = unwrapDuck(val);
  return out;
}

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
      // DuckDB 래퍼(Struct/List/Map)·BigInt를 supabase-js 호환 평범한 JS 값으로 재귀 변환
      const rows = (reader.getRowObjects() as Row[]).map(row => unwrapDuck(row) as Row);

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
// **연결이 아니라 "여는 중인 Promise"를 캐시한다.** 연결(_conn)만 캐시하면 확인과
// 대입 사이가 await로 벌어져, 동시에 부른 둘이 모두 "아직 없다"를 보고 둘 다
// DuckDBInstance.create(같은 파일)를 실행한다 → 두 번째가 **자기 프로세스**를 가리키며
// "다른 프로세스가 파일을 사용 중"으로 죽는다(DuckDB는 writer가 하나뿐).
// 2026-09-27 실제 사고: probe_v7_accuracy가 예측·결과를 Promise.all로 동시 로드 →
// O-004 판정 자체가 불가. 열기 실패 시 캐시를 비워 다음 호출이 다시 시도하게 둔다.
let _clientPromise: Promise<ReadClient> | null = null;
const DB_PATH = 'data/local.duckdb';

/**
 * 잠금 IO 에러를 원인 설명으로 감싼다.
 * ⚠️ 범인이 남이 아닐 수 있다 — 2026-09-27에 두 번 다 자기 자신이었다
 * (동시 호출 경쟁 / db:pull이 "완료" 출력 뒤에도 잠깐 쥐고 있음).
 */
export function explainOpenError(e: Error): string {
  if (!/already open|사용 중/.test(e.message)) return e.message;
  const pid = e.message.match(/PID (\d+)/)?.[1];
  return [
    `미러 파일을 열 수 없습니다 — 다른 프로세스가 쥐고 있습니다${pid ? ` (PID ${pid})` : ''}.`,
    'DuckDB는 동시에 하나만 열 수 있습니다. 흔한 원인 세 가지:',
    '  1) 방금 끝난 db:pull — "완료" 출력 뒤에도 잠깐 파일을 쥡니다. 몇 초 뒤 다시 실행하세요.',
    '  2) 자기 자신 — PID가 실행마다 달라지면 남이 아니라 이 프로세스입니다.',
    '  3) 다른 워크트리·세션에서 미러를 쓰는 중.',
    `원본: ${e.message}`,
  ].join('\n');
}

export async function getLocalDb(): Promise<ReadClient> {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      if (!existsSync(DB_PATH)) {
        throw new Error(`${DB_PATH} 없음 — npm run db:pull 먼저 실행하세요`);
      }
      let conn: any;
      try {
        const instance = await DuckDBInstance.create(DB_PATH);
        conn = await instance.connect();
      } catch (e) {
        throw new Error(explainOpenError(e as Error));
      }
      await warnIfStale(conn);
      return makeLocalClient(conn);
    })().catch((e) => {
      _clientPromise = null;
      throw e;
    });
  }
  return _clientPromise;
}

/**
 * 미러가 묵었으면 경고만 한다(막지 않는다) — 백테스트·게이트 실험은 일부러 과거
 * 미러로 돌리는 일이 많다. 2026-09-27에 79일 묵은 미러로 O-004를 판정할 뻔했다.
 * `MIRROR_STALE_WARN=off`로 끌 수 있고, `_sync_state`가 없는 구 미러면 조용히 넘어간다.
 */
async function warnIfStale(conn: any): Promise<void> {
  if (process.env.MIRROR_STALE_WARN === 'off') return;
  try {
    const { readLastSyncedAt, mirrorAgeDays, staleWarning } = await import('./mirror/syncState.js');
    const last = await readLastSyncedAt(conn);
    const warn = staleWarning(mirrorAgeDays(last, new Date()), last);
    if (warn) console.warn(warn);
  } catch {
    // 신선도 확인 실패가 읽기를 막으면 안 된다 — 조용히 넘어간다
  }
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
