# 1a — API156 진짜 as-of 수득상금 복원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** API156 `rsutRkPurse`(경주별 상금)를 수집해 `race_entries.rk_purse`에 저장하고, 자기조인으로 "그 경주 이전 누적 수득상금"을 `erng_sump_asof` 컬럼에 사전계산한 뒤, 로지스틱 피처 `earnings_asof_log`로 추가해 진짜 깨끗한 수득상금의 예측력을 재측정한다.

**Architecture:** 수집(스크립트)→저장(컬럼)→as-of(SQL 자기조인)→피처(buildFeatures). 런타임 SUM 쿼리 없이 컬럼 읽기. v1·`erng_sump` 무수정(동결), 로지스틱 경로에만 피처 추가. 클래스 신호(career_*)는 유지하고 진짜 earnings를 추가(둘 다, L2 선택).

**Tech Stack:** Node ESM(`.js` import), TypeScript, vitest, Supabase(supabase-js + SQL Editor), tsx, p-limit.

**스펙:** `docs/superpowers/specs/2026-06-05-earnings-asof-reconstruction-design.md`

**기존 코드 사실(참고, 시그니처 유지):**
- `EntryRow`(`scorePredictor.ts:15-33`)에 `erng_sump: number | null;`. select(`:63`)에 `erng_sump` 포함. `input.erngSump = e.erng_sump ?? undefined;`(`:151`)로 주입(buildEngineInput 반환 객체가 아니라 그 뒤 직접 세팅).
- `ScoreEngineInput`(`index.ts`)에 `erngSump?: number;`(`:132`)와 `careerFinishRatio?/careerPlaceRate?/careerN?`(선행작업 추가). v1 ⑱는 `calculateEarningsScore({ erngSump })`(`index.ts:~334`) 사용 — **무수정**.
- `buildFeatures`(`features/buildFeatures.ts`): `add(name,value)` 헬퍼, `missingFlag(name,present)` 헬퍼(`:208`). 선행작업이 ⑱ 자리에 `career_*` 추가(`:149-152`)·missing 플래그(`:216-217`).
- `featureItemMap.ts:27` `career_finish_ratio: '18_earnings', career_place_rate: '18_earnings', career_n: '18_earnings',`.
- 수집 참고: `scripts/collect_combo_dividends.ts` — `fetchPage`(재시도 backoff)·`pLimit(4)`·`appendFileSync` 패턴. **단 `fetch`에 타임아웃 없음(무한대기 버그) → 본 작업은 AbortController 추가.**
- API156 item 필드: `pthrHrno`("0051793")·`pthrGtno`(게이트=pthr_no)·`schdRaceNo`("1R")·`rsutRkPurse`("16,500,000")·`raceDt`. 파라미터 `rccrs_cd`(서울1/부경3=meet)·`race_dt`(YYYYMMDD)·`pageNo`·`numOfRows`·`_type=json`.

---

## File Structure
- **Create** `supabase/migrations/013_earnings_asof.sql` — rk_purse·erng_sump_asof 컬럼.
- **Create** `scripts/lib/prizeParse.ts` (+test) — 순수 파서(콤마 상금·"1R" rc_no).
- **Create** `scripts/collect_prize.ts` — API156 수집 → rk_purse UPDATE(AbortController 타임아웃).
- **Create** `scripts/sql/build_earnings_asof.sql` — 자기조인 as-of UPDATE(사용자 SQL Editor 실행).
- **Create** `scripts/sql/verify_prize.sql` — sum(rk_purse)≈erng_sump 정합 게이트(사용자 실행).
- **Modify** `src/engine/scorePredictor.ts` — EntryRow·select·input.earningsAsof.
- **Modify** `src/engine/index.ts` — ScoreEngineInput.earningsAsof.
- **Modify** `src/engine/features/buildFeatures.ts` (+test) — earnings_asof_log 피처.
- **Modify** `src/engine/features/featureItemMap.ts` (+test) — earnings_asof_log → ⑱.
- **Modify** `package.json` — `collect:prize`.

---

## Task 1: 마이그레이션 013 (rk_purse·erng_sump_asof)

**Files:** Create `supabase/migrations/013_earnings_asof.sql`

- [ ] **Step 1: 작성** → `supabase/migrations/013_earnings_asof.sql`:

```sql
-- ============================================
-- 013_earnings_asof.sql
-- API156 rsutRkPurse(경주별 상금) 저장 + as-of 누적 수득상금 컬럼.
-- 순수 추가형(멱등). erng_sump(오염 통산 스냅샷)은 보존(v1 동결).
-- ============================================

ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS rk_purse BIGINT;        -- 그 경주 획득 상금
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS erng_sump_asof BIGINT;  -- 그 경주 이전 누적(누수 없음)

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: 커밋** (적용은 사용자가 Supabase에서 수행)

```bash
git add supabase/migrations/013_earnings_asof.sql
git commit -m "feat(db): race_entries rk_purse·erng_sump_asof 컬럼 (API156 as-of 수득상금)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: prizeParse 순수 파서

**Files:** Create `scripts/lib/prizeParse.ts`, Test `scripts/lib/prizeParse.test.ts`

- [ ] **Step 1: 실패 테스트** → `scripts/lib/prizeParse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePurse, parseRcNo } from './prizeParse.js';

describe('parsePurse', () => {
  it('콤마 천단위 상금을 정수로', () => {
    expect(parsePurse('16,500,000')).toBe(16500000);
    expect(parsePurse('6,600,000')).toBe(6600000);
    expect(parsePurse('0')).toBe(0);
  });
  it('빈값·하이픈·null → null', () => {
    expect(parsePurse('-')).toBeNull();
    expect(parsePurse('')).toBeNull();
    expect(parsePurse(null)).toBeNull();
    expect(parsePurse(undefined)).toBeNull();
  });
  it('숫자형 입력도 허용', () => {
    expect(parsePurse(16500000 as unknown as string)).toBe(16500000);
  });
});

describe('parseRcNo', () => {
  it('"1R"→1, "12R"→12', () => {
    expect(parseRcNo('1R')).toBe(1);
    expect(parseRcNo('12R')).toBe(12);
  });
  it('숫자만/이상값', () => {
    expect(parseRcNo('3')).toBe(3);
    expect(parseRcNo('-')).toBeNull();
    expect(parseRcNo(null)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run scripts/lib/prizeParse.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** → `scripts/lib/prizeParse.ts`:

```typescript
/** API156 rsutRkPurse 파서. "16,500,000" → 16500000. 빈/하이픈/null → null. */
export function parsePurse(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** schdRaceNo "1R" → 1. 숫자 부분 추출, 없으면 null. */
export function parseRcNo(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = String(s).match(/\d+/);
  return m ? Number(m[0]) : null;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run scripts/lib/prizeParse.test.ts` → PASS.
- [ ] **Step 5: 커밋**
```bash
git add scripts/lib/prizeParse.ts scripts/lib/prizeParse.test.ts
git commit -m "feat(scripts): prizeParse 순수 파서 (상금 콤마·rc_no)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: collect_prize 수집 스크립트

**Files:** Create `scripts/collect_prize.ts`, Modify `package.json`

- [ ] **Step 1: 작성** → `scripts/collect_prize.ts`:

```typescript
/**
 * Stage 1a — API156/raceRsutDtl rsutRkPurse(경주별 상금) 수집 → race_entries.rk_purse UPDATE.
 * 사용: npm run collect:prize -- --from 20240101 --to 20991231
 * 주의: fetch에 AbortController 타임아웃(15s) — collect:combo 무한대기 버그 방지.
 */
import 'dotenv/config';
import pLimit from 'p-limit';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { parsePurse, parseRcNo } from './lib/prizeParse.js';

const KEY = process.env.KRA_API_KEY!;
const ENDPOINT = 'https://apis.data.go.kr/B551015/API156/raceRsutDtl';
const TIMEOUT_MS = 15000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1페이지 호출 + 타임아웃 + 일시오류 재시도(backoff). */
async function fetchPage(qs: URLSearchParams, tag: string, attempts = 4): Promise<any> {
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${ENDPOINT}?${qs}`, { signal: ctrl.signal });
      const txt = await r.text();
      const j = JSON.parse(txt);
      if (j.response?.header?.resultCode !== '00') throw new Error(`API에러 ${j.response?.header?.resultMsg}`);
      return j;
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 120);
      if (i < attempts - 1) await sleep(500 * 2 ** i);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${tag} ${attempts}회 실패: ${lastErr}`);
}

interface Item156 { pthrHrno?: string; schdRaceNo?: string; rsutRkPurse?: string; }

/** (race_dt, rccrs_cd=meet) 하루치 전 경주 결과 → 행 배열. */
async function fetchDay(meet: number, raceDt: number): Promise<Item156[]> {
  const out: Item156[] = [];
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const qs = new URLSearchParams({
      serviceKey: KEY, pageNo: String(pageNo), numOfRows: '100', _type: 'json',
      rccrs_cd: String(meet), race_dt: String(raceDt),
    });
    const j = await fetchPage(qs, `${meet}/${raceDt}`);
    let items = j.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    out.push(...items);
    const total = j.response?.body?.totalCount ?? 0;
    if (pageNo * 100 >= total) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20240101'));
  const to = Number(arg('--to', '20991231'));

  const sb = getSupabaseAdmin();

  // 대상 (race_date, meet) — race_entries에서 distinct
  const dayset = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet').gte('race_date', from).lte('race_date', to)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number }[]) dayset.add(`${r.meet}-${r.race_date}`);
    if (data.length < PAGE) break;
  }
  const days = [...dayset].map((s) => { const [m, d] = s.split('-').map(Number); return { m: m!, d: d! }; });
  console.log(`대상 (날짜×경마장) ${days.length}건`);

  const limit = pLimit(4);
  let done = 0, updated = 0, miss = 0;
  await Promise.all(days.map((day) => limit(async () => {
    try {
      const items = await fetchDay(day.m, day.d);
      for (const it of items) {
        const purse = parsePurse(it.rsutRkPurse);
        const rcNo = parseRcNo(it.schdRaceNo);
        const hrNo = it.pthrHrno ?? null;
        if (purse == null || rcNo == null || !hrNo) { miss++; continue; }
        const { error, count } = await sb.from('race_entries')
          .update({ rk_purse: purse }, { count: 'exact' })
          .eq('race_date', day.d).eq('meet', day.m).eq('rc_no', rcNo).eq('hr_no', hrNo);
        if (error) { miss++; } else { updated += count ?? 0; }
      }
    } catch (e) { console.error(`  ⚠️ ${day.m}/${day.d}:`, (e as Error).message); }
    if (++done % 50 === 0) console.log(`  ${done}/${days.length} 일, ${updated} 행 업데이트, ${miss} 미스`);
  })));
  console.log(`✅ ${updated} 행 rk_purse 채움, ${miss} 미스. → build/verify SQL 실행하세요.`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: npm 스크립트** — `package.json` scripts에 추가:
```json
    "collect:prize": "tsx scripts/collect_prize.ts",
