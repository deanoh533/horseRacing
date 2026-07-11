# 런치 게이팅 운영 기반 (L-002~005) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sync 무인 자동화(GitHub Actions cron) + 실패·0건 이메일 알림 + 재학습 동결 정책 문서화 + predictions 스냅샷 백업으로 v7 라이브 추적을 운영 수준으로 만든다.

**Architecture:** 순수 헬퍼(날짜 오프셋·0건 판정)를 `src/utils/syncCli.ts`로 분리해 TDD하고, 두 sync CLI(main)에 와이어링한다. 워크플로우 1개(`sync.yml`)가 cron 2개로 두 잡을 나눠 실행한다. 스냅샷은 `DATABASE_URL` Postgres 직결(egress 무관)로 DB 안에 테이블 복사한다.

**Tech Stack:** Node 20 + TypeScript(ESM, import에 `.js` 확장자) · tsx · vitest · GitHub Actions · pg(동적 import)

**스펙:** `docs/superpowers/specs/2026-07-11-launch-gating-ops-design.md`

## Global Constraints

- 브랜치: `feat/launch-gating-ops` (이미 생성됨, 스펙 커밋 f59f817 포함)
- 커밋 메시지: 한국어 + scope (`feat(x)`/`fix(x)`/`docs:`), 끝에 하네스 규칙 푸터(Co-Authored-By / Claude-Session) 추가
- 매 커밋 전: `npm run build` (tsc 타입체크) + `npm run test:run` 통과
- 기존 CLI 동작 불변: `--date`/`--meet` 명시 시 동작 그대로, `--fail-on-empty` 미지정 시 기존과 동일
- KRA API를 호출하는 실행(sync 실제 구동)은 Claude가 하지 않는다 — 검증 Task 7의 해당 단계는 사용자 실행
- 워크플로우 필수 env: `TZ: Asia/Seoul`(러너는 UTC — 없으면 "어제/오늘+2" 계산이 하루 어긋남), `DB_SOURCE: supabase`(러너엔 DuckDB 미러 없음)

---

### Task 1: 날짜 오프셋·0건 판정 헬퍼 (`src/utils/syncCli.ts`)

**Files:**
- Create: `src/utils/syncCli.ts`
- Test: `src/utils/syncCli.test.ts`

**Interfaces:**
- Produces: `yyyymmddOffset(offsetDays: number, now?: Date): number` — 시스템 TZ 기준 now+offsetDays를 YYYYMMDD 정수로. `isEmptySync(results: Array<{ racesSynced: number }>): boolean` — 전 meet 합계 0건이면 true. Task 2·3이 이 두 함수를 import한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/utils/syncCli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { yyyymmddOffset, isEmptySync } from './syncCli.js';

describe('yyyymmddOffset', () => {
  it('+2일: 수요일 발표 → 금요일 경주', () => {
    expect(yyyymmddOffset(2, new Date(2026, 6, 8))).toBe(20260710); // 2026-07-08(수) → 07-10(금)
  });

  it('-1일: 결과 sync의 어제', () => {
    expect(yyyymmddOffset(-1, new Date(2026, 6, 11))).toBe(20260710);
  });

  it('월 경계를 넘는다', () => {
    expect(yyyymmddOffset(2, new Date(2026, 6, 30))).toBe(20260801); // 07-30 → 08-01
  });

  it('연 경계를 넘는다', () => {
    expect(yyyymmddOffset(2, new Date(2026, 11, 30))).toBe(20270101); // 12-30 → 01-01
  });

  it('now 생략 시 오늘 기준으로 8자리 정수를 낸다', () => {
    const v = yyyymmddOffset(0);
    expect(String(v)).toMatch(/^20\d{6}$/);
  });
});

