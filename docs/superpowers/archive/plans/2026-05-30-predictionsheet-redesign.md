# PredictionSheet 카드 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PredictionSheet 말 카드를 제안3 구조로 재설계한다 — 카드 헤더 분리, 말정보 라벨 제거 + 같은거리 하이라이트 박스, 기수정보에 조교·진료·조합이력 통합, 직전경주 테이블화(조건 컬럼 추가), 항목점수 높이 밸런스 조정.

**Architecture:** PredictionSheet.tsx의 4개 컬럼 컴포넌트(ColHorseInfo, ColJockeyInfo, ColHistory, Col5Items)를 각각 재작성하고, 카드 헤더를 별도 컴포넌트로 분리한다. 신규 데이터(prize_cond)를 위한 배치 훅을 queries.ts에 추가한다.

**Tech Stack:** React, TypeScript, Tailwind CSS, Supabase, @tanstack/react-query, vitest

---

## 파일 변경 맵

| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `client/src/lib/queries.ts` | 수정 | `useHistoryRacesPrizeCond` 훅 추가 |
| `client/src/pages/PredictionSheet.tsx` | 수정 | 전체 카드 구조 재작성 (6개 변경 지점) |
| `client/src/pages/PredictionSheet.test.ts` | 신규 | `computeSameDistStats` 유닛 테스트 |

---

## Task 1: prize_cond 배치 조회 훅

**Files:**
- Modify: `client/src/lib/queries.ts` (끝에 추가)

- [ ] **Step 1: 훅 추가**

`queries.ts` 파일 맨 끝 `useHorseGateStatsBatch` 함수 아래에 다음을 추가한다.

```typescript
/**
 * 히스토리 경주들의 prize_cond 배치 조회
 * - ColHistory에서 경기조건 컬럼 표시에 사용
 * - key: `${race_date}-${meet}-${rc_no}` → prize_cond
 */
export function useHistoryRacesPrizeCond(
  keys: Array<{ race_date: number; meet: number; rc_no: number }>
) {
  const sortedKey = keys
    .map((k) => `${k.race_date}-${k.meet}-${k.rc_no}`)
    .sort()
    .join(',');

  return useQuery({
    queryKey: ['history-races-prize-cond', sortedKey],
    queryFn: async (): Promise<Map<string, string>> => {
      if (keys.length === 0) return new Map();
      const uniqueKeys = [...new Map(keys.map((k) => [`${k.race_date}-${k.meet}-${k.rc_no}`, k])).values()];

      const { data, error } = await supabase
        .from('races')
        .select('race_date, meet, rc_no, prize_cond')
        .in(
          'race_date',
          [...new Set(uniqueKeys.map((k) => k.race_date))]
        );
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of data ?? []) {
        if (r.prize_cond) {
          map.set(`${r.race_date}-${r.meet}-${r.rc_no}`, r.prize_cond);
        }
      }
      return map;
    },
    enabled: keys.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add client/src/lib/queries.ts
git commit -m "feat(queries): useHistoryRacesPrizeCond 배치 훅 추가"
```

---

## Task 2: computeSameDistStats 유틸 + 히스토리 limit 확장

**Files:**
- Create: `client/src/pages/PredictionSheet.test.ts`
- Modify: `client/src/pages/PredictionSheet.tsx` (computeSameDistStats 함수 추가, useMultipleHorseHistories limit 변경)

- [ ] **Step 1: 테스트 파일 작성**

`client/src/pages/PredictionSheet.test.ts`를 새로 만든다.

