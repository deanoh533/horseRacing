// client/src/pages/TodayPicks.tsx
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useUpcomingPicks, useRaceEntryNamesByDate, useHorseSectionalAbilityByNames } from '../lib/queries';
import { classifyPick } from '../lib/selectivePicks';
import { PickBadge } from '../components/PickBadge';
import { RacePaceBadge } from '../components/RacePaceBadge';
import { classifyRunningStyle, type RunningStyle } from '../lib/runningStyle';
import { fmtPct } from '../lib/sectional';
import type { Prediction } from '../lib/supabase';

const MEET_NAME: Record<number, string> = { 1: '서울', 2: '제주', 3: '부경' };

export function TodayPicks() {
  const { data, isLoading } = useUpcomingPicks();

  // F-001: 경주 페이스 배지 — 픽 경주의 전체 출전마 성향 필요 (픽 행만으론 집계 불가)
  const picksDate = data?.[0]?.race_date ?? null;
  const { data: entryNames } = useRaceEntryNamesByDate(picksDate);
  const allNames = useMemo(() => [...new Set((entryNames ?? []).map((e) => e.hr_name))], [entryNames]);
  const { data: abilities } = useHorseSectionalAbilityByNames(allNames);
  const stylesByRace = useMemo(() => {
    const styleByName = new Map<string, RunningStyle>();
    (abilities ?? []).forEach((a) => {
      styleByName.set(a.hr_name, classifyRunningStyle(a.avg_position_ratio, a.stddev_position_ratio));
    });
    const map = new Map<string, RunningStyle[]>();
    for (const e of entryNames ?? []) {
      const k = `${e.race_date}-${e.meet}-${e.rc_no}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(styleByName.get(e.hr_name) ?? 'unknown');
    }
    return map;
  }, [entryNames, abilities]);

  if (isLoading) return <div className="text-[var(--color-text-secondary)]">불러오는 중…</div>;

  const picks = (data ?? [])
    .filter((p) => classifyPick(p.p_top3) !== null)
    .sort((a, b) => {
      const rank = (t: ReturnType<typeof classifyPick>) => (t === 'strong' ? 0 : 1);
      return rank(classifyPick(a.p_top3)) - rank(classifyPick(b.p_top3)) || (b.p_top3 ?? 0) - (a.p_top3 ?? 0);
    });

  if (picks.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--color-text-secondary)]">
        <p className="text-lg mb-1">오늘 강추 없음</p>
        <p className="text-sm">오늘 경주 중 기준(연승 확률 임계값)을 넘는 출주마가 없습니다.</p>
      </div>
    );
  }

  // 경주별 그룹
  const byRace = new Map<string, Prediction[]>();
  for (const p of picks) {
    const k = `${p.race_date}-${p.meet}-${p.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(p);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">오늘의 강추</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">
        보정 연승확률 기준 강추/주목 {picks.length}마리 · {byRace.size}경주
      </p>
      {[...byRace.entries()].map(([key, horses]) => {
        const h0 = horses[0]!;
        return (
          <div key={key} className="rounded-lg border border-[var(--color-bg-elevated)] p-3">
            <Link
              to={`/race/${h0.meet}/${h0.race_date}/${h0.rc_no}/sheet`}
              className="text-sm font-medium text-[var(--color-accent-cyan)]"
            >
              {MEET_NAME[h0.meet] ?? h0.meet} {h0.race_date} · {h0.rc_no}R →
            </Link>
            {stylesByRace.has(key) && (
              <div className="mt-1.5">
                <RacePaceBadge styles={stylesByRace.get(key)!} />
              </div>
            )}
            <ul className="mt-2 space-y-1">
              {horses.map((p) => (
                <li key={`${p.race_date}-${p.meet}-${p.rc_no}-${p.hr_name}`} className="flex items-center gap-2 text-sm">
                  <PickBadge pTop3={p.p_top3} />
                  <span className="font-semibold">{p.hr_name}</span>
                  <span className="text-xs text-[var(--color-text-secondary)] ml-auto">
                    연승 {p.p_top3 != null ? fmtPct(p.p_top3) : '-'}
                    {p.p_win != null && <> · 우승 {fmtPct(p.p_win)}</>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
