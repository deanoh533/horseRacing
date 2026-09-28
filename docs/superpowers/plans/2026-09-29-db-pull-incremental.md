# db:pull 증분 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `db:pull`이 바뀐 날짜만 받아 적재하게 하고, 직결 경로의 `LIMIT/OFFSET` 페이징을 없앤다.

**Architecture:** 원천(Postgres)에서 날짜별 내용 해시를 받아 미러 안 `_sync_state`에 저장된
지난 지문과 비교해 바뀐 날짜만 재적재한다. 비교는 언제나 "원천 지금 vs 원천 그때"이며 미러에서
해시를 재계산하지 않는다. 판단 로직(비교·전량 전환·신선도)은 DB 없이 테스트되는 순수 함수로
분리하고, 스크립트는 CLI 껍데기만 맡는다.

**Tech Stack:** TypeScript (ESM, `.js` 확장자 import) · `@duckdb/node-api` · `pg` · vitest · tsx

**Spec:** [docs/superpowers/specs/2026-09-29-db-pull-incremental-design.md](../specs/2026-09-29-db-pull-incremental-design.md)

## Global Constraints

- 모든 import는 `.js` 확장자 (ESM). 예: `import { x } from './tableSpecs.js'`
- 테스트는 vitest. 실행 `npx vitest run <path>`, 전체 `npm run test:run`
- 타입체크는 `npm run build` (= `tsc`). ⚠️ `npx tsc --noEmit`은 참조 방식이라 일부 파일을 안 본다
- 주석·커밋 메시지·로그 출력은 **한국어**
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 미러는 **읽기 전용**. 쓰기는 항상 `getSupabaseAdmin()` (이 계획은 미러 적재만 다룸)
- `FULL_RELOAD_RATIO = 0.5` · `MIRROR_STALE_DAYS = 3` — 상수로 두고 한 곳에서만 정의
- 증분 대상 5개와 정렬 키는 spec §4 표가 유일한 출처

## Review Focus

spec이 함의하지만 어느 태스크의 테스트도 건드리지 않을 입력 5가지. 각 줄의 테스트를 해당
태스크에 넣었다.

1. **원천에 날짜가 하나도 없는 테이블**(빈 `shadow_predictions`) — 지문 0줄. 전량 전환 규칙의
   "절반 초과" 계산이 0으로 나누면 안 된다 → Task 3
2. **저장된 지문은 있는데 원천이 통째로 비었을 때** — 전 날짜가 "사라짐". 미러도 비워야 한다 → Task 3
3. **날짜 키가 `null`인 행** — `GROUP BY`가 `null` 그룹을 만든다. 그 행들은 증분으로 추적 불가 →
   Task 2에서 지문 SQL이 `null` 날짜를 제외하고, Task 5에서 그런 테이블은 전량으로 돌린다
4. **`_sync_state`가 없는 구 미러**(지금 디스크에 있는 것) — 읽기가 터지면 안 되고 첫 실행처럼
   전량으로 가야 한다 → Task 4
5. **시각·jsonb 컬럼이 증분 적재를 거친 뒤 모양이 바뀌는 것** — 2026-09-27 사고의 재발 →
   Task 7 (spec §8)

---

### Task 1: 테이블 전략 표

**Files:**
- Create: `src/db/mirror/tableSpecs.ts`
- Test: `src/db/mirror/tableSpecs.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `TableSpec` · `IncrementalSpec` · `TABLE_SPECS` · `ALL_TARGETS` · `isIncremental()`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/mirror/tableSpecs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TABLE_SPECS, ALL_TARGETS, isIncremental } from './tableSpecs.js';

describe('TABLE_SPECS', () => {
  it('증분 대상은 spec §4의 5개', () => {
    const inc = Object.entries(TABLE_SPECS)
      .filter(([, s]) => s.mode === 'incremental')
      .map(([t]) => t)
      .sort();
    expect(inc).toEqual([
      'combo_dividends', 'predictions', 'race_entries',
      'shadow_predictions', 'training_logs',
    ]);
  });

  it('정렬 키는 PK의 날짜 키를 뺀 나머지', () => {
    const re = TABLE_SPECS['race_entries']!;
    expect(re).toEqual({ mode: 'incremental', dateCol: 'race_date', orderCols: ['meet', 'rc_no', 'pthr_no'] });
    const tl = TABLE_SPECS['training_logs']!;
    expect(tl).toEqual({ mode: 'incremental', dateCol: 'train_date', orderCols: ['meet', 'hr_no', 'part'] });
  });

  it('정렬 키에 날짜 컬럼이 다시 들어가면 안 된다', () => {
    for (const [, s] of Object.entries(TABLE_SPECS)) {
      if (s.mode === 'incremental') expect(s.orderCols).not.toContain(s.dateCol);
    }
  });

  it('ALL_TARGETS는 기존 12개 + 신규 2개 = 14개, 중복 없음', () => {
    expect(ALL_TARGETS).toHaveLength(14);
    expect(new Set(ALL_TARGETS).size).toBe(14);
    expect(ALL_TARGETS).toContain('combo_dividends');
    expect(ALL_TARGETS).toContain('shadow_predictions');
  });

  it('ALL_TARGETS의 모든 이름이 TABLE_SPECS에 있다', () => {
    for (const t of ALL_TARGETS) expect(TABLE_SPECS[t]).toBeDefined();
  });

  it('isIncremental 타입 좁히기', () => {
    const s = TABLE_SPECS['races']!;
    expect(isIncremental(s)).toBe(false);
    expect(isIncremental(TABLE_SPECS['predictions']!)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/db/mirror/tableSpecs.test.ts`
Expected: FAIL — `Cannot find module './tableSpecs.js'`

- [ ] **Step 3: 구현**

`src/db/mirror/tableSpecs.ts`:

