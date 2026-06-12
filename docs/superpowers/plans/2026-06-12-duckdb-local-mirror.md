# DuckDB 로컬 읽기 미러 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분석·백테스트 스크립트 읽기를 로컬 DuckDB 파일로 분리해 Supabase egress를 0으로 만든다.

**Architecture:** supabase-js의 `.from().select().eq()...` 체인을 흉내 내는 `QueryBuilder` 어댑터(`src/db/localDb.ts`)를 만든다. `getReadClient()`가 `DB_SOURCE` 환경변수 기준으로 DuckDB(기본) vs 진짜 Supabase를 선택한다. 분석 스크립트는 `getSupabaseAdmin()` → `getReadClient()` 한 줄 교체. `gatherRaceInputs(sb, ...)` 는 이미 클라이언트 주입 방식이라 라이브 경로 변경 없음. `npm run db:pull` 스크립트가 Supabase → DuckDB 전체 새로고침을 수행한다(Supabase egress 리셋 6/23 후 1회 실행).

**Tech Stack:** `@duckdb/node-api`, TypeScript 5, Vitest, tsx

---

## 파일 구조

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/db/localDb.ts` | DuckDB 연결 + QueryBuilder 어댑터 + `getLocalDb()` + `getReadClient()` | 신규 |
| `src/db/localDb.test.ts` | 어댑터 단위 테스트 (in-memory DuckDB) | 신규 |
| `scripts/sync_local_db.ts` | `db:pull` 덤프 스크립트 | 신규 |
| `package.json` | `db:pull` 스크립트 추가, `@duckdb/node-api` 의존성 추가 | 수정 |
| `src/utils/env.ts` | `DB_SOURCE` 환경변수 추가 (optional, 기본 'local') | 수정 |
| `.gitignore` | `data/local.duckdb` 추가 | 수정 |
| `scripts/extract_training_matrix.ts` | `getReadClient()` 배선 (읽기 클라이언트 교체) | 수정 |

---

### Task 0: @duckdb/node-api Windows 설치·API 검증 ⚠️ 필수 선행

> **Sonnet 리뷰 포인트:** 이 Task 완료 후 출력된 API 패턴을 확인한 뒤 Task 1 진행. Windows prebuild가 없으면 대안 패키지로 전환.

**Files:**
- Create: `scripts/verify_duckdb.ts` (검증 후 삭제)

- [ ] **Step 1: 패키지 설치**

```bash
npm install @duckdb/node-api
```

Expected: 오류 없이 완료. Windows native prebuild가 있으면 컴파일 단계 생략.

- [ ] **Step 2: 검증 스크립트 작성**

`scripts/verify_duckdb.ts`:
```typescript
import { DuckDBInstance } from '@duckdb/node-api';

async function main() {
  console.log('1. in-memory 인스턴스 생성...');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();

  console.log('2. 테이블 생성 + 데이터 삽입...');
  await conn.run('CREATE TABLE test (id INTEGER, name VARCHAR, val DOUBLE)');
  await conn.run("INSERT INTO test VALUES (1, 'hello', 3.14), (2, 'world', 2.72)");

  console.log('3. 전체 조회...');
  const r1 = await conn.runAndReadAll('SELECT * FROM test');
  console.log('rows:', r1.getRowObjects());
  // Expected: [ { id: 1, name: 'hello', val: 3.14 }, { id: 2, name: 'world', val: 2.72 } ]

  console.log('4. 단일 파라미터 WHERE...');
  const r2 = await conn.runAndReadAll('SELECT * FROM test WHERE id = ?', [1]);
  console.log('filtered:', r2.getRowObjects());
  // Expected: [ { id: 1, name: 'hello', val: 3.14 } ]

  console.log('5. 복수 파라미터...');
  const r3 = await conn.runAndReadAll('SELECT * FROM test WHERE id >= ? AND val < ?', [1, 4.0]);
  console.log('multi:', r3.getRowObjects());
  // Expected: [ { id: 1, name: 'hello', val: 3.14 } ]

  console.log('6. IS NULL...');
  await conn.run('INSERT INTO test VALUES (3, NULL, 0.0)');
  const r4 = await conn.runAndReadAll('SELECT * FROM test WHERE name IS NULL');
  console.log('null check:', r4.getRowObjects());
  // Expected: [ { id: 3, name: null, val: 0 } ]

  await conn.close();
  await instance.close();
  console.log('✅ DuckDB API 검증 완료');
}
main().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 3: 실행**

