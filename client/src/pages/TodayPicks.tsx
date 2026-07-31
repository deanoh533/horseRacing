// client/src/pages/TodayPicks.tsx — 주간 강추 (월~일, 다가오는/지난 섹션 + 지난 주 탐색)
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useWeeklyPicks, useRaceEntryNamesByRange, useHorseSectionalAbilityByNames, useRaceSectionalStatsByRange } from '../lib/queries';
import { classifyPick } from '../lib/selectivePicks';
import { PickBadge } from '../components/PickBadge';
import { RacePaceBadge } from '../components/RacePaceBadge';
import { WinningCombos } from '../components/WinningCombos';
import { classifyRunningStyle, type RunningStyle } from '../lib/runningStyle';
import { fmtPct } from '../lib/sectional';
import { getTodayRaceDate } from '../lib/supabase';
import { addDaysToYmd, weekRange } from '../lib/week';
import type { Prediction } from '../lib/supabase';

const MEET_NAME: Record<number, string> = { 1: '서울', 2: '제주', 3: '부경' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDate(d: number): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${m}/${day}(${DOW[dow]})`;
}

/** YYYYMMDD 숫자가 실제 존재하는 달력 날짜인지 확인 (예: 20260230, 20261301은 false). */
function isValidYmd(n: number): boolean {
  const y = Math.floor(n / 10000);
  const m = Math.floor(n / 100) % 100;
  const d = n % 100;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 경주 카드 (다가오는/지난 공용). showResult=true면 픽마다 실착순 ✅/❌ 표기(지난 경주는 날짜 그룹이 없어 Link에 날짜도 표기). */
function RaceCard({
  raceKey, horses, styles, showResult, actual, pthrByKey,
}: {
  raceKey: string;
  horses: Prediction[];
  styles: RunningStyle[] | undefined;
  showResult: boolean;
  actual?: { avgS1f: number | null; meet: number; dist: number | null };
  pthrByKey: Map<string, number>;
}) {
  const h0 = horses[0]!;
  const [showCombo, setShowCombo] = useState(false);
  return (
    <div key={raceKey} className="rounded-lg border border-[var(--color-bg-elevated)] p-3">
      <Link
        to={`/race/${h0.meet}/${h0.race_date}/${h0.rc_no}/sheet`}
        className="text-sm font-medium text-[var(--color-accent-cyan)]"
      >
        {MEET_NAME[h0.meet] ?? h0.meet} {showResult && `${fmtDate(h0.race_date)} `}{h0.rc_no}R →
      </Link>
      {styles && (
        <div className="mt-1.5">
          <RacePaceBadge styles={styles} actual={actual} />
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {horses.map((p) => (
          <li key={`${p.race_date}-${p.meet}-${p.rc_no}-${p.hr_name}`} className="flex items-center gap-2 text-sm">
            <PickBadge pTop3={p.p_top3} />
            <span className="font-semibold">
              {pthrByKey.get(`${p.race_date}-${p.meet}-${p.rc_no}-${p.hr_name}`)}.{p.hr_name}
            </span>
            {showResult && p.actual_ord != null && (
              <span className={`text-xs font-semibold ${p.actual_ord <= 3 ? 'text-emerald-300' : 'text-red-400'}`}>
                {p.actual_ord}착 {p.actual_ord <= 3 ? '✅' : '❌'}
              </span>
            )}
            <span className="text-xs text-[var(--color-text-secondary)] ml-auto">
              연승 {p.p_top3 != null ? fmtPct(p.p_top3) : '-'}
              {p.p_win != null && <> · 우승 {fmtPct(p.p_win)}</>}
            </span>
          </li>
        ))}
      </ul>
      {showResult && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowCombo((v) => !v)}
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)]"
          >
            {showCombo ? '조합 배당 숨기기' : '조합 배당 보기'}
          </button>
          {showCombo && (
            <WinningCombos rcDate={h0.race_date} meet={h0.meet} rcNo={h0.rc_no} compact />
          )}
        </div>
      )}
    </div>
  );
}

export function TodayPicks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getTodayRaceDate();
  const thisWeekMonday = weekRange(today).from;

  const weekParam = searchParams.get('week');
  const parsedWeek =
    weekParam && /^\d{8}$/.test(weekParam) && isValidYmd(Number(weekParam)) ? Number(weekParam) : null;
  const anchor = parsedWeek ?? today;
  const { from, to } = weekRange(anchor);
  const isCurrentWeek = from === thisWeekMonday;

  // URL의 week 값이 그 주의 월요일이 아니거나(예: 수동 편집) 미래 주면 정규화
  useEffect(() => {
    const clamped = Math.min(from, thisWeekMonday);
    if (parsedWeek !== null && parsedWeek !== clamped) {
      setSearchParams({ week: String(clamped) }, { replace: true });
    }
  }, [parsedWeek, from, thisWeekMonday, setSearchParams]);

  const goToWeek = (monday: number) => setSearchParams({ week: String(monday) });

  const { data, isLoading } = useWeeklyPicks(anchor);

  const picks = useMemo(
    () => (data ?? []).filter((p) => classifyPick(p.p_top3) !== null),
    [data]
  );

  // 페이스 배지 — 픽 경주의 전체 출전마 성향 필요. 픽 0건이면 쿼리 스킵.
  const hasPicks = picks.length > 0;
  const { data: entryNames } = useRaceEntryNamesByRange(hasPicks ? from : null, hasPicks ? to : null);
  const allNames = useMemo(() => [...new Set((entryNames ?? []).map((e) => e.hr_name))], [entryNames]);
  const pthrByKey = useMemo(() => {
    const map = new Map<string, number>();
    (entryNames ?? []).forEach((e) => map.set(`${e.race_date}-${e.meet}-${e.rc_no}-${e.hr_name}`, e.pthr_no));
    return map;
  }, [entryNames]);
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

  // 경주별 그룹 (data가 race_date→meet→rc_no 정렬이라 카드 순서 자동 유지) + 픽은 강추 우선 정렬
  const { upcomingByDate, pastRaces, raceCount } = useMemo(() => {
    const byRace = new Map<string, Prediction[]>();
    for (const p of picks) {
      const k = `${p.race_date}-${p.meet}-${p.rc_no}`;
      if (!byRace.has(k)) byRace.set(k, []);
      byRace.get(k)!.push(p);
    }
    const tierRank = (t: ReturnType<typeof classifyPick>) => (t === 'strong' ? 0 : 1);
    for (const horses of byRace.values()) {
      horses.sort(
        (a, b) =>
          tierRank(classifyPick(a.p_top3)) - tierRank(classifyPick(b.p_top3)) ||
          (b.p_top3 ?? 0) - (a.p_top3 ?? 0)
      );
    }
    // 섹션 분류 = 결과 유무 (스펙 §4: 픽 중 하나라도 actual_ord 있으면 지난 경주)
    const upcoming: Array<[string, Prediction[]]> = [];
    const past: Array<[string, Prediction[]]> = [];
    for (const entry of byRace.entries()) {
      (entry[1].some((p) => p.actual_ord != null) ? past : upcoming).push(entry);
    }
    const byDate = new Map<number, Array<[string, Prediction[]]>>();
    for (const entry of upcoming) {
      const d = entry[1][0]!.race_date;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(entry);
    }
    return { upcomingByDate: [...byDate.entries()], pastRaces: past, raceCount: byRace.size };
  }, [picks]);

  // 지난 경주 실측 페이스 — 지난 경주 있을 때만 조회(훅 규칙 위해 항상 호출, 인자 null 스킵)
  const hasPast = pastRaces.length > 0;
  const { data: sectionalRows } = useRaceSectionalStatsByRange(hasPast ? from : null, hasPast ? to : null);
  const sectionalByKey = useMemo(() => {
    const m = new Map<string, { avgS1f: number | null; meet: number; dist: number | null }>();
    for (const r of sectionalRows ?? []) {
      m.set(`${r.race_date}-${r.meet}-${r.rc_no}`, { avgS1f: r.avg_s1f, meet: r.meet, dist: r.rc_dist });
    }
    return m;
  }, [sectionalRows]);

  if (isLoading) return <div className="text-[var(--color-text-secondary)]">불러오는 중…</div>;

  const weekNav = (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => goToWeek(addDaysToYmd(from, -7))}
        aria-label="이전 주"
        className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="font-medium">{fmtDate(from)} ~ {fmtDate(to)}</span>
      <button
        type="button"
        onClick={() => goToWeek(addDaysToYmd(from, 7))}
        disabled={from >= thisWeekMonday}
        aria-label="다음 주"
        className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight size={16} />
      </button>
      {!isCurrentWeek && (
        <button
          type="button"
          onClick={() => goToWeek(thisWeekMonday)}
          className="ml-1 text-xs text-[var(--color-accent-cyan)] hover:underline"
        >
          이번 주로
        </button>
      )}
    </div>
  );

  if (picks.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{isCurrentWeek ? '이번 주 강추' : '지난 강추'}</h1>
        {weekNav}
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <p className="text-lg mb-1">선택한 주 강추 없음</p>
          {isCurrentWeek && (
            <p className="text-sm">기준(연승 확률 임계값)을 넘는 출주마가 없습니다. 출마표는 수·목·금 오후에 도착합니다.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{isCurrentWeek ? '이번 주 강추' : '지난 강추'}</h1>
      {weekNav}
      <p className="text-sm text-[var(--color-text-secondary)]">
        보정 연승확률 기준 강추/주목 {picks.length}마리 · {raceCount}경주
      </p>

      {upcomingByDate.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">다가오는 경주</h2>
          {upcomingByDate.map(([date, races]) => (
            <div key={date} className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--color-accent-cyan)]">{fmtDate(date)}</h3>
              {races.map(([key, horses]) => (
                <RaceCard key={key} raceKey={key} horses={horses} styles={stylesByRace.get(key)} showResult={false} pthrByKey={pthrByKey} />
              ))}
            </div>
          ))}
        </section>
      )}

      {pastRaces.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">지난 경주{isCurrentWeek ? ' (이번 주 결과)' : ''}</h2>
          {pastRaces.map(([key, horses]) => (
            <RaceCard key={key} raceKey={key} horses={horses} styles={stylesByRace.get(key)} showResult={true} actual={sectionalByKey.get(key)} pthrByKey={pthrByKey} />
          ))}
        </section>
      )}
    </div>
  );
}
