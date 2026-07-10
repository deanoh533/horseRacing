# v7 라이브 적중률 추적 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v7 모델이 라이브 환경에서 실제로 얼마나 잘 맞추는가를 정직하게 판정할 수 있도록 predictions 테이블의 쓰기 전략을 변경하고, 관련 화면과 검증 스크립트를 정비.

**Architecture:**  
dailySync에서 predictions 재계산을 제거하고, 수요일 사전 예측을 보존한다. 금요일에는 race_entries에만 결과(ord)를 저장한다. 화면의 방어 필터를 명확한 race_date=TODAY 필터로 교체하고, 예측이 없는 경우 금요일에 사전 모드로 보충한다. 라이브 판정은 predictions과 race_entries를 JOIN해서 적중률을 계산하는 신규 스크립트로 한다.

**Tech Stack:**
- TypeScript, Node.js (backend scripts)
- React + TanStack Query (client screen)
- Supabase (data storage)
- Vitest (unit tests)

## Global Constraints

- 이번 주말(2026-07-12~14) 배포 필수
- 점수 계산 로직(ScoreEngine) 변경 금지
- 테이블 스키마(predictions, race_entries) 변경 금지
- predictions은 INSERT-only (수요일 후 무변경)
- forcePrecompetition은 skipPredictions과 독립적 옵션

---

## 파일 구조

```
변경 파일:
├── src/sync/dailySync.ts
│   └─ predictRace() 제거 또는 조건 변경
│
├── src/engine/scorePredictor.ts
│   └─ forcePrecompetition 옵션 추가
│
├── client/src/lib/queries.ts
│   └─ useUpcomingPicks() 필터 변경
│
├── client/src/lib/supabase.ts
│   └─ getTodayRaceDate() 유틸 추가 (있으면 기존 재사용)
│
└── scripts/probe_v7_accuracy.ts (신규)
    └─ 라이브 판정 스크립트

테스트 파일:
└── tests/
    ├─ sync/dailySync.test.ts (기존 수정)
    ├─ engine/scorePredictor.test.ts (신규 - forcePrecompetition)
    └─ scripts/probe_v7_accuracy.test.ts (신규)
```

---

## Task 1: forcePrecompetition 옵션 구현

**Files:**
- Modify: `src/engine/scorePredictor.ts:69-75` (gatherRaceInputs 시그니처)
- Modify: `src/engine/scorePredictor.ts:305-310` (predictRace 호출)
- Create: `tests/engine/scorePredictor.test.ts` (신규 테스트)

**Interfaces:**
- Consumes: ScoreEngine (기존, 변경 없음)
- Produces: `gatherRaceInputs(..., opts?: { forcePrecompetition?: boolean })`
  - forcePrecompetition=true일 때도 ord=NULL로 취급하고 입력 데이터 구성

- [ ] **Step 1: scorePredictor.ts에서 현재 로직 읽기**

```bash
# scorePredictor.ts 라인 69-75, 305-310 확인
# gatherRaceInputs의 현재 시그니처와 predictRace 호출 패턴 이해
```

- [ ] **Step 2: opts 파라미터 타입 추가**

scorePredictor.ts 라인 69-75를 다음과 같이 수정:

```typescript
export async function gatherRaceInputs(
  sb: ReadClient,
  rcDate: number,
  meet: number,
  rcNo: number,
  opts?: { shapeParCutoff?: number; forcePrecompetition?: boolean }  // ← 추가
): Promise<RaceInputRow[]> {
  const forcePrecompetition = opts?.forcePrecompetition ?? false;
  const currentMonth = Math.floor((rcDate % 10000) / 100);
  // ... 기존 로직
}
```

- [ ] **Step 3: 테스트 작성 (사전 모드 강제 확인)**

`tests/engine/scorePredictor.test.ts` 생성:

```typescript
import { gatherRaceInputs } from '../../src/engine/scorePredictor';
import { describe, it, expect } from 'vitest';

describe('forcePrecompetition option', () => {
  it('should treat race as precompetition even if ord is present', async () => {
    // race_entries에 ord=2가 있는 경주
    // forcePrecompetition=true로 gatherRaceInputs 호출
    // → actual_ord이 NULL로 처리되는지 확인
    
    const inputs = await gatherRaceInputs(mockSb, 20260710, 1, 1, {
      forcePrecompetition: true
    });
    
    // 결과 확인: 입력 데이터가 사전 모드로 구성됨
    expect(inputs.length).toBeGreaterThan(0);
    // actual_ord는 별도 필드이므로 예측 결과에서 확인
  });
});
```

- [ ] **Step 4: 테스트 실행 (실패 확인)**

```bash
npm run test:run -- tests/engine/scorePredictor.test.ts
# 예상: FAIL (forcePrecompetition 옵션이 아직 구현되지 않았으므로)
```

- [ ] **Step 5: predictRace 호출 부분 수정**

scorePredictor.ts 라인 300-310 근처에서 predictRace 호출 시 opts 전달:

```typescript
export async function predictRace(
  sb: ReadClient,
  rcDate: number,
  meet: number,
  rcNo: number,
  opts?: { forcePrecompetition?: boolean }  // ← 추가
): Promise<PredictionRow[]> {
  const rows = await gatherRaceInputs(sb, rcDate, meet, rcNo, {
    shapeParCutoff: opts?.shapeParCutoff ?? DEFAULT_CUTOFF,
    forcePrecompetition: opts?.forcePrecompetition ?? false  // ← 전달
  });
  // ... 기존 로직
}
```

- [ ] **Step 6: 테스트 실행 (통과 확인)**

```bash
npm run test:run -- tests/engine/scorePredictor.test.ts
# 예상: PASS
```

- [ ] **Step 7: 타입 확인**

```bash
npm run build
# 예상: tsc 타입체크 통과
```

- [ ] **Step 8: 커밋**

```bash
git add src/engine/scorePredictor.ts tests/engine/scorePredictor.test.ts
git commit -m "feat(scorePredictor): add forcePrecompetition option

금요일 보충 예측 시 ord 값 무시하고 사전 모드로 강제.
예측이 없는 경주를 dailySync에서 보충할 때 사용."
```

---

## Task 2: dailySync에서 predictions 제거

**Files:**
- Modify: `src/sync/dailySync.ts:251-270` (predictRace 실행 부분)
- Modify: `src/sync/dailySync.ts:26-31` (SyncOptions 인터페이스)
- Create: `tests/sync/dailySync.test.ts` (신규 테스트)

**Interfaces:**
- Consumes: predictRace (Task 1에서 확장됨)
- Produces: dailySync가 predictions을 계산하지 않음 (skipPredictions=true 기본값)

- [ ] **Step 1: dailySync.ts 현재 상태 확인**

```bash
# 라인 26-31 SyncOptions, 251-270 predictRace 실행 부분 확인
```

- [ ] **Step 2: SyncOptions skipPredictions 기본값 변경**

dailySync.ts 라인 26-31:

```typescript
interface SyncOptions {
  rcDate: number;
  meets?: MeetCode[];
  /** 백필·라이브: 기본값 true (predictions 생성 안 함) */
  skipPredictions?: boolean;  // ← 기본값 true로 변경됨
}
```

- [ ] **Step 3: predictRace 실행 부분 주석 처리**

dailySync.ts 라인 251-270을 다음과 같이 수정:

```typescript
// 5. Score Engine → predictions (기본 제거, 백필만 사용)
// dailySync는 사전 예측을 건드리지 않음
// if (!skipPredictions) { 
//   const predictions = await predictRace(...);
//   ...
// }
// 단, 예측이 없는 경우 보충 로직은 아래에서 처리
```

- [ ] **Step 4: 예측 없는 경우 보충 로직 추가**

dailySync.ts 라인 250 근처에 추가:

```typescript
// 예측이 없는 경우 보충 (사전 모드)
const missingPredictions: Array<{
  race_date: number;
  meet: number;
  rc_no: number;
}> = [];

for (const entry of entries) {
  const { data: existing } = await supabase
    .from('predictions')
    .select('id')
    .eq('race_date', rcDate)
    .eq('meet', meet)
    .eq('rc_no', rcNo)
    .eq('hr_name', entry.hr_name)
    .single();
  
  if (!existing) {
    missingPredictions.push({
      race_date: rcDate,
      meet: meet,
      rc_no: rcNo
    });
  }
}

// 보충 예측 (사전 모드 강제)
if (missingPredictions.length > 0) {
  console.warn(`⚠️ 예측 미보유 ${missingPredictions.length}건 → 금요일 보충`);
  
  const uniqueRaces = [...new Set(
    missingPredictions.map(p => `${p.race_date}-${p.meet}-${p.rc_no}`)
  )];
  
  for (const raceKey of uniqueRaces) {
    const [date, meetStr, rcNoStr] = raceKey.split('-');
    const predictions = await predictRace(
      supabase as unknown as ReadClient,
      parseInt(date),
      parseInt(meetStr),
      parseInt(rcNoStr),
      { forcePrecompetition: true }  // ← 사전 모드 강제
    );
    
    if (predictions.length > 0) {
      const { error } = await supabase
        .from('predictions')
        .insert(predictions);
      if (error) throw error;
    }
  }
}
```

- [ ] **Step 5: 테스트 작성**

`tests/sync/dailySync.test.ts` 생성:

```typescript
import { dailySync } from '../../src/sync/dailySync';
import { describe, it, expect, beforeEach } from 'vitest';

describe('dailySync', () => {
  it('should not recalculate predictions by default', async () => {
    // race_entries에만 ord 저장되고
    // predictions은 계산되지 않음을 확인
    
    // 수요일 사전 예측이 존재
    await mockSupabase.from('predictions').insert({
      race_date: 20260710,
      meet: 1,
      rc_no: 1,
      hr_name: '말1',
      predicted_rank: 1,
      p_top3: 0.75
    });
    
    // 금요일 dailySync 실행
    await dailySync({ rcDate: 20260710, meets: [1] });
    
    // predictions 확인: 여전히 predicted_rank=1
    const { data: pred } = await mockSupabase
      .from('predictions')
      .select('predicted_rank')
      .eq('race_date', 20260710)
      .single();
    
    expect(pred.predicted_rank).toBe(1);  // 변경 안 됨
  });

  it('should supplement missing predictions with precompetition mode', async () => {
    // 예측이 없는 경주 → 금요일에 보충
    
    // race_entries만 생성 (predictions은 없음)
    await mockSupabase.from('race_entries').insert({
      race_date: 20260710,
      meet: 1,
      rc_no: 1,
      hr_name: '말1',
      ord: null  // 사전 상태
    });
    
    // dailySync 실행
    await dailySync({ rcDate: 20260710, meets: [1] });
    
    // 로그에서 보충 경고 확인
    // predictions 저장 확인
    const { data: pred } = await mockSupabase
      .from('predictions')
      .select('actual_ord')
      .eq('race_date', 20260710)
      .single();
    
    expect(pred.actual_ord).toBeNull();  // 사전 모드 (NULL)
  });
});
```

- [ ] **Step 6: 테스트 실행**

```bash
npm run test:run -- tests/sync/dailySync.test.ts
# 예상: PASS
```

- [ ] **Step 7: 빌드 확인**

```bash
npm run build
```

- [ ] **Step 8: 커밋**

```bash
git add src/sync/dailySync.ts tests/sync/dailySync.test.ts
git commit -m "feat(dailySync): remove predictions recalculation, add supplement logic

- predictions 재계산 제거 (skipPredictions 기본값 true)
- race_entries에만 결과(ord) 저장
- 예측 누락 시 금요일에 사전 모드로 보충 (forcePrecompetition)"
```

---

## Task 3: TodayPicks 화면 필터 변경

**Files:**
- Modify: `client/src/lib/queries.ts:243-250` (useUpcomingPicks)
- Modify: `client/src/lib/supabase.ts` (getTodayRaceDate 추가 또는 기존 재사용)
- Create: `client/src/components/TodayPicks.test.tsx` (신규 테스트)

**Interfaces:**
- Consumes: predictions 테이블 (race_date, p_top3)
- Produces: TodayPicks 컴포넌트가 race_date=TODAY만 표시