describe('isEmptySync', () => {
  it('전 meet 0건이면 true', () => {
    expect(isEmptySync([{ racesSynced: 0 }, { racesSynced: 0 }])).toBe(true);
  });

  it('한 meet라도 1건 이상이면 false', () => {
    expect(isEmptySync([{ racesSynced: 0 }, { racesSynced: 3 }])).toBe(false);
  });

  it('빈 배열이면 true (아무 것도 처리 못함)', () => {
    expect(isEmptySync([])).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/utils/syncCli.test.ts`
Expected: FAIL — `Cannot find module './syncCli.js'` 류의 로드 에러

- [ ] **Step 3: 최소 구현**

`src/utils/syncCli.ts`:

```ts
/**
 * sync CLI 공통 헬퍼 — 날짜 기본값 계산 + 0건(조용한 실패) 판정
 *
 * 날짜는 시스템 TZ 기준(Date 로컬 필드 사용). GitHub Actions에서는
 * 워크플로우 env `TZ: Asia/Seoul`이 이를 KST로 고정한다.
 */

/** now + offsetDays를 YYYYMMDD 정수로 반환 */
export function yyyymmddOffset(offsetDays: number, now: Date = new Date()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** 전 meet의 동기화 경주 합계가 0건인지 (--fail-on-empty 판정) */
export function isEmptySync(results: Array<{ racesSynced: number }>): boolean {
  return results.reduce((sum, r) => sum + r.racesSynced, 0) === 0;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/utils/syncCli.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/syncCli.ts src/utils/syncCli.test.ts
git commit -m "feat(sync): 날짜 오프셋·0건 판정 헬퍼 syncCli 추가 — CLI 자동화 기본값용"
```

---

### Task 2: raceCardSync 기본 날짜(+2일)와 `--fail-on-empty`

**Files:**
- Modify: `src/sync/raceCardSync.ts:211-249` (CLI `main()` 부분과 파일 상단 usage 주석)

**Interfaces:**
- Consumes: Task 1의 `yyyymmddOffset`, `isEmptySync`
- Produces: CLI 동작 — `npm run sync:cards` 인자 없이 실행하면 오늘+2일 대상. `--fail-on-empty` 지정 시 0건이면 exit 1. Task 5의 워크플로우가 이 동작에 의존한다.

- [ ] **Step 1: main() 수정**

현재 코드 (src/sync/raceCardSync.ts:214-240):

```ts
async function main() {
  const args = process.argv.slice(2);
  let rcDate = 0;
  let meets: MeetCode[] = [1, 3];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      rcDate = parseInt(args[i + 1]!, 10);
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
    }
  }

  if (!rcDate) {
    console.error('Usage: tsx src/sync/raceCardSync.ts --date YYYYMMDD [--meet 1,3]');
    process.exit(1);
  }

  const results = await syncRaceCards({ rcDate, meets });
  console.log('\n' + '='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} races / ${r.horsesSynced} horses / ${r.errors.length} errors`);
  }
}
```

다음으로 교체 (파일 상단 import 블록에 `import { yyyymmddOffset, isEmptySync } from '../utils/syncCli.js';` 추가):

```ts
async function main() {
  const args = process.argv.slice(2);
  let rcDate = 0;
  let meets: MeetCode[] = [1, 3];
  let failOnEmpty = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      rcDate = parseInt(args[i + 1]!, 10);
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
    } else if (args[i] === '--fail-on-empty') {
      failOnEmpty = true;
    }
  }

  if (!rcDate) {
    // 출마표 발표일 → 경주일은 항상 +2일 (수 발표=금경, 목=토경, 금=일경)
    rcDate = yyyymmddOffset(2);
    console.log(`📅 날짜 인자 없음 → 이틀 뒤(${rcDate})로 자동 설정 (발표일+2)`);
  }

  const results = await syncRaceCards({ rcDate, meets });
  console.log('\n' + '='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} races / ${r.horsesSynced} horses / ${r.errors.length} errors`);
  }

  if (failOnEmpty && isEmptySync(results)) {
    console.error('❌ --fail-on-empty: 동기화된 경주 0건 (휴장일이거나 KRA 빈 응답)');
    process.exit(1);
  }
}
```

- [ ] **Step 2: 파일 상단 usage 주석 갱신**

파일 상단 주석의 `tsx src/sync/raceCardSync.ts --date 20260530` 예시 아래에 한 줄 추가:

```
 *   tsx src/sync/raceCardSync.ts                    # 날짜 생략 → 오늘+2일 (발표일+2)
 *   tsx src/sync/raceCardSync.ts --fail-on-empty    # 0건이면 exit 1 (자동화용)
```

- [ ] **Step 3: 타입체크·전체 테스트**

Run: `npm run build && npm run test:run`
Expected: 둘 다 통과 (기존 테스트 깨짐 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/sync/raceCardSync.ts
git commit -m "feat(raceCardSync): 날짜 기본값 오늘+2일 + --fail-on-empty — Actions 자동화 전제"
```

---

### Task 3: dailySync 어제 계산 헬퍼 전환 + `--fail-on-empty`

**Files:**
- Modify: `src/sync/dailySync.ts:364-403` (CLI `main()` 부분과 파일 상단 usage 주석)

**Interfaces:**
- Consumes: Task 1의 `yyyymmddOffset`, `isEmptySync`
- Produces: CLI 동작 — `npm run sync` 인자 없이 실행하면 어제 대상(기존과 동일 결과, 계산만 헬퍼로). `--fail-on-empty` 지정 시 0건이면 exit 1.

- [ ] **Step 1: main() 수정**

현재 코드 (src/sync/dailySync.ts:367-403):

```ts
async function main() {
  const args = process.argv.slice(2);
  let rcDate = 0;
  let meets: MeetCode[] = [1, 3];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      rcDate = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
      i++;
    }
  }

  if (!rcDate) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    rcDate =
      yesterday.getFullYear() * 10000 +
      (yesterday.getMonth() + 1) * 100 +
      yesterday.getDate();
    console.log(`📅 날짜 인자 없음 → 어제(${rcDate})로 자동 설정`);
  }

  const results = await syncDay({ rcDate, meets });

  console.log('\n' + '='.repeat(50));
  console.log('📊 동기화 결과 요약');
  console.log('='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} 경주 / ${r.horsesSynced} 두 / 에러 ${r.errors.length}`);
  }
}
```

다음으로 교체 (파일 상단 import 블록에 `import { yyyymmddOffset, isEmptySync } from '../utils/syncCli.js';` 추가):

```ts
async function main() {
  const args = process.argv.slice(2);
  let rcDate = 0;
  let meets: MeetCode[] = [1, 3];
  let failOnEmpty = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      rcDate = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
      i++;
    } else if (args[i] === '--fail-on-empty') {
      failOnEmpty = true;
    }
  }

  if (!rcDate) {
    rcDate = yyyymmddOffset(-1);
    console.log(`📅 날짜 인자 없음 → 어제(${rcDate})로 자동 설정`);
  }

  const results = await syncDay({ rcDate, meets });

  console.log('\n' + '='.repeat(50));
  console.log('📊 동기화 결과 요약');
  console.log('='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} 경주 / ${r.horsesSynced} 두 / 에러 ${r.errors.length}`);
  }

  if (failOnEmpty && isEmptySync(results)) {
    console.error('❌ --fail-on-empty: 동기화된 경주 0건 (휴장일이거나 KRA 빈 응답)');
    process.exit(1);
  }
}
```