```ts
/**
 * db:pull 테이블별 동기화 전략 (SSOT).
 * 근거·행수는 spec docs/superpowers/specs/2026-09-29-db-pull-incremental-design.md §4.
 */

export interface IncrementalSpec {
  mode: 'incremental';
  /** 날짜 키 컬럼 — PK 앞자리이며 인덱스가 있다 */
  dateCol: string;
  /** 지문 정렬 키 = PK에서 dateCol을 뺀 나머지. 순서가 흔들리면 해시가 달라지므로 고정. */
  orderCols: string[];
}
export interface FullSpec {
  mode: 'full';
  /** 뷰는 날짜 키가 없어 증분 자체가 불가 — 로그·문서용 구분 */
  isView?: boolean;
}
export type TableSpec = IncrementalSpec | FullSpec;

export function isIncremental(s: TableSpec): s is IncrementalSpec {
  return s.mode === 'incremental';
}

export const TABLE_SPECS: Record<string, TableSpec> = {
  // ── 증분 (날짜 키가 PK 앞자리) ──
  race_entries:       { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'pthr_no'] },
  predictions:        { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'hr_name', 'model_version'] },
  training_logs:      { mode: 'incremental', dateCol: 'train_date', orderCols: ['meet', 'hr_no', 'part'] },
  combo_dividends:    { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'pool', 'leg1', 'leg2', 'leg3'] },
  shadow_predictions: { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'hr_name', 'model_version'] },

  // ── 전량 (작아서 증분 이득 0) ──
  races:          { mode: 'full' },
  horses:         { mode: 'full' },
  jockey_stats:   { mode: 'full' },
  race_par_times: { mode: 'full' },
  weight_history: { mode: 'full' },
  model_versions: { mode: 'full' },

  // ── 전량 (뷰 — 날짜 키 없는 집계라 불가피) ──
  race_sectional_stats:            { mode: 'full', isView: true },
  horse_sectional_ability:         { mode: 'full', isView: true },
  horse_running_style_by_distance: { mode: 'full', isView: true },
};

/** db:pull 기본 대상 — 순서는 의존 없음(로그 가독성만 고려) */
export const ALL_TARGETS: string[] = Object.keys(TABLE_SPECS);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/db/mirror/tableSpecs.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/db/mirror/tableSpecs.ts src/db/mirror/tableSpecs.test.ts
git commit -m "feat(db): 미러 테이블별 동기화 전략 표 — 증분 5 / 전량 6 / 뷰 3

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 지문 SQL 생성 + 비교

**Files:**
- Create: `src/db/mirror/fingerprint.ts`
- Test: `src/db/mirror/fingerprint.test.ts`

**Interfaces:**
- Consumes: `IncrementalSpec` (Task 1)
- Produces: `Fingerprint {dateKey, rowCount, hash}` · `buildFingerprintSql(table, spec)` ·
  `buildRowsByDatesSql(table, spec)` · `FingerprintDiff {changed, removed, unchanged}` ·
  `diffFingerprints(source, stored)`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/mirror/fingerprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFingerprintSql, buildRowsByDatesSql, diffFingerprints, type Fingerprint } from './fingerprint.js';
import { TABLE_SPECS, type IncrementalSpec } from './tableSpecs.js';

const re = TABLE_SPECS['race_entries'] as IncrementalSpec;

describe('buildFingerprintSql', () => {
  it('날짜별 행수+md5, 정렬 키 고정, null 날짜 제외', () => {
    expect(buildFingerprintSql('race_entries', re)).toBe(
      'SELECT "race_date" AS d, count(*) AS n, ' +
      `md5(string_agg(t::text, '|' ORDER BY "meet", "rc_no", "pthr_no")) AS h ` +
      'FROM "race_entries" t WHERE "race_date" IS NOT NULL GROUP BY "race_date"'
    );
  });
});

describe('buildRowsByDatesSql', () => {
  it('날짜 목록을 파라미터로 받는다 — 페이징 없음', () => {
    expect(buildRowsByDatesSql('race_entries', re)).toBe(
      'SELECT * FROM "race_entries" WHERE "race_date" = ANY($1)'
    );
  });
});

const fp = (dateKey: number, hash: string, rowCount = 10): Fingerprint => ({ dateKey, rowCount, hash });

describe('diffFingerprints', () => {
  it('해시 같으면 그대로', () => {
    const d = diffFingerprints([fp(20260101, 'a')], [fp(20260101, 'a')]);
    expect(d).toEqual({ changed: [], removed: [], unchanged: [20260101] });
  });

  it('해시 다르면 바뀜', () => {
    const d = diffFingerprints([fp(20260101, 'b')], [fp(20260101, 'a')]);
    expect(d.changed).toEqual([20260101]);
    expect(d.unchanged).toEqual([]);
  });

  it('저장에 없으면 바뀜(신규)', () => {
    const d = diffFingerprints([fp(20260102, 'x')], []);
    expect(d.changed).toEqual([20260102]);
  });

  it('원천에 없으면 사라짐', () => {
    const d = diffFingerprints([], [fp(20260101, 'a')]);
    expect(d).toEqual({ changed: [], removed: [20260101], unchanged: [] });
  });

  it('행수만 달라도(해시 같으면) 그대로 — 해시가 판정 기준', () => {
    const d = diffFingerprints([fp(20260101, 'a', 11)], [fp(20260101, 'a', 10)]);
    expect(d.unchanged).toEqual([20260101]);
  });

  it('섞인 경우 + 결과는 날짜 오름차순', () => {
    const d = diffFingerprints(
      [fp(20260103, 'c'), fp(20260101, 'a'), fp(20260102, 'B')],
      [fp(20260101, 'a'), fp(20260102, 'b'), fp(20260104, 'd')]
    );
    expect(d.changed).toEqual([20260102, 20260103]);
    expect(d.removed).toEqual([20260104]);
    expect(d.unchanged).toEqual([20260101]);
  });

  it('양쪽 다 비면 전부 빈 배열', () => {
    expect(diffFingerprints([], [])).toEqual({ changed: [], removed: [], unchanged: [] });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/db/mirror/fingerprint.test.ts`
Expected: FAIL — `Cannot find module './fingerprint.js'`

- [ ] **Step 3: 구현**