- [ ] **Step 1: getTodayRaceDate 유틸 확인 또는 작성**

```bash
# client/src/lib/supabase.ts에서 getTodayRaceDate 확인
# 없으면 추가
```

client/src/lib/supabase.ts에 추가 (없는 경우):

```typescript
/**
 * 오늘 경주 날짜를 race_date 형식(YYYYMMDD)으로 반환
 */
export function getTodayRaceDate(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return parseInt(`${year}${month}${date}`);
}
```

- [ ] **Step 2: useUpcomingPicks 쿼리 변경**

client/src/lib/queries.ts 라인 243-250:

```typescript
export function useUpcomingPicks() {
  return useQuery({
    queryKey: ['upcoming-picks'],
    queryFn: async (): Promise<Prediction[]> => {
      const today = getTodayRaceDate();
      
      const { data } = await supabase
        .from('predictions')
        .select('*')
        .eq('race_date', today)  // ← 변경: 정확한 오늘 날짜
        .gte('p_top3', 0.62)  // 강추/주목 모두
        .order('race_date')
        .order('meet')
        .order('rc_no');
      
      return (data ?? []) as Prediction[];
    }
  });
}
```

- [ ] **Step 3: 테스트 작성**

`client/src/components/TodayPicks.test.tsx` 생성:

```typescript
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TodayPicks from './TodayPicks';

describe('TodayPicks', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-07-12'));  // 일요일
  });

  it('should only show today\'s races', async () => {
    // 과거 경주도 predictions에 있지만
    // 오늘(20260712) 경주만 표시됨을 확인
    
    const queryClient = new QueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <TodayPicks />
      </QueryClientProvider>
    );
    
    // 오늘 경주는 보임
    const todayRace = await screen.findByText(/20260712/);
    expect(todayRace).toBeInTheDocument();
    
    // 과거 경주는 보이지 않음
    const pastRace = screen.queryByText(/20260705/);
    expect(pastRace).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 테스트 실행**

```bash
npm run test:run -- client/src/components/TodayPicks.test.tsx
# 예상: PASS
```

- [ ] **Step 5: 브라우저에서 화면 확인 (수동 테스트)**

```bash
npm run client:dev
# http://localhost:5173에서 TodayPicks 확인
# - 오늘 경주만 표시
# - 과거 경주 섞이지 않음
```

- [ ] **Step 6: 커밋**

```bash
git add client/src/lib/queries.ts client/src/lib/supabase.ts client/src/components/TodayPicks.test.tsx
git commit -m "feat(TodayPicks): replace defense filter with race_date=TODAY

- 방어 필터(7일) 제거
- getTodayRaceDate 유틸로 명확한 필터링
- predictions 무변경이므로 과거 기록도 조회 가능"
```

---

## Task 4: probe:v7-accuracy 스크립트 구현

**Files:**
- Create: `scripts/probe_v7_accuracy.ts`
- Create: `tests/scripts/probe_v7_accuracy.test.ts`
- Modify: `package.json` (scripts 항목에 추가, 있으면 수정)

**Interfaces:**
- Consumes: predictions, race_entries 테이블
- Produces: v7 라이브 적중률 JSON 또는 CLI 출력
  ```typescript
  interface V7Result {
    category: '강추' | '주목' | '전체';
    total: number;
    correct: number;
    accuracy: number;
  }
  ```

- [ ] **Step 1: 스크립트 틀 작성**

`scripts/probe_v7_accuracy.ts` 생성:

```typescript
/**
 * v7 라이브 판정
 * 
 * usage:
 *   npm run probe:v7-accuracy [--from YYYYMMDD] [--to YYYYMMDD]
 * 
 * 예:
 *   npm run probe:v7-accuracy --from 20260712 --to 20260714
 */

import { getSupabaseAdmin } from '../src/db/supabase.js';

interface V7Result {
  category: '강추' | '주목' | '전체';
  label: string;
  threshold: number;
  total: number;
  correct: number;
  accuracy: number;  // 퍼센트
}

