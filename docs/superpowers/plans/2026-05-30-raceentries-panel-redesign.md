# RaceEntries 아코디언 패널 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출마정보(RaceEntries)의 기수 패널에 조합이력·최근3개월폼을, 말 패널에 구간기록 서브행·같은거리기록·조교·진료를 추가한다.

**Architecture:** `getSectionalInfo`·`fmtSec`·`SectionalInfo`를 `client/src/lib/sectional.ts` 공통 유틸로 분리하고, `computeSameDistStats`는 `PredictionSheet.tsx`에서 그대로 import한다. 신규 훅 `useJockeyRecentForm`을 queries.ts에 추가한다.

**Tech Stack:** React, TypeScript, Tailwind CSS, Supabase, @tanstack/react-query, vitest

---

## 파일 변경 맵

| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `client/src/lib/sectional.ts` | 신규 | `SectionalInfo`, `getSectionalInfo`, `fmtSec` 공통 유틸 |
| `client/src/lib/queries.ts` | 수정 | `useJockeyRecentForm` 훅 추가 |
| `client/src/pages/PredictionSheet.tsx` | 수정 | `getSectionalInfo`·`fmtSec` → sectional.ts import로 교체 |
| `client/src/pages/RaceEntries.tsx` | 수정 | JockeyPanel·HorsePanel 개선, rcDist prop 전달 |

---

## Task 1: sectional.ts 공통 유틸 생성

**Files:**
- Create: `client/src/lib/sectional.ts`
- Modify: `client/src/pages/PredictionSheet.tsx` (import 교체)

- [ ] **Step 1: `client/src/lib/sectional.ts` 파일 생성**

```typescript
import type { RaceEntry } from './supabase';

export interface SectionalInfo {
  cornerStr: string | null;
  s1fOrd: number | null;
  s1fTime: number | null;
  g3fOrd: number | null;
  g3fSplit: number | null;
  g1fOrd: number | null;
  g1fSplit: number | null;
}

export function getSectionalInfo(h: RaceEntry): SectionalInfo {
  const isSe = h.meet === 1;
  const cornerRanks = isSe
    ? [h.sj_1c_ord ?? null, h.sj_2c_ord ?? null, h.sj_3c_ord ?? null, h.sj_4c_ord ?? null]
    : [h.bu_g8f_ord ?? null, h.bu_g6f_ord ?? null, h.bu_g4f_ord ?? null, h.bu_g2f_ord ?? null];
  const validCornerRanks = cornerRanks.filter((r): r is number => r !== null);
  const s1fTime = isSe ? (h.se_s1f_acc_time ?? null) : (h.bu_s1f_acc_time ?? null);
  const g3fAcc = isSe ? (h.se_g3f_acc_time ?? null) : (h.bu_g3f_acc_time ?? null);
  const g1fAcc = isSe ? (h.se_g1f_acc_time ?? null) : (h.bu_g1f_acc_time ?? null);

  return {
    cornerStr: validCornerRanks.length > 0 ? validCornerRanks.join('-') : null,
    s1fOrd: isSe ? (h.sj_s1f_ord ?? null) : (h.bu_s1f_ord ?? null),
    s1fTime,
    g3fOrd: isSe ? (h.sj_g3f_ord ?? null) : (h.bu_g3f_ord ?? null),
    g3fSplit:
      h.rc_time != null && h.rc_time > 0 && g3fAcc != null
        ? +Math.max(0, h.rc_time - g3fAcc).toFixed(1)
        : null,
    g1fOrd: isSe ? (h.sj_g1f_ord ?? null) : (h.bu_g1f_ord ?? null),
    g1fSplit:
      h.rc_time != null && h.rc_time > 0 && g1fAcc != null
        ? +Math.max(0, h.rc_time - g1fAcc).toFixed(1)
        : null,
  };
}

export function fmtSec(time: number | null): string | null {
  return time != null ? `${time.toFixed(1)}` : null;
}
```

- [ ] **Step 2: PredictionSheet.tsx의 로컬 정의를 import로 교체**