`src/db/mirror/fingerprint.ts`:

```ts
/**
 * 날짜별 내용 지문 — 무엇이 바뀌었는지 가려내는 부분.
 *
 * ⚠️ 비교 축: **원천 지금 vs 원천 그때**다. 미러에서 해시를 재계산하면 안 된다 —
 * Postgres와 DuckDB는 같은 행을 다르게 문자열로 펴므로(숫자·날짜·jsonb 표기) 모든 날짜가
 * 영원히 "바뀜"으로 나온다. spec §5.2.
 */
import type { IncrementalSpec } from './tableSpecs.js';

export interface Fingerprint {
  dateKey: number;
  rowCount: number;
  hash: string;
}

const q = (id: string): string => `"${id}"`;

/**
 * 날짜별 (행수, md5) 한 줄씩. `t::text`는 행 전체를 문자열로 펴므로 **어느 컬럼이 바뀌어도**
 * 해시가 달라진다. 정렬 키가 흔들리면 내용이 같아도 해시가 달라지므로 PK 나머지로 고정한다.
 * 날짜가 null인 행은 증분으로 추적할 수 없어 제외한다(그런 테이블은 호출부가 전량으로 돌린다).
 */
export function buildFingerprintSql(table: string, spec: IncrementalSpec): string {
  const order = spec.orderCols.map(q).join(', ');
  return (
    `SELECT ${q(spec.dateCol)} AS d, count(*) AS n, ` +
    `md5(string_agg(t::text, '|' ORDER BY ${order})) AS h ` +
    `FROM ${q(table)} t WHERE ${q(spec.dateCol)} IS NOT NULL GROUP BY ${q(spec.dateCol)}`
  );
}

/** 바뀐 날짜들의 행을 한 번에. 페이징 없음 — 직결이라 OFFSET 재스캔이 필요 없다. */
export function buildRowsByDatesSql(table: string, spec: IncrementalSpec): string {
  return `SELECT * FROM ${q(table)} WHERE ${q(spec.dateCol)} = ANY($1)`;
}

export interface FingerprintDiff {
  /** 재적재할 날짜 (해시 다름 + 신규) */
  changed: number[];
  /** 미러에서 지울 날짜 (원천에 없음) */
  removed: number[];
  unchanged: number[];
}

export function diffFingerprints(source: Fingerprint[], stored: Fingerprint[]): FingerprintDiff {
  const storedByDate = new Map(stored.map((f) => [f.dateKey, f]));
  const changed: number[] = [];
  const unchanged: number[] = [];

  for (const s of source) {
    const prev = storedByDate.get(s.dateKey);
    if (prev && prev.hash === s.hash) unchanged.push(s.dateKey);
    else changed.push(s.dateKey);
  }

  const sourceDates = new Set(source.map((f) => f.dateKey));
  const removed = stored.map((f) => f.dateKey).filter((d) => !sourceDates.has(d));

  const asc = (a: number, b: number): number => a - b;
  return { changed: changed.sort(asc), removed: removed.sort(asc), unchanged: unchanged.sort(asc) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/db/mirror/fingerprint.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/db/mirror/fingerprint.ts src/db/mirror/fingerprint.test.ts
git commit -m "feat(db): 날짜별 내용 지문 SQL 생성 + 비교 (순수)

비교 축은 원천 지금 vs 원천 그때 — 미러에서 해시를 재계산하면 표기 차이로
영원히 전부 바뀜이 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 전량 전환 판단

**Files:**
- Create: `src/db/mirror/syncPlan.ts`
- Test: `src/db/mirror/syncPlan.test.ts`

**Interfaces:**
- Consumes: `FingerprintDiff` (Task 2)
- Produces: `FULL_RELOAD_RATIO` · `FullReason` · `SyncPlan` · `decideSyncPlan(input)`

`decideSyncPlan` 입력 타입 (후속 태스크가 이 이름 그대로 쓴다):

```ts
export interface SyncPlanInput {
  forced: boolean;          // --full
  directConnection: boolean;// DATABASE_URL 있음
  tableExistsInMirror: boolean;
  hasStoredFingerprints: boolean;
  sourceDateCount: number;  // 원천 날짜 수
  diff: FingerprintDiff;
}
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/mirror/syncPlan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideSyncPlan, FULL_RELOAD_RATIO, type SyncPlanInput } from './syncPlan.js';
import type { FingerprintDiff } from './fingerprint.js';

const diff = (changed: number[] = [], removed: number[] = [], unchanged: number[] = []): FingerprintDiff =>
  ({ changed, removed, unchanged });

const base: SyncPlanInput = {
  forced: false, directConnection: true, tableExistsInMirror: true,
  hasStoredFingerprints: true, sourceDateCount: 100, diff: diff(),
};

describe('decideSyncPlan — 전량 전환 5규칙', () => {
  it('미러에 테이블 없음 → 전량', () => {
    expect(decideSyncPlan({ ...base, tableExistsInMirror: false }))
      .toEqual({ kind: 'full', reason: 'no-table' });
  });

  it('저장된 지문 없음 → 전량', () => {
    expect(decideSyncPlan({ ...base, hasStoredFingerprints: false }))
      .toEqual({ kind: 'full', reason: 'no-fingerprints' });
  });

  it('바뀜+사라짐이 절반 초과 → 전량', () => {
    const changed = Array.from({ length: 51 }, (_, i) => i);
    expect(decideSyncPlan({ ...base, sourceDateCount: 100, diff: diff(changed) }))
      .toEqual({ kind: 'full', reason: 'too-many-changed' });
  });

  it('정확히 절반이면 증분 (초과여야 전량)', () => {
    const changed = Array.from({ length: 50 }, (_, i) => i);
    expect(decideSyncPlan({ ...base, sourceDateCount: 100, diff: diff(changed) }).kind).toBe('incremental');
  });

  it('사라짐도 절반 계산에 포함', () => {
    const changed = Array.from({ length: 30 }, (_, i) => i);
    const removed = Array.from({ length: 21 }, (_, i) => 1000 + i);
    expect(decideSyncPlan({ ...base, sourceDateCount: 100, diff: diff(changed, removed) }))
      .toEqual({ kind: 'full', reason: 'too-many-changed' });
  });

  it('--full → 전량 (다른 조건 무시)', () => {
    expect(decideSyncPlan({ ...base, forced: true }))
      .toEqual({ kind: 'full', reason: 'forced' });
  });

  it('REST 폴백(직결 없음) → 전량', () => {
    expect(decideSyncPlan({ ...base, directConnection: false }))
      .toEqual({ kind: 'full', reason: 'no-direct-connection' });
  });

  it('우선순위: --full이 다른 사유보다 앞선다', () => {
    expect(decideSyncPlan({ ...base, forced: true, tableExistsInMirror: false }))
      .toEqual({ kind: 'full', reason: 'forced' });
  });
});

