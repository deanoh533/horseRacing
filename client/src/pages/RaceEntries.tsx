/**
 * 출마정보 비교 화면 (PRD v6.1 — P0a)
 *
 * 한 경주의 모든 출전마를 한 표에서 비교.
 *  - 상단: AI 예측 1-3위 요약 박스
 *  - 본체: 출주번호 순 정렬, 컬럼 헤더 클릭으로 재정렬
 *  - 셀 클릭: 기수 → 기수 패널 / 조교사 → 조교사 패널
 *  - 마명: 말 상세 페이지 링크
 */
import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronUp, ChevronDown, Loader2, Bot, Zap, Award, Target, History, Dumbbell, Dna, ExternalLink } from 'lucide-react';
import { RaceInfoBlock } from '../components/RaceInfoBlock';
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
  useGradeWinnerStats,
  useTrainerStats,
  useJockeyHorseComboBatch,
  useJockeyRecentForm,
} from '../lib/queries';
import { supabase, type RaceEntry, type Race } from '../lib/supabase';
import { useQueries, useQuery } from '@tanstack/react-query';
import { classifyRunningStyle, STYLE_INFO, describeFrontRunSuccess, type RunningStyle } from '../lib/runningStyle';
import { getSectionalInfo, fmtSec, computeSameDistStats } from '../lib/sectional';

function useRaceMeta(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['race', rcDate, meet, rcNo],
    queryFn: async (): Promise<Race | null> => {
      const { data, error } = await supabase
        .from('races').select('*')
        .eq('race_date', rcDate).eq('meet', meet).eq('rc_no', rcNo)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 10 * 60 * 1000,
  });
}

function useMultipleHorseHistories(hrNames: string[], beforeDate: number) {
  return useQueries({
    queries: hrNames.map((hrName) => ({
      queryKey: ['horse-history', hrName, beforeDate, 5],
      queryFn: async (): Promise<RaceEntry[]> => {
        const { data, error } = await supabase
          .from('race_entries').select('*')
          .eq('hr_name', hrName).lt('race_date', beforeDate)
          .not('ord', 'is', null)
          .order('race_date', { ascending: false }).limit(5);
        if (error) throw error;
        return data ?? [];
      },
      enabled: !!hrName,
      staleTime: 60 * 60 * 1000,
    })),
  });
}