async function probeV7Accuracy(opts: {
  from?: number;
  to?: number;
}): Promise<V7Result[]> {
  const sb = getSupabaseAdmin();
  
  const from = opts.from ?? 20260712;  // 이번 주말 기본값
  const to = opts.to ?? 20261231;      // 연말 기본값
  
  const { data: joined, error } = await sb
    .from('predictions')
    .select(`
      race_date, meet, rc_no, hr_name,
      predicted_rank, p_top3, p_win,
      race_entries!inner(ord)
    `)
    .gte('race_date', from)
    .lte('race_date', to)
    .not('p_top3', 'is', null);
  
  if (error) throw error;
  
  const rows = (joined ?? []) as any[];
  
  const categories = [
    { cat: '강추', threshold: 0.72, label: 'Strong Pick (≥0.72)' },
    { cat: '주목', threshold: 0.62, label: 'Notice (≥0.62)' },
    { cat: '전체', threshold: 0.0, label: 'All (all)' }
  ];
  
  const results: V7Result[] = categories.map(({ cat, threshold, label }) => {
    const filtered = rows.filter(r => r.p_top3 >= threshold);
    const correct = filtered.filter(r => 
      r.race_entries?.ord !== null && r.race_entries?.ord <= 3
    ).length;
    
    return {
      category: cat as '강추' | '주목' | '전체',
      label,
      threshold,
      total: filtered.length,
      correct,
      accuracy: filtered.length > 0 
        ? Math.round((correct / filtered.length) * 1000) / 10  // 소수점 1자리
        : 0
    };
  });
  
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  
  let from: number | undefined;
  let to: number | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      from = parseInt(args[i + 1]);
    }
    if (args[i] === '--to' && args[i + 1]) {
      to = parseInt(args[i + 1]);
    }
  }
  
  const results = await probeV7Accuracy({ from, to });
  
  console.log('\n🏇 v7 라이브 판정\n');
  results.forEach(r => {
    console.log(`${r.label}`);
    console.log(`  적중률: ${r.accuracy}% (${r.correct}/${r.total})\n`);
  });
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: package.json에 스크립트 추가**

package.json에 scripts 섹션 수정:

```json
{
  "scripts": {
    ...
    "probe:v7-accuracy": "tsx scripts/probe_v7_accuracy.ts"
  }
}
```

- [ ] **Step 3: 테스트 작성**

`tests/scripts/probe_v7_accuracy.test.ts` 생성:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { probeV7Accuracy } from '../../scripts/probe_v7_accuracy';

describe('probe:v7-accuracy', () => {
  it('should calculate accuracy correctly', async () => {
    // Mock predictions + race_entries JOIN 결과
    // 강추 10건 중 7건 적중 (ord <= 3)
    // → accuracy = 70%
    
    const results = await probeV7Accuracy({ 
      from: 20260712, 
      to: 20260714 
    });
    
    const strongPick = results.find(r => r.category === '강추');
    expect(strongPick?.accuracy).toBeGreaterThan(0);
    expect(strongPick?.correct).toBeLessThanOrEqual(strongPick?.total ?? 0);
  });

  it('should handle empty result set', async () => {
    const results = await probeV7Accuracy({ 
      from: 20000101,  // 먼 과거
      to: 20000102
    });
    
    results.forEach(r => {
      expect(r.total).toBe(0);
      expect(r.accuracy).toBe(0);
    });
  });
});
```

- [ ] **Step 4: 테스트 실행**

```bash
npm run test:run -- tests/scripts/probe_v7_accuracy.test.ts
# 예상: PASS
```

- [ ] **Step 5: 스크립트 수동 실행 테스트**

```bash
npm run probe:v7-accuracy --from 20260712 --to 20260714
# 예상: 강추/주목/전체 적중률 출력
```

- [ ] **Step 6: 커밋**

```bash
git add scripts/probe_v7_accuracy.ts tests/scripts/probe_v7_accuracy.test.ts package.json
git commit -m "feat(scripts): add probe:v7-accuracy for live accuracy tracking