```

- [ ] **Step 3: 빌드** — Run: `npm run build` → 에러 없음.

- [ ] **Step 4: 매칭키 probe (소량)** — `.env` 필요. Run: `npm run collect:prize -- --from 20250524 --to 20250524`
  Expected: `대상 (날짜×경마장) N건` 후 `✅ M 행 rk_purse 채움, K 미스`. **M>0이고 miss가 0에 가까우면** `pthrHrno`==`hr_no` 매칭 정상. **miss가 거의 전부면 hr_no 포맷 불일치** → STOP, 보고(DONE_WITH_CONCERNS): API156 `pthrHrno`와 race_entries `hr_no` 샘플을 비교해 매칭키 조정 필요(예: `pthrGtno`==pthr_no 대안).

- [ ] **Step 5: 커밋**
```bash
git add scripts/collect_prize.ts package.json
git commit -m "feat(scripts): collect:prize API156 rk_purse 수집 (AbortController 타임아웃)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: as-of 빌드 + 검증 SQL (사용자 SQL Editor 실행)

**Files:** Create `scripts/sql/build_earnings_asof.sql`, Create `scripts/sql/verify_prize.sql`

- [ ] **Step 1: build SQL 작성** → `scripts/sql/build_earnings_asof.sql`:

```sql
-- 각 경주 행의 '그 경주 이전' 누적 수득상금 = 그 말의 과거(race_date <) rk_purse 합.
-- collect:prize로 rk_purse 채운 뒤 Supabase SQL Editor에서 1회 실행.
UPDATE race_entries r
SET erng_sump_asof = COALESCE((
  SELECT SUM(p.rk_purse)
  FROM race_entries p
  WHERE p.hr_no = r.hr_no
    AND p.race_date < r.race_date
    AND p.rk_purse IS NOT NULL
), 0)
WHERE r.hr_no IS NOT NULL;
```