// ============================================================
// 정렬 키
// ============================================================
type SortKey = 'pthr_no' | 'hr_name' | 'ag' | 'burd_wgt' | 'ratg' | 'jcky_nm' | 'trar_nm' | 'predicted_rank';
type SortDir = 'asc' | 'desc';
type ExpandPanel = 'jockey' | 'trainer' | 'horse';
type ExpandedCell = { pthr: number; panel: ExpandPanel } | null;

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
  const [expandedCell, setExpandedCell] = useState<ExpandedCell>(null);
  const navigate = useNavigate();

  const { data: race } = useRaceMeta(rcDate, meet, rcNo);
  const { data: horses, isLoading, error } = useHorsesByRace(rcDate, meet, rcNo);
  const { data: predictions } = usePredictionsByRace(rcDate, meet, rcNo);
  const { data: gradeStats } = useGradeWinnerStats(race?.prize_cond ?? null, race?.rc_dist ?? null);

  const hrNames = useMemo(() => (horses ?? []).map((h) => h.hr_name), [horses]);
  const historyQueries = useMultipleHorseHistories(hrNames, rcDate);
  const { data: abilities } = useHorseSectionalAbilityByNames(hrNames);

  const styleByName = useMemo(() => {
    const map = new Map<string, RunningStyle>();
    (abilities ?? []).forEach((a) => {
      map.set(a.hr_name, classifyRunningStyle(a.avg_position_ratio, a.stddev_position_ratio));
    });
    return map;
  }, [abilities]);

  const predRankByName = useMemo(() => {
    const map = new Map<string, number>();
    (predictions ?? []).forEach((p) => map.set(p.hr_name, p.predicted_rank));
    return map;
  }, [predictions]);

  const recentFormByName = useMemo(() => {
    const map = new Map<string, string>();
    hrNames.forEach((name, idx) => {
      const hist = historyQueries[idx]?.data ?? [];
      if (hist.length === 0) { map.set(name, '-'); return; }
      const seq = [...hist].reverse().map((h) => (h.ord === null ? '-' : h.ord)).join('-');
      map.set(name, seq);
    });
    return map;
  }, [hrNames, historyQueries]);

  const rows = useMemo(() => {
    if (!horses) return [];
    const enriched = horses.map((h) => ({
      ...h,
      predicted_rank: predRankByName.get(h.hr_name) ?? 999,
      recent_form: recentFormByName.get(h.hr_name) ?? '-',
    }));
    return sortRows(enriched, sortKey, sortDir);
  }, [horses, predRankByName, recentFormByName, sortKey, sortDir]);

  const top3 = useMemo(() => {
    return [...(predictions ?? [])].sort((a, b) => a.predicted_rank - b.predicted_rank).slice(0, 3);
  }, [predictions]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleCellClick = (pthr: number, panel: ExpandPanel) => {
    setExpandedCell((prev) =>
      prev?.pthr === pthr && prev?.panel === panel ? null : { pthr, panel }
    );
  };

  return (
    <div className="space-y-4">
      {/* 내비게이션 */}
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" />뒤로
        </button>
      </div>

      <RaceInfoBlock rcDate={rcDate} meet={meet} rcNo={rcNo} race={race} horses={horses} gradeStats={gradeStats} />

      {/* AI 예측 요약 */}
      {top3.length > 0 && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl p-3 border border-[var(--color-bg-elevated)] flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-accent-cyan)] font-semibold">
            <Bot className="w-4 h-4" />AI 예측
          </div>
          <div className="flex items-center gap-3 text-sm flex-wrap">
            {top3.map((p, i) => {
              const medals = ['🥇', '🥈', '🥉'];
              return (
                <div key={p.hr_name} className="flex items-center gap-1.5 font-mono-num">
                  <span>{medals[i]}</span>
                  <span className="font-semibold">{p.hr_name}</span>
                  <span className="text-xs text-[var(--color-text-disabled)]">{p.total_score.toFixed(1)}점</span>
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

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />로딩 중...
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
          {/* U-003: 가로 스크롤 힌트 */}
          <div className="relative">
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono-num">
                <thead className="bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] text-sm">
                  <tr>
                    <SortHeader label="번" k="pthr_no" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    <SortHeader label="마명" k="hr_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    <th className="hidden md:table-cell px-2 py-2 text-left whitespace-nowrap text-xs">산지·성·연령</th>
                    <SortHeader label="레이팅" k="ratg" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    <SortHeader label="중량/증감" k="burd_wgt" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                    <SortHeader label="기수" k="jcky_nm" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" />
                    <SortHeader label="조교사" k="trar_nm" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="left" className="hidden md:table-cell" />
                    <th className="hidden md:table-cell px-2 py-2 text-left whitespace-nowrap">최근 폼</th>
                    <SortHeader label="AI" k="predicted_rank" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="center" className="hidden md:table-cell" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const isJockeyOpen = expandedCell?.pthr === h.pthr_no && expandedCell?.panel === 'jockey';
                    const isTrainerOpen = expandedCell?.pthr === h.pthr_no && expandedCell?.panel === 'trainer';
                    const isHorseOpen = expandedCell?.pthr === h.pthr_no && expandedCell?.panel === 'horse';
                    const anyOpen = isJockeyOpen || isTrainerOpen || isHorseOpen;
                    return (
                      <FragmentRow key={h.pthr_no}>
                        <tr
                          className={`border-t border-[var(--color-bg-elevated)] transition-colors ${
                            anyOpen ? 'bg-[var(--color-bg-elevated)]/60' : 'hover:bg-[var(--color-bg-elevated)]/30'
                          }`}
                        >
                          {/* 번호 */}
                          <td className="px-2 py-2 text-right font-semibold text-[var(--color-accent-cyan)]">
                            {h.pthr_no}
                          </td>

                          {/* 마명 — 클릭 시 최근전적 패널 + 외부링크로 상세 이동 */}
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                className="text-left font-semibold hover:underline transition-colors inline-flex items-center gap-0.5"
                                style={{
                                  color: isHorseOpen ? 'var(--color-accent-cyan)' : undefined,
                                }}
                                onClick={() => handleCellClick(h.pthr_no, 'horse')}
                              >
                                {isHorseOpen
                                  ? <ChevronUp className="w-3 h-3" />
                                  : <ChevronDown className="w-3 h-3" />}
                                {h.hr_name}
                              </button>
                              <Link
                                to={`/race/${meet}/${rcDate}/${rcNo}/horse/${h.pthr_no}`}
                                className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent-cyan)]"
                                title="말 상세 페이지"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3 h-3" />
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
                                    <span>{info.emoji}</span>{info.shortName}
                                  </span>
                                );
                              })()}
                            </div>
                          </td>

                          {/* 산지·성·연령 */}
                          <td className="hidden md:table-cell px-2 py-2 text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                            {[h.prds, h.gndr, h.ag != null ? `${h.ag}세` : null]
                              .filter(Boolean).join(' · ')}
                          </td>

                          {/* 레이팅 */}
                          <td className="px-2 py-2 text-right">
                            {h.ratg && h.ratg > 0 ? h.ratg : '-'}
                          </td>

                          {/* 중량 / 증감 */}
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {h.burd_wgt ?? '-'}
                            {h.wg_hr_diff != null && h.wg_hr_diff !== 0 && (
                              <span
                                className="ml-1 text-xs"
                                style={{
                                  color: h.wg_hr_diff > 0
                                    ? 'var(--color-danger)'
                                    : 'var(--color-success)',
                                }}
                              >
                                ({h.wg_hr_diff > 0 ? '+' : ''}{h.wg_hr_diff})
                              </span>
                            )}
                          </td>

                          {/* 기수 — 클릭 시 기수 패널 */}
                          <td className="px-2 py-2">
                            {h.jcky_nm ? (
                              <button
                                className="text-left hover:underline transition-colors"
                                style={{
                                  color: isJockeyOpen
                                    ? 'var(--color-accent-cyan)'
                                    : 'var(--color-accent-blue, #5b9bd5)',
                                }}
                                onClick={() => handleCellClick(h.pthr_no, 'jockey')}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  {isJockeyOpen
                                    ? <ChevronUp className="w-3 h-3" />
                                    : <ChevronDown className="w-3 h-3" />}
                                  {h.jcky_nm}
                                </span>
                              </button>
                            ) : '-'}
                          </td>

                          {/* 조교사 — 클릭 시 조교사 패널 */}
                          <td className="hidden md:table-cell px-2 py-2">
                            {h.trar_nm ? (
                              <button
                                className="text-left hover:underline transition-colors"
                                style={{
                                  color: isTrainerOpen
                                    ? 'var(--color-accent-cyan)'
                                    : 'var(--color-accent-blue, #5b9bd5)',
                                }}
                                onClick={() => handleCellClick(h.pthr_no, 'trainer')}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  {isTrainerOpen
                                    ? <ChevronUp className="w-3 h-3" />
                                    : <ChevronDown className="w-3 h-3" />}
                                  {h.trar_nm}
                                </span>
                              </button>
                            ) : '-'}
                          </td>

                          {/* 최근 폼 */}
                          <td className="hidden md:table-cell px-2 py-2 text-xs text-[var(--color-text-secondary)]">
                            {h.recent_form}
                          </td>

                          {/* AI 예측 순위 */}
                          <td className="hidden md:table-cell px-2 py-2 text-center">
                            <span className={rankBadgeClass(h.predicted_rank)}>
                              {formatPredRank(h.predicted_rank)}
                            </span>
                          </td>
                        </tr>

                        {/* 아코디언 패널 */}
                        {anyOpen && (
                          <tr className="bg-[var(--color-bg-primary)]/40">
                            <td colSpan={9} className="p-4">
                              {isJockeyOpen && (
                                <JockeyPanel entry={h} meet={meet} />
                              )}
                              {isTrainerOpen && (
                                <TrainerPanel entry={h} />
                              )}
                              {isHorseOpen && (
                                <HorsePanel entry={h} meet={meet} rcDate={rcDate} rcNo={rcNo} rcDist={race?.rc_dist ?? null} />
                              )}
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* U-003: 우측 스크롤 힌트 그라디언트 */}
            <div
              className="absolute right-0 top-0 bottom-0 w-6 pointer-events-none rounded-r-xl"
              style={{
                background: 'linear-gradient(to right, transparent, var(--color-bg-surface))',
              }}
            />
          </div>
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 text-center text-[var(--color-text-secondary)]">
          출전마 데이터 없음
        </div>
      )}

      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-2">
        헤더 클릭 정렬 · 마명/기수/조교사 클릭 상세 패널 · <ExternalLink className="w-3 h-3 inline" /> 아이콘 클릭 말 상세 페이지
      </div>
    </div>
  );
}