```typescript
import { describe, it, expect } from 'vitest';
import type { RaceEntry } from '../lib/supabase';

// computeSameDistStats를 직접 테스트하기 위해 모듈에서 export가 필요하다.
// 이 테스트를 작성한 후 구현 시 함수를 export한다.
import { computeSameDistStats } from './PredictionSheet';

function makeEntry(overrides: Partial<RaceEntry>): RaceEntry {
  return {
    race_date: 20260501,
    meet: 1,
    rc_no: 1,
    pthr_no: 1,
    hr_name: 'TestHorse',
    ag: null, gndr: null, burd_wgt: null, ratg: null,
    jcky_no: null, jcky_nm: null, trar_no: null, trar_nm: null,
    erng_sump: null, erng_loy: null, erng_lsm: null,
    prds: null, owner_nm: null,
    sump_rcod_fplc: null, sump_rcod_splc: null, sump_rcod_tplc: null, sump_rcod_sum: null,
    rc_dist: null, track_type: null,
    hr_no: null, ord: null, rc_time: null,
    wg_hr: null, wg_hr_diff: null, wg_jk: null,
    win_odds: null, popularity: null, result_at: null,
    asis_equip1: null, asis_equip2: null, asis_equip3: null, asis_equip4: null, asis_equip5: null,
    latst_bledg1: null, latst_bledg2: null, latst_trea1_txt: null, latst_trea2_txt: null,
    ...overrides,
  };
}

describe('computeSameDistStats', () => {
  it('대상 거리 경주가 없으면 null을 반환한다', () => {
    const history = [
      makeEntry({ rc_dist: 1200, rc_time: 75.3, ord: 1 }),
      makeEntry({ rc_dist: 1200, rc_time: 76.1, ord: 2 }),
    ];
    expect(computeSameDistStats(history, 1400)).toBeNull();
  });

  it('rc_time이 null이거나 0인 경주는 무시한다', () => {
    const history = [
      makeEntry({ rc_dist: 1400, rc_time: null, ord: 1 }),
      makeEntry({ rc_dist: 1400, rc_time: 0, ord: 2 }),
    ];
    expect(computeSameDistStats(history, 1400)).toBeNull();
  });

  it('같은 거리 최고·평균·전적을 올바르게 계산한다', () => {
    const history = [
      makeEntry({ rc_dist: 1400, rc_time: 86.0, ord: 1, burd_wgt: 56, track_type: '양호', pthr_no: 3 }),
      makeEntry({ rc_dist: 1400, rc_time: 87.5, ord: 2, burd_wgt: 55, track_type: '불량', pthr_no: 5 }),
      makeEntry({ rc_dist: 1400, rc_time: 88.0, ord: 4, burd_wgt: 55, track_type: '양호', pthr_no: 2 }),
      makeEntry({ rc_dist: 1200, rc_time: 72.0, ord: 1, burd_wgt: 54, track_type: '양호', pthr_no: 1 }),
    ];
    const result = computeSameDistStats(history, 1400);
    expect(result).not.toBeNull();
    expect(result!.bestTime).toBeCloseTo(86.0);
    expect(result!.bestBurdWgt).toBe(56);
    expect(result!.bestTrackType).toBe('양호');
    expect(result!.bestOrd).toBe(1);
    expect(result!.bestPthrNo).toBe(3);
    expect(result!.avgTime).toBeCloseTo((86.0 + 87.5 + 88.0) / 3);
    expect(result!.count).toBe(3);
    expect(result!.wins).toBe(1);
    expect(result!.places).toBe(2);
    expect(result!.shows).toBe(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd client && npx vitest run src/pages/PredictionSheet.test.ts
```

Expected: FAIL — `computeSameDistStats` not exported

- [ ] **Step 3: computeSameDistStats 구현 및 export**

`PredictionSheet.tsx`에서 `computeTimeStats` 함수 아래에 다음을 추가하고, 기존 `computeSameDistStats` 인터페이스를 정의한다.

```typescript
export interface SameDistStats {
  bestTime: number;
  bestBurdWgt: number | null;
  bestTrackType: string | null;
  bestOrd: number | null;
  bestPthrNo: number;
  avgTime: number;
  count: number;
  wins: number;
  places: number;
  shows: number;
}

export function computeSameDistStats(
  history: RaceEntry[],
  targetDist: number
): SameDistStats | null {
  const valid = history.filter(
    (h) => h.rc_dist === targetDist && h.rc_time != null && h.rc_time > 0
  );
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => a.rc_time! - b.rc_time!);
  const best = sorted[0]!;
  const avgTime = valid.reduce((s, h) => s + h.rc_time!, 0) / valid.length;

  return {
    bestTime: best.rc_time!,
    bestBurdWgt: best.burd_wgt,
    bestTrackType: best.track_type,
    bestOrd: best.ord,
    bestPthrNo: best.pthr_no,
    avgTime,
    count: valid.length,
    wins: valid.filter((h) => h.ord === 1).length,
    places: valid.filter((h) => h.ord != null && h.ord <= 2).length,
    shows: valid.filter((h) => h.ord != null && h.ord <= 3).length,
  };
}
```

- [ ] **Step 4: useMultipleHorseHistories limit을 10으로 변경**

`PredictionSheet.tsx`에서 `useMultipleHorseHistories` 함수 안의 `.limit(5)`를 `.limit(10)`으로 변경한다.

```typescript
// 변경 전
.limit(limit);
// 기본값도 변경: limit = 5 → limit = 10
```

함수 시그니처:
```typescript
function useMultipleHorseHistories(hrNames: string[], beforeDate: number, limit = 10) {
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd client && npx vitest run src/pages/PredictionSheet.test.ts
```

Expected: PASS (3개 테스트 모두)

- [ ] **Step 6: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx client/src/pages/PredictionSheet.test.ts
git commit -m "feat(sheet): computeSameDistStats 유틸 추가, 히스토리 limit 10으로 확장"
```

---

## Task 3: CardHeader 컴포넌트 + HorseCard 그리드 비율 변경

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx` (CardHeader 추가, HorseCard 수정)

- [ ] **Step 1: accentColor 헬퍼 추출**

`HorseCard` 함수 위에 다음 헬퍼를 추가한다 (PODIUM_STYLES 활용).

```typescript
function rankAccentColor(pRank: number): string {
  if (pRank === 1) return '#ffd700';
  if (pRank === 2) return '#a8a8b3';
  if (pRank === 3) return '#cd7f32';
  return 'var(--color-accent-cyan)';
}

function rankEmoji(pRank: number): string {
  if (pRank === 1) return '🥇';
  if (pRank === 2) return '🥈';
  if (pRank === 3) return '🥉';
  if (pRank >= 999) return '';
  return `${pRank}위`;
}
```