- [ ] **Step 2: 파일 상단 usage 주석 갱신**

파일 상단 usage 주석에 한 줄 추가:

```
 *   tsx src/sync/dailySync.ts --fail-on-empty   # 0건이면 exit 1 (자동화용)
```

- [ ] **Step 3: 타입체크·전체 테스트**

Run: `npm run build && npm run test:run`
Expected: 둘 다 통과

- [ ] **Step 4: 커밋**

```bash
git add src/sync/dailySync.ts
git commit -m "feat(dailySync): 어제 계산 syncCli 헬퍼 전환 + --fail-on-empty"
```

---

### Task 4: predictions 스냅샷 스크립트 (`npm run db:snapshot`)

**Files:**
- Create: `scripts/snapshot_predictions.ts`
- Test: `scripts/snapshot_predictions.test.ts`
- Modify: `package.json` (scripts에 `"db:snapshot": "tsx scripts/snapshot_predictions.ts"` 추가 — `"db:pull"` 줄 아래)

**Interfaces:**
- Consumes: `.env`의 `DATABASE_URL` (Postgres 직결 — egress 무관, `scripts/sync_local_db.ts:107-118`과 같은 연결 패턴)
- Produces: DB에 `predictions_snapshot_YYYYMMDD` 테이블. export 순수 함수 `snapshotTableName(now?: Date): string`, `tablesToPrune(names: string[], keep: number): string[]` (테스트가 import).

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/snapshot_predictions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { snapshotTableName, tablesToPrune } from './snapshot_predictions.js';

describe('snapshotTableName', () => {
  it('predictions_snapshot_YYYYMMDD 형식', () => {
    expect(snapshotTableName(new Date(2026, 6, 12))).toBe('predictions_snapshot_20260712');
  });
});

