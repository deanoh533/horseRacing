/**
 * 출마정보 비교 화면 (PRD v6.1 — P0a)
 *
 * 한 경주의 모든 출전마를 한 표에서 비교.
 *  - 상단: AI 예측 1-3위 요약 박스 (가볍게)
 *  - 본체: 출주번호 순 정렬, 컬럼 헤더 클릭으로 재정렬
 *  - 행 클릭: 말 상세로 이동
 */
import { useParams, Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronUp, ChevronDown, Loader2, Bot, Zap, Award, Target, History, Dumbbell, Dna } from 'lucide-react';
import {
  useHorsesByRace,
  usePredictionsByRace,
  useHorseSectionalAbility,
  useHorseSectionalAbilityByNames,
  useHorseRunningStyleByDistance,
  useHorseHistory,
  useHorseTraining,
  useJockeyStats,
  useHorseInfo,
} from '../lib/queries';
import { supabase, type RaceEntry, type Race } from '../lib/supabase';
import { useQueries, useQuery } from '@tanstack/react-query';
import { classifyRunningStyle, STYLE_INFO, describeFrontRunSuccess, type RunningStyle } from '../lib/runningStyle';

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부산경남' };

function useRaceMeta(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['race', rcDate, meet, rcNo],
    queryFn: async (): Promise<Race | null> => {
      const { data, error } = await supabase
        .from('races')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * 여러 말의 최근 5경주 이력을 병렬로 조회 (출전마 N마리 → N개 쿼리)
 * React Query 캐시로 동일 (hr_name, beforeDate) 중복 제거
 */
function useMultipleHorseHistories(hrNames: string[], beforeDate: number) {
  return useQueries({
    queries: hrNames.map((hrName) => ({
      queryKey: ['horse-history', hrName, beforeDate, 5],
      queryFn: async (): Promise<RaceEntry[]> => {
        const { data, error } = await supabase
          .from('race_entries')
          .select('*')
          .eq('hr_name', hrName)
          .lt('race_date', beforeDate)
          .not('ord', 'is', null)
          .order('race_date', { ascending: false })
          .limit(5);
        if (error) throw error;
        return data ?? [];
      },
      enabled: !!hrName,
      staleTime: 60 * 60 * 1000,
    })),
  });
}

// ============================================================
// 정렬 키 정의
// ============================================================
type SortKey =
  | 'pthr_no'
  | 'hr_name'
  | 'ag'
  | 'burd_wgt'
  | 'ratg'
  | 'erng_sump'
  | 'jcky_nm'
  | 'predicted_rank';

type SortDir = 'asc' | 'desc';

// ============================================================
// 메인 페이지
// ============================================================
export function RaceEntries() {
  const { meet: meetStr, date: dateStr, rcNo: rcNoStr } = useParams();
  const meet = Number(meetStr);
  const rcDate = Number(dateStr);
  const rcNo = Number(rcNoStr);

  const [sortKey, setSortKey] = useState<SortKey>('pthr_no');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedPthr, setExpandedPthr] = useState<number | null>(null);

  const { data: race } = useRaceMeta(rcDate, meet, rcNo);
  const { data: horses, isLoading, error } = useHorsesByRace(rcDate, meet, rcNo);
  const { data: predictions } = usePredictionsByRace(rcDate, meet, rcNo);

  const hrNames = useMemo(() => (horses ?? []).map((h) => h.hr_name), [horses]);
  const historyQueries = useMultipleHorseHistories(hrNames, rcDate);
  const { data: abilities } = useHorseSectionalAbilityByNames(hrNames);

  // hr_name → 주행 성향 분류 맵
  const styleByName = useMemo(() => {
    const map = new Map<string, RunningStyle>();
    (abilities ?? []).forEach((a) => {
      map.set(a.hr_name, classifyRunningStyle(a.avg_position_ratio, a.stddev_position_ratio));
    });
    return map;
  }, [abilities]);

  // hr_name → predicted_rank 맵
  const predRankByName = useMemo(() => {
    const map = new Map<string, number>();
    (predictions ?? []).forEach((p) => map.set(p.hr_name, p.predicted_rank));
    return map;
  }, [predictions]);

  // hr_name → 최근 5경주 폼 ("1-3-2-5-1")
  const recentFormByName = useMemo(() => {
    const map = new Map<string, string>();
    hrNames.forEach((name, idx) => {
      const hist = historyQueries[idx]?.data ?? [];
      if (hist.length === 0) {
        map.set(name, '-');
        return;
      }
      // 최근 → 과거 순으로 받았으니 reverse해서 오래된 → 최근
      const seq = [...hist]
        .reverse()
        .map((h) => (h.ord === null ? '-' : h.ord))
        .join('-');
      map.set(name, seq);
    });
    return map;
  }, [hrNames, historyQueries]);

  // 정렬 + 표시용 row 만들기
  const rows = useMemo(() => {
    if (!horses) return [];
    const enriched = horses.map((h) => ({
      ...h,
      predicted_rank: predRankByName.get(h.hr_name) ?? 999,
      recent_form: recentFormByName.get(h.hr_name) ?? '-',
    }));
    return sortRows(enriched, sortKey, sortDir);
  }, [horses, predRankByName, recentFormByName, sortKey, sortDir]);

  // AI 예측 top3
  const top3 = useMemo(() => {
    return [...(predictions ?? [])]
      .sort((a, b) => a.predicted_rank - b.predicted_rank)
      .slice(0, 3);
  }, [predictions]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
            뒤로
          </Link>
          <span className="text-[var(--color-text-disabled)]">|</span>
          <span className="font-mono-num text-xs text-[var(--color-text-disabled)]">
            {formatFullDate(rcDate)}
          </span>
          <span className="font-semibold">
            {MEET_NAMES[meet] ?? '?'} {rcNo}R
          </span>
          {race?.rc_dist != null && (
            <span className="font-mono-num">{race.rc_dist}m</span>
          )}
          {race?.rc_name && (
            <span className="text-[var(--color-text-secondary)]">{race.rc_name}</span>
          )}
          {horses && (
            <span className="text-xs text-[var(--color-text-disabled)] ml-auto">
              {horses.length}마
            </span>
          )}
        </div>
        {/* 경주 조건 배지 (데이터 로드 후 표시) */}
        {race && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {race.age_cond && (
              <span className="px-2 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
                {race.age_cond}
              </span>
            )}
            {race.prize_cond && (
              <span
                className="px-2 py-0.5 rounded border font-medium"
                style={{
                  background: 'rgba(0,229,255,0.08)',
                  border: '1px solid rgba(0,229,255,0.3)',
                  color: 'var(--color-accent-cyan)',
                }}
              >
                {race.prize_cond}
              </span>
            )}
            {race.track && (
              <span className="px-2 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
                {race.track}
              </span>
            )}
            {race.weather && (
              <span className="px-2 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
                {race.weather}
              </span>
            )}
            {race.chaksun1 != null && race.chaksun1 > 0 && (
              <span className="font-mono-num font-semibold" style={{ color: 'var(--color-accent-gold)' }}>
                1위 {formatErng(race.chaksun1)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* AI 예측 요약 박스 (가볍게, 별도 강조) */}
      {top3.length > 0 && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl p-3 border border-[var(--color-bg-elevated)] flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-accent-cyan)] font-semibold">
            <Bot className="w-4 h-4" />
            AI 예측
          </div>
          <div className="flex items-center gap-3 text-sm flex-wrap">
            {top3.map((p, i) => {
              const medals = ['🥇', '🥈', '🥉'];
              return (
                <div
                  key={p.hr_name}
                  className="flex items-center gap-1.5 font-mono-num"
                >
                  <span>{medals[i]}</span>
                  <span className="font-semibold">{p.hr_name}</span>
                  <span className="text-xs text-[var(--color-text-disabled)]">
                    {p.total_score.toFixed(1)}점
                  </span>
                </div>
              );
            })}
          </div>
          <Link
            to={`/race/${meet}/${rcDate}/${rcNo}`}
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)] underline ml-auto"
          >
            AI 예측 상세 →
          </Link>
        </div>
      )}

      {/* 로딩 / 에러 */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          로딩 중...
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          ❌ {(error as Error).message}
        </div>
      )}

      {/* 출전마 비교 표 */}
      {!isLoading && rows.length > 0 && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono-num">
              <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] text-sm">
                <tr>
                  <SortHeader label="번" k="pthr_no" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeader label="마명" k="hr_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                  <SortHeader label="나/성" k="ag" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
                  <SortHeader label="부담" k="burd_wgt" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeader label="레이팅" k="ratg" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeader label="수득상금" k="erng_sump" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <SortHeader label="기수" k="jcky_nm" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                  <th className="px-2 py-2 text-left">최근 폼</th>
                  <SortHeader label="AI" k="predicted_rank" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const sex = h.gndr ?? '';
                  const rankLabel = formatPredRank(h.predicted_rank);
                  const isExpanded = expandedPthr === h.pthr_no;
                  return (
                    <FragmentRow key={h.pthr_no}>
                      <tr
                        className={`border-t border-[var(--color-bg-elevated)] cursor-pointer transition-colors ${
                          isExpanded
                            ? 'bg-[var(--color-accent-cyan)]/10'
                            : 'hover:bg-[var(--color-bg-elevated)]/50'
                        }`}
                        onClick={() => setExpandedPthr(isExpanded ? null : h.pthr_no)}
                      >
                        <td className="px-2 py-2 text-right font-semibold text-[var(--color-accent-cyan)]">
                          <span className="inline-flex items-center gap-1">
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            {h.pthr_no}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Link
                              to={`/race/${meet}/${rcDate}/${rcNo}/horse/${h.pthr_no}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-semibold hover:text-[var(--color-accent-cyan)] hover:underline"
                            >
                              {h.hr_name}
                            </Link>
                            {(() => {
                              const style = styleByName.get(h.hr_name) ?? 'unknown';
                              if (style === 'unknown') return null;
                              const info = STYLE_INFO[style];
                              return (
                                <span
                                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[12px] font-medium border ${info.className}`}
                                  title={info.description}
                                >
                                  <span>{info.emoji}</span>
                                  {info.shortName}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-center text-xs">
                          {h.ag ?? '?'}{sex}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {h.burd_wgt ?? '-'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {h.ratg && h.ratg > 0 ? h.ratg : '-'}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatErng(h.erng_sump)}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {h.jcky_nm ?? '-'}
                        </td>
                        <td className="px-2 py-2 text-xs text-[var(--color-text-secondary)]">
                          {h.recent_form}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={rankBadgeClass(h.predicted_rank)}>
                            {rankLabel}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[var(--color-bg-primary)]/30">
                          <td colSpan={9} className="p-4">
                            <ExpandedDetail
                              entry={h}
                              meet={meet}
                              rcDate={rcDate}
                              rcNo={rcNo}
                            />
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 text-center text-[var(--color-text-secondary)]">
          출전마 데이터 없음
        </div>
      )}

      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-2">
        ℹ️ 컬럼 헤더 클릭으로 정렬 · 마명 클릭으로 상세 보기 · 기본 정렬: 출주번호
      </div>
    </div>
  );
}