// ============================================================
// 정렬 헤더
// ============================================================
function SortHeader({
  label, k, sortKey, sortDir, onClick, align, className: extraClass = '',
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir;
  onClick: (k: SortKey) => void; align: 'left' | 'right' | 'center';
  className?: string;
}) {
  const active = sortKey === k;
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`px-2 py-2 ${alignClass} cursor-pointer select-none hover:text-[var(--color-accent-cyan)] whitespace-nowrap ${extraClass}`}
      onClick={() => onClick(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (sortDir === 'asc'
          ? <ChevronUp className="w-3 h-3" />
          : <ChevronDown className="w-3 h-3" />)}
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
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv), 'ko') * sign;
  });
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

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ============================================================
// 공통 UI 컴포넌트
// ============================================================
function DetailCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-bg-surface)] rounded-lg p-3 border border-[var(--color-bg-elevated)]">
      <div className="flex items-center gap-1.5 text-[var(--color-accent-cyan)] text-[12px] uppercase tracking-wider font-semibold mb-2">
        {icon}{title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-[var(--color-text-secondary)] flex-shrink-0">{label}:</span>
      <span className="font-mono-num text-right">{value}</span>
    </div>
  );
}

// ============================================================
// 기수 패널
// ============================================================
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

// ============================================================
// 조교사 패널
// ============================================================
function TrainerPanel({ entry }: { entry: RaceEntry }) {
  const { data: trainerStat } = useTrainerStats(entry.trar_nm ?? '');
  const { data: training, isLoading: trLoading } = useHorseTraining(entry.hr_no ?? '', 30);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <DetailCard icon={<Target className="w-3.5 h-3.5" />} title="조교사 최근 2년 성적">
        {!trainerStat ? (
          <div className="text-[var(--color-text-disabled)]">집계 중…</div>
        ) : (
          <>
            <KV label="조교사" value={entry.trar_nm ?? '-'} />
            <KV label="출주" value={`${trainerStat.total}전`} />
            <KV label="1위" value={`${trainerStat.wins}승 (${trainerStat.total > 0 ? ((trainerStat.wins / trainerStat.total) * 100).toFixed(1) : 0}%)`} />
            <KV label="연승(~2위)" value={`${trainerStat.places}회`} />
            <KV label="복승(~3위)" value={`${trainerStat.shows}회`} />
          </>
        )}
      </DetailCard>

      <DetailCard icon={<Dumbbell className="w-3.5 h-3.5" />} title={`훈련 기록 (최근 30일) — ${entry.hr_name}`}>
        {!entry.hr_no ? (
          <div className="text-[var(--color-text-disabled)]">말 번호 없음</div>
        ) : trLoading ? (
          <div className="text-[var(--color-text-disabled)]"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />로딩…</div>
        ) : !training || training.length === 0 ? (
          <div className="text-[var(--color-text-disabled)]">훈련 기록 없음</div>
        ) : (
          <>
            <KV label="총 훈련" value={`${training.length}회`} />
            <KV label="마지막" value={formatShortDate(training[0]!.train_date)} />
            <KV label="출전 구분" value={training[0]!.chul_gubun ?? '-'} />
            <KV label="기승자" value={training[0]!.pr_gubun ?? '-'} />
            <KV label="소요시간" value={training[0]!.tr_term != null ? `${training[0]!.tr_term}초` : '-'} />
          </>
        )}
      </DetailCard>
    </div>
  );
}

