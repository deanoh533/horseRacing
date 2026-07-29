# 조합 확정배당 수집 (결과 sync 통합) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동 결과 sync가 경주 결과를 받을 때 그 경주의 조합 확정배당(복승·복연승·쌍승·삼복승·삼쌍승)을 `API160_1/integratedInfo_1`에서 함께 받아 새 테이블 `combo_dividends`에 저장한다.

**Architecture:** `KRAClient`에 조합배당 조회 메서드(`getComboDividends`, 기존 `getWithRetry` 재시도 경유)를 추가하고, 순수 변환함수(`toComboDividendRows`)가 응답을 대상 pool만 필터해 DB 행으로 바꾼다. `dailySync`의 경주 루프가 결과 저장 직후 이를 호출해 `combo_dividends`에 멱등 upsert 하되, 실패는 격리하고 `skipPredictions=false`(=forward 결과 sync)일 때만 실행한다.

**Tech Stack:** Node.js + TypeScript, tsx, vitest, Supabase(Postgres), axios(KRA API).

## Global Constraints

- **재시도 일원화:** 새 KRA 호출은 반드시 `KRAClient.getWithRetry` 경유 (raw `fetch`/`axios.get` 금지).
- **멱등:** `combo_dividends` upsert는 `onConflict: 'race_date,meet,rc_no,pool,leg1,leg2,leg3'`.
- **leg3 센티넬:** 3마리 조합이 아니면 `leg3 = 0` (NULL 금지 — PK NULL 중복 방지).
- **raw 순서 저장:** leg 정렬하지 않음 (쌍승·삼쌍승 착순 순서 보존).
- **forward-only:** 조합 수집은 `skipPredictions === false`일 때만 (백필 경로 제외).
- **실패 격리:** 조합 수집 실패가 경주 결과 저장을 되돌리지 않음 (try/catch + 경고 로그, 계속).
- **대상 pool:** `COMBO_POOLS = ['복승식','쌍승식','복연승식','삼복승식','삼쌍승식']`.
- **커밋 메시지:** 한국어 + scope. 푸터에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 타입체크 `npm run build`, 테스트 `npx vitest run` 각 태스크 종료 시 통과.

## File Structure

- `supabase/migrations/015_combo_dividends.sql` (신규) — 테이블 DDL.
- `src/kra/client.ts` (수정) — `KRAComboDividend` 인터페이스 + `getComboDividends` 메서드.
- `src/sync/transformer.ts` (수정) — `COMBO_POOLS` 상수 + `ComboDividendRow` 인터페이스 + `toComboDividendRows` 순수함수.
- `src/sync/dailySync.ts` (수정) — 경주 루프에 조합배당 수집·upsert 블록.
- `tests/kra/client.test.ts` (수정) — `getComboDividends` 파싱·페이지네이션 테스트.
- `tests/sync/transformer.combo.test.ts` (신규) — `toComboDividendRows` 단위 테스트.
- `tests/sync/dailySync.test.ts` (수정) — 통합 테스트(조합 upsert + skip 게이트).
- 문서: `docs/status/05-data-infra.md`, `docs/api_spec.md`, `docs/pipeline_guide.md` (수정).

---

### Task 1: DB 마이그레이션 — `combo_dividends` 테이블

**Files:**
- Create: `supabase/migrations/015_combo_dividends.sql`

**Interfaces:**
- Produces: 테이블 `combo_dividends(race_date, meet, rc_no, pool, leg1, leg2, leg3, odds, collected_at)`, PK `(race_date, meet, rc_no, pool, leg1, leg2, leg3)`.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/015_combo_dividends.sql`:
```sql
-- ============================================
-- 015_combo_dividends.sql
-- 조합 확정배당 저장 (복승·복연승·쌍승·삼복승·삼쌍승)
--
-- 결과 sync(dailySync)가 경주 결과 저장 직후 API160_1/integratedInfo_1에서
-- 조합 확정배당을 받아 이 테이블에 멱등 upsert. 단승/연승은 race_entries에 이미
-- 있으므로 여기 저장 안 함. leg 순서는 API가 준 그대로(쌍승·삼쌍승 착순 순서 의미).
-- ============================================