describe('decideSyncPlan — 증분·건너뜀', () => {
  it('바뀐 게 없으면 건너뜀', () => {
    expect(decideSyncPlan({ ...base, diff: diff([], [], [20260101]) })).toEqual({ kind: 'skip' });
  });

  it('바뀐 날짜만 싣는다', () => {
    const plan = decideSyncPlan({ ...base, diff: diff([20260102], [20260104]) });
    expect(plan).toEqual({ kind: 'incremental', load: [20260102], remove: [20260104] });
  });

  it('사라짐만 있어도 증분(삭제만 수행)', () => {
    expect(decideSyncPlan({ ...base, diff: diff([], [20260104]) }))
      .toEqual({ kind: 'incremental', load: [], remove: [20260104] });
  });

  // Review Focus 1
  it('원천 날짜가 0개여도 0으로 나누지 않는다 — 바뀐 것 없으면 건너뜀', () => {
    expect(decideSyncPlan({ ...base, sourceDateCount: 0, diff: diff() })).toEqual({ kind: 'skip' });
  });

  // Review Focus 2
  it('원천이 통째로 비었는데 저장 지문이 있으면 전량(미러도 비운다)', () => {
    const removed = [20260101, 20260102];
    expect(decideSyncPlan({ ...base, sourceDateCount: 0, diff: diff([], removed) }))
      .toEqual({ kind: 'full', reason: 'too-many-changed' });
  });

  it('FULL_RELOAD_RATIO는 0.5', () => {
    expect(FULL_RELOAD_RATIO).toBe(0.5);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/db/mirror/syncPlan.test.ts`
Expected: FAIL — `Cannot find module './syncPlan.js'`

- [ ] **Step 3: 구현**

`src/db/mirror/syncPlan.ts`:

```ts
/** 지문 비교 결과 → "이 테이블을 어떻게 받을까" 결정. spec §5.6. */
import type { FingerprintDiff } from './fingerprint.js';

/** 바뀐 날짜 비율이 이 값을 **초과**하면 날짜별로 지우고 넣기보다 통째가 빠르다. */
export const FULL_RELOAD_RATIO = 0.5;

export type FullReason =
  | 'forced'                // --full
  | 'no-direct-connection'  // REST 폴백 — 지문 SQL을 못 돌린다
  | 'no-table'              // 미러에 테이블 없음(첫 실행)
  | 'no-fingerprints'       // _sync_state에 이 테이블 지문이 없음
  | 'too-many-changed';     // 절반 초과

export type SyncPlan =
  | { kind: 'skip' }
  | { kind: 'incremental'; load: number[]; remove: number[] }
  | { kind: 'full'; reason: FullReason };

export interface SyncPlanInput {
  forced: boolean;
  directConnection: boolean;
  tableExistsInMirror: boolean;
  hasStoredFingerprints: boolean;
  sourceDateCount: number;
  diff: FingerprintDiff;
}

export function decideSyncPlan(input: SyncPlanInput): SyncPlan {
  if (input.forced) return { kind: 'full', reason: 'forced' };
  if (!input.directConnection) return { kind: 'full', reason: 'no-direct-connection' };
  if (!input.tableExistsInMirror) return { kind: 'full', reason: 'no-table' };
  if (!input.hasStoredFingerprints) return { kind: 'full', reason: 'no-fingerprints' };

  const { changed, removed } = input.diff;
  const touched = changed.length + removed.length;
  if (touched === 0) return { kind: 'skip' };

  // 원천 날짜가 0인데 손댈 게 있다 = 원천이 통째로 비었다 → 전량으로 미러를 비운다.
  // (0으로 나누지 않는다 — Review Focus 1·2)
  if (input.sourceDateCount === 0) return { kind: 'full', reason: 'too-many-changed' };
  if (touched > input.sourceDateCount * FULL_RELOAD_RATIO) {
    return { kind: 'full', reason: 'too-many-changed' };
  }

  return { kind: 'incremental', load: changed, remove: removed };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/db/mirror/syncPlan.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/db/mirror/syncPlan.ts src/db/mirror/syncPlan.test.ts
git commit -m "feat(db): 전량 전환 판단 — 첫실행·지문없음·절반초과·--full·REST

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `_sync_state` 저장소 + 신선도 판정

**Files:**
- Create: `src/db/mirror/syncState.ts`
- Test: `src/db/mirror/syncState.test.ts`

**Interfaces:**
- Consumes: `Fingerprint` (Task 2)
- Produces: `SYNC_STATE_TABLE` · `FULL_TABLE_DATE_KEY` · `MIRROR_STALE_DAYS` ·
  `ensureSyncStateTable(conn)` · `readFingerprints(conn, table)` ·
  `writeFingerprintsSql(table, fps, syncedAt)` · `deleteFingerprintsSql(table, dateKeys)` ·
  `readLastSyncedAt(conn)` · `mirrorAgeDays(lastSyncedAt, now)` · `staleWarning(ageDays, lastSyncedAt)`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/mirror/syncState.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  ensureSyncStateTable, readFingerprints, writeFingerprintsSql, deleteFingerprintsSql,
  readLastSyncedAt, mirrorAgeDays, staleWarning, MIRROR_STALE_DAYS, FULL_TABLE_DATE_KEY,
} from './syncState.js';

let conn: any;
beforeAll(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
});

describe('mirrorAgeDays (순수)', () => {
  const now = new Date('2026-09-29T00:00:00Z');
  it('하루 전이면 1', () => {
    expect(mirrorAgeDays('2026-09-28T00:00:00Z', now)).toBe(1);
  });
  it('같은 순간이면 0', () => {
    expect(mirrorAgeDays('2026-09-29T00:00:00Z', now)).toBe(0);
  });
  it('내림 처리 — 1.9일은 1', () => {
    expect(mirrorAgeDays('2026-09-27T02:24:00Z', now)).toBe(1);
  });
  it('값이 없으면 null (구 미러 — Review Focus 4)', () => {
    expect(mirrorAgeDays(null, now)).toBeNull();
  });
  it('파싱 불가도 null', () => {
    expect(mirrorAgeDays('nonsense', now)).toBeNull();
  });
});

describe('staleWarning (순수)', () => {
  it('임계 이하면 경고 없음', () => {
    expect(staleWarning(MIRROR_STALE_DAYS, '2026-09-26T00:00:00Z')).toBeNull();
  });
  it('임계 초과면 일수와 마지막 시각을 담은 문구', () => {
    const w = staleWarning(79, '2026-07-10T12:31:00Z');
    expect(w).toContain('79일');
    expect(w).toContain('2026-07-10');
    expect(w).toContain('db:pull');
  });
  it('null(구 미러)이면 경고 없음 — 판단 근거가 없다', () => {
    expect(staleWarning(null, null)).toBeNull();
  });
  it('MIRROR_STALE_DAYS는 3 — 주말 하나를 놓치면 알려준다', () => {
    expect(MIRROR_STALE_DAYS).toBe(3);
  });
});

describe('_sync_state 저장소 (DuckDB)', () => {
  it('없으면 만들고, 두 번 불러도 안전', async () => {
    await ensureSyncStateTable(conn);
    await ensureSyncStateTable(conn);
    const r = await conn.runAndReadAll(
      "SELECT count(*) n FROM information_schema.tables WHERE table_name = '_sync_state'"
    );
    expect(Number((r.getRowObjects()[0] as any).n)).toBe(1);
  });

  it('구 미러(테이블 없음)에서 읽어도 터지지 않고 빈 결과 — Review Focus 4', async () => {
    const fresh = await (await DuckDBInstance.create(':memory:')).connect();
    expect(await readFingerprints(fresh, 'race_entries')).toEqual([]);
    expect(await readLastSyncedAt(fresh)).toBeNull();
  });

  it('쓰고 읽으면 같은 지문이 나온다', async () => {
    await ensureSyncStateTable(conn);
    const fps = [
      { dateKey: 20260101, rowCount: 10, hash: 'aaa' },
      { dateKey: 20260102, rowCount: 20, hash: 'bbb' },
    ];
    for (const sql of writeFingerprintsSql('race_entries', fps, '2026-09-29T01:00:00Z')) {
      await conn.run(sql);
    }
    const got = await readFingerprints(conn, 'race_entries');
    expect(got).toEqual(fps);
  });

  it('다른 테이블 지문과 섞이지 않는다', async () => {
    await ensureSyncStateTable(conn);
    for (const sql of writeFingerprintsSql('predictions', [{ dateKey: 20260101, rowCount: 5, hash: 'zzz' }], '2026-09-29T01:00:00Z')) {
      await conn.run(sql);
    }
    const re = await readFingerprints(conn, 'race_entries');
    expect(re.find((f) => f.hash === 'zzz')).toBeUndefined();
  });

  it('삭제 SQL이 지정 날짜만 지운다', async () => {
    await ensureSyncStateTable(conn);
    await conn.run(deleteFingerprintsSql('race_entries', [20260101]));
    const got = await readFingerprints(conn, 'race_entries');
    expect(got.map((f) => f.dateKey)).toEqual([20260102]);
  });

  it('빈 목록 삭제는 아무것도 안 지우는 SQL', async () => {
    await ensureSyncStateTable(conn);
    await conn.run(deleteFingerprintsSql('race_entries', []));
    expect(await readFingerprints(conn, 'race_entries')).toHaveLength(1);
  });

  it('전량 테이블은 date_key=-1 한 줄', async () => {
    await ensureSyncStateTable(conn);
    for (const sql of writeFingerprintsSql('races', [{ dateKey: FULL_TABLE_DATE_KEY, rowCount: 8214, hash: 'full' }], '2026-09-29T02:00:00Z')) {
      await conn.run(sql);
    }
    const got = await readFingerprints(conn, 'races');
    expect(got).toEqual([{ dateKey: -1, rowCount: 8214, hash: 'full' }]);
  });

  it('readLastSyncedAt은 전체에서 가장 최근', async () => {
    const last = await readLastSyncedAt(conn);
    expect(last).not.toBeNull();
    expect(Date.parse(last!)).toBe(Date.parse('2026-09-29T02:00:00Z'));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/db/mirror/syncState.test.ts`
Expected: FAIL — `Cannot find module './syncState.js'`

- [ ] **Step 3: 구현**

`src/db/mirror/syncState.ts`:

```ts
/**
 * 미러 안 `_sync_state` — 원천이 준 날짜별 지문을 그대로 보관한다.
 * 다음 pull이 "원천 지금"을 여기 있는 "원천 그때"와 비교한다. spec §5.3.
 */
import type { Fingerprint } from './fingerprint.js';

export const SYNC_STATE_TABLE = '_sync_state';
/** 전량 테이블의 date_key — "마지막 전량 적재 시각" 한 줄만 남긴다 */
export const FULL_TABLE_DATE_KEY = -1;
/** 경마가 금·토·일 중심이라 3일이면 주말 하나를 놓쳤을 때 반드시 경고가 뜬다 */
export const MIRROR_STALE_DAYS = 3;

const esc = (s: string): string => s.replace(/'/g, "''");

export async function ensureSyncStateTable(conn: any): Promise<void> {
  await conn.run(`CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (
    table_name VARCHAR   NOT NULL,
    date_key   BIGINT    NOT NULL,
    row_count  BIGINT    NOT NULL,
    hash       VARCHAR   NOT NULL,
    synced_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (table_name, date_key)
  )`);
}

async function hasSyncState(conn: any): Promise<boolean> {
  const r = await conn.runAndReadAll(
    `SELECT count(*) n FROM information_schema.tables WHERE table_name = '${SYNC_STATE_TABLE}'`
  );
  return Number((r.getRowObjects()[0] as { n: bigint | number }).n) > 0;
}

/** 구 미러(테이블 없음)에서도 터지지 않고 빈 배열을 준다. */
export async function readFingerprints(conn: any, table: string): Promise<Fingerprint[]> {
  if (!await hasSyncState(conn)) return [];
  const r = await conn.runAndReadAll(
    `SELECT date_key, row_count, hash FROM ${SYNC_STATE_TABLE} WHERE table_name = '${esc(table)}' ORDER BY date_key`
  );
  return (r.getRowObjects() as Array<{ date_key: bigint; row_count: bigint; hash: string }>).map((x) => ({
    dateKey: Number(x.date_key),
    rowCount: Number(x.row_count),
    hash: x.hash,
  }));
}

/** 미러 전체에서 가장 최근 동기화 시각(ISO). 구 미러면 null. */
export async function readLastSyncedAt(conn: any): Promise<string | null> {
  if (!await hasSyncState(conn)) return null;
  const r = await conn.runAndReadAll(`SELECT max(synced_at) AS m FROM ${SYNC_STATE_TABLE}`);
  const m = (r.getRowObjects()[0] as { m: unknown }).m;
  if (m == null) return null;
  // DuckDBTimestampValue{micros} → ISO (localDb.unwrapDuck과 같은 규칙)
  const micros = (m as { micros?: bigint }).micros;
  if (typeof micros === 'bigint') return new Date(Number(micros / 1000n)).toISOString();
  return String(m);
}

/** 트랜잭션 안에서 순서대로 실행할 SQL들. 지우고 다시 넣는다(멱등). */
export function writeFingerprintsSql(table: string, fps: Fingerprint[], syncedAtIso: string): string[] {
  if (fps.length === 0) return [];
  const keys = fps.map((f) => f.dateKey);
  const values = fps
    .map((f) => `('${esc(table)}', ${f.dateKey}, ${f.rowCount}, '${esc(f.hash)}', TIMESTAMP '${esc(syncedAtIso.replace('T', ' ').replace('Z', ''))}')`)
    .join(', ');
  return [
    deleteFingerprintsSql(table, keys),
    `INSERT INTO ${SYNC_STATE_TABLE} (table_name, date_key, row_count, hash, synced_at) VALUES ${values}`,
  ];
}

export function deleteFingerprintsSql(table: string, dateKeys: number[]): string {
  if (dateKeys.length === 0) return `SELECT 1`; // 아무것도 안 지운다
  return `DELETE FROM ${SYNC_STATE_TABLE} WHERE table_name = '${esc(table)}' AND date_key IN (${dateKeys.join(', ')})`;
}

/** 마지막 동기화로부터 지난 일수(내림). 모르면 null. */
export function mirrorAgeDays(lastSyncedAtIso: string | null, now: Date): number | null {
  if (!lastSyncedAtIso) return null;
  const t = Date.parse(lastSyncedAtIso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** 임계 초과일 때만 경고 문구. 막지 않는다 — 백테스트는 일부러 과거 미러로 돌린다. */
export function staleWarning(ageDays: number | null, lastSyncedAtIso: string | null): string | null {
  if (ageDays === null || ageDays <= MIRROR_STALE_DAYS) return null;
  const when = lastSyncedAtIso ? lastSyncedAtIso.slice(0, 10) : '알 수 없음';
  return `⚠️ 미러가 ${ageDays}일 묵었습니다 (마지막 db:pull: ${when})\n` +
         `   최신 결과가 필요하면 npm run db:pull 먼저 실행하세요`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/db/mirror/syncState.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/db/mirror/syncState.ts src/db/mirror/syncState.test.ts
git commit -m "feat(db): _sync_state 저장소 + 미러 신선도 판정 (임계 3일)

구 미러(테이블 없음)에서도 터지지 않고 빈 결과를 준다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `sync_local_db.ts` 재배선

**Files:**
- Modify: `scripts/sync_local_db.ts` (전면 재작성)
- Test: Task 7의 통합 테스트가 덮는다 (이 태스크는 실행으로 검증)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: `npm run db:pull [-- --table X] [-- --full]`

- [ ] **Step 1: 페이징 제거 + 전량 경로부터 (증분 전)**

`fetchAllPg`를 단일 쿼리로 바꾸고 `TABLES`/`VIEWS`를 `ALL_TARGETS`로 교체한다.

```ts
// 삭제: PAGE 상수, fetchAllPg의 LIMIT/OFFSET 루프
async function fetchAllPg(pgClient: any, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  // 직결이라 페이징이 필요 없다. OFFSET은 건너뛸 행을 매번 다시 세므로
  // training_logs 377페이지에서 누적 7,100만 행을 헛스캔했다.
  const res = await pgClient.query(sql, params);
  return res.rows;
}
```

`fetchAllRest`는 **그대로 둔다** — PostgREST 1000행 상한 때문에 페이징이 필수다.

- [ ] **Step 2: 실행해 전량 경로가 깨지지 않았는지 확인**

Run: `npm run db:pull -- --table races`
Expected: `✅ 8214행` (또는 현재 원천 행수), 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add scripts/sync_local_db.ts
git commit -m "perf(db): 직결 경로 LIMIT/OFFSET 페이징 제거 + 빠진 테이블 2개 추가

OFFSET은 건너뛸 행을 매번 처음부터 세고 버린다. training_logs 376k를
1000행씩 377회 받으면 누적 7,100만 행을 헛스캔한다. 직결에선 불필요.
REST 폴백은 PostgREST 1000행 상한 때문에 페이징을 유지한다.

combo_dividends·shadow_predictions를 복사 목록에 추가하고,
race_sectional_stats를 뷰 쪽으로 라벨 정정(동작 동일).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 증분 경로 추가**

`dumpTable`을 전략 분기로 바꾼다. 핵심 골격:

```ts
async function syncOne(conn: any, pgClient: any, table: string, forced: boolean): Promise<void> {
  const spec = TABLE_SPECS[table];
  if (!spec) throw new Error(`알 수 없는 테이블: ${table}`);
  const direct = pgClient !== null;

  if (!isIncremental(spec) || !direct) {
    await fullReload(conn, pgClient, table);
    return;
  }

  // 1) 원천 지문
  const fpRows = await fetchAllPg(pgClient, buildFingerprintSql(table, spec));
  const source: Fingerprint[] = fpRows.map((r: any) => ({
    dateKey: Number(r.d), rowCount: Number(r.n), hash: String(r.h),
  }));

  // 2) 저장된 지문 + 미러에 테이블이 있는지
  const stored = await readFingerprints(conn, table);
  const exists = await tableExistsInMirror(conn, table);

  // 3) 계획
  const plan = decideSyncPlan({
    forced, directConnection: true, tableExistsInMirror: exists,
    hasStoredFingerprints: stored.length > 0,
    sourceDateCount: source.length,
    diff: diffFingerprints(source, stored),
  });

  if (plan.kind === 'skip') { console.log('(바뀐 날짜 없음)'); return; }
  if (plan.kind === 'full') { await fullReload(conn, pgClient, table, source); return; }

  await incrementalLoad(conn, pgClient, table, spec, plan, source);
}
```

`incrementalLoad`는 **한 트랜잭션**으로:

```ts
const rows = plan.load.length > 0
  ? await fetchAllPg(pgClient, buildRowsByDatesSql(table, spec), [plan.load])
  : [];
const tmp = writeTmpJson(table, rows);           // 기존 dumpTable과 같은 방식
const syncedAt = new Date().toISOString();
const touched = [...plan.load, ...plan.remove];

await conn.run('BEGIN');
try {
  if (touched.length > 0) {
    await conn.run(`DELETE FROM "${table}" WHERE "${spec.dateCol}" IN (${touched.join(', ')})`);
  }
  if (rows.length > 0) {
    await conn.run(`INSERT INTO "${table}" BY NAME SELECT * FROM read_json_auto('${tmp}')`);
  }
  await conn.run(deleteFingerprintsSql(table, plan.remove));
  const loadedFps = source.filter((f) => plan.load.includes(f.dateKey));
  for (const sql of writeFingerprintsSql(table, loadedFps, syncedAt)) await conn.run(sql);
  await conn.run('COMMIT');
} catch (e) {
  await conn.run('ROLLBACK');
  // 타입 추론 불일치 등 → 전량 폴백 (조용히 넘어가지 않는다, spec §8.1)
  console.warn(`    ⚠️ 증분 적재 실패 → 전량으로 폴백: ${(e as Error).message}`);
  await fullReload(conn, pgClient, table, source);
} finally { unlinkSync(tmp); }
```

`fullReload`는 기존 `dumpTable` 로직 + 끝나고 지문 저장:

```ts
// 전량 후: 증분 가능 테이블이면 받아둔 지문을, 아니면 date_key=-1 한 줄을 남긴다.
// ⚠️ REST 폴백에선 지문을 건드리지 않는다 (spec §5.6) — 지문 SQL을 못 돌린다.
```

- [ ] **Step 5: 첫 실행 — 전량 + 지문 생성**

Run: `npm run db:pull -- --table race_entries`
Expected: `전량(no-fingerprints)` 표시 + 행수 출력

- [ ] **Step 6: 두 번째 실행 — 건너뜀**

Run: `npm run db:pull -- --table race_entries`
Expected: `(바뀐 날짜 없음)` — 행을 하나도 받지 않는다

- [ ] **Step 7: 커밋**

```bash
git add scripts/sync_local_db.ts
git commit -m "feat(db): db:pull 증분 동기화 — 바뀐 날짜만 재적재

날짜별 내용 해시를 원천에서 받아 _sync_state의 지난 지문과 비교하고,
바뀐 날짜만 한 트랜잭션으로 DELETE→INSERT BY NAME→지문 갱신한다.
증분 적재가 실패하면 조용히 넘어가지 않고 전량으로 폴백하며 경고한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 신선도 경고 + 잠금 안내

**Files:**
- Modify: `src/db/localDb.ts` (`getLocalDb`)
- Test: `src/db/localDb.test.ts` (추가)

**Interfaces:**
- Consumes: `readLastSyncedAt` · `mirrorAgeDays` · `staleWarning` (Task 4)
- Produces: 없음 (동작 변경)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/db/localDb.test.ts`에 추가:

```ts
describe('잠금 에러 메시지', () => {
  it('IO 에러를 원인 설명으로 감싼다 — PID가 자기 자신일 수 있다고 알려준다', () => {
    const msg = explainOpenError(new Error(
      'IO Error: Cannot open file "data/local.duckdb": 다른 프로세스가 파일을 사용 중입니다.\nFile is already open in node.exe (PID 12345)'
    ));
    expect(msg).toContain('PID 12345');
    expect(msg).toContain('자기 자신');   // db:pull 직후·동시 호출
    expect(msg).toContain('워크트리');
  });

  it('잠금과 무관한 에러는 그대로 통과', () => {
    const e = new Error('something else');
    expect(explainOpenError(e)).toBe(e.message);
  });
});
```

`explainOpenError`를 `localDb.ts`에서 export 하고 테스트 import에 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/db/localDb.test.ts`
Expected: FAIL — `explainOpenError is not a function`

- [ ] **Step 3: 구현**

`src/db/localDb.ts`:

```ts
/**
 * DuckDB는 writer가 하나뿐이라 파일이 열려 있으면 IO 에러로 죽는다.
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
    '  3) 다른 워크트리/세션에서 미러를 쓰는 중.',
    `원본: ${e.message}`,
  ].join('\n');
}
```

`getLocalDb` 안에서 `DuckDBInstance.create`를 try/catch로 감싸 `explainOpenError`로 던지고,
연결 직후 신선도를 확인한다:

```ts
const client = makeLocalClient(await instance.connect());
const last = await readLastSyncedAt(conn);
const warn = staleWarning(mirrorAgeDays(last, new Date()), last);
if (warn && process.env.MIRROR_STALE_WARN !== 'off') console.warn(warn);
return client;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/db/localDb.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/db/localDb.ts src/db/localDb.test.ts
git commit -m "feat(db): 미러 신선도 경고 + 잠금 에러 원인 안내

경고만 하고 막지 않는다 — 백테스트는 일부러 과거 미러로 돌린다.
잠금 메시지에 'PID가 자기 자신일 수 있다'를 넣었다(2026-09-27 실제 사례 2건).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 증분 왕복 통합 테스트

**Files:**
- Create: `src/db/mirror/incrementalLoad.test.ts`

**Interfaces:**
- Consumes: Task 1~4 + Task 5가 노출하는 적재 함수

Task 5의 `incrementalLoad` 핵심 부분을 `src/db/mirror/load.ts`로 빼서 테스트 가능하게 한다
(`applyIncremental(conn, table, dateCol, {load, remove}, rowsJsonPath, fingerprints, syncedAt)`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('증분 적재 왕복', () => {
  it('바뀐 날짜만 교체하고 다른 날짜는 건드리지 않는다', async () => {
    // 20260101(2행) · 20260102(2행) 적재 → 20260102만 내용 바꿔 재적재
    // → 20260101 행은 그대로(값·개수), 20260102만 새 값
  });

  it('사라진 날짜는 미러에서도 지워진다', async () => { /* ... */ });

  it('실패하면 롤백돼 데이터·지문이 둘 다 이전 상태', async () => {
    // INSERT가 깨지는 JSON을 주고, 트랜잭션 후 행수·지문이 불변인지 확인
  });

  // Review Focus 5 — spec §8
  it('시각·jsonb 컬럼이 증분 적재 뒤에도 같은 모양(ISO 문자열·평범한 객체)', async () => {
    // created_at TIMESTAMP + payload STRUCT 컬럼을 넣고
    // makeLocalClient로 읽어 typeof created_at === 'string', payload.k === 'v' 확인
  });

  it('BY NAME — 컬럼 순서가 달라도 값이 제자리에 들어간다', async () => {
    // JSON 키 순서를 테이블과 다르게 만들어 확인
  });
});
```

- [ ] **Step 2~4:** 실패 확인 → `load.ts` 추출 → 통과 확인

Run: `npx vitest run src/db/mirror/incrementalLoad.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add src/db/mirror/load.ts src/db/mirror/incrementalLoad.test.ts scripts/sync_local_db.ts
git commit -m "test(db): 증분 적재 왕복 — 부분 교체·삭제·롤백·값 모양 보존

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 전체 검증 + 문서 갱신

**Files:**
- Modify: `docs/pipeline_guide.md` · `docs/status/05-data-infra.md` · `TODO.md`

- [ ] **Step 1: 전체 테스트·타입체크**

Run: `npm run test:run` → 전부 통과
Run: `npm run build` → 에러 없음

- [ ] **Step 2: 실제 2회 실행 검증 (spec §11)**

```bash
npm run db:pull          # 1회차: 전량 + 지문 생성
npm run db:pull          # 2회차: 전 증분 테이블 "바뀐 날짜 없음"
```

Expected 2회차: 증분 5개 전부 건너뜀, 전량 9개만 받음

- [ ] **Step 3: 행수 일치 확인**

미러 행수 = 원천 행수 (`race_entries`·`predictions`·`training_logs` 3개 표본)

- [ ] **Step 4: 문서 갱신**

- `docs/pipeline_guide.md` — db:pull 절에 증분 동작·`--full`·복사 테이블 14개 반영
- `docs/status/05-data-infra.md` — 증분 도입 한 줄 + 마지막 업데이트 날짜
- `TODO.md` — T-014 완료 표시 + 실측 효과

- [ ] **Step 5: 커밋**

```bash
git add docs TODO.md
git commit -m "docs: db:pull 증분 반영 (T-014 완료)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**

| spec 절 | 태스크 |
|---|---|
| §3.1 페이징 제거 | Task 5 Step 1 |
| §4 테이블 전략 | Task 1 |
| §5.1 지문 SQL | Task 2 |
| §5.2 비교 축 | Task 2 (주석·설계) |
| §5.3 `_sync_state` | Task 4 |
| §5.4 판정 | Task 2 `diffFingerprints` |
| §5.5 트랜잭션 적재 | Task 5 Step 4 · Task 7 |
| §5.6 전량 전환 5규칙 | Task 3 |
| §6 모듈 구조 | Task 1~4 파일 배치 |
| §7.1 신선도 경고 | Task 4(판정) · Task 6(연결) |
| §7.2 잠금 안내 | Task 6 |
| §7.3 빠진 테이블 2개 | Task 1 · Task 5 Step 1 |
| §8 값 모양 보존 | Task 5 Step 4(폴백) · Task 7(테스트) |
| §9 테스트 | 각 태스크 |
| §11 검증 기준 | Task 8 |

**2. 플레이스홀더** — Task 7의 테스트 본문이 주석 스케치다. 구현 시 실제 코드로 채운다
(다른 태스크는 전부 실제 코드).

**3. 타입 일관성** — `Fingerprint`(Task 2 정의)를 Task 4가 그대로 쓴다. `FingerprintDiff`를
Task 3이 그대로 쓴다. `SyncPlanInput` 필드명이 Task 5 호출부와 일치.

**4. Review Focus** — 5개 전부 담당 태스크에 테스트가 있다(1·2→Task 3, 3→Task 2+5, 4→Task 4,
5→Task 7).