// ============================================================
// 정렬 헤더 셀
// ============================================================
function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align: 'left' | 'right' | 'center';
}) {
  const active = sortKey === k;
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`px-2 py-2 ${alignClass} cursor-pointer select-none hover:text-[var(--color-accent-cyan)]`}
      onClick={() => onClick(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active &&
          (sortDir === 'asc' ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          ))}
      </span>
    </th>
  );
}

// ============================================================
// 유틸
// ============================================================
type Row = RaceEntry & { predicted_rank: number; recent_form: string };

function sortRows(rows: Row[], key: SortKey, dir: SortDir): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a: Row, b: Row): number => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // null은 항상 뒤로
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv), 'ko') * sign;
  };
  return [...rows].sort(cmp);
}

function formatErng(v: number | null): string {
  if (v == null || v === 0) return '-';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${Math.round(v / 10_000)}만`;
  return String(v);
}

function formatPredRank(rank: number): string {
  if (rank >= 999) return '-';
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return medals[rank] ?? `${rank}`;
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return 'text-[var(--color-accent-gold)] font-bold';
  if (rank === 2 || rank === 3) return 'text-[var(--color-accent-cyan)] font-semibold';
  return 'text-[var(--color-text-disabled)] text-xs';
}

function ordBadgeClass(ord: number | null): string {
  if (ord == null) return 'text-[var(--color-accent-pink)] text-[12px]';
  if (ord === 1) return 'text-[var(--color-accent-gold)] font-bold';
  if (ord <= 3) return 'text-[var(--color-success)] font-semibold';
  if (ord <= 7) return 'text-[var(--color-text-primary)]';
  return 'text-[var(--color-text-disabled)]';
}

function formatShortDate(rcDate: number): string {
  const m = Math.floor((rcDate % 10000) / 100);
  const d = rcDate % 100;
  return `${m}/${String(d).padStart(2, '0')}`;
}

function formatFullDate(d: number): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor((d % 10000) / 100);
  const day = d % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ============================================================
// Fragment wrapper for two-row entry (main + expand)
// ============================================================
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ============================================================
// ExpandedDetail — 행 펼침 시 추가 데이터 표시
// ============================================================
function ExpandedDetail({
  entry,
  meet,
  rcDate,
  rcNo,
}: {
  entry: RaceEntry;
  meet: number;
  rcDate: number;
  rcNo: number;
}) {
  const { data: ability, isLoading: abLoading } = useHorseSectionalAbility(entry.hr_name);
  const { data: jockeyStats } = useJockeyStats(entry.jcky_no ?? '', meet);
  const { data: history, isLoading: histLoading } = useHorseHistory(entry.hr_name, rcDate, 5);
  const { data: training, isLoading: trLoading } = useHorseTraining(entry.hr_no ?? '', 30);
  const { data: horseInfo } = useHorseInfo(entry.hr_no ?? '');

  const jockeyStat = jockeyStats?.[0]; // (jcky_no, meet) 단일 row

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      {/* ① 출전마 메타 */}
      <DetailCard icon={<Award className="w-3.5 h-3.5" />} title="기본 정보">
        <KV label="출생지" value={entry.prds ?? '-'} />
        <KV label="마주" value={entry.owner_nm ?? '-'} />
        <KV label="조교사" value={entry.trar_nm ?? '-'} />
        <KV label="수득상금" value={formatErng(entry.erng_sump)} />
        <KV label="최근1년" value={formatErng(entry.erng_loy)} />
        <KV label="최근6개월" value={formatErng(entry.erng_lsm)} />
        {entry.sump_rcod_fplc != null && (
          <KV
            label="통산전적"
            value={`${entry.sump_rcod_sum ?? '?'}전 / 1위 ${entry.sump_rcod_fplc} · 2위 ${entry.sump_rcod_splc} · 3위 ${entry.sump_rcod_tplc}`}
          />
        )}
      </DetailCard>

      {/* ② 기수 통산 */}
      <DetailCard icon={<Target className="w-3.5 h-3.5" />} title="기수 통산">
        {!entry.jcky_no ? (
          <div className="text-[var(--color-text-disabled)]">기수 번호 없음</div>
        ) : !jockeyStat ? (
          <div className="text-[var(--color-text-disabled)]">데이터 없음 (sync 필요)</div>
        ) : (
          <>
            <KV label="기수" value={`${jockeyStat.jcky_nm ?? '-'} (${entry.jcky_no})`} />
            <KV label="통산 출주" value={`${jockeyStat.race_cnt_t ?? '-'}회`} />
            <KV label="1위" value={`${jockeyStat.first_cnt ?? 0}회`} />
            <KV label="2-3위" value={`${(jockeyStat.second_cnt ?? 0) + (jockeyStat.third_cnt ?? 0)}회`} />
            <KV label="단승률" value={`${jockeyStat.win_rate_t ?? '-'}%`} />
            <KV label="입상률" value={`${jockeyStat.qu_rate_t ?? '-'}%`} />
          </>
        )}
      </DetailCard>

      {/* ③ 구간 능력치 + 주행 성향 */}
      <DetailCard icon={<Zap className="w-3.5 h-3.5" />} title="구간 능력치 · 주행 성향">
        {abLoading ? (
          <div className="text-[var(--color-text-disabled)]">
            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
            로딩…
          </div>
        ) : !ability ? (
          <div className="text-[var(--color-text-disabled)]">
            3경주 미만 (분석 데이터 부족)
          </div>
        ) : (
          <>
            {(() => {
              const style = classifyRunningStyle(ability.avg_position_ratio, ability.stddev_position_ratio);
              const info = STYLE_INFO[style];
              return (
                <div className="mb-2 pb-2 border-b border-[var(--color-bg-elevated)]">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[13px] font-semibold border ${info.className}`}
                  >
                    <span>{info.emoji}</span>
                    {info.name}
                  </span>
                  <span className="ml-2 text-[12px] text-[var(--color-text-secondary)]">
                    {info.description}
                  </span>
                </div>
              );
            })()}
            <KV label="분석경주수" value={`${ability.races}회`} />
            <KV
              label="평균 출발 위치"
              value={
                ability.avg_position_ratio != null
                  ? `${(ability.avg_position_ratio * 100).toFixed(0)}% (0=선두, 100=후미)`
                  : '-'
              }
            />
            <KV
              label="스타일 안정성"
              value={
                ability.stddev_position_ratio != null
                  ? ability.stddev_position_ratio < 0.2
                    ? `${ability.stddev_position_ratio.toFixed(2)} (매우 일관)`
                    : ability.stddev_position_ratio < 0.35
                      ? `${ability.stddev_position_ratio.toFixed(2)} (보통)`
                      : `${ability.stddev_position_ratio.toFixed(2)} (변동 큼 → 자유마)`
                  : '-'
              }
            />
            <KV
              label="선행 성공률"
              value={describeFrontRunSuccess(ability.front_run_success_rate)}
            />
            <KV label="평균 착순" value={ability.avg_ord != null ? `${ability.avg_ord}위` : '-'} />
            <div className="my-2 pt-2 border-t border-[var(--color-bg-elevated)] text-[12px] text-[var(--color-text-secondary)]">
              구간 시간 (best · avg)
            </div>
            <KV
              label="출발 200m"
              value={ability.best_s1f != null ? `${ability.best_s1f}초 (avg ${ability.avg_s1f})` : '-'}
            />
            <KV
              label="막판 600m"
              value={ability.best_last_600m != null ? `${ability.best_last_600m}초 (avg ${ability.avg_last_600m})` : '-'}
            />
            <KV
              label="막판 200m"
              value={ability.best_last_200m != null ? `${ability.best_last_200m}초 (avg ${ability.avg_last_200m})` : '-'}
            />
          </>
        )}
      </DetailCard>

      {/* ③-2 거리별 주행 성향 (Phase 3) */}
      <DistanceStyleCard hrName={entry.hr_name} />


      {/* ④ 최근 5경주 */}
      <DetailCard icon={<History className="w-3.5 h-3.5" />} title="최근 5경주">
        {histLoading ? (
          <div className="text-[var(--color-text-disabled)]">
            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
            로딩…
          </div>
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
              {history.map((h, i) => (
                <tr key={i} className="border-t border-[var(--color-bg-elevated)]">
                  <td className="py-1">{formatShortDate(h.race_date)}</td>
                  <td className="py-1 text-right">{h.rc_dist ?? '-'}m</td>
                  <td className="py-1 text-right">
                    <span className={ordBadgeClass(h.ord)}>
                      {h.ord != null ? `${h.ord}위` : '-'}
                    </span>
                  </td>
                  <td className="py-1 text-right font-mono-num">
                    {h.rc_time != null ? `${h.rc_time}s` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DetailCard>

      {/* ⑤ 최근 훈련 (30일) */}
      <DetailCard icon={<Dumbbell className="w-3.5 h-3.5" />} title="최근 훈련 (30일)">
        {!entry.hr_no ? (
          <div className="text-[var(--color-text-disabled)]">말 번호 없음</div>
        ) : trLoading ? (
          <div className="text-[var(--color-text-disabled)]">
            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
            로딩…
          </div>
        ) : !training || training.length === 0 ? (
          <div className="text-[var(--color-text-disabled)]">훈련 기록 없음</div>
        ) : (
          <>
            <KV label="총 훈련" value={`${training.length}회`} />
            <KV
              label="마지막"
              value={formatShortDate(training[0]!.train_date)}
            />
            <KV
              label="조교사"
              value={training[0]!.trar_nm ?? '-'}
            />
            <KV
              label="총 달린 횟수"
              value={`${training.reduce((s, t) => s + (t.run1_cnt ?? 0) + (t.run2_cnt ?? 0), 0)}회`}
            />
            <KV
              label="출전 구분"
              value={training[0]!.chul_gubun ?? '-'}
            />
          </>
        )}
      </DetailCard>

      {/* ⑥ 혈통 */}
      <DetailCard icon={<Dna className="w-3.5 h-3.5" />} title="혈통">
        {!entry.hr_no ? (
          <div className="text-[var(--color-text-disabled)]">말 번호 없음</div>
        ) : !horseInfo ? (
          <div className="text-[var(--color-text-disabled)]">혈통 데이터 없음 (horses 테이블 sync 필요)</div>
        ) : (
          <>
            <KV label="부마" value={horseInfo.sire_hr_nm ?? '-'} />
            <KV label="모마" value={horseInfo.dam_hr_nm ?? '-'} />
            <KV label="모부마" value={horseInfo.dam_sire_hr_nm ?? '-'} />
            {horseInfo.spcs_nm && <KV label="품종" value={horseInfo.spcs_nm} />}
            {horseInfo.dsidx_vl != null && horseInfo.dsidx_vl > 0 && (
              <KV label="혈통지수" value={`${horseInfo.dsidx_vl}`} />
            )}
            {horseInfo.dsa_coi_rt != null && horseInfo.dsa_coi_rt > 0 && (
              <KV label="근친도" value={`${horseInfo.dsa_coi_rt}%`} />
            )}
          </>
        )}
      </DetailCard>

      {/* 푸터 안내 */}
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
}

function DetailCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--color-bg-surface)] rounded-lg p-3 border border-[var(--color-bg-elevated)]">
      <div className="flex items-center gap-1.5 text-[var(--color-accent-cyan)] text-[12px] uppercase tracking-wider font-semibold mb-2">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--color-text-secondary)] flex-shrink-0">{label}:</span>
      <span className="font-mono-num text-right">{value}</span>
    </div>
  );
}