```bash
npx tsx scripts/verify_duckdb.ts
```

Expected 출력:
```
1. in-memory 인스턴스 생성...
2. 테이블 생성 + 데이터 삽입...
3. 전체 조회...
rows: [ { id: 1, name: 'hello', val: 3.14 }, { id: 2, name: 'world', val: 2.72 } ]
4. 단일 파라미터 WHERE...
filtered: [ { id: 1, name: 'hello', val: 3.14 } ]
5. 복수 파라미터...
multi: [ { id: 1, name: 'hello', val: 3.14 } ]
6. IS NULL...
null check: [ { id: 3, name: null, val: 0 } ]
✅ DuckDB API 검증 완료
```

**만약 실패하면:** `runAndReadAll` / `getRowObjects` 이름이 다를 수 있음. 에러 메시지와 `console.log(Object.getOwnPropertyNames(conn))` 출력을 Sonnet에게 보고. Sonnet이 Task 1~4 코드 수정 후 재시도.

- [ ] **Step 4: 검증 스크립트 삭제**

```bash
del scripts\verify_duckdb.ts
```

Sonnet에게 보고: "API 확인 — `runAndReadAll(sql, paramsArray)` + `getRowObjects()` 동작함" (또는 실제 동작한 패턴).

---

### Task 1: 환경 설정 (env + .gitignore + package.json)

**Files:**
- Modify: `src/utils/env.ts`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: DB_SOURCE 환경변수 추가**

`src/utils/env.ts`의 `envSchema` `z.object({ ... })` 블록 안 마지막 항목 뒤에 추가:
```typescript
  DB_SOURCE: z.enum(['local', 'supabase']).default('local'),
```

파일 전체를 바꾸지 말고 해당 줄만 삽입.

- [ ] **Step 2: .gitignore 추가**

`.gitignore` 파일 끝에 두 줄 추가:
```
data/local.duckdb
data/local.duckdb.wal
```

- [ ] **Step 3: package.json에 db:pull 추가**

`package.json`의 `"scripts"` 블록에 추가:
```json
"db:pull": "tsx scripts/sync_local_db.ts"
```

- [ ] **Step 4: 타입체크**

```bash
npm run build
```

Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/utils/env.ts .gitignore package.json
git commit -m "chore(duckdb): DB_SOURCE env + .gitignore + db:pull 스크립트 등록"
```

---

### Task 2: QueryBuilder 필터 메서드 TDD

> **전제:** Task 0에서 확인한 DuckDB API 패턴(`runAndReadAll`, `getRowObjects`)을 사용. Task 0 결과가 다르면 Sonnet이 수정한 패턴으로 교체.

**Files:**
- Create: `src/db/localDb.ts`
- Create: `src/db/localDb.test.ts`

- [ ] **Step 1: 테스트 파일 먼저 작성**

`src/db/localDb.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { makeLocalClient } from './localDb.js';

let instance: any;
let conn: any;
let client: ReturnType<typeof makeLocalClient>;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  await conn.run(`CREATE TABLE races (
    race_date INTEGER, meet INTEGER, rc_no INTEGER,
    rc_dist INTEGER, track_type VARCHAR, prize_cond VARCHAR,
    ord INTEGER
  )`);
  await conn.run(`INSERT INTO races VALUES
    (20240101, 1, 1, 1400, 'T', 'A', 1),
    (20240101, 1, 2, 1800, 'D', 'B', 2),
    (20240201, 2, 1, 1200, 'T', 'A', 3),
    (20240301, 1, 1, 1400, 'T', 'C', NULL)
  `);
  client = makeLocalClient(conn);
});

afterAll(async () => {
  await conn.close();
  await instance.close();
});

describe('select', () => {
  it('기본: 전체 컬럼', async () => {
    const { data, error } = await client.from('races').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
    expect(data![0]).toHaveProperty('race_date');
  });

  it('특정 컬럼 선택', async () => {
    const { data } = await client.from('races').select('race_date, meet');
    expect(data).toHaveLength(4);
    expect(Object.keys(data![0]!).sort()).toEqual(['meet', 'race_date']);
  });
});