describe('tablesToPrune', () => {
  const names = [
    'predictions_snapshot_20260701',
    'predictions_snapshot_20260712',
    'predictions_snapshot_20260615',
  ];

  it('최신 keep개를 남기고 오래된 것을 반환', () => {
    expect(tablesToPrune(names, 2)).toEqual(['predictions_snapshot_20260615']);
  });

  it('keep이 전체 이상이면 빈 배열', () => {
    expect(tablesToPrune(names, 5)).toEqual([]);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const copy = [...names];
    tablesToPrune(names, 1);
    expect(names).toEqual(copy);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run scripts/snapshot_predictions.test.ts`
Expected: FAIL — 모듈 없음 로드 에러

- [ ] **Step 3: 구현**

`scripts/snapshot_predictions.ts`:

```ts
/**
 * db:snapshot — predictions 스냅샷 (재학습·백필 등 대량 쓰기 전 안전장치)
 *
 * DATABASE_URL Postgres 직결(egress 무관)로 DB 안에 테이블 복사:
 *   CREATE TABLE predictions_snapshot_YYYYMMDD AS SELECT * FROM predictions
 *
 * Usage:
 *   npm run db:snapshot                 # 오늘 이름으로 생성 (이미 있으면 유지·종료)
 *   npm run db:snapshot -- --force      # 같은 날 스냅샷 교체
 *   npm run db:snapshot -- --prune 3    # 최신 3개만 남기고 오래된 스냅샷 삭제
 *
 * 복원 절차(수동 SQL)는 docs/pipeline_guide.md 참고.
 */
import 'dotenv/config';

export function snapshotTableName(now: Date = new Date()): string {
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return `predictions_snapshot_${ymd}`;
}

/** 이름(=날짜) 내림차순 정렬 후 최신 keep개를 제외한 나머지 반환 */
export function tablesToPrune(names: string[], keep: number): string[] {
  return [...names].sort().reverse().slice(Math.max(keep, 0));
}

async function connectPg() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 필요 (.env) — Supabase Postgres 직결 문자열');
  }
  const pgModule = (await import('pg')) as any;
  const { Client } = pgModule.default ?? pgModule;
  // ## → %23%23 URL 인코딩 (pg URL 파서 호환 — sync_local_db.ts와 동일)
  const connStr = process.env.DATABASE_URL.replace(/##/g, '%23%23');
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  let prune = 0;
  const pruneIdx = args.indexOf('--prune');
  if (pruneIdx >= 0 && args[pruneIdx + 1]) {
    prune = parseInt(args[pruneIdx + 1]!, 10);
    if (!Number.isFinite(prune) || prune < 1) {
      console.error('❌ --prune N: N은 1 이상의 정수');
      process.exit(1);
    }
  }

  const table = snapshotTableName();
  const pg = await connectPg();
  console.log('🔌 Postgres 직접 연결 (DATABASE_URL)');

  try {
    const existing = await pg.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'predictions_snapshot_%'
       ORDER BY table_name`
    );
    const names: string[] = existing.rows.map((r: any) => r.table_name);

    if (names.includes(table)) {
      if (!force) {
        console.log(`ℹ️ ${table} 이미 존재 — 유지하고 종료 (교체하려면 --force)`);
        return;
      }
      await pg.query(`DROP TABLE "${table}"`);
      console.log(`♻️ 기존 ${table} 삭제 (--force)`);
    }

    await pg.query(`CREATE TABLE "${table}" AS SELECT * FROM predictions`);

    const counts = await pg.query(
      `SELECT (SELECT count(*) FROM predictions) AS src,
              (SELECT count(*) FROM "${table}") AS dst`
    );
    const { src, dst } = counts.rows[0];
    if (src !== dst) {
      console.error(`❌ 행수 불일치: predictions=${src} vs ${table}=${dst}`);
      process.exit(1);
    }
    console.log(`✅ ${table} 생성 완료 (${dst}행 = 원본 ${src}행)`);

    if (prune > 0) {
      const all = names.includes(table) ? names : [...names, table].sort();
      for (const victim of tablesToPrune(all, prune)) {
        await pg.query(`DROP TABLE "${victim}"`);
        console.log(`🗑 오래된 스냅샷 삭제: ${victim}`);
      }
    }
  } finally {
    await pg.end();
  }
}

const isMainModule = process.argv[1] && process.argv[1].includes('snapshot_predictions');
if (isMainModule) {
  main().catch((err) => {
    console.error('💥', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: package.json 등록**

`package.json`의 `"db:pull"` 줄 아래에 추가:

```json
    "db:snapshot": "tsx scripts/snapshot_predictions.ts"
```

- [ ] **Step 5: 테스트·타입체크 통과 확인**

Run: `npx vitest run scripts/snapshot_predictions.test.ts && npm run build`
Expected: PASS (4 tests) + 타입체크 통과

- [ ] **Step 6: 커밋**

```bash
git add scripts/snapshot_predictions.ts scripts/snapshot_predictions.test.ts package.json
git commit -m "feat(backup): db:snapshot — predictions 스냅샷 스크립트 (L-005, DB 내부 복사·egress 0)"
```

---

### Task 5: GitHub Actions sync 워크플로우 (`.github/workflows/sync.yml`)

**Files:**
- Create: `.github/workflows/sync.yml`

**Interfaces:**
- Consumes: Task 2·3의 CLI 동작 (인자 없는 기본 날짜 + `--fail-on-empty`), repo secrets 5종 (Task 7에서 사용자가 등록)
- Produces: cron 무인 실행 + `workflow_dispatch` 수동 실행. 실패 시 GitHub 이메일.

- [ ] **Step 1: 워크플로우 작성**

`.github/workflows/sync.yml`:

```yaml
name: Sync

on:
  schedule:
    # 출마표: 수·목·금 15:00 KST (발표 14:30 + 여유) = 06:00 UTC
    - cron: '0 6 * * 3,4,5'
    # 결과: 토·일·월 01:00 KST (금·토·일 경주 다음날 새벽) = 전날 16:00 UTC
    - cron: '0 16 * * 5,6,0'
  workflow_dispatch:
    inputs:
      target:
        description: '실행할 잡'
        required: true
        type: choice
        options: [racecard, results]
      date:
        description: '대상 날짜 YYYYMMDD (생략 시 자동: 출마표=오늘+2, 결과=어제)'
        required: false
        type: string

env:
  # 러너는 UTC — 이 설정이 없으면 스크립트의 "어제/오늘+2" 계산이 하루 어긋난다
  TZ: Asia/Seoul
  # 러너엔 DuckDB 로컬 미러가 없다 — 예측 생성 읽기를 Supabase로
  DB_SOURCE: supabase
  KRA_API_KEY: ${{ secrets.KRA_API_KEY }}
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  DATE_ARG: ${{ inputs.date }}

jobs:
  racecard:
    name: 출마표 sync (발표일+2)
    if: github.event.schedule == '0 6 * * 3,4,5' || (github.event_name == 'workflow_dispatch' && inputs.target == 'racecard')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: raceCardSync
        run: npm run sync:cards -- --fail-on-empty ${DATE_ARG:+--date $DATE_ARG}

  results:
    name: 결과 sync (어제)
    if: github.event.schedule == '0 16 * * 5,6,0' || (github.event_name == 'workflow_dispatch' && inputs.target == 'results')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: dailySync
        run: npm run sync -- --fail-on-empty ${DATE_ARG:+--date $DATE_ARG}
```

- [ ] **Step 2: YAML 문법 검증**

Run: `npx yaml-lint .github/workflows/sync.yml 2>/dev/null || node -e "const yaml=require('js-yaml');yaml.load(require('fs').readFileSync('.github/workflows/sync.yml','utf8'));console.log('YAML OK')"`
Expected: `YAML OK` (js-yaml이 없으면 `npx --yes js-yaml .github/workflows/sync.yml`로 대체)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/sync.yml
git commit -m "feat(ops): sync 자동화 워크플로우 — 출마표 수목금 15시·결과 토일월 새벽 1시 KST (L-002/L-004)"
```

---

### Task 6: 문서 갱신 (정책 명문화 + 절차 수록)

**Files:**
- Modify: `TODO.md` (L-002~005를 완료 체크로)
- Modify: `docs/pipeline_guide.md` (자동화·스냅샷·복원 절차 추가)
- Modify: `docs/status/05-data-infra.md` (현황 갱신)
- Modify: `docs/status/02-model-benchmark.md` (재학습 동결 정책)
- Modify: `docs/accuracy_metrics.md` (재학습 주기 언급부에 동결 정책 한 줄)
- Modify: `CLAUDE.md` ("한 주의 흐름" 표에 자동화 반영, 기술 스택의 "로컬 수동 실행 전용" 문구 조정)

**Interfaces:**
- Consumes: Task 1~5의 결과물 이름 (`sync.yml`, `db:snapshot`, `--fail-on-empty`)
- Produces: 문서만 — 코드 없음

- [ ] **Step 1: TODO.md L-002~005 완료 처리**

각 항목을 `- [x]`로 바꾸고 L-001 형식대로 완료 요약을 단다. 내용 요지 (문구는 기존 L-001 스타일에 맞춰 조정 가능):

```markdown
- [x] **L-002 sync 자동화 스케줄링** — 완료 2026-07-12
  - GitHub Actions `.github/workflows/sync.yml`: 출마표 수·목·금 15:00 KST(`sync:cards`, 날짜 기본값=오늘+2일 코드 추가) / 결과 토·일·월 01:00 KST(`sync`, 어제 기본값). `workflow_dispatch`로 수동 재실행(날짜 입력 가능).
  - 함정 처리: 러너 UTC → `TZ: Asia/Seoul` / 러너에 미러 없음 → `DB_SOURCE: supabase`.

- [x] **L-003 가중치 재학습 주기 정책 결정** — 완료 2026-07-12 (정책 문서화)
  - **v7 라이브 1개 분기(약 12주) 누적 + probe:v7-accuracy 첫 판정까지 재학습·승격 동결.** 이후 분기 1회 수동 사이클: `db:snapshot` → `learn:candidate` → `db:pull --table model_versions` → `benchmark` → 사용자 판단 → `promote`. 자동 재학습·자동 승격 없음.

- [x] **L-004 에러 알림 채널** — 완료 2026-07-12
  - 워크플로우 실패 → GitHub 이메일 자동. `--fail-on-empty`로 "성공인데 0건" 조용한 실패도 실패 처리(휴장일 오탐은 확인 후 무시).

- [x] **L-005 DB 백업·복구 계획** — 완료 2026-07-12
  - `npm run db:snapshot`(predictions → predictions_snapshot_YYYYMMDD, DB 내부 복사·egress 0, `--force`/`--prune N`). 복원 SQL·db:pull 미러 복원 개요는 docs/pipeline_guide.md.
  - 설계: `docs/superpowers/specs/2026-07-11-launch-gating-ops-design.md`
```

- [ ] **Step 2: docs/pipeline_guide.md에 운영 섹션 추가**

문서 끝(또는 명령어 모음 섹션 근처)에 다음 섹션을 추가:

```markdown
## sync 자동화·백업 (2026-07-12, L-002~005)

### 무인 sync (GitHub Actions)
- `.github/workflows/sync.yml` — 출마표 수·목·금 15:00 KST(`sync:cards`, 기본 날짜 오늘+2), 결과 토·일·월 01:00 KST(`sync`, 기본 어제).
- 실패·0건(`--fail-on-empty`) 시 GitHub이 계정 이메일로 통지. 휴장일엔 0건 오탐 가능 — 확인 후 무시.
- 수동 재실행: GitHub → Actions → Sync → Run workflow (target·date 선택).
- 필요 secrets: `KRA_API_KEY`·`SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`ANTHROPIC_API_KEY`(env 검증 스키마가 요구, sync는 호출 안 함).

### predictions 스냅샷 (재학습·백필 전 필수)
- `npm run db:snapshot` — `predictions_snapshot_YYYYMMDD` 생성 (같은 날 재실행은 유지·종료, `--force` 교체, `--prune 3` 오래된 것 정리).
- **복원 (수동 SQL, Supabase SQL Editor):**
  ```sql
  BEGIN;
  TRUNCATE predictions;
  INSERT INTO predictions SELECT * FROM predictions_snapshot_20260712;  -- 날짜 교체
  COMMIT;
  ```

### 최후 방어선 — DuckDB 로컬 미러
- `npm run db:pull` 미러가 전 테이블 사본 (마지막 pull 시점 기준 — 이후 변경분은 복원 불가).
- 복원 개요: 미러에서 해당 테이블을 CSV/Parquet로 내보내 Supabase에 테이블 단위 upsert (사고 시 상황 봐서 수동 진행).

### 재학습 정책 (L-003)
- v7 라이브 1개 분기(약 12주) 누적 + `probe:v7-accuracy` 첫 판정까지 **재학습·승격 동결**.
- 이후 분기 1회 수동 사이클: `db:snapshot` → `learn:candidate` → `db:pull --table model_versions` → `benchmark` → 판단 → `promote`.
```

- [ ] **Step 3: status·지표 문서 갱신**

`docs/status/05-data-infra.md` — "다음 후보·남음"의 런치 게이팅 항목을 완료로 옮기고 현황에 한 줄:

```markdown
- **sync 자동화 + 백업 (L-002~005, 2026-07-12)** — Actions cron(출마표 수목금 15시·결과 토일월 새벽 1시 KST, 실패·0건 이메일) + `db:snapshot`. 절차: [pipeline_guide.md](../pipeline_guide.md).
```

`docs/status/02-model-benchmark.md` — "현재 상태" 끝에 한 줄:

```markdown
**재학습 정책(L-003, 2026-07-12)**: v7 라이브 1개 분기 누적·첫 판정까지 재학습·승격 동결 → 이후 분기 1회 수동 사이클(db:snapshot → learn:candidate → db:pull → benchmark → promote).
```

`docs/accuracy_metrics.md` — §8.6(v7 라이브 추적) 근처에 한 줄: "재학습 동결: 라이브 1개 분기 누적·첫 판정까지 (L-003, pipeline_guide 참고)".

- [ ] **Step 4: CLAUDE.md 반영**

- "한 주의 흐름" 표 아래에 주석 한 줄 추가: `> 위 sync 명령은 2026-07-12부터 GitHub Actions로 무인 실행 (수동 실행도 가능) — .github/workflows/sync.yml`
- 기술 스택의 "**로컬 수동 실행 전용** (상시 서버 X)"를 "**로컬 수동 실행 + GitHub Actions 무인 sync** (상시 서버 X)"로 수정.

- [ ] **Step 5: 커밋**

```bash
git add TODO.md docs/pipeline_guide.md docs/status/05-data-infra.md docs/status/02-model-benchmark.md docs/accuracy_metrics.md CLAUDE.md
git commit -m "docs(ops): L-002~005 완료 반영 — 자동화·백업 절차, 재학습 동결 정책 명문화"
```

---

### Task 7: 검증·리허설 (사용자 작업 포함)

**Files:** 없음 (실행·확인만)

**Interfaces:**
- Consumes: Task 1~6 전부 (main 머지 또는 브랜치 push 이후)

- [ ] **Step 1: 로컬 회귀 최종 확인 (Claude)**

Run: `npm run build && npm run test:run`
Expected: 타입체크 + 전체 테스트 통과

- [ ] **Step 2: db:snapshot 리허설 (Claude — KRA 무관, DB만)**

Run: `npm run db:snapshot` → 생성·행수 대조 로그 확인 → `npm run db:snapshot` 재실행 → "이미 존재 — 유지" 확인
Expected: `✅ predictions_snapshot_... 생성 완료 (N행 = 원본 N행)` / 재실행 시 `ℹ️ 이미 존재`

- [ ] **Step 3: 브랜치 push + PR/머지 (사용자 확인 후)**

워크플로우 cron은 **기본 브랜치의 워크플로우 파일만** 스케줄된다 — main 머지 전에는 cron이 돌지 않는다. 사용자에게 머지 의사 확인 후 push.

- [ ] **Step 4: repo secrets 등록 (사용자)**

GitHub repo → Settings → Secrets and variables → Actions → New repository secret 5건:
`KRA_API_KEY` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` (`.env` 값 그대로).

- [ ] **Step 5: workflow_dispatch 리허설 (사용자 — KRA 쿼터 소비)**

GitHub → Actions → Sync → Run workflow → target=`racecard` (수·목·금이면 실제 유효, 그 외 요일은 0건 실패가 정상 동작 확인이 됨) → 성공/실패와 이메일 수신 확인.

- [ ] **Step 6: 다음 스케줄 실행 모니터링 (사용자)**

다음 수요일 15:00 KST 이후 Actions 탭에서 racecard 잡 성공 확인 + `/picks` 화면에 신규 예측 표시 확인.