`PredictionSheet.tsx`에서 `SectionalInfo` interface, `getSectionalInfo` 함수, `fmtSec` 함수 3개를 삭제하고, 파일 상단 import 블록에 추가:

```typescript
import { getSectionalInfo, fmtSec, type SectionalInfo } from '../lib/sectional';
```

- [ ] **Step 3: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add client/src/lib/sectional.ts client/src/pages/PredictionSheet.tsx
git commit -m "refactor: getSectionalInfo/fmtSec를 lib/sectional.ts 공통 유틸로 분리"
```

---

## Task 2: useJockeyRecentForm 훅 추가

**Files:**
- Modify: `client/src/lib/queries.ts`

- [ ] **Step 1: `useJockeyRecentForm` 추가**

`queries.ts` 파일에서 `useJockeyStatsBatch` 함수 바로 아래에 추가:

```typescript
/**
 * 기수 최근 N일 성적 (race_entries 집계)
 * - JockeyPanel에서 "최근 3개월 폼" 표시에 사용
 * - meet 기준 필터: 서울/부경 분리
 */
export function useJockeyRecentForm(
  jckyNo: string,
  meet: number,
  daysBack = 90
): ReturnType<typeof useQuery<{ total: number; wins: number; places: number; shows: number } | null>> {
  return useQuery({
    queryKey: ['jockey-recent-form', jckyNo, meet, daysBack],
    queryFn: async (): Promise<{ total: number; wins: number; places: number; shows: number } | null> => {
      const cutoff = getDateNDaysAgo(daysBack);
      const { data, error } = await supabase
        .from('race_entries')
        .select('ord')
        .eq('jcky_no', jckyNo)
        .eq('meet', meet)
        .gte('race_date', cutoff)
        .not('ord', 'is', null);
      if (error) throw error;
      const items = data ?? [];
      if (items.length === 0) return null;
      return {
        total: items.length,
        wins: items.filter((r) => r.ord === 1).length,
        places: items.filter((r) => r.ord != null && r.ord <= 2).length,
        shows: items.filter((r) => r.ord != null && r.ord <= 3).length,
      };
    },
    enabled: !!jckyNo && !!meet,
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
git commit -m "feat(queries): useJockeyRecentForm 훅 추가 (기수 최근 N일 성적)"
```

---

## Task 3: JockeyPanel 개선

**Files:**
- Modify: `client/src/pages/RaceEntries.tsx`

- [ ] **Step 1: imports 추가**

`RaceEntries.tsx` 상단 queries import 블록에 다음 2개를 추가:

```typescript
import {
  // ... 기존 항목들 유지 ...
  useJockeyHorseComboBatch,
  useJockeyRecentForm,
  type JockeyHorseComboStat,
} from '../lib/queries';
```

- [ ] **Step 2: JockeyPanel 함수 전체 교체**

기존 `JockeyPanel` 함수 전체를 다음으로 교체:

```typescript
function JockeyPanel({ entry, meet }: { entry: RaceEntry; meet: number }) {
  const { data: jockeyStats } = useJockeyStats(entry.jcky_no ?? '', meet);
  const jockeyStat = jockeyStats?.[0];

  const { data: comboMap } = useJockeyHorseComboBatch(
    entry.jcky_nm ? [{ hrName: entry.hr_name, jckyNm: entry.jcky_nm }] : []
  );
  const combo = comboMap?.get(`${entry.hr_name}:${entry.jcky_nm ?? ''}`);

  const { data: recentForm } = useJockeyRecentForm(entry.jcky_no ?? '', meet, 90);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      {/* 기수 통산 성적 */}
      <DetailCard icon={<Target className="w-3.5 h-3.5" />} title="기수 통산 성적">
        {!entry.jcky_no ? (
          <div className="text-[var(--color-text-disabled)]">기수 번호 없음</div>
        ) : !jockeyStat ? (
          <div className="text-[var(--color-text-disabled)]">데이터 없음</div>
        ) : (
          <>
            <KV label="기수" value={`${jockeyStat.jcky_nm ?? '-'} (${entry.jcky_no})`} />
            <KV label="통산 출주" value={`${jockeyStat.race_cnt_t ?? '-'}회`} />
            <KV label="1위" value={`${jockeyStat.first_cnt ?? 0}회`} />
            <KV label="2·3위" value={`${(jockeyStat.second_cnt ?? 0) + (jockeyStat.third_cnt ?? 0)}회`} />
            <KV label="단승률" value={`${jockeyStat.win_rate_t ?? '-'}%`} />
            <KV label="입상률" value={`${jockeyStat.qu_rate_t ?? '-'}%`} />
          </>
        )}
      </DetailCard>

      {/* 부담중량 */}
      <DetailCard icon={<Award className="w-3.5 h-3.5" />} title="부담중량">
        <KV label="이번 경주" value={entry.burd_wgt != null ? `${entry.burd_wgt}kg` : '-'} />
        {entry.wg_hr_diff != null && entry.wg_hr_diff !== 0 && (
          <KV label="전경주 대비" value={`${entry.wg_hr_diff > 0 ? '+' : ''}${entry.wg_hr_diff}kg`} />
        )}
      </DetailCard>

      {/* 이 말과의 조합 이력 */}
      <DetailCard icon={<History className="w-3.5 h-3.5" />} title="이 말과의 조합 이력">
        {combo == null || combo.total === 0 ? (
          <div className="text-[var(--color-text-disabled)]">조합 이력 없음</div>
        ) : (
          <>
            <KV label="출주" value={`${combo.total}전`} />
            <KV
              label="1위"
              value={`${combo.wins}승 (${combo.total > 0 ? ((combo.wins / combo.total) * 100).toFixed(1) : 0}%)`}
            />
            <KV label="연승(~2위)" value={`${combo.places}회`} />
            <KV label="복승(~3위)" value={`${combo.shows}회`} />
          </>
        )}
      </DetailCard>

      {/* 최근 3개월 성적 */}
      <DetailCard icon={<Zap className="w-3.5 h-3.5" />} title="최근 3개월 성적">
        {recentForm == null ? (
          <div className="text-[var(--color-text-disabled)]">최근 출주 없음</div>
        ) : (
          <>
            <KV label="출주" value={`${recentForm.total}전`} />
            <KV
              label="단승률"
              value={`${recentForm.wins}승 (${recentForm.total > 0 ? ((recentForm.wins / recentForm.total) * 100).toFixed(1) : 0}%)`}
            />
            <KV label="연승(~2위)" value={`${recentForm.places}회`} />
            <KV label="복승(~3위)" value={`${recentForm.shows}회`} />
          </>
        )}
      </DetailCard>
    </div>
  );
}
```

- [ ] **Step 3: 타입 체크**

```bash
cd client && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/RaceEntries.tsx
git commit -m "feat(entries): JockeyPanel — 조합이력·최근3개월폼 추가"
```

---

## Task 4: HorsePanel 개선

**Files:**
- Modify: `client/src/pages/RaceEntries.tsx`

- [ ] **Step 1: imports 추가**

`RaceEntries.tsx` 상단에 추가:

```typescript
import { getSectionalInfo, fmtSec } from '../lib/sectional';
import { computeSameDistStats } from './PredictionSheet';
```

그리고 queries import 블록에 추가:

```typescript
import {
  // ... 기존 항목들 ...
  useHorseTraining,  // 이미 있음 — 확인만
} from '../lib/queries';
```

- [ ] **Step 2: HorsePanel 시그니처에 rcDist 추가**

기존:
```typescript
function HorsePanel({
  entry, meet, rcDate, rcNo,
}: {
  entry: RaceEntry; meet: number; rcDate: number; rcNo: number;
})
```

변경:
```typescript
function HorsePanel({
  entry, meet, rcDate, rcNo, rcDist,
}: {
  entry: RaceEntry; meet: number; rcDate: number; rcNo: number; rcDist: number | null;
})
```

- [ ] **Step 3: HorsePanel 함수 내부 — 훅 추가 및 로직 추가**

`HorsePanel` 함수 내부 훅 호출부에 다음을 추가 (기존 훅 3개 유지):

```typescript
// 기존 훅들 유지
const { data: ability, isLoading: abLoading } = useHorseSectionalAbility(entry.hr_name);
const { data: history, isLoading: histLoading } = useHorseHistory(entry.hr_name, rcDate, 10); // limit 5→10
const { data: horseInfo } = useHorseInfo(entry.hr_no ?? '');

// 신규
const { data: training } = useHorseTraining(entry.hr_no ?? '', 30);
const sameDistStats = useMemo(
  () => (rcDist != null ? computeSameDistStats(history ?? [], rcDist) : null),
  [history, rcDist]
);

const hasHealth =
  entry.latst_bledg1 || entry.latst_bledg2 ||
  entry.latst_trea1_txt || entry.latst_trea2_txt;
```

- [ ] **Step 4: HorsePanel return 교체**

기존 return 전체를 다음으로 교체:

```typescript
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      {/* 기본 정보 + 같은거리 기록 + 조교/진료 */}
      <DetailCard icon={<Award className="w-3.5 h-3.5" />} title="기본 정보">
        <KV label="출생지" value={entry.prds ?? '-'} />
        <KV label="마주" value={entry.owner_nm ?? '-'} />
        <KV label="수득상금" value={formatErng(entry.erng_sump)} />
        <KV label="최근1년" value={formatErng(entry.erng_loy)} />
        {entry.sump_rcod_fplc != null && (
          <KV
            label="통산전적"
            value={`${entry.sump_rcod_sum ?? '?'}전 / 1위 ${entry.sump_rcod_fplc} · 2위 ${entry.sump_rcod_splc} · 3위 ${entry.sump_rcod_tplc}`}
          />
        )}

        {/* 같은거리 최고/평균 */}
        {rcDist != null && (
          <div className="mt-2 pt-2 border-t border-[var(--color-bg-elevated)] space-y-1.5">
            {sameDistStats != null ? (
              <>
                <div
                  className="rounded px-2 py-1.5"
                  style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-bg-elevated)' }}
                >
                  <div className="text-[9px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-accent-cyan)' }}>
                    ⚡ {rcDist}m 최고
                  </div>
                  <div className="font-mono-num font-bold text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
                    {formatErng(null) === '-' ? '-' : (() => {
                      const m = Math.floor(sameDistStats.bestTime / 60);
                      const s = (sameDistStats.bestTime % 60).toFixed(1);
                      return m > 0 ? `${m}:${s.padStart(4, '0')}` : s;
                    })()}
                  </div>
                  <div className="font-mono-num text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>
                    {[
                      sameDistStats.bestBurdWgt != null ? `${sameDistStats.bestBurdWgt}kg` : null,
                      sameDistStats.bestTrackType,
                      sameDistStats.bestOrd != null ? `${sameDistStats.bestOrd}위` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div
                  className="rounded px-2 py-1.5"
                  style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-bg-elevated)' }}
                >
                  <div className="text-[9px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>
                    — {rcDist}m 평균
                  </div>
                  <div className="font-mono-num font-semibold text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                    {(() => {
                      const m = Math.floor(sameDistStats.avgTime / 60);
                      const s = (sameDistStats.avgTime % 60).toFixed(1);
                      return m > 0 ? `${m}:${s.padStart(4, '0')}` : s;
                    })()}
                  </div>
                  <div className="font-mono-num text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>
                    {sameDistStats.count}전 기준 · {sameDistStats.wins}/{sameDistStats.places - sameDistStats.wins}/{sameDistStats.shows - sameDistStats.places}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--color-text-disabled)' }}>{rcDist}m 이력 없음</div>
            )}
          </div>
        )}

        {/* 최근 조교 */}
        {training && training.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--color-bg-elevated)]">
            <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-accent-cyan)' }}>▸ 최근 조교</div>
            <div className="font-mono-num text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
              {formatShortDate(training[0]!.train_date)}
              {training[0]!.chul_gubun && <span className="ml-1">{training[0]!.chul_gubun}</span>}
              {training[0]!.pr_gubun && <span className="ml-1 text-[var(--color-text-disabled)]">{training[0]!.pr_gubun}</span>}
              {training[0]!.tr_term != null && training[0]!.tr_term > 0 && (
                <span className="ml-1 text-[var(--color-text-disabled)]">{training[0]!.tr_term}초</span>
              )}
            </div>
          </div>
        )}

        {/* 진료내역 */}
        {hasHealth && (
          <div className="mt-2 pt-2 border-t border-[var(--color-bg-elevated)]">
            <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-accent-pink)' }}>▸ 진료내역</div>
            <div className="text-[11px] space-y-0.5" style={{ color: 'var(--color-accent-pink)' }}>
              {entry.latst_bledg1 && <div>폐출혈: {entry.latst_bledg1}</div>}
              {entry.latst_bledg2 && <div>폐출혈2: {entry.latst_bledg2}</div>}
              {entry.latst_trea1_txt && <div>{entry.latst_trea1_txt}</div>}
              {entry.latst_trea2_txt && <div>{entry.latst_trea2_txt}</div>}
            </div>
          </div>
        )}
      </DetailCard>

      {/* 구간 능력치 */}
      <DetailCard icon={<Zap className="w-3.5 h-3.5" />} title="구간 능력치 · 주행 성향">
        {abLoading ? (
          <div className="text-[var(--color-text-disabled)]"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />로딩…</div>
        ) : !ability ? (
          <div className="text-[var(--color-text-disabled)]">3경주 미만 (분석 부족)</div>
        ) : (
          <>
            {(() => {
              const style = classifyRunningStyle(ability.avg_position_ratio, ability.stddev_position_ratio);
              const info = STYLE_INFO[style];
              return (
                <div className="mb-2 pb-2 border-b border-[var(--color-bg-elevated)]">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[13px] font-semibold border ${info.className}`}>
                    <span>{info.emoji}</span>{info.name}
                  </span>
                  <span className="ml-2 text-[12px] text-[var(--color-text-secondary)]">{info.description}</span>
                </div>
              );
            })()}
            <KV label="분석경주" value={`${ability.races}회`} />
            <KV label="선행 성공률" value={describeFrontRunSuccess(ability.front_run_success_rate)} />
            <KV label="출발 200m" value={ability.best_s1f != null ? `${ability.best_s1f}초 (avg ${ability.avg_s1f})` : '-'} />
            <KV label="막판 600m" value={ability.best_last_600m != null ? `${ability.best_last_600m}초 (avg ${ability.avg_last_600m})` : '-'} />
          </>
        )}
      </DetailCard>

      {/* 최근 5경주 + 구간기록 서브행 */}
      <DetailCard icon={<History className="w-3.5 h-3.5" />} title="최근 5경주">
        {histLoading ? (
          <div className="text-[var(--color-text-disabled)]"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />로딩…</div>
        ) : !history || history.length === 0 ? (
          <div className="text-[var(--color-text-disabled)]">이력 없음</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[12px] text-[var(--color-text-secondary)]">
                <th className="text-left py-0.5">날짜</th>
                <th className="text-right py-0.5">거리</th>
                <th className="text-right py-0.5">착순</th>
                <th className="text-right py-0.5">기록</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 5).map((h, i) => {
                const sec = getSectionalInfo(h);
                const hasSecData =
                  sec.cornerStr != null || sec.s1fTime != null ||
                  sec.g3fSplit != null || sec.g1fSplit != null;
                return (
                  <>
                    <tr key={i} className="border-t border-[var(--color-bg-elevated)]">
                      <td className="py-1">{formatShortDate(h.race_date)}</td>
                      <td className="py-1 text-right">{h.rc_dist ?? '-'}m</td>
                      <td className="py-1 text-right">
                        <span className={ordBadgeClass(h.ord)}>{h.ord != null ? `${h.ord}위` : '-'}</span>
                      </td>
                      <td className="py-1 text-right font-mono-num">{h.rc_time != null ? `${h.rc_time}s` : '-'}</td>
                    </tr>
                    {hasSecData && (
                      <tr key={`sec-${i}`}>
                        <td colSpan={4} className="pb-1 text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>
                          {sec.cornerStr != null && (
                            <span style={{ color: 'var(--color-accent-cyan)' }}>코너 {sec.cornerStr}</span>
                          )}
                          {sec.s1fTime != null && <span> · 출발 {fmtSec(sec.s1fTime)}s</span>}
                          {sec.g3fSplit != null && <span> · 막판600m {fmtSec(sec.g3fSplit)}s</span>}
                          {sec.g1fSplit != null && <span> · 막판200m {fmtSec(sec.g1fSplit)}s</span>}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </DetailCard>

      {/* 혈통 */}
      <DetailCard icon={<Dna className="w-3.5 h-3.5" />} title="혈통">
        {!entry.hr_no ? (
          <div className="text-[var(--color-text-disabled)]">말 번호 없음</div>
        ) : !horseInfo ? (
          <div className="text-[var(--color-text-disabled)]">혈통 데이터 없음</div>
        ) : (
          <>
            <KV label="부마" value={horseInfo.sire_hr_nm ?? '-'} />
            <KV label="모마" value={horseInfo.dam_hr_nm ?? '-'} />
            <KV label="모부마" value={horseInfo.dam_sire_hr_nm ?? '-'} />
            {horseInfo.spcs_nm && <KV label="품종" value={horseInfo.spcs_nm} />}
          </>
        )}
      </DetailCard>

      <div className="md:col-span-2 text-center text-[12px] text-[var(--color-text-disabled)] pt-1">
        <Link
          to={`/race/${meet}/${rcDate}/${rcNo}/horse/${entry.pthr_no}`}
          className="hover:text-[var(--color-accent-cyan)] underline"
        >
          🐎 {entry.hr_name} 상세 분석 보기 →
        </Link>
      </div>
    </div>
  );
```

- [ ] **Step 5: HorsePanel 호출부에 rcDist 전달**

`RaceEntries.tsx`의 메인 컴포넌트에서 HorsePanel 호출 위치를 찾는다 (약 369번째 줄):

```tsx
// 변경 전
{isHorseOpen && (
  <HorsePanel entry={h} meet={meet} rcDate={rcDate} rcNo={rcNo} />
)}

// 변경 후
{isHorseOpen && (
  <HorsePanel entry={h} meet={meet} rcDate={rcDate} rcNo={rcNo} rcDist={race?.rc_dist ?? null} />
)}
```

- [ ] **Step 6: useMemo import 확인**

`RaceEntries.tsx` 상단에 `useMemo`가 import되어 있는지 확인. 없으면 추가:

```typescript
import { useState, useMemo } from 'react';
```

- [ ] **Step 7: 타입 체크 + 빌드**

```bash
cd client && npx tsc --noEmit && npm run build
```

Expected: 에러 없음, 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add client/src/pages/RaceEntries.tsx
git commit -m "feat(entries): HorsePanel — 구간기록 서브행·같은거리기록·조교·진료 추가"
```

---

## 셀프 리뷰

**스펙 커버리지:**
- [x] 기수: 조합이력 → Task 3
- [x] 기수: 최근 3개월 폼 → Task 2 + Task 3
- [x] 말: 구간기록 서브행 → Task 4
- [x] 말: 같은거리 최고/평균 → Task 4
- [x] 말: 조교 정보 → Task 4
- [x] 말: 진료내역 → Task 4
- [x] getSectionalInfo 공통 유틸 → Task 1

**주의사항:**
- `formatShortDate`는 RaceEntries.tsx에 이미 정의됨 (formatDate가 아닌 formatShortDate)
- `race` 객체는 RaceEntries 메인 컴포넌트에서 `useRaceMeta`로 이미 로드됨
- `useMemo`는 RaceEntries.tsx에 이미 import됨 (라인 11)
- `useHorseTraining`은 RaceEntries.tsx에 이미 import됨 (라인 21)
- history limit 10으로 변경하되 화면엔 `.slice(0, 5)`로 5건만 표시