describe('eq / neq', () => {
  it('eq: meet = 1', async () => {
    const { data } = await client.from('races').select('*').eq('meet', 1);
    expect(data).toHaveLength(3);
    expect(data!.every((r: any) => r.meet === 1)).toBe(true);
  });

  it('neq: meet != 1', async () => {
    const { data } = await client.from('races').select('*').neq('meet', 1);
    expect(data).toHaveLength(1);
    expect(data![0]!.meet).toBe(2);
  });
});

describe('gt / gte / lt / lte', () => {
  it('gte: race_date >= 20240201', async () => {
    const { data } = await client.from('races').select('race_date').gte('race_date', 20240201);
    expect(data).toHaveLength(2);
  });

  it('lte: race_date <= 20240101', async () => {
    const { data } = await client.from('races').select('race_date').lte('race_date', 20240101);
    expect(data).toHaveLength(2);
  });

  it('gt: rc_dist > 1400', async () => {
    const { data } = await client.from('races').select('rc_dist').gt('rc_dist', 1400);
    expect(data).toHaveLength(1);
    expect(data![0]!.rc_dist).toBe(1800);
  });

  it('lt: rc_dist < 1400', async () => {
    const { data } = await client.from('races').select('rc_dist').lt('rc_dist', 1400);
    expect(data).toHaveLength(1);
    expect(data![0]!.rc_dist).toBe(1200);
  });
});

describe('in', () => {
  it('in: meet IN [1, 2]', async () => {
    const { data } = await client.from('races').select('*').in('meet', [1, 2]);
    expect(data).toHaveLength(4);
  });

  it('in: track_type IN ["D"]', async () => {
    const { data } = await client.from('races').select('*').in('track_type', ['D']);
    expect(data).toHaveLength(1);
    expect(data![0]!.track_type).toBe('D');
  });
});

describe('is / not', () => {
  it('is null: ord IS NULL', async () => {
    const { data } = await client.from('races').select('*').is('ord', null);
    expect(data).toHaveLength(1);
    expect(data![0]!.ord).toBeNull();
  });

  it('not is null: ord IS NOT NULL', async () => {
    const { data } = await client.from('races').select('*').not('ord', 'is', null);
    expect(data).toHaveLength(3);
    data!.forEach((r: any) => expect(r.ord).not.toBeNull());
  });
});