CREATE TABLE IF NOT EXISTS combo_dividends (
  race_date    INT         NOT NULL,
  meet         INT         NOT NULL,           -- 1=서울, 3=부산경남
  rc_no        INT         NOT NULL,
  pool         VARCHAR(20) NOT NULL,           -- '복승식'|'복연승식'|'쌍승식'|'삼복승식'|'삼쌍승식'
  leg1         INT         NOT NULL,           -- 첫째 말 출주번호(chulNo)
  leg2         INT         NOT NULL,           -- 둘째 말
  leg3         INT         NOT NULL DEFAULT 0, -- 셋째 말(3마리 조합만, 없으면 0)
  odds         NUMERIC     NOT NULL,           -- 확정배당
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_date, meet, rc_no, pool, leg1, leg2, leg3)
);

-- 경주 단위 조회용
CREATE INDEX IF NOT EXISTS idx_combo_dividends_race
  ON combo_dividends (race_date, meet, rc_no);
```

- [ ] **Step 2: 사용자에게 Supabase 적용 요청**

이 SQL은 Supabase SQL Editor에서 **사용자가 직접 실행**한다(프로젝트 관례: DDL/SQL은 사용자 실행). 실행 후 `combo_dividends` 테이블이 생성됐는지 확인. (자동 테스트는 페이크 Supabase를 쓰므로 이 단계 없이도 통과하나, 라이브 sync 전 필수.)

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/015_combo_dividends.sql
git commit -m "feat(db): combo_dividends 테이블 — 조합 확정배당 저장 (015)

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `KRAClient.getComboDividends`

**Files:**
- Modify: `src/kra/client.ts` (인터페이스 추가 + 메서드 추가)
- Test: `tests/kra/client.test.ts`

**Interfaces:**
- Consumes: 기존 `this.getWithRetry<T>(url, params)`, `this.parseResponse<T>(data)`, `this.apiKey`, `limit` (pLimit), `MeetCode`.
- Produces:
  - `export interface KRAComboDividend { rcNo: number; pool: string; chulNo: number; chulNo2: number; chulNo3: number; odds: number; }`
  - `getComboDividends(params: { meet: MeetCode; rcDate: number; rcNo: number }): Promise<KRAComboDividend[]>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/kra/client.test.ts` 하단(마지막 `});` 뒤)에 추가:
```ts
describe('KRAClient.getComboDividends', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  /** integratedInfo 성공 응답 (조합 아이템 배열) */
  function comboResponse(items: unknown[], totalCount: number) {
    return {
      data: {
        response: {
          header: { resultCode: '00', resultMsg: 'NORMAL' },
          body: { items: { item: items }, numOfRows: 1000, pageNo: 1, totalCount },
        },
      },
    };
  }

  it('단일 페이지 조합배당을 파싱해 반환한다', async () => {
    mockGet.mockResolvedValueOnce(
      comboResponse(
        [
          { rcNo: 1, pool: '복승식', chulNo: 3, chulNo2: 7, chulNo3: 0, odds: 12.4 },
          { rcNo: 1, pool: '삼복승식', chulNo: 3, chulNo2: 7, chulNo3: 1, odds: 88.1 },
        ],
        2
      )
    );

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    const rows = await client.getComboDividends({ meet: 1, rcDate: 20260726, rcNo: 1 });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pool: '복승식', chulNo: 3, chulNo2: 7, odds: 12.4 });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('totalCount가 페이지 크기를 넘으면 다음 페이지도 이어 받는다', async () => {
    mockGet
      .mockResolvedValueOnce(
        comboResponse([{ rcNo: 1, pool: '복승식', chulNo: 1, chulNo2: 2, chulNo3: 0, odds: 5 }], 3000)
      )
      .mockResolvedValueOnce(comboResponse([], 3000)); // 2페이지 빈 응답 → 종료

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    const rows = await client.getComboDividends({ meet: 1, rcDate: 20260726, rcNo: 1 });

    expect(rows).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/kra/client.test.ts`
Expected: FAIL — `client.getComboDividends is not a function`.

- [ ] **Step 3: 인터페이스 + 메서드 구현**

`src/kra/client.ts` — `KRAJockeyStat`을 반환하는 `getJockeyStats` 메서드 바로 다음(클래스 마지막 메서드 뒤, 클래스 닫는 `}` 앞)에 추가:
```ts
  /**
   * API160_1/integratedInfo_1: 경주 단위 통합배당 정보.
   * 조합 확정배당(복승·복연승·쌍승·삼복승·삼쌍승 등 모든 pool)을 반환한다.
   * pool 입력필터는 API가 무시 → 전체를 받아 호출부(transformer)에서 필터한다.
   * getWithRetry 경유(타임아웃/네트워크/5xx 재시도).
   */
  async getComboDividends(params: {
    meet: MeetCode;
    rcDate: number;
    rcNo: number;
  }): Promise<KRAComboDividend[]> {
    return limit(async () => {
      const all: KRAComboDividend[] = [];
      const numOfRows = 1000;
      for (let pageNo = 1; pageNo <= 5; pageNo++) {
        const data = await this.getWithRetry<KRAComboDividend>(
          '/API160_1/integratedInfo_1',
          {
            serviceKey: this.apiKey,
            meet: params.meet,
            rc_date: params.rcDate,
            rc_no: params.rcNo,
            pageNo,
            numOfRows,
            _type: 'json',
          }
        );
        const page = this.parseResponse(data);
        if (page.length === 0) break;
        all.push(...page);
        const total = data.response?.body?.totalCount ?? 0;
        if (pageNo * numOfRows >= total) break;
      }
      return all;
    });
  }
```

그리고 `KRAJockeyStat` 인터페이스 정의 근처(파일 하단의 응답 인터페이스 블록)에 추가:
```ts
/**
 * API160_1/integratedInfo_1: 조합 확정배당 아이템.
 * chulNo(=leg1)·chulNo2(=leg2)는 항상, chulNo3(=leg3)은 3마리 조합만(그 외 0/부재).
 */
export interface KRAComboDividend {
  rcNo: number;
  pool: string;       // '복승식'|'복연승식'|'쌍승식'|'삼복승식'|'삼쌍승식' 등
  chulNo: number;
  chulNo2: number;
  chulNo3: number;
  odds: number;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/kra/client.test.ts`
Expected: PASS (기존 재시도 3건 + 신규 2건).

- [ ] **Step 5: 커밋**

```bash
git add src/kra/client.ts tests/kra/client.test.ts
git commit -m "feat(kra): getComboDividends — API160_1 조합배당 조회(재시도 경유)

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: 순수 변환함수 `toComboDividendRows`

**Files:**
- Modify: `src/sync/transformer.ts`
- Test: `tests/sync/transformer.combo.test.ts` (신규)

**Interfaces:**
- Consumes: `KRAComboDividend` (from `@kra/client.js`).
- Produces:
  - `export const COMBO_POOLS = ['복승식','쌍승식','복연승식','삼복승식','삼쌍승식'] as const;`
  - `export interface ComboDividendRow { race_date: number; meet: number; rc_no: number; pool: string; leg1: number; leg2: number; leg3: number; odds: number; }`
  - `export function toComboDividendRows(items: KRAComboDividend[], keys: { race_date: number; meet: number; rc_no: number }): ComboDividendRow[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/sync/transformer.combo.test.ts` (신규):
```ts
import { describe, it, expect } from 'vitest';
import { toComboDividendRows } from '../../src/sync/transformer.js';
import type { KRAComboDividend } from '../../src/kra/client.js';

const KEYS = { race_date: 20260726, meet: 1, rc_no: 5 };

function item(o: Partial<KRAComboDividend>): KRAComboDividend {
  return { rcNo: 5, pool: '복승식', chulNo: 0, chulNo2: 0, chulNo3: 0, odds: 0, ...o };
}

describe('toComboDividendRows', () => {
  it('대상이 아닌 pool(단승식·연승식)은 제외한다', () => {
    const rows = toComboDividendRows(
      [
        item({ pool: '단승식', chulNo: 3, odds: 3.2 }),
        item({ pool: '연승식', chulNo: 3, odds: 1.5 }),
        item({ pool: '복승식', chulNo: 3, chulNo2: 7, odds: 12.4 }),
      ],
      KEYS
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pool).toBe('복승식');
  });

  it('2마리 조합은 leg3=0으로 저장한다', () => {
    const rows = toComboDividendRows([item({ pool: '쌍승식', chulNo: 4, chulNo2: 2, odds: 30 })], KEYS);
    expect(rows[0]).toEqual({
      race_date: 20260726, meet: 1, rc_no: 5, pool: '쌍승식',
      leg1: 4, leg2: 2, leg3: 0, odds: 30,
    });
  });

  it('3마리 조합은 leg3까지 보존하고 순서를 정렬하지 않는다', () => {
    const rows = toComboDividendRows(
      [item({ pool: '삼쌍승식', chulNo: 9, chulNo2: 1, chulNo3: 5, odds: 420 })],
      KEYS
    );
    expect(rows[0]).toMatchObject({ pool: '삼쌍승식', leg1: 9, leg2: 1, leg3: 5 });
  });

  it('chulNo3이 undefined여도 leg3=0으로 안전 처리한다', () => {
    const raw = { rcNo: 5, pool: '복연승식', chulNo: 2, chulNo2: 6, odds: 8 } as unknown as KRAComboDividend;
    const rows = toComboDividendRows([raw], KEYS);
    expect(rows[0]!.leg3).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/sync/transformer.combo.test.ts`
Expected: FAIL — `toComboDividendRows` export 없음.

- [ ] **Step 3: 구현**

`src/sync/transformer.ts` 상단 import에 `KRAComboDividend` 추가 — 5번째 줄을 다음으로 교체:
```ts
import type { KRARaceCard, KRAEntrySheetItem, KRATrainingRecord, KRAJockeyStat, KRAComboDividend } from '@kra/client.js';
```

파일 하단(맨 끝)에 추가:
```ts
// ============================================
// 조합 확정배당 (combo_dividends)
// ============================================

/** 결과 sync가 저장할 조합식(pool) 집합. API가 주는 다른 pool(단승/연승 등)은 제외. */
export const COMBO_POOLS = ['복승식', '쌍승식', '복연승식', '삼복승식', '삼쌍승식'] as const;

/** combo_dividends 테이블 행 */
export interface ComboDividendRow {
  race_date: number;
  meet: number;
  rc_no: number;
  pool: string;
  leg1: number;
  leg2: number;
  leg3: number;
  odds: number;
}

/**
 * API160_1 조합배당 아이템 → combo_dividends 행.
 * 대상 pool(COMBO_POOLS)만 통과, leg 순서는 raw 유지(쌍승/삼쌍승 착순 순서),
 * 3마리 조합이 아니면 leg3=0.
 */
export function toComboDividendRows(
  items: KRAComboDividend[],
  keys: { race_date: number; meet: number; rc_no: number }
): ComboDividendRow[] {
  const pools = new Set<string>(COMBO_POOLS);
  return items
    .filter((it) => pools.has(it.pool))
    .map((it) => ({
      race_date: keys.race_date,
      meet: keys.meet,
      rc_no: keys.rc_no,
      pool: it.pool,
      leg1: it.chulNo,
      leg2: it.chulNo2,
      leg3: it.chulNo3 || 0,
      odds: it.odds,
    }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/sync/transformer.combo.test.ts`
Expected: PASS (4건).

- [ ] **Step 5: pool 문자열 실검증 (사용자 실행, 1회)**

`COMBO_POOLS`의 3마리 조합 문자열(삼복승식·삼쌍승식·쌍승식)이 실제 API160_1 응답과 일치하는지 확인 필요. 사용자에게 다음 중 하나를 부탁:
- (a) 기존 수집물이 있으면 확인, 또는
- (b) 한 경주 probe 1회: `npm run collect:combo -- --from 20260726 --to 20260726 --pool 삼복승식 --out data/_probe.jsonl` 실행 후 행이 생기는지(=문자열 일치) 확인.

불일치 시 `COMBO_POOLS`와 관련 테스트 fixture의 pool 문자열만 실제값으로 교체하고 Step 4 재실행. (KRA 호출은 Claude가 실행하지 않음 — 명령만 제공.)

- [ ] **Step 6: 커밋**

```bash
git add src/sync/transformer.ts tests/sync/transformer.combo.test.ts
git commit -m "feat(sync): toComboDividendRows — 조합배당 아이템→행 변환(pool 필터·leg3=0)

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: `dailySync` 통합 — 조합배당 수집·upsert

**Files:**
- Modify: `src/sync/dailySync.ts` (import 1줄 + 수집 블록)
- Test: `tests/sync/dailySync.test.ts` (KRA 페이크 확장 + 테스트 2건)

**Interfaces:**
- Consumes: `kra.getComboDividends`, `toComboDividendRows`, `COMBO_POOLS`(간접), fake Supabase의 `combo_dividends` 테이블(자동 생성).
- Produces: 없음(최종 소비자).

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/sync/dailySync.test.ts` 수정:

(1) KRA 모듈 모킹을 `getComboDividends` 포함으로 교체 — 기존
```ts
vi.mock('@kra/client.js', () => ({
  getKRAClient: () => ({ getAllRaceResults: mockGetAllRaceResults }),
}));
```
을 다음으로:
```ts
vi.mock('@kra/client.js', () => ({
  getKRAClient: () => ({
    getAllRaceResults: mockGetAllRaceResults,
    getComboDividends: mockGetComboDividends,
  }),
}));
```

(2) 모듈 레벨 mock 변수 선언 추가 — `let mockPredictRace: ...` 아래에:
```ts
let mockGetComboDividends: ReturnType<typeof vi.fn>;
```

(3) `beforeEach`에 기본값 추가 — `mockPredictRace = vi.fn().mockResolvedValue([]);` 아래에:
```ts
mockGetComboDividends = vi.fn().mockResolvedValue([
  { rcNo: RC_NO, pool: '복승식', chulNo: 1, chulNo2: 2, chulNo3: 0, odds: 12.4 },
  { rcNo: RC_NO, pool: '단승식', chulNo: 1, chulNo2: 0, chulNo3: 0, odds: 3.2 }, // 비대상 → 저장 안 됨
]);
```

(4) `describe(...)` 블록 안 마지막 테스트 뒤에 추가:
```ts
  it('결과 sync 시 대상 pool 조합배당을 combo_dividends에 저장한다', async () => {
    fakeSb.tables['race_entries'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null }],
    };
    fakeSb.tables['predictions'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', predicted_rank: 1, actual_ord: null }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    expect(mockGetComboDividends).toHaveBeenCalledTimes(1);
    const combo = fakeSb.tables['combo_dividends']?.rows ?? [];
    expect(combo).toHaveLength(1); // 복승식만, 단승식 제외
    expect(combo[0]).toMatchObject({
      race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pool: '복승식', leg1: 1, leg2: 2, leg3: 0, odds: 12.4,
    });
  });

  it('skipPredictions=true(백필)면 조합배당을 수집하지 않는다', async () => {
    fakeSb.tables['race_entries'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET], skipPredictions: true });

    expect(mockGetComboDividends).not.toHaveBeenCalled();
    expect(fakeSb.tables['combo_dividends']?.rows ?? []).toHaveLength(0);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/sync/dailySync.test.ts`
Expected: FAIL — `mockGetComboDividends` 미호출(조합 로직 없음) / `combo_dividends` 비어 있음.

- [ ] **Step 3: 구현 — import 추가**

`src/sync/dailySync.ts` import 블록에서 transformer import에 `toComboDividendRows` 추가 — 기존
```ts
import {
  toRaceRow,
  toRaceEntryResultRow,
  calculatePopularities,
} from './transformer.js';
```
을:
```ts
import {
  toRaceRow,
  toRaceEntryResultRow,
  calculatePopularities,
  toComboDividendRows,
} from './transformer.js';
```

- [ ] **Step 4: 구현 — 수집 블록 추가**

`src/sync/dailySync.ts`의 `if (!skipPredictions) {` 블록 내부, `actual_ord` UPDATE `for` 루프가 끝나는 지점(주석 `// 6. predictions.actual_ord만 UPDATE ...`로 시작하는 루프의 닫는 `}`) **직후**, 그 `if` 블록의 닫는 `}` **직전**에 추가:
```ts
          // 7. 조합 확정배당 수집 (복승·복연승·쌍승·삼복승·삼쌍승) → combo_dividends
          //    결과 도착 경주에 한해 API160_1 호출. forward 결과 sync(skipPredictions=false)
          //    에서만 실행됨(이 블록 자체가 !skipPredictions 가드 안). 실패는 격리(계속).
          try {
            const comboItems = await kra.getComboDividends({ meet, rcDate, rcNo });
            const comboRows = toComboDividendRows(comboItems, {
              race_date: rcDate,
              meet,
              rc_no: rcNo,
            });
            if (comboRows.length > 0) {
              const { error: comboErr } = await supabase
                .from('combo_dividends')
                .upsert(comboRows, {
                  onConflict: 'race_date,meet,rc_no,pool,leg1,leg2,leg3',
                });
              if (comboErr) throw comboErr;
              console.log(`    [meet=${meet}, rcNo=${rcNo}] 조합배당 ${comboRows.length}건`);
            }
          } catch (err) {
            console.warn(
              `    [meet=${meet}, rcNo=${rcNo}] 조합배당 수집 실패 (계속): ${(err as Error).message}`
            );
          }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/sync/dailySync.test.ts`
Expected: PASS (기존 + 신규 2건).

- [ ] **Step 6: 전체 검증**

Run: `npm run build && npx vitest run`
Expected: tsc 통과 + 전체 테스트 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/sync/dailySync.ts tests/sync/dailySync.test.ts
git commit -m "feat(sync): 결과 sync가 조합배당도 수집해 combo_dividends 저장

경주 결과 저장 직후 API160_1 호출→대상 pool만 combo_dividends upsert.
skipPredictions=false(forward 결과 sync)에서만, 실패는 격리(계속).

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: 문서 갱신

**Files:**
- Modify: `docs/status/05-data-infra.md`, `docs/api_spec.md`, `docs/pipeline_guide.md`

**Interfaces:** 없음.

- [ ] **Step 1: `docs/status/05-data-infra.md` 갱신**

"현재 상태" 목록에 항목 추가(맨 아래 bullet 뒤):
```markdown
- **조합 확정배당 수집 (2026-07-29)** — 결과 sync(dailySync)가 경주 결과 저장 직후 `API160_1/integratedInfo_1`에서 조합배당(복승·복연승·쌍승·삼복승·삼쌍승)을 받아 `combo_dividends`(migration 015)에 멱등 upsert. forward만(skipPredictions=false), 실패 격리. 단승/연승은 race_entries에 이미 존재. 과거 백필·DuckDB 미러 반영은 별도. 스펙/플랜 docs/superpowers/*/2026-07-29-combo-dividends-sync*.
```
"DB 현황" 표에 행 추가:
```markdown
| combo_dividends | (신규) | 2026-07-29~ |
```

- [ ] **Step 2: `docs/api_spec.md` 갱신 (SSOT)**

KRA 엔드포인트 목록에 `API160_1/integratedInfo_1` 항목이 없으면 추가(있으면 "결과 sync에서 조합배당 수집에 사용" 명시). 파라미터: `meet, rc_date, rc_no, pageNo, numOfRows, _type`. 반환: pool별 조합 아이템(`pool, chulNo, chulNo2, chulNo3, odds`). Supabase 스키마 절에 `combo_dividends` 테이블(Task 1 DDL 요약) 추가.

- [ ] **Step 3: `docs/pipeline_guide.md` 갱신**

"무인 sync" 절의 결과 sync 설명에 "조합배당(combo_dividends)도 함께 수집(API160_1)" 한 줄 추가.

- [ ] **Step 4: 커밋**

```bash
git add docs/status/05-data-infra.md docs/api_spec.md docs/pipeline_guide.md
git commit -m "docs(sync): 조합배당 수집 반영 — 상태·api_spec·pipeline_guide

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## 완료 후

- 사용자: Task 1 마이그레이션을 Supabase에 적용(미적용 시 라이브 sync에서 combo upsert가 실패하나, 실패 격리라 결과 sync 본류는 계속됨).
- 다음 주말 결과 sync에서 `combo_dividends`에 행이 쌓이는지 실측 관찰.
- 후속(별도): 과거 백필(`collect_combo_dividends`를 DB upsert로 개조) + DuckDB 미러(`db:pull`) 대상 추가 + 백테스트/ROI 연결.