- [ ] **Step 2: CardHeader 컴포넌트 작성**

`HorseCard` 함수 위에 추가한다.

```typescript
function CardHeader({
  horse,
  prediction,
  runningStyle,
  racingGap,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  runningStyle: RunningStyle;
  racingGap: number | null;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const pScore = prediction?.total_score ?? 0;
  const accent = rankAccentColor(pRank);

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-bg-elevated)] flex-wrap"
      style={{ background: 'var(--color-bg-elevated)' }}
    >
      {/* 번호 + 마명 */}
      <span className="text-[17px] font-extrabold font-mono-num" style={{ color: 'var(--color-accent-cyan)' }}>
        {horse.pthr_no}
      </span>
      <span className="text-[15px] font-bold">{horse.hr_name}</span>

      {/* 주행성향 배지 */}
      {runningStyle !== 'unknown' && (() => {
        const info = STYLE_INFO[runningStyle];
        return (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold border ${info.className}`}>
            {info.emoji} {info.shortName}
          </span>
        );
      })()}

      {/* 공백 배지 (30일+ 시 gold) */}
      {racingGap != null && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border"
          style={{
            color: racingGap >= 30 ? 'var(--color-accent-gold)' : 'var(--color-text-disabled)',
            borderColor: racingGap >= 30 ? 'rgba(255,215,0,0.4)' : 'var(--color-bg-elevated)',
            background: racingGap >= 30 ? 'rgba(255,215,0,0.08)' : 'transparent',
          }}
        >
          공백 {racingGap}일{racingGap >= 30 ? ' [장기]' : ''}
        </span>
      )}

      {/* AI 점수바 + 총점 + 순위 이모지 (우측 정렬) */}
      <div className="ml-auto flex items-center gap-2">
        {pRank < 999 && (
          <>
            <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-elevated)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(pScore, 100)}%`, background: accent }}
              />
            </div>
            <span className="text-[11px] font-mono-num font-semibold" style={{ color: accent }}>
              {pScore.toFixed(1)}
            </span>
            <span className="text-[17px]">{rankEmoji(pRank)}</span>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: HorseCard에서 CardHeader 사용 + 그리드 비율 변경**

`HorseCard` 함수 전체를 다음으로 교체한다.

```typescript
function HorseCard({
  horse,
  prediction,
  history,
  runningStyle,
  bloodline,
  trainerStat,
  jockeyStat,
  latestTraining,
  jockeyHorseCombo,
  gateStats,
  prizeCondMap,
  viewMode,
  onViewModeChange,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  history: RaceEntry[];
  runningStyle: RunningStyle;
  bloodline: BloodlineInfo | undefined;
  trainerStat: { total: number; wins: number } | undefined;
  jockeyStat: JockeyStat | undefined;
  latestTraining: TrainingLog | undefined;
  jockeyHorseCombo: JockeyHorseComboStat | undefined;
  gateStats: Map<number, { total: number; wins: number }> | undefined;
  prizeCondMap: Map<string, string>;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const accent = rankAccentColor(pRank);
  const borderColor = pRank <= 3 ? `${accent}50` : 'var(--color-bg-elevated)';

  const lastRaceDate = history[0]?.race_date ?? null;
  const racingGap = lastRaceDate != null ? daysBetween(horse.race_date, lastRaceDate) : null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-surface)', border: `1px solid ${borderColor}` }}
    >
      {/* 헤더 */}
      <CardHeader
        horse={horse}
        prediction={prediction}
        runningStyle={runningStyle}
        racingGap={racingGap}
      />

      {/* 본문 4열 그리드 — 모바일: 2+2, 데스크탑: 1.5fr 1.2fr 2.8fr 1.5fr */}
      <div className="grid grid-cols-2 md:[grid-template-columns:1.5fr_1.2fr_2.8fr_1.5fr]">
        <div className="border-b border-r border-[var(--color-bg-elevated)] md:border-b-0">
          <ColHorseInfo
            horse={horse}
            prediction={prediction}
            runningStyle={runningStyle}
            accentColor={accent}
            bloodline={bloodline}
            history={history}
            trainerStat={trainerStat}
            gateStats={gateStats}
          />
        </div>
        <div className="border-b border-[var(--color-bg-elevated)] md:border-b-0 md:border-r">
          <ColJockeyInfo
            horse={horse}
            history={history}
            jockeyStat={jockeyStat}
            jockeyHorseCombo={jockeyHorseCombo}
            latestTraining={latestTraining}
          />
        </div>
        <div className="col-span-2 md:col-span-1 border-b border-[var(--color-bg-elevated)] md:border-b-0 md:border-r">
          <ColHistory history={history.slice(0, 5)} prizeCondMap={prizeCondMap} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <Col5Items
            itemScores={prediction?.item_scores}
            accentColor={accent}
            pRank={pRank}
            pScore={prediction?.total_score ?? 0}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: ColHorseInfo/ColJockeyInfo/ColHistory/Col5Items prop 타입 오류 예상 — Task 4~7에서 해결

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx
git commit -m "feat(sheet): CardHeader 분리 + HorseCard 그리드 1.5fr/1.2fr/2.8fr/1.5fr"
```

---

## Task 4: ColHorseInfo 재작성

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx` (ColHorseInfo 전체 교체)

- [ ] **Step 1: ColHorseInfo 전체 교체**

기존 `ColHorseInfo` 함수 전체를 다음으로 교체한다.

```typescript
function ColHorseInfo({
  horse,
  prediction,
  runningStyle: _runningStyle,
  accentColor: _accentColor,
  bloodline,
  history,
  trainerStat,
  gateStats,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  runningStyle: RunningStyle;
  accentColor: string;
  bloodline: BloodlineInfo | undefined;
  history: RaceEntry[];
  trainerStat: { total: number; wins: number } | undefined;
  gateStats: Map<number, { total: number; wins: number }> | undefined;
}) {
  const sameDistStats = useMemo(
    () => (horse.rc_dist != null ? computeSameDistStats(history, horse.rc_dist) : null),
    [history, horse.rc_dist]
  );

  const total = horse.sump_rcod_sum ?? 0;
  const fplc = horse.sump_rcod_fplc ?? 0;
  const splc = horse.sump_rcod_splc ?? 0;
  const tplc = horse.sump_rcod_tplc ?? 0;
  const rest = Math.max(total - fplc - splc - tplc, 0);
  const careerStr = total > 0 ? `${total}전 ${fplc}/${splc}/${tplc}/${rest}` : null;

  const trainerWinRate =
    trainerStat && trainerStat.total > 0
      ? `${trainerStat.wins}승/${trainerStat.total}전`
      : null;

  const currentGateStat = gateStats?.get(horse.pthr_no) ?? null;

  const currentEquip = [
    horse.asis_equip1, horse.asis_equip2, horse.asis_equip3,
    horse.asis_equip4, horse.asis_equip5,
  ].filter((e): e is string => !!e);
  const prevEquip = history[0]
    ? [history[0].asis_equip1, history[0].asis_equip2, history[0].asis_equip3,
       history[0].asis_equip4, history[0].asis_equip5].filter((e): e is string => !!e)
    : null;
  const equipAdded = prevEquip != null ? currentEquip.filter((e) => !prevEquip.includes(e)) : [];
  const equipRemoved = prevEquip != null ? prevEquip.filter((e) => !currentEquip.includes(e)) : [];
  const hasEquipChange = equipAdded.length > 0 || equipRemoved.length > 0;

  const dist = horse.rc_dist;

  return (
    <div className="p-2.5 flex flex-col gap-1 text-[12px]">
      {/* 나이 · 성 · 국적 · 레이팅 (라벨 없이) */}
      <div className="flex items-baseline gap-1.5 flex-wrap font-mono-num">
        {horse.ag != null && <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{horse.ag}세</span>}
        {horse.gndr && <span style={{ color: 'var(--color-text-secondary)' }}>{horse.gndr}</span>}
        {horse.prds && <span style={{ color: 'var(--color-text-secondary)' }}>· {horse.prds}</span>}
        {horse.ratg != null && horse.ratg > 0 && (
          <span className="font-bold" style={{ color: 'var(--color-accent-cyan)' }}>R{horse.ratg}</span>
        )}
      </div>

      {/* 혈통 */}
      {(bloodline?.dam_hr_nm || bloodline?.sire_hr_nm) && (
        <div style={{ color: 'var(--color-text-disabled)', fontSize: '11px' }}>
          {bloodline.dam_hr_nm ?? '?'}(모) · {bloodline.sire_hr_nm ?? '?'}(부)
        </div>
      )}

      {/* 조교사 · 마주 */}
      {(horse.trar_nm || horse.owner_nm) && (
        <div className="flex items-baseline gap-1.5 flex-wrap" style={{ color: 'var(--color-text-disabled)', fontSize: '11px' }}>
          {horse.trar_nm && (
            <span>
              {horse.trar_nm}
              {trainerWinRate && <span className="font-mono-num ml-1">({trainerWinRate})</span>}
              <span style={{ color: 'var(--color-text-disabled)' }}> 조교사</span>
            </span>
          )}
          {horse.trar_nm && horse.owner_nm && <span>·</span>}
          {horse.owner_nm && <span>{horse.owner_nm} <span style={{ color: 'var(--color-text-disabled)' }}>마주</span></span>}
        </div>
      )}

      {/* 통산전적 · 수득상금 */}
      <div className="flex items-baseline gap-1.5 flex-wrap font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
        {careerStr && <span>{careerStr}</span>}
        {horse.erng_sump != null && horse.erng_sump > 0 && (
          <span style={{ color: 'var(--color-text-disabled)' }}>{formatErng(horse.erng_sump)}</span>
        )}
      </div>

      {/* 마체중 · 공백 */}
      <div className="flex items-baseline gap-1.5 flex-wrap font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
        {horse.wg_hr != null && (
          <span>
            {horse.wg_hr}kg
            {horse.wg_hr_diff != null && horse.wg_hr_diff !== 0 && (
              <span
                className="ml-0.5"
                style={{ color: horse.wg_hr_diff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}
              >
                ({horse.wg_hr_diff > 0 ? '+' : ''}{horse.wg_hr_diff})
              </span>
            )}
          </span>
        )}
      </div>

      {/* 게이트 성적 */}
      {currentGateStat != null && currentGateStat.total >= 3 && (
        <div className="font-mono-num" style={{ color: 'var(--color-text-disabled)', fontSize: '11px' }}>
          {horse.pthr_no}번 게이트 {currentGateStat.total}전{' '}
          <span style={{ color: currentGateStat.wins > 0 ? 'var(--color-success)' : undefined }}>
            {currentGateStat.wins}승({Math.round((currentGateStat.wins / currentGateStat.total) * 100)}%)
          </span>
        </div>
      )}

      {/* 장구 변경 */}
      {(currentEquip.length > 0 || equipRemoved.length > 0) && (
        <div className="flex items-center gap-1 flex-wrap text-[11px]">
          {hasEquipChange && (
            <span
              className="px-1 rounded font-bold text-[10px]"
              style={{
                background: 'rgba(255,215,0,0.12)',
                color: 'var(--color-accent-gold)',
                border: '1px solid rgba(255,215,0,0.3)',
              }}
            >
              장구변경
            </span>
          )}
          {currentEquip.map((e) => (
            <span key={e} style={{ color: equipAdded.includes(e) ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
              {e}
            </span>
          ))}
          {equipRemoved.map((e) => (
            <span key={`rm-${e}`} className="line-through" style={{ color: 'var(--color-danger)' }}>{e}</span>
          ))}
        </div>
      )}

      {/* 구분선 */}
      <div className="border-t border-[var(--color-bg-elevated)] my-1" />

      {/* 같은거리 최고기록 하이라이트 박스 */}
      {dist != null && sameDistStats != null ? (
        <>
          <div
            className="rounded-md px-2 py-1.5"
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-bg-elevated)' }}
          >
            <div className="flex items-center gap-1 mb-1" style={{ fontSize: '9px', color: 'var(--color-accent-cyan)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <span>⚡</span>
              <span>{dist}m 최고</span>
            </div>
            <div className="font-mono-num font-bold" style={{ fontSize: '14px', color: 'var(--color-text-primary)' }}>
              {formatRcTime(sameDistStats.bestTime)}
            </div>
            <div className="font-mono-num" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              {[
                sameDistStats.bestBurdWgt != null ? `${sameDistStats.bestBurdWgt}kg` : null,
                sameDistStats.bestTrackType,
                sameDistStats.bestOrd != null ? `${sameDistStats.bestOrd}위` : null,
                `${sameDistStats.bestPthrNo}번 게이트`,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>

          {/* 같은거리 평균기록 */}
          <div
            className="rounded-md px-2 py-1.5"
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-bg-elevated)' }}
          >
            <div className="flex items-center gap-1 mb-1" style={{ fontSize: '9px', color: 'var(--color-text-disabled)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <span>—</span>
              <span>{dist}m 평균</span>
            </div>
            <div className="font-mono-num font-semibold" style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              {formatRcTime(sameDistStats.avgTime)}
            </div>
            <div className="font-mono-num" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              {sameDistStats.count}전 기준 · 전적 {sameDistStats.wins}/{sameDistStats.places - sameDistStats.wins}/{sameDistStats.shows - sameDistStats.places}
            </div>
          </div>
        </>
      ) : dist != null ? (
        <div style={{ fontSize: '11px', color: 'var(--color-text-disabled)' }}>
          {dist}m 경주 이력 없음
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: ColHorseInfo 관련 에러 없음 (다른 컴포넌트 에러는 Task 5~7에서 해결)

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx
git commit -m "feat(sheet): ColHorseInfo 재작성 — 라벨제거·같은거리 하이라이트 박스"
```

---

## Task 5: ColJockeyInfo 재작성

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx` (ColJockeyInfo 전체 교체)

- [ ] **Step 1: ColJockeyInfo 전체 교체**

기존 `ColJockeyInfo` 함수 전체를 다음으로 교체한다.

```typescript
function ColJockeyInfo({
  horse,
  history,
  jockeyStat,
  jockeyHorseCombo,
  latestTraining,
}: {
  horse: RaceEntry;
  history: RaceEntry[];
  jockeyStat: JockeyStat | undefined;
  jockeyHorseCombo: JockeyHorseComboStat | undefined;
  latestTraining: TrainingLog | undefined;
}) {
  const lastBurdWgt = history[0]?.burd_wgt ?? null;
  const burdDiff =
    horse.burd_wgt != null && lastBurdWgt != null ? horse.burd_wgt - lastBurdWgt : null;

  const hasHealth =
    horse.latst_bledg1 || horse.latst_bledg2 ||
    horse.latst_trea1_txt || horse.latst_trea2_txt;

  return (
    <div className="p-2.5 flex flex-col gap-2 text-[12px]">
      {/* 기수명 + 체중 */}
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {horse.jcky_nm ?? '-'}
          </span>
          {horse.wg_jk != null && (
            <span className="font-mono-num text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>
              {horse.wg_jk}kg
            </span>
          )}
        </div>

        {/* 부담중량 */}
        <div className="flex items-baseline gap-1 font-mono-num mt-0.5">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {horse.burd_wgt != null ? `${horse.burd_wgt}kg` : '-'}
          </span>
          {burdDiff != null && burdDiff !== 0 && (
            <span
              className="text-[12px]"
              style={{ color: burdDiff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}
            >
              ({burdDiff > 0 ? '+' : ''}{burdDiff})
            </span>
          )}
          <span className="text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>부담중량</span>
        </div>

        {/* 통산 성적 */}
        {jockeyStat && (
          <div className="font-mono-num text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {jockeyStat.race_cnt_t != null ? `${jockeyStat.race_cnt_t}전 ` : ''}
            {jockeyStat.first_cnt != null ? `${jockeyStat.first_cnt}승` : ''}
            {jockeyStat.win_rate_t != null && (
              <span className="ml-1" style={{ color: 'var(--color-accent-cyan)' }}>
                {jockeyStat.win_rate_t}%
              </span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-bg-elevated)]" />

      {/* 이 말과의 전적 */}
      <div>
        <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>이 말과의 전적</div>
        {jockeyHorseCombo != null && jockeyHorseCombo.total > 0 ? (
          <div className="font-mono-num text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
            {jockeyHorseCombo.total}전{' '}
            <span style={{ color: jockeyHorseCombo.wins > 0 ? 'var(--color-success)' : undefined }}>
              {jockeyHorseCombo.wins}승
            </span>
            {' / '}
            <span style={{ color: 'var(--color-text-disabled)' }}>
              연{jockeyHorseCombo.places} 복{jockeyHorseCombo.shows}
            </span>
          </div>
        ) : (
          <div className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>이력 없음</div>
        )}
      </div>

      <div className="border-t border-[var(--color-bg-elevated)]" />

      {/* 최근 조교 */}
      <div>
        <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-accent-cyan)' }}>▸ 최근 조교</div>
        {latestTraining ? (
          <div className="flex flex-col gap-0.5 font-mono-num text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <span>
              {formatDate(latestTraining.train_date)}
              {latestTraining.chul_gubun && <span className="ml-1">{latestTraining.chul_gubun}</span>}
            </span>
            <span style={{ color: 'var(--color-text-disabled)' }}>
              {latestTraining.pr_gubun ?? '-'}
              {latestTraining.tr_term != null && latestTraining.tr_term > 0 && (
                <span className="ml-1">{formatTrTerm(latestTraining.tr_term)}</span>
              )}
            </span>
          </div>
        ) : (
          <div className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>조교 기록 없음</div>
        )}
      </div>

      <div className="border-t border-[var(--color-bg-elevated)]" />

      {/* 진료·폐출혈 내역 */}
      <div>
        <div
          className="text-[10px] mb-0.5"
          style={{ color: hasHealth ? 'var(--color-accent-pink)' : 'var(--color-text-disabled)' }}
        >
          ▸ 진료내역
        </div>
        {hasHealth ? (
          <div className="flex flex-col gap-0.5 text-[11px]" style={{ color: 'var(--color-accent-pink)' }}>
            {horse.latst_bledg1 && <span>폐출혈: {horse.latst_bledg1}</span>}
            {horse.latst_bledg2 && <span>폐출혈2: {horse.latst_bledg2}</span>}
            {horse.latst_trea1_txt && <span>{horse.latst_trea1_txt}</span>}
            {horse.latst_trea2_txt && <span>{horse.latst_trea2_txt}</span>}
          </div>
        ) : (
          <div className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>없음</div>
        )}
      </div>

      {/* 사후: 실제 착순 + 인기순위 */}
      {horse.ord != null && (
        <>
          <div className="border-t border-[var(--color-bg-elevated)]" />
          <div>
            <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>실제 착순</div>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-mono-num font-bold" style={{ color: ordColor(horse.ord) }}>
                {horse.ord}위
              </span>
              {horse.popularity != null && (
                <span className="text-[11px] font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
                  인기 {horse.popularity}위
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: ColJockeyInfo 관련 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx
git commit -m "feat(sheet): ColJockeyInfo 재작성 — wg_jk·조합이력·조교·진료 통합"
```

---

## Task 6: ColHistory 재작성 (테이블 형식 + prize_cond)

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx` (ColHistory 전체 교체)

- [ ] **Step 1: ColHistory 전체 교체**

기존 `ColHistory` 함수 전체를 다음으로 교체한다.

```typescript
function ColHistory({
  history,
  prizeCondMap,
}: {
  history: RaceEntry[];
  prizeCondMap: Map<string, string>;
}) {
  if (history.length === 0) {
    return (
      <div className="p-3 text-[12px]" style={{ color: 'var(--color-text-disabled)' }}>
        직전 경주 이력 없음
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono-num border-collapse">
        <thead>
          <tr style={{ background: 'var(--color-bg-primary)' }}>
            {['날짜', '장소', '거리', '조건', '주로', '착순', '기록', '중량', '기수'].map((h) => (
              <th
                key={h}
                className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]"
                style={{ color: 'var(--color-accent-cyan)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'inherit' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const sec = getSectionalInfo(h);
            const hasSecData =
              sec.cornerStr != null || sec.s1fTime != null ||
              sec.g3fSplit != null || sec.g1fSplit != null;

            const prizeKey = `${h.race_date}-${h.meet}-${h.rc_no}`;
            const prizeCond = prizeCondMap.get(prizeKey) ?? '-';
            const rowBg = i % 2 === 1 ? 'var(--color-bg-primary)' : 'transparent';

            // 구간 서브행 텍스트 조합
            const subParts: string[] = [];
            if (sec.cornerStr != null) subParts.push(`코너 ${sec.cornerStr}`);
            if (sec.s1fTime != null) subParts.push(`출발 ${fmtSec(sec.s1fTime)}s`);
            if (sec.g3fSplit != null) subParts.push(`막판600m ${fmtSec(sec.g3fSplit)}s`);
            if (sec.g1fSplit != null) subParts.push(`막판200m ${fmtSec(sec.g1fSplit)}s`);

            const tdStyle = { background: rowBg, color: 'var(--color-text-secondary)' as const };

            return (
              <>
                <tr key={`main-${i}`}>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={tdStyle}>
                    {formatDate(h.race_date)}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={tdStyle}>
                    {MEET_NAMES[h.meet] ?? '?'}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={tdStyle}>
                    {h.rc_dist ?? '-'}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={{ ...tdStyle, color: 'var(--color-text-disabled)' }}>
                    {prizeCond}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={{ ...tdStyle, color: 'var(--color-text-disabled)' }}>
                    {h.track_type ?? '-'}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)] font-semibold" style={{ ...tdStyle, color: ordColor(h.ord) }}>
                    {h.ord != null ? `${h.ord}위` : '-'}
                  </td>
                  <td
                    className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]"
                    style={{ ...tdStyle, color: h.ord === 1 ? 'var(--color-success)' : 'var(--color-text-secondary)' }}
                  >
                    {formatRcTime(h.rc_time)}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={tdStyle}>
                    {h.burd_wgt ?? '-'}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap border-b border-[var(--color-bg-elevated)]" style={{ ...tdStyle, color: 'var(--color-text-disabled)' }}>
                    {h.jcky_nm ?? '-'}
                  </td>
                </tr>
                {hasSecData && subParts.length > 0 && (
                  <tr key={`sub-${i}`}>
                    <td
                      colSpan={9}
                      className="px-2 pb-1.5 text-left border-b border-[var(--color-bg-elevated)]"
                      style={{ background: rowBg, fontSize: '9px', color: 'var(--color-text-disabled)' }}
                    >
                      <span style={{ color: 'var(--color-accent-cyan)' }}>
                        {sec.cornerStr != null ? `코너 ${sec.cornerStr}` : ''}
                      </span>
                      {sec.s1fTime != null && (
                        <span> · 출발 {fmtSec(sec.s1fTime)}s</span>
                      )}
                      {sec.g3fSplit != null && (
                        <span> · 막판600m {fmtSec(sec.g3fSplit)}s</span>
                      )}
                      {sec.g1fSplit != null && (
                        <span> · 막판200m {fmtSec(sec.g1fSplit)}s</span>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: 에러 없음 (JSX fragment key 경고는 무시)

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx
git commit -m "feat(sheet): ColHistory 테이블 형식 재작성 — prize_cond 조건 컬럼 추가"
```

---

## Task 7: Col5Items 하단 총점 추가 + 높이 조정

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx` (Col5Items 시그니처 + 하단 총점 추가)

- [ ] **Step 1: Col5Items props에 pRank, pScore 추가 및 하단 총점 렌더링**

`Col5Items` 함수 시그니처를 다음으로 변경한다.

```typescript
function Col5Items({
  itemScores,
  accentColor,
  pRank,
  pScore,
  viewMode,
  onViewModeChange,
}: {
  itemScores: Record<string, ItemScore> | undefined;
  accentColor: string;
  pRank: number;
  pScore: number;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
})
```

그리고 `Col5Items` 함수 내부 `return` 문의 마지막 `</div>` 닫기 직전에 다음을 추가한다.

```tsx
{/* 하단 AI 순위 + 총점 */}
{pRank < 999 && (
  <div className="mt-auto pt-2 border-t border-[var(--color-bg-elevated)] text-center">
    <div className="text-[18px]">{rankEmoji(pRank)}</div>
    <div className="font-mono-num text-[12px] font-bold" style={{ color: accentColor }}>
      {pScore.toFixed(1)}점
    </div>
  </div>
)}
```

레이더 차트 컨테이너 높이를 `height: 220` → `style={{ minHeight: 160, flex: 1 }}`로 변경한다.

```tsx
// 변경 전
<div className="relative overflow-hidden" style={{ height: 220 }}>
// 변경 후
<div className="relative overflow-hidden" style={{ minHeight: 160, height: '100%' }}>
```

- [ ] **Step 2: 타입 체크 + 테스트 전체 실행**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 에러 없음, 테스트 PASS

- [ ] **Step 3: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx
git commit -m "feat(sheet): Col5Items 하단 총점 추가, 레이더 높이 유동적으로 변경"
```

---

## Task 8: PredictionSheet 메인 — prize_cond 연결 + HorseCard prop 업데이트

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx` (PredictionSheet 메인 컴포넌트, HorseCard 호출부)

- [ ] **Step 1: import 추가**

`PredictionSheet.tsx` 상단 `queries` import에 `useHistoryRacesPrizeCond` 추가.

```typescript
import {
  useHorsesByRace,
  usePredictionsByRace,
  useHorseSectionalAbilityByNames,
  useTrainerStatsBatch,
  useJockeyStatsBatch,
  useGradeWinnerStats,
  useTrainingBatchByNames,
  useJockeyHorseComboBatch,
  useHorseGateStatsBatch,
  useHistoryRacesPrizeCond,   // 추가
  type JockeyHorseComboStat,
} from '../lib/queries';
```

- [ ] **Step 2: historyKeys 계산 + useHistoryRacesPrizeCond 호출 추가**

`PredictionSheet` 함수 내 `historyByName` useMemo 아래에 다음을 추가한다.

```typescript
// prize_cond 배치 조회용 key 목록
const historyRaceKeys = useMemo(() => {
  const keys: Array<{ race_date: number; meet: number; rc_no: number }> = [];
  historyByName.forEach((hist) => {
    for (const h of hist) {
      keys.push({ race_date: h.race_date, meet: h.meet, rc_no: h.rc_no });
    }
  });
  return keys;
}, [historyByName]);

const { data: prizeCondMap = new Map<string, string>() } = useHistoryRacesPrizeCond(historyRaceKeys);
```

- [ ] **Step 3: HorseCard 호출부에 prizeCondMap prop 추가**

`sortedHorses.map(...)` 안의 `<HorseCard .../>` 에 `prizeCondMap={prizeCondMap}` prop을 추가한다.

```tsx
<HorseCard
  key={horse.hr_name}
  horse={horse}
  prediction={predByName.get(horse.hr_name)}
  history={historyByName.get(horse.hr_name) ?? []}
  runningStyle={styleByName.get(horse.hr_name) ?? 'unknown'}
  bloodline={bloodlineByName.get(horse.hr_name)}
  trainerStat={trainerStatsMap?.get(horse.trar_nm ?? '')}
  jockeyStat={jockeyStatsMap?.get(horse.jcky_no ?? '')}
  latestTraining={trainingMap?.get(horse.hr_name)?.[0]}
  jockeyHorseCombo={jockeyHorseComboMap?.get(`${horse.hr_name}:${horse.jcky_nm ?? ''}`)}
  gateStats={gateStatsMap?.get(horse.hr_name)}
  prizeCondMap={prizeCondMap}
  viewMode={viewMode}
  onViewModeChange={setViewMode}
/>
```

- [ ] **Step 4: 전체 타입 체크 + 테스트**

```bash
cd client && npx tsc --noEmit && npx vitest run
```

Expected: 에러 없음, 테스트 PASS

- [ ] **Step 5: 빌드 확인**

```bash
cd client && npm run build
```

Expected: 빌드 성공 (경고는 허용, 에러 없음)

- [ ] **Step 6: 최종 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx client/src/lib/queries.ts
git commit -m "feat(sheet): PredictionSheet prize_cond 연결 — 예상지 카드 재설계 완료"
```

---

## 셀프 리뷰 체크리스트

**스펙 커버리지 확인:**
- [x] 헤더행: CardHeader (Task 3)
- [x] 말정보 라벨 제거 + 데이터만: ColHorseInfo (Task 4)
- [x] 같은거리 최고/평균 하이라이트 박스: ColHorseInfo (Task 4)
- [x] 기수체중(wg_jk): ColJockeyInfo (Task 5)
- [x] 조합이력·조교·진료 기수 컬럼 통합: ColJockeyInfo (Task 5)
- [x] 직전경주 테이블 + prize_cond 컬럼: ColHistory (Task 6) + useHistoryRacesPrizeCond (Task 1)
- [x] 항목점수 총점 하단 + 높이 조정: Col5Items (Task 7)
- [x] 그리드 비율 1.5fr/1.2fr/2.8fr/1.5fr: HorseCard (Task 3)
- [x] 히스토리 limit 10: Task 2
- [x] 총전적 형식 N전 W/P/S/R: ColHorseInfo (Task 4)