v7 모델의 라이브 적중률 판정 스크립트.
- predictions과 race_entries JOIN
- 강추/주목/전체 카테고리별 적중률 계산
- CLI 출력 형식"
```

---

## Task 5: 통합 테스트 및 배포 준비

**Files:**
- Modify: `docs/prediction_mode.md` (변경 기록 추가)
- Modify: `docs/api_spec.md` (predictRace 옵션 문서화)
- Create: `.superpowers/sdd/v7-live-tracking-e2e.test.ts` (E2E 테스트)

**Interfaces:**
- Consumes: 모든 이전 태스크 결과
- Produces: 배포 가능 상태 (테스트 통과, 문서 최신화)

- [ ] **Step 1: E2E 통합 테스트 작성**

`.superpowers/sdd/v7-live-tracking-e2e.test.ts` 생성:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { dailySync } from '../src/sync/dailySync.js';
import { raceCardSync } from '../src/sync/raceCardSync.js';
import { probeV7Accuracy } from '../scripts/probe_v7_accuracy.js';

describe('v7 Live Tracking E2E', () => {
  const testDate = 20260712;
  const sb = getSupabaseAdmin();
  
  beforeAll(async () => {
    // 테스트 데이터 정리
    await sb.from('predictions').delete().eq('race_date', testDate);
    await sb.from('race_entries').delete().eq('race_date', testDate);
  });
  
  afterAll(async () => {
    // 테스트 데이터 정리
    await sb.from('predictions').delete().eq('race_date', testDate);
    await sb.from('race_entries').delete().eq('race_date', testDate);
  });

  it('should preserve pre-competition predictions through daily sync', async () => {
    // 1. 수요일: raceCardSync (사전 예측 저장)
    await raceCardSync({ rcDate: testDate, meets: [1] });
    
    const { data: predAfterCard } = await sb
      .from('predictions')
      .select('predicted_rank')
      .eq('race_date', testDate)
      .eq('meet', 1)
      .limit(1);
    
    expect(predAfterCard?.length).toBeGreaterThan(0);
    const originalRank = predAfterCard?.[0]?.predicted_rank;
    
    // 2. 금요일: race_entries에 결과 추가, dailySync 실행
    // (모의 결과 업데이트)
    await sb.from('race_entries')
      .update({ ord: 2 })
      .eq('race_date', testDate);
    
    await dailySync({ rcDate: testDate, meets: [1] });
    
    // 3. predictions이 무변경 확인
    const { data: predAfterDaily } = await sb
      .from('predictions')
      .select('predicted_rank')
      .eq('race_date', testDate)
      .eq('meet', 1)
      .limit(1);
    
    expect(predAfterDaily?.[0]?.predicted_rank).toBe(originalRank);
    
    // 4. 라이브 판정 실행
    const results = await probeV7Accuracy({ from: testDate, to: testDate });
    
    expect(results).toBeDefined();
    expect(results.some(r => r.total > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: E2E 테스트 실행**

```bash
npm run test:run -- .superpowers/sdd/v7-live-tracking-e2e.test.ts
# 예상: PASS (전체 플로우 동작 확인)
```

- [ ] **Step 3: 문서 업데이트 - prediction_mode.md**

docs/prediction_mode.md 마지막에 추가:

```markdown
## 8. v7 라이브 추적 변경 (2026-07-11)

dailySync에서 predictions 재계산을 제거하고 사전 예측을 보존:

- **변경 전**: dailySync → DELETE + INSERT (사후 예측 재계산)
- **변경 후**: dailySync → race_entries만 업데이트 (predictions 무변경)
- **보충**: 예측 누락 시 금요일에 사전 모드로 보충 (forcePrecompetition)
- **화면**: 방어 필터 제거, race_date=TODAY로 변경
- **판정**: probe:v7-accuracy 스크립트로 라이브 적중률 계산

→ v7 라이브 성능을 정직하게 판정 가능
```

- [ ] **Step 4: 문서 업데이트 - api_spec.md**

docs/api_spec.md에서 predictRace 섹션 찾아 수정:

```markdown
### predictRace()

**시그니처:**
```typescript
async function predictRace(
  sb: ReadClient,
  rcDate: number,
  meet: number,
  rcNo: number,
  opts?: { 
    forcePrecompetition?: boolean;
    shapeParCutoff?: number;
  }
): Promise<PredictionRow[]>
```

