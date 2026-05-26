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
import { ChevronLeft, ChevronUp, ChevronDown, Loader2, Bot } from 'lucide-react';
import { useHorsesByRace, usePredictionsByRace } from '../lib/queries';
import { supabase, type RaceEntry, type Race } from '../lib/supabase';
import { useQueries, useQuery } from '@tanstack/react-query';

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

  const { data: race } = useRaceMeta(rcDate, meet, rcNo);
  const { data: horses, isLoading, error } = useHorsesByRace(rcDate, meet, rcNo);
  const { data: predictions } = usePredictionsByRace(rcDate, meet, rcNo);

  const hrNames = useMemo(() => (horses ?? []).map((h) => h.hr_name), [horses]);
  const historyQueries = useMultipleHorseHistories(hrNames, rcDate);

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
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
          뒤로
        </Link>
        <span className="text-[var(--color-text-disabled)]">|</span>
        <span className="font-semibold">
          {MEET_NAMES[meet] ?? '?'} {rcNo}R
        </span>
        {race?.rc_dist && <span className="font-mono-num">{race.rc_dist}m</span>}
        {race?.rc_name && (
          <span className="text-[var(--color-text-secondary)]">{race.rc_name}</span>
        )}
        {race?.track && (
          <>
            <span>|</span>
            <span>{race.track}</span>
          </>
        )}
        {horses && (
          <span className="text-xs text-[var(--color-text-disabled)] ml-auto">
            {horses.length}마
          </span>
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
              <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] text-xs">
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
                  return (
                    <tr
                      key={h.pthr_no}
                      className="border-t border-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-elevated)]/50 transition-colors"
                    >
                      <td className="px-2 py-2 text-right font-semibold text-[var(--color-accent-cyan)]">
                        {h.pthr_no}
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          to={`/race/${meet}/${rcDate}/${rcNo}/horse/${h.pthr_no}`}
                          className="font-semibold hover:text-[var(--color-accent-cyan)] hover:underline"
                        >
                          {h.hr_name}
                        </Link>
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
