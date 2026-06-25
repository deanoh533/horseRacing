// client/src/pages/TodayPicks.tsx
import { Link } from 'react-router-dom';
import { useUpcomingPicks } from '../lib/queries';
import { classifyPick } from '../lib/selectivePicks';
import { PickBadge } from '../components/PickBadge';
import { fmtPct } from '../lib/sectional';
import type { Prediction } from '../lib/supabase';

const MEET_NAME: Record<number, string> = { 1: '서울', 2: '제주', 3: '부경' };

export function TodayPicks() {
  const { data, isLoading } = useUpcomingPicks();

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
        <p className="text-lg mb-1">이번 주 강추 없음</p>
        <p className="text-sm">기준(연승 확률 임계값)을 넘는 출주마가 없습니다.</p>
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
            <ul className="mt-2 space-y-1">
              {horses.map((p) => (
                <li key={p.hr_name} className="flex items-center gap-2 text-sm">
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