**옵션:**
- `forcePrecompetition`: true일 때 ord 값을 무시하고 사전 모드로 강제.
  금요일 보충 예측 시 사용 (실제 결과를 알아도 사전 데이터로만 계산).
```

- [ ] **Step 5: 빌드 및 타입 확인**

```bash
npm run build
# 예상: tsc 타입체크 통과, no errors
```

- [ ] **Step 6: 전체 테스트 실행**

```bash
npm run test:run
# 예상: 모든 테스트 PASS
```

- [ ] **Step 7: 커밋**

```bash
git add docs/prediction_mode.md docs/api_spec.md .superpowers/sdd/v7-live-tracking-e2e.test.ts
git commit -m "docs,test: update docs and add E2E test for v7 live tracking

- prediction_mode.md: v7 라이브 추적 변경 기록
- api_spec.md: forcePrecompetition 옵션 문서화
- E2E 테스트: 전체 플로우 동작 확인"
```

---

## Task 6: 배포 (주말 아침)

**Files:**
- (변경 없음)

**Interfaces:**
- Consumes: Task 1-5 완료 상태
- Produces: main 브랜치 배포 가능 상태

- [ ] **Step 1: 최종 빌드 확인**

```bash
npm run build
npm run test:run
# 예상: 모두 성공
```

- [ ] **Step 2: git 상태 확인**

```bash
git status
# 예상: clean (모든 변경 커밋됨)

git log --oneline -6
# 예상: 6개 커밋 (Task 1-6)
```

- [ ] **Step 3: main 브랜치 동기화 확인**

```bash
git fetch origin
git log origin/main..main
# 예상: 6개 커밋 ahead
```

- [ ] **Step 4: Vercel 배포 (자동 또는 수동)**

```bash
# main에 push하면 GitHub Actions / Vercel이 자동 배포
git push origin main

# 수동 배포 필요 시:
# Vercel 대시보드에서 "Deploy" 버튼 클릭
```

- [ ] **Step 5: 배포 확인**

```bash
# Vercel 배포 완료 후 라이브 확인
# https://horse-racing-xi-one.vercel.app

# - TodayPicks가 오늘 경주만 표시
# - 과거 경주 없음
# - 스크립트 실행 가능: npm run probe:v7-accuracy
```

- [ ] **Step 6: 라이브 판정 스크립트 첫 실행**

```bash
npm run probe:v7-accuracy --from 20260712 --to 20260714
# 출력 예시:
# 🏇 v7 라이브 판정
# Strong Pick (≥0.72)
#   적중률: 73.1% (37/50)
# Notice (≥0.62)
#   적중률: 65.4% (98/150)
# All (all)
#   적중률: 61.9% (...)
```

- [ ] **Step 7: 세션 기록 작성**

docs/session_history.md 마지막에 추가:

```markdown
## 2026-07-11 (금요일 오전) — v7 라이브 적중률 추적 구현 (L-001) 완료

전체 설계 → 구현 → 배포.

① predictions 보존 전략 설계 (스펙 6개 섹션 검토)
② 6개 태스크 구현 (forcePrecompetition 옵션 ~ E2E 테스트)
③ 문서·테스트 최신화
④ 주말 아침 배포 (main 브랜치)

결과:
- predictions은 수요일에만 저장, 금요일 무변경 ✓
- race_entries에는 결과(ord)만 저장 ✓
- 화면 필터: race_date=TODAY (방어 필터 제거) ✓
- probe:v7-accuracy로 라이브 판정 가능 ✓

다음: 주말부터 v7 라이브 적중률 추적 시작
```

---

## 체크리스트

- [ ] Task 1: forcePrecompetition 옵션 구현 ✓
- [ ] Task 2: dailySync predictRace 제거 + 보충 로직 ✓
- [ ] Task 3: TodayPicks 화면 필터 변경 ✓
- [ ] Task 4: probe:v7-accuracy 스크립트 ✓
- [ ] Task 5: 통합 테스트 + 문서 업데이트 ✓
- [ ] Task 6: 배포 ✓