- [ ] **Step 2: verify SQL 작성** → `scripts/sql/verify_prize.sql`:

```sql
-- 정합 게이트: 말별 SUM(rk_purse 전체) vs erng_sump(현재 통산 스냅샷).
-- 허용오차 ±5% 내 일치 비율을 본다. 일치율 낮으면 rsutRkPurse 정의 재조사.
WITH per_horse AS (
  SELECT hr_no,
         SUM(rk_purse) AS sum_purse,
         MAX(erng_sump) AS snap_erng,
         COUNT(*) AS n
  FROM race_entries
  WHERE hr_no IS NOT NULL AND rk_purse IS NOT NULL
  GROUP BY hr_no
)
SELECT
  COUNT(*) AS horses,
  ROUND(AVG(CASE WHEN snap_erng > 0
            AND ABS(sum_purse - snap_erng) <= 0.05 * snap_erng THEN 1.0 ELSE 0.0 END), 3) AS match_rate_5pct,
  ROUND(AVG(CASE WHEN snap_erng > 0 THEN sum_purse::numeric / snap_erng END), 3) AS avg_ratio
FROM per_horse;
```

- [ ] **Step 3: 커밋** (실행은 사용자)
```bash
git add scripts/sql/build_earnings_asof.sql scripts/sql/verify_prize.sql
git commit -m "feat(scripts): as-of 수득상금 빌드 + 정합검증 SQL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> 운영(사용자): collect:prize 완료 → verify_prize.sql로 match_rate 확인(게이트) → build_earnings_asof.sql 실행.

---

## Task 5: 피처 통합 (earnings_asof_log)

**Files:** Modify `scorePredictor.ts`, `index.ts`, `buildFeatures.ts`(+test), `featureItemMap.ts`(+test)

- [ ] **Step 1: 실패 테스트(buildFeatures)** — `buildFeatures.test.ts`의 `'⑱ 통산 클래스: ...'` 테스트 다음에 추가:

```typescript
  it('⑱ 진짜 as-of 수득상금 log1p (클래스 신호와 병존)', () => {
    const input = { ...base, earningsAsof: 100_000_000, careerFinishRatio: 0.2 };
    expect(val(input, 'earnings_asof_log')).toBeCloseTo(Math.log1p(100_000_000), 5);
    expect(val(input, 'career_finish_ratio')).toBeCloseTo(0.2, 5); // 병존 확인
  });
  it('⑱ earnings_asof 결측이면 missing=1', () => {
    expect(val({ ...base }, 'earnings_asof_log__missing')).toBe(1);
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/engine/features/buildFeatures.test.ts` → FAIL.

- [ ] **Step 3: ScoreEngineInput 타입** — `index.ts`의 `careerN?: number;` 다음에 추가:
```typescript
  careerN?: number;
  earningsAsof?: number | null;  // ⑱ 진짜 as-of 누적 수득상금(API156 rk_purse 합)
```

- [ ] **Step 4: buildFeatures 피처** — `buildFeatures.ts`의 `add('career_n', input.careerN ?? 0);` 다음 줄에 추가:
```typescript
  add('career_n', input.careerN ?? 0);
  if (input.earningsAsof != null) add('earnings_asof_log', Math.log1p(input.earningsAsof));
```
그리고 missingFlag 블록의 `missingFlag('career_place_rate', input.careerPlaceRate != null);` 다음에 추가:
```typescript
  missingFlag('earnings_asof_log', input.earningsAsof != null);
```

- [ ] **Step 5: 통과 확인(buildFeatures)** — Run: `npx vitest run src/engine/features/buildFeatures.test.ts` → PASS.

- [ ] **Step 6: 실패 테스트(featureItemMap)** — `featureItemMap.test.ts`의 `'통산 클래스 신호는 ⑱로 매핑'` 테스트에 줄 추가(또는 새 it):
```typescript
  it('진짜 as-of 수득상금도 ⑱로 매핑', () => {
    expect(featureToItem('earnings_asof_log')).toBe('18_earnings');
    expect(featureToItem('earnings_asof_log__missing')).toBe('18_earnings');
  });
```

- [ ] **Step 7: 실패 확인** — Run: `npx vitest run src/engine/features/featureItemMap.test.ts` → FAIL.

- [ ] **Step 8: featureItemMap 매핑** — `featureItemMap.ts:27`의 career 매핑 줄을 아래로 교체:
```typescript
  career_finish_ratio: '18_earnings', career_place_rate: '18_earnings', career_n: '18_earnings', earnings_asof_log: '18_earnings',
```

- [ ] **Step 9: 통과 확인(featureItemMap)** — Run: `npx vitest run src/engine/features/featureItemMap.test.ts` → PASS.

- [ ] **Step 10: scorePredictor 배선** — 세 곳 수정:
  (a) `EntryRow`(`scorePredictor.ts:32`) `erng_sump: number | null;` 다음에:
```typescript
  erng_sump: number | null;
  erng_sump_asof: number | null;
```
  (b) select(`:63`)에서 `, erng_sump')` 를 `, erng_sump, erng_sump_asof')` 로:
```typescript
    .select('race_date, meet, rc_no, pthr_no, hr_name, hr_no, ag, gndr, ratg, ord, rc_dist, track_type, burd_wgt, jcky_no, trar_no, popularity, erng_sump, erng_sump_asof')
```
  (c) `input.erngSump = e.erng_sump ?? undefined;`(`:151`) 다음에:
```typescript
      input.erngSump = e.erng_sump ?? undefined;
      input.earningsAsof = e.erng_sump_asof ?? undefined;
```

- [ ] **Step 11: 빌드** — Run: `npm run build` → 에러 없음.

- [ ] **Step 12: 커밋**
```bash
git add src/engine/index.ts src/engine/scorePredictor.ts src/engine/features/buildFeatures.ts src/engine/features/buildFeatures.test.ts src/engine/features/featureItemMap.ts src/engine/features/featureItemMap.test.ts
git commit -m "feat(engine): earnings_asof_log 피처 (진짜 as-of 수득상금, 클래스 병존)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 전체 검증

- [ ] **Step 1: 전체 타입체크** — Run: `npm run build` → 에러 없음.
- [ ] **Step 2: 전체 단위테스트** — Run: `npm run test:run` → 전부 PASS.

---

## 운영 순서 (구현 완료 후, 사용자 수행 — DB·.env, 토큰·DB 위임)
1. 마이그레이션 013 Supabase 적용.
2. `npm run collect:prize -- --from 20240101` — rk_purse 수집(수분~십수분). 끝부분(✅ N행/미스) 확인.
3. `scripts/sql/verify_prize.sql` Supabase SQL Editor 실행 — **match_rate_5pct 게이트**. 낮으면 rsutRkPurse 정의 재조사(부가상금 등) 후 결정.
4. 게이트 통과 시 `scripts/sql/build_earnings_asof.sql` 실행 — erng_sump_asof 채움.
5. `npm run extract:matrix` — 행렬 재추출(earnings_asof_log baked).
6. `npm run exp:logistic -- --walkforward` — 로지스틱(클래스+진짜earnings) vs leaky v1. 진짜 earnings가 클래스 위에 예측력 더하는지(연승·계수) 판정(사람).

---

## Self-Review (작성자 체크 완료)
- **Spec coverage:** §4.1 마이그=Task1 / §4.2 collect:prize(타임아웃·매칭probe)=Task3 / §4.3 build asof SQL=Task4 / §4.4 verify=Task4 / §4.5 피처통합(select·input·type·buildFeatures·featureItemMap, v1무수정)=Task5 / §4.6 재측정=운영순서5-6 / §6 테스트(파싱·누수·buildFeatures·featureItemMap)=Task2·Task5. 누수차단은 build SQL의 `race_date <` + verify로 보장.
- **Type consistency:** `earningsAsof`(ScoreEngineInput, Step3)→buildFeatures 소비(Step4)→scorePredictor 주입(Step10c). `erng_sump_asof`(EntryRow Step10a·select Step10b·DB컬럼 Task1) 일관. `earnings_asof_log` 피처명 buildFeatures(Step4)·featureItemMap(Step8)·테스트 일관. `parsePurse`/`parseRcNo` collect_prize·테스트 일관.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝 실제 코드.
- **Open items:** rsutRkPurse 정의=verify 게이트가 방어. hr_no 매칭=Task3 Step4 probe로 확정(불일치 시 pthrGtno 대안 명시). career_* 유지(제거 안 함)·v1 erng_sump/calculateEarningsScore 무수정 — 의도적.