// ============================================================
// 말 상세 패널 (구간능력·이력·혈통)
// ============================================================
function HorsePanel({
  entry, meet, rcDate, rcNo, rcDist,
}: {
  entry: RaceEntry; meet: number; rcDate: number; rcNo: number; rcDist: number | null;
}) {
  const { data: ability, isLoading: abLoading } = useHorseSectionalAbility(entry.hr_name);
  const { data: history, isLoading: histLoading } = useHorseHistory(entry.hr_name, rcDate, 10);
  const { data: horseInfo } = useHorseInfo(entry.hr_no ?? '');

  const { data: training } = useHorseTraining(entry.hr_no ?? '', 30);
  const sameDistStats = useMemo(
    () => (rcDist != null ? computeSameDistStats(history ?? [], rcDist) : null),
    [history, rcDist]
  );
  const hasHealth =
    entry.latst_bledg1 || entry.latst_bledg2 ||
    entry.latst_trea1_txt || entry.latst_trea2_txt;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs items-start">
      {/* 왼쪽 열: 기본 정보 + 혈통 */}
      <div className="flex flex-col gap-3">
      {/* 기본 정보 + 같은거리 기록 + 조교/진료 */}
      <DetailCard icon={<Award className="w-3.5 h-3.5" />} title="기본 정보">
        <KV label="출생지" value={entry.prds ?? '-'} />
        <KV label="마주" value={entry.owner_nm ?? '-'} />
        <KV label="수득상금" value={formatErng(entry.erng_sump)} />
        <KV label="최근1년" value={formatErng(entry.erng_loy)} />
        {entry.sump_rcod_fplc != null && (
          <KV
            label="통산전적"
            value={`${entry.sump_rcod_sum ?? '?'}전 ${entry.sump_rcod_fplc}/${entry.sump_rcod_splc}/${entry.sump_rcod_tplc}`}
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
                    {(() => {
                      const m = Math.floor(sameDistStats.bestTime / 60);
                      const s = (sameDistStats.bestTime % 60).toFixed(1);
                      return m > 0 ? `${m}:${s.padStart(4, '0')}` : s;
                    })()}
                  </div>
                  <div className="font-mono-num text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>
                    {[
                      formatShortDate(sameDistStats.bestRaceDate),
                      sameDistStats.bestJckyNm,
                      sameDistStats.bestBurdWgt != null ? `${sameDistStats.bestBurdWgt}kg` : null,
                      sameDistStats.bestTrackType,
                      sameDistStats.bestOrd != null ? `${sameDistStats.bestOrd}위` : null,
                      `${sameDistStats.bestPthrNo}번`,
                    ].filter(Boolean).join('·')}
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
                    {sameDistStats.count}전·{sameDistStats.wins}/{sameDistStats.places - sameDistStats.wins}/{sameDistStats.shows - sameDistStats.places}
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
      </div>

      {/* 오른쪽 열: 구간 능력치 + 최근 5경주 */}
      <div className="flex flex-col gap-3">
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
                  sec.cornerStr != null || sec.s1fOrd != null || sec.s1fTime != null ||
                  sec.g3fOrd != null || sec.g3fSplit != null ||
                  sec.g1fOrd != null || sec.g1fSplit != null;

                // 위치 시퀀스: S1F - C1 - C2 - C3 - C4 - G1F
                const isSe = h.meet === 1;
                const cornerRanks: (number | null)[] = isSe
                  ? [h.sj_1c_ord ?? null, h.sj_2c_ord ?? null, h.sj_3c_ord ?? null, h.sj_4c_ord ?? null]
                  : [h.bu_g8f_ord ?? null, h.bu_g6f_ord ?? null, h.bu_g4f_ord ?? null, h.bu_g2f_ord ?? null];
                const allPositions = [sec.s1fOrd, ...cornerRanks, sec.g1fOrd];
                const hasAnyPos = allPositions.some(p => p != null);
                const posStr = allPositions.map(p => p != null ? String(p) : '·').join('-');

                const timeParts = [
                  (sec.s1fOrd != null || sec.s1fTime != null)
                    ? `S1F${sec.s1fOrd != null ? ` ${sec.s1fOrd}위` : ''}${sec.s1fTime != null ? `(${fmtSec(sec.s1fTime)}초)` : ''}`
                    : null,
                  (sec.g3fOrd != null || sec.g3fSplit != null)
                    ? `S3F${sec.g3fOrd != null ? ` ${sec.g3fOrd}위` : ''}${sec.g3fSplit != null ? `(${fmtSec(sec.g3fSplit)}초)` : ''}`
                    : null,
                  (sec.g1fOrd != null || sec.g1fSplit != null)
                    ? `G1F${sec.g1fOrd != null ? ` ${sec.g1fOrd}위` : ''}${sec.g1fSplit != null ? `(${fmtSec(sec.g1fSplit)}초)` : ''}`
                    : null,
                ].filter(Boolean);

                return (
                  <React.Fragment key={i}>
                    <tr className="border-t border-[var(--color-bg-elevated)]">
                      <td className="py-1">{formatShortDate(h.race_date)}</td>
                      <td className="py-1 text-right">{h.rc_dist ?? '-'}m</td>
                      <td className="py-1 text-right">
                        <span className={ordBadgeClass(h.ord)}>{h.ord != null ? `${h.ord}위` : '-'}</span>
                      </td>
                      <td className="py-1 text-right font-mono-num">{h.rc_time != null ? `${h.rc_time}s` : '-'}</td>
                    </tr>
                    {hasSecData && (
                      <tr>
                        <td colSpan={4} className="pb-1 text-[11px]" style={{ color: 'var(--color-text-disabled)', borderLeft: '2px solid var(--color-accent-cyan)', paddingLeft: '8px' }}>
                          <span style={{ display: 'inline-block', minWidth: '18ch', color: hasAnyPos ? 'var(--color-accent-cyan)' : 'transparent' }}>
                            {hasAnyPos ? posStr : ''}
                          </span>
                          {timeParts.length > 0 && <span>{timeParts.join(' · ')}</span>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </DetailCard>
      </div>

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
        <div className="text-[var(--color-text-disabled)]"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />로딩…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-[var(--color-text-disabled)]">거리별 데이터 부족</div>
      ) : (
        <div className="space-y-1.5">
          {(['short', 'middle', 'long'] as const).map((cat) => {
            const row = data.find((d) => d.dist_category === cat);
            if (!row) return (
              <div key={cat} className="flex justify-between text-[var(--color-text-disabled)]">
                <span>{DIST_LABEL[cat]}:</span><span>-</span>
              </div>
            );
            const style = classifyRunningStyle(row.avg_position_ratio, row.stddev_position_ratio);
            const info = STYLE_INFO[style];
            return (
              <div key={cat} className="flex justify-between items-center gap-2">
                <span className="text-[var(--color-text-secondary)] flex-shrink-0">{DIST_LABEL[cat]}:</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono-num text-[12px] text-[var(--color-text-secondary)]">{row.races}회</span>
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[12px] font-medium border ${info.className}`}>
                    <span>{info.emoji}</span>{info.shortName}
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

// DistanceStyleCard는 HorsePanel에서 필요 시 추가할 수 있음
void DistanceStyleCard;