describe('복합 필터', () => {
  it('eq + gte + lte 조합', async () => {
    const { data } = await client.from('races').select('*')
      .eq('meet', 1)
      .gte('race_date', 20240101)
      .lte('race_date', 20240101);
    expect(data).toHaveLength(2);
  });

  it('in + not is null 조합', async () => {
    const { data } = await client.from('races').select('*')
      .in('track_type', ['T'])
      .not('ord', 'is', null);
    expect(data).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run src/db/localDb.test.ts
```

Expected: `makeLocalClient` not found — import 실패.

- [ ] **Step 3: localDb.ts 구현**

`src/db/localDb.ts`:
```typescript
import { existsSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

type Row = Record<string, unknown>;
type DbResult<T> = { data: T | null; error: Error | null };

export interface ReadClient {
  from(table: string): QueryBuilder;
}

export class QueryBuilder {
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

  then(resolve: any, reject?: any): any {
    return this._execute().then(resolve, reject);
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
      const rows = reader.getRowObjects() as Row[];

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
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run src/db/localDb.test.ts
```

Expected: 모든 테스트 통과 (PASS).

- [ ] **Step 5: 커밋**

```bash
git add src/db/localDb.ts src/db/localDb.test.ts
git commit -m "feat(duckdb): QueryBuilder 필터 TDD (eq/neq/gt/gte/lt/lte/in/is/not)"
```

---

### Task 3: QueryBuilder order / range / limit / single / maybeSingle TDD

> 구현은 Task 2에서 이미 완성됨. 이 Task는 테스트만 추가해 통과 확인.

**Files:**
- Modify: `src/db/localDb.test.ts`

- [ ] **Step 1: 테스트 추가**

`src/db/localDb.test.ts` 파일의 맨 끝 (마지막 `describe` 블록 뒤)에 추가:

```typescript
describe('order', () => {
  it('ASC 정렬', async () => {
    const { data } = await client.from('races').select('race_date')
      .order('race_date', { ascending: true });
    expect(data![0]!.race_date).toBe(20240101);
    expect(data![data!.length - 1]!.race_date).toBe(20240301);
  });

  it('DESC 정렬', async () => {
    const { data } = await client.from('races').select('race_date')
      .order('race_date', { ascending: false });
    expect(data![0]!.race_date).toBe(20240301);
  });

  it('다중 order 누적 (race_date, rc_no ASC)', async () => {
    const { data } = await client.from('races').select('race_date, rc_no')
      .order('race_date').order('rc_no');
    expect(data![0]).toMatchObject({ race_date: 20240101, rc_no: 1 });
    expect(data![1]).toMatchObject({ race_date: 20240101, rc_no: 2 });
  });
});

describe('range / limit', () => {
  it('range(0, 1): 2행 반환', async () => {
    const { data } = await client.from('races').select('*')
      .order('race_date').range(0, 1);
    expect(data).toHaveLength(2);
  });

  it('range(2, 3): offset 2에서 2행', async () => {
    const { data } = await client.from('races').select('race_date')
      .order('race_date').range(2, 3);
    expect(data).toHaveLength(2);
    expect(data![0]!.race_date).toBe(20240201);
  });

  it('limit(2): 상위 2행만', async () => {
    const { data } = await client.from('races').select('*').limit(2);
    expect(data).toHaveLength(2);
  });
});

describe('single / maybeSingle', () => {
  it('single: 1행 정상 반환', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('race_date', 20240201).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ race_date: 20240201, meet: 2 });
  });

  it('single: 0행이면 error 반환', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('race_date', 99999999).single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toContain('Expected 1 row');
  });

  it('maybeSingle: 1행 정상 반환', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('race_date', 20240201).maybeSingle();
    expect(error).toBeNull();
    expect(data).toMatchObject({ race_date: 20240201 });
  });

  it('maybeSingle: 0행이면 data null, error null', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('race_date', 99999999).maybeSingle();
    expect(data).toBeNull();
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run src/db/localDb.test.ts
```

Expected: 모든 테스트 통과.

- [ ] **Step 3: 커밋**

```bash
git add src/db/localDb.test.ts
git commit -m "test(duckdb): order/range/limit/single/maybeSingle 테스트 추가 — 전체 통과"
```

---

### Task 4: 타입체크 + 전체 테스트 통과 확인

**Files:**
- 없음 (기존 파일 검증만)

- [ ] **Step 1: 전체 테스트**

```bash
npm run test:run
```

Expected: localDb.test.ts 포함 전체 통과. 기존 테스트 회귀 없음.

- [ ] **Step 2: 타입체크**

```bash
npm run build
```

Expected: 오류 없음. (타입 경고가 있으면 Sonnet에게 보고)

- [ ] **Step 3: 커밋 (빌드 오류 없음 확인)**

```bash
git add -A
git commit -m "chore(duckdb): 전체 빌드·테스트 통과 확인"
```

빌드 오류가 없으면 이 커밋은 생략해도 됨.

---

### Task 5: 덤프 스크립트 (sync_local_db.ts)

> ⚠️ Supabase가 현재 Restricted(402) 상태. 코드만 작성하고 실행은 2026-06-23 egress 리셋 후.

**Files:**
- Create: `scripts/sync_local_db.ts`

- [ ] **Step 1: 스크립트 작성**

`scripts/sync_local_db.ts`:
```typescript
/**
 * Supabase → 로컬 DuckDB 전체 덤프 (npm run db:pull)
 *
 * 사용:
 *   npm run db:pull                        # 전체 테이블 새로고침
 *   npm run db:pull -- --table race_entries # 단일 테이블만
 *
 * ⚠️ Supabase egress 리셋(2026-06-23) 후 실행.
 * 원리: Supabase → 임시 JSON → DuckDB read_json_auto (타입 자동 추론)
 */
import 'dotenv/config';
import { DuckDBInstance } from '@duckdb/node-api';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TABLES = [
  'race_entries', 'races', 'predictions', 'horses', 'horse_results',
  'model_versions', 'weight_history', 'race_cards', 'jockey_stats',
  'training_logs', 'race_sectional_stats', 'race_par_times',
] as const;

// 뷰는 결과 행을 테이블로 굳혀 적재
const VIEWS = [
  'horse_sectional_ability',
  'horse_running_style_by_distance',
] as const;

const DB_PATH = 'data/local.duckdb';
const PAGE = 1000;

async function fetchAll(
  sb: ReturnType<typeof getSupabaseAdmin>,
  table: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select('*')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} fetch 오류: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function dumpTable(
  conn: any,
  sb: ReturnType<typeof getSupabaseAdmin>,
  table: string
): Promise<void> {
  console.log(`  → ${table}`);
  const rows = await fetchAll(sb, table);

  if (rows.length === 0) {
    console.log(`    (빈 테이블, 스킵)`);
    return;
  }

  // 임시 JSON 파일 → DuckDB read_json_auto (타입 자동 추론)
  const tmp = join(tmpdir(), `duckpull_${table}.json`).replace(/\\/g, '/');
  writeFileSync(tmp, JSON.stringify(rows));

  await conn.run(`DROP TABLE IF EXISTS "${table}"`);
  await conn.run(`CREATE TABLE "${table}" AS SELECT * FROM read_json_auto('${tmp}')`);
  unlinkSync(tmp);

  console.log(`    ✅ ${rows.length}행`);
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--table');
  const singleTable = idx >= 0 ? args[idx + 1] : null;

  if (!existsSync('data')) mkdirSync('data');

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  const sb = getSupabaseAdmin();

  const targets = singleTable ? [singleTable] : [...TABLES, ...VIEWS];
  console.log(`🦆 db:pull 시작: ${targets.length}개 테이블 → ${DB_PATH}`);

  for (const table of targets) {
    await dumpTable(conn, sb, table);
  }

  await conn.close();
  await instance.close();
  console.log(`\n✅ db:pull 완료 → ${DB_PATH}`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: 타입체크**

```bash
npm run build
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add scripts/sync_local_db.ts
git commit -m "feat(duckdb): db:pull 덤프 스크립트 — Supabase→DuckDB JSON 경유 적재"
```

---

### Task 6: extract:matrix 배선 (getReadClient 주입)

**Files:**
- Modify: `scripts/extract_training_matrix.ts`

- [ ] **Step 1: import 교체**

`scripts/extract_training_matrix.ts` 상단의 import 블록에서:

```typescript
// 제거:
import { getSupabaseAdmin } from '../src/db/supabase.js';
// 추가:
import { getReadClient } from '../src/db/localDb.js';
```

- [ ] **Step 2: 클라이언트 초기화 교체**

`main()` 함수 안에서:

```typescript
// 변경 전:
const sb = getSupabaseAdmin();
// 변경 후:
const sb = await getReadClient();
```

`await` 추가 필수 — `getReadClient()`는 `async` 함수.

- [ ] **Step 3: gatherRaceInputs 호출 확인**

`gatherRaceInputs(sb, d!, m!, n!)` 호출은 **변경 없음**. `sb` 인자 타입이 바뀌는 것뿐.

`sb.from('race_entries').select(...)` 형태로 직접 호출하는 줄도 `sb` 변수만 바뀌므로 코드 변경 없음.

- [ ] **Step 4: 타입체크**

```bash
npm run build
```

타입 불일치 오류가 나면 `as any` 캐스팅으로 처리:
```typescript
const sb = await getReadClient() as any;
```

Expected: 오류 없음.

- [ ] **Step 5: 전체 테스트**

```bash
npm run test:run
```

Expected: 기존 테스트 전부 통과. 회귀 없음.

- [ ] **Step 6: 커밋**

```bash
git add scripts/extract_training_matrix.ts
git commit -m "feat(duckdb): extract:matrix → getReadClient() 배선 완료"
```

---

## Phase 1 완료 기준

모든 Task 완료 후 아래를 확인:

```bash
npm run test:run   # 전체 통과
npm run build      # 타입 오류 없음
git log --oneline  # 6개 커밋 확인
```

---

## 6/23 이후 실행 체크리스트 (Phase 3)

```bash
# 1. DuckDB 채우기 (1회, Supabase egress 리셋 후)
npm run db:pull
# Expected: 각 테이블 덤프 완료, data/local.duckdb 생성

# 2. extract:matrix DuckDB로 재실행
npm run extract:matrix -- --from 20240101 --out data/training_matrix_duckdb.jsonl

# 3. byte-identical 비교 (PowerShell)
(Get-FileHash data/training_matrix.jsonl -Algorithm SHA256).Hash
(Get-FileHash data/training_matrix_duckdb.jsonl -Algorithm SHA256).Hash
# 두 해시 일치 → ✅ 어댑터 정확성 검증 완료
# 불일치 → Sonnet에게 두 파일 첫 번째 차이점 보고
```