const DIST_LABEL: Record<string, string> = {
  short: '단거리 (<1400m)',
  middle: '중거리 (1400-1800m)',
  long: '장거리 (>1800m)',
};

function DistanceStyleCard({ hrName }: { hrName: string }) {
  const { data, isLoading } = useHorseRunningStyleByDistance(hrName);

  return (
    <DetailCard icon={<Zap className="w-3.5 h-3.5" />} title="거리별 주행 성향">
      {isLoading ? (
        <div className="text-[var(--color-text-disabled)]">
          <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
          로딩…
        </div>
      ) : !data || data.length === 0 ? (
        <div className="text-[var(--color-text-disabled)]">
          거리별 데이터 부족 (거리당 2경주 미만)
        </div>
      ) : (
        <div className="space-y-1.5">
          {(['short', 'middle', 'long'] as const).map((cat) => {
            const row = data.find((d) => d.dist_category === cat);
            if (!row) {
              return (
                <div key={cat} className="flex justify-between text-[var(--color-text-disabled)]">
                  <span>{DIST_LABEL[cat]}:</span>
                  <span>-</span>
                </div>
              );
            }
            const style = classifyRunningStyle(row.avg_position_ratio, row.stddev_position_ratio);
            const info = STYLE_INFO[style];
            return (
              <div key={cat} className="flex justify-between items-center gap-2">
                <span className="text-[var(--color-text-secondary)] flex-shrink-0">
                  {DIST_LABEL[cat]}:
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono-num text-[12px] text-[var(--color-text-secondary)]">
                    {row.races}회 · ratio {row.avg_position_ratio?.toFixed(2) ?? '-'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[12px] font-medium border ${info.className}`}
                  >
                    <span>{info.emoji}</span>
                    {info.shortName}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </DetailCard>
  );
}
