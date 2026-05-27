/**
 * 예상지 화면 (PredictionSheet)
 *
 * 레거시 출마표 형식 + AI 오버레이.
 *   - Top 3 포디엄 카드 (상단 고정)
 *   - 말 카드: 4열 그리드 — 마정보 | 기수정보 | 직전경주 | 5항목점수
 *
 * Route: /race/:meet/:date/:rcNo/sheet
 */

import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronLeft, Loader2, LayoutList, Activity } from 'lucide-react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import {
  useHorsesByRace,
  usePredictionsByRace,
  useHorseSectionalAbilityByNames,
  useTrainerStatsBatch,
  useJockeyStatsBatch,
  useGradeWinnerStats,
} from '../lib/queries';
import {
  supabase,
  type RaceEntry,
  type Race,
  type Prediction,
  type ItemScore,
  type JockeyStat,
} from '../lib/supabase';
import { classifyRunningStyle, STYLE_INFO, type RunningStyle } from '../lib/runningStyle';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip);

// ─── 상수 ────────────────────────────────────────────────────────────

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경' };

const TOP5_ITEMS: { id: string; label: string }[] = [
  { id: '01_rating',           label: '레이팅'  },
  { id: '09_jockey_form',      label: '기수폼'  },
  { id: '06_distance_fitness', label: '거리적성' },
  { id: '03_recent_form',      label: '착순추세' },
  { id: '17_market_odds',      label: '배당률'  },
];

const PODIUM_STYLES = [
  { border: 'border-[#ffd700]', glow: '0 0 24px rgba(255,215,0,0.25)', accent: '#ffd700', label: '1위', labelColor: 'text-[#ffd700]' },
  { border: 'border-[#a8a8b3]', glow: '0 0 16px rgba(168,168,179,0.15)', accent: '#a8a8b3', label: '2위', labelColor: 'text-[#a8a8b3]' },
  { border: 'border-[#cd7f32]', glow: '0 0 16px rgba(205,127,50,0.15)', accent: '#cd7f32', label: '3위', labelColor: 'text-[#cd7f32]' },
];

type ViewMode = 'bar' | 'radar';

type BloodlineInfo = { sire_hr_nm: string | null; dam_hr_nm: string | null };

// ─── 데이터 훅 ───────────────────────────────────────────────────────

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

function useHorseBloodlinesByNames(hrNames: string[]) {
  return useQuery({
    queryKey: ['horse-bloodlines', hrNames.slice().sort().join(',')],
    queryFn: async (): Promise<{ hr_name: string; sire_hr_nm: string | null; dam_hr_nm: string | null }[]> => {
      if (hrNames.length === 0) return [];
      const { data, error } = await supabase
        .from('horses')
        .select('hr_name, sire_hr_nm, dam_hr_nm')
        .in('hr_name', hrNames);
      if (error) throw error;
      return (data ?? []) as { hr_name: string; sire_hr_nm: string | null; dam_hr_nm: string | null }[];
    },
    enabled: hrNames.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

// ─── 유틸 ────────────────────────────────────────────────────────────

function formatErng(v: number | null): string {
  if (v == null || v === 0) return '-';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${Math.round(v / 10_000)}만`;
  return String(v);
}

function formatRcTime(t: number | null): string {
  if (t == null || t === 0) return '-';
  const min = Math.floor(t / 60);
  const sec = (t % 60).toFixed(1);
  return min > 0 ? `${min}:${sec.padStart(4, '0')}` : sec;
}

function formatDate(d: number): string {
  const m = Math.floor((d % 10000) / 100);
  const day = d % 100;
  return `${m}/${String(day).padStart(2, '0')}`;
}

function ordColor(ord: number | null): string {
  if (ord === 1) return 'var(--color-accent-gold)';
  if (ord != null && ord <= 3) return 'var(--color-success)';
  if (ord != null && ord <= 7) return 'var(--color-text-primary)';
  return 'var(--color-text-disabled)';
}

interface TimeStats {
  bestTime: number;
  bestDate: number;
  bestBurdWgt: number | null;
  bestPthrNo: number;
  avgTime: number;
  count: number;
  formStr: string; // "1-2-5-3-1" 구→신
}

function computeTimeStats(history: RaceEntry[]): TimeStats | null {
  const valid = history.filter((h) => h.rc_time != null && h.rc_time > 0);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.rc_time! - b.rc_time!);
  const best = sorted[0]!;
  const avg = valid.reduce((s, h) => s + h.rc_time!, 0) / valid.length;
  const form = history
    .slice(0, 5)
    .reverse()
    .map((h) => (h.ord != null ? String(h.ord) : 'X'))
    .join('-');
  return {
    bestTime: best.rc_time!,
    bestDate: best.race_date,
    bestBurdWgt: best.burd_wgt,
    bestPthrNo: best.pthr_no,
    avgTime: avg,
    count: valid.length,
    formStr: form,
  };
}

// ─── 공통 서브 컴포넌트 ──────────────────────────────────────────────

function ScoreBar({ score, maxScore, color }: { score: number; maxScore: number; color?: string }) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  return (
    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-elevated)' }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color ?? 'var(--color-accent-cyan)' }}
      />
    </div>
  );
}

function StyleBadge({ style }: { style: RunningStyle }) {
  if (style === 'unknown') return null;
  const info = STYLE_INFO[style];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${info.className}`}>
      {info.shortName}
    </span>
  );
}

// ─── Top3 포디엄 (상단 고정) ─────────────────────────────────────────

function PodiumCards({
  top3,
  pthrNoByName,
}: {
  top3: Prediction[];
  pthrNoByName: Map<string, number>;
}) {
  if (top3.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      {top3.map((p, i) => {
        const s = PODIUM_STYLES[i]!;
        const pthrNo = pthrNoByName.get(p.hr_name);
        return (
          <div
            key={p.hr_name}
            className={`rounded-xl border ${s.border} p-4 flex flex-col gap-2`}
            style={{ boxShadow: s.glow, background: 'var(--color-bg-surface)' }}
          >
            <div className={`text-xs font-semibold font-mono-num ${s.labelColor}`}>{s.label}</div>
            <div>
              <div className="text-[12px] font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
                {pthrNo != null ? `${pthrNo}번` : '-'}
              </div>
              <div className="text-base font-bold leading-tight truncate">{p.hr_name}</div>
            </div>
            <div className="space-y-1">
              <ScoreBar score={p.total_score} maxScore={100} color={s.accent} />
              <div className="text-right text-xs font-mono-num font-semibold" style={{ color: s.accent }}>
                {p.total_score.toFixed(1)}점
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 열 1: 마정보 (레거시 출마표 형식) ──────────────────────────────

function ColHorseInfo({
  horse,
  prediction,
  runningStyle,
  accentColor,
  bloodline,
  history,
  trainerStat,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  runningStyle: RunningStyle;
  accentColor: string;
  bloodline: BloodlineInfo | undefined;
  history: RaceEntry[];
  trainerStat: { total: number; wins: number } | undefined;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const pScore = prediction?.total_score ?? 0;
  const timeStats = useMemo(() => computeTimeStats(history), [history]);

  const total = horse.sump_rcod_sum ?? 0;
  const fplc = horse.sump_rcod_fplc ?? 0;
  const splc = horse.sump_rcod_splc ?? 0;
  const tplc = horse.sump_rcod_tplc ?? 0;
  const rest = Math.max(total - fplc - splc - tplc, 0);
  const careerStr = total > 0 ? `${total}전 (${fplc}-${splc}-${tplc}-${rest})` : null;

  const trainerWinRate =
    trainerStat && trainerStat.total > 0
      ? ((trainerStat.wins / trainerStat.total) * 100).toFixed(1)
      : null;

  return (
    <div className="p-3 flex flex-col gap-1 min-w-0">
      {/* AI 배지 */}
      {pRank < 999 && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className="text-[11px] font-bold px-1.5 py-0.5 rounded font-mono-num shrink-0"
            style={{
              background: `${accentColor}20`,
              color: accentColor,
              border: `1px solid ${accentColor}40`,
            }}
          >
            AI {pRank}위
          </span>
          <div className="flex-1 min-w-0">
            <ScoreBar score={pScore} maxScore={100} color={accentColor} />
          </div>
          <span className="text-[11px] font-mono-num shrink-0" style={{ color: accentColor }}>
            {pScore.toFixed(1)}
          </span>
        </div>
      )}

      {/* 번호 + 마명 + 성향 */}
      <div className="flex items-baseline gap-1 flex-wrap">
        <span className="text-sm font-bold font-mono-num" style={{ color: accentColor }}>
          {horse.pthr_no}번
        </span>
        <span className="text-sm font-bold leading-tight">{horse.hr_name}</span>
        <StyleBadge style={runningStyle} />
      </div>

      {/* 나이 / 성별 / 산지 / 레이팅 */}
      <div className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
        {horse.ag ?? '?'}세 {horse.gndr ?? ''}
        {horse.prds ? ` · ${horse.prds}` : ''}
        {horse.ratg && horse.ratg > 0 ? (
          <span className="ml-1.5 font-mono-num font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            R{horse.ratg}
          </span>
        ) : null}
      </div>

      {/* 혈통: 모마 - 부마 */}
      {(bloodline?.dam_hr_nm || bloodline?.sire_hr_nm) && (
        <div className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>
          {bloodline.dam_hr_nm ?? '?'}(모) - {bloodline.sire_hr_nm ?? '?'}(부)
        </div>
      )}

      {/* 조교사 (+ 최근 2년 승수) / 마주 */}
      {(horse.trar_nm || horse.owner_nm) && (
        <div className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>
          {horse.trar_nm && (
            <span>
              조교 {horse.trar_nm}
              {trainerWinRate != null && (
                <span className="ml-1 font-mono-num">
                  ({trainerStat!.wins}승/{trainerStat!.total}전 {trainerWinRate}%)
                </span>
              )}
            </span>
          )}
          {horse.trar_nm && horse.owner_nm && <span className="mx-1">/</span>}
          {horse.owner_nm && <span>마주 {horse.owner_nm}</span>}
        </div>
      )}

      {/* 통산 성적 (N전 W-P-S-R) + 수득상금 */}
      {(careerStr || (horse.erng_sump != null && horse.erng_sump > 0)) && (
        <div
          className="font-mono-num text-[12px] flex items-center gap-1.5 flex-wrap"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {careerStr && <span>{careerStr}</span>}
          {horse.erng_sump != null && horse.erng_sump > 0 && (
            <span style={{ color: 'var(--color-text-disabled)' }}>{formatErng(horse.erng_sump)}</span>
          )}
        </div>
      )}

      {/* 마체중 */}
      {horse.wg_hr != null && (
        <div className="flex items-baseline gap-1 font-mono-num">
          <span className="text-[12px] font-semibold">{horse.wg_hr}kg</span>
          {horse.wg_hr_diff != null && horse.wg_hr_diff !== 0 && (
            <span
              className="text-[11px]"
              style={{ color: horse.wg_hr_diff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}
            >
              ({horse.wg_hr_diff > 0 ? '+' : ''}{horse.wg_hr_diff})
            </span>
          )}
        </div>
      )}

      {/* 최고 기록 */}
      {timeStats && (
        <div className="text-[11px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
          최 {formatRcTime(timeStats.bestTime)}
          <span style={{ color: 'var(--color-text-disabled)' }}>
            {' '}({formatDate(timeStats.bestDate)},{' '}
            {timeStats.bestBurdWgt != null ? `${timeStats.bestBurdWgt}kg` : '-'},{' '}
            {timeStats.bestPthrNo}번)
          </span>
        </div>
      )}

      {/* 평균 기록 + 형태 (구→신, 대시 구분) */}
      {timeStats && (
        <div className="text-[11px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
          평 {formatRcTime(timeStats.avgTime)} {timeStats.count}전
          {timeStats.formStr && (
            <span className="ml-1" style={{ color: 'var(--color-text-disabled)' }}>
              ({timeStats.formStr})
            </span>
          )}
        </div>
      )}

      {/* 건강정보 */}
      {horse.latst_trea1_txt && (
        <div className="text-[11px]" style={{ color: 'var(--color-accent-pink)' }}>
          부상이력: {horse.latst_trea1_txt}
        </div>
      )}
    </div>
  );
}

// ─── 열 2: 기수정보 ──────────────────────────────────────────────────

function ColJockeyInfo({
  horse,
  history,
  jockeyStat,
}: {
  horse: RaceEntry;
  history: RaceEntry[];
  jockeyStat: JockeyStat | undefined;
}) {
  const lastBurdWgt = history[0]?.burd_wgt ?? null;
  const burdDiff =
    horse.burd_wgt != null && lastBurdWgt != null ? horse.burd_wgt - lastBurdWgt : null;

  return (
    <div className="p-3 flex flex-col gap-2">
      {/* 기수명 */}
      <div>
        <div className="text-[11px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>기수</div>
        <div className="text-sm font-semibold">{horse.jcky_nm ?? '-'}</div>
      </div>

      {/* 부담중량 + 전경주 대비 변화 */}
      <div>
        <div className="text-[11px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>부담중량</div>
        <div className="flex items-baseline gap-1 font-mono-num">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
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
        </div>
      </div>

      {/* 기수 통산 성적 (jockey_stats 커버 시) */}
      {jockeyStat && (
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>통산 성적</div>
          <div className="text-[12px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
            {jockeyStat.race_cnt_t != null ? `${jockeyStat.race_cnt_t}전` : '-'}
            {jockeyStat.first_cnt != null && (
              <span> ({jockeyStat.first_cnt}승)</span>
            )}
          </div>
          {jockeyStat.win_rate_t != null && (
            <div className="text-[12px] font-mono-num" style={{ color: 'var(--color-accent-cyan)' }}>
              승률 {jockeyStat.win_rate_t}%
            </div>
          )}
        </div>
      )}

      {/* 사후: 실제 착순 */}
      {horse.ord != null && (
        <div>
          <div className="text-[11px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>실제 착순</div>
          <div className="text-sm font-mono-num font-bold" style={{ color: ordColor(horse.ord) }}>
            {horse.ord}위
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 열 3: 직전 경주 ─────────────────────────────────────────────────

function ColHistory({ history }: { history: RaceEntry[] }) {
  return (
    <div className="p-3">
      <div className="text-[11px] mb-1.5 font-semibold" style={{ color: 'var(--color-text-disabled)' }}>
        직전 경주
      </div>
      {history.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--color-text-disabled)' }}>이력 없음</p>
      ) : (
        <div className="space-y-1.5">
          {history.map((h, i) => (
            <div
              key={i}
              className="pb-1.5 border-b border-[var(--color-bg-elevated)] last:border-0 last:pb-0"
            >
              {/* 상단: 날짜·경마장거리·착순·기록 */}
              <div className="flex items-center gap-1.5 font-mono-num text-[12px] flex-wrap">
                <span className="shrink-0" style={{ color: 'var(--color-text-disabled)' }}>
                  {formatDate(h.race_date)}
                </span>
                <span className="shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                  {MEET_NAMES[h.meet] ?? '?'}{h.rc_dist ? ` ${h.rc_dist}m` : ''}
                </span>
                <span className="font-semibold shrink-0" style={{ color: ordColor(h.ord) }}>
                  {h.ord != null ? `${h.ord}위` : '-'}
                </span>
                <span style={{ color: 'var(--color-text-primary)' }}>
                  {formatRcTime(h.rc_time)}
                </span>
              </div>
              {/* 하단: 출발번호·기수명(기수무게)·부담중량 */}
              <div
                className="flex items-center gap-2 text-[11px] mt-0.5 flex-wrap"
                style={{ color: 'var(--color-text-disabled)' }}
              >
                <span>{h.pthr_no}번</span>
                {h.jcky_nm && (
                  <span>
                    {h.jcky_nm}
                    {h.wg_jk != null ? `(${h.wg_jk})` : ''}
                  </span>
                )}
                {h.burd_wgt != null && <span>{h.burd_wgt}kg</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 열 4: 5항목 점수 ────────────────────────────────────────────────

function Col5Items({
  itemScores,
  accentColor,
  viewMode,
  onViewModeChange,
}: {
  itemScores: Record<string, ItemScore> | undefined;
  accentColor: string;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}) {
  const hasScores = itemScores && Object.keys(itemScores).length > 0;

  return (
    <div className="p-3 flex flex-col gap-2">
      {/* A/B 토글 */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-disabled)' }}>
          5항목 점수
        </span>
        <div
          className="flex items-center rounded overflow-hidden text-[10px] font-medium"
          style={{ border: '1px solid var(--color-bg-elevated)' }}
        >
          <button
            onClick={() => onViewModeChange('bar')}
            className="flex items-center gap-0.5 px-2 py-1 transition-all"
            style={{
              background: viewMode === 'bar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'bar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}
          >
            <LayoutList className="w-2.5 h-2.5" />바
          </button>
          <button
            onClick={() => onViewModeChange('radar')}
            className="flex items-center gap-0.5 px-2 py-1 transition-all"
            style={{
              background: viewMode === 'radar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'radar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}
          >
            <Activity className="w-2.5 h-2.5" />레이더
          </button>
        </div>
      </div>

      {!hasScores && (
        <p className="text-[12px]" style={{ color: 'var(--color-text-disabled)' }}>예측 없음</p>
      )}

      {hasScores && viewMode === 'bar' && (
        <div className="space-y-1.5">
          {TOP5_ITEMS.map(({ id, label }) => {
            const score = itemScores![id]?.rawScore ?? 0;
            const pending = itemScores![id]?.status === 'expert_pending';
            return (
              <div key={id} className="flex items-center gap-1.5">
                <span
                  className="text-[12px] shrink-0 w-14 text-right"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {label}
                </span>
                <div
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--color-bg-elevated)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${score * 100}%`,
                      background: pending ? 'var(--color-text-disabled)' : accentColor,
                    }}
                  />
                </div>
                <span
                  className="text-[11px] font-mono-num w-6 shrink-0"
                  style={{ color: pending ? 'var(--color-text-disabled)' : 'var(--color-text-primary)' }}
                >
                  {score.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {hasScores && viewMode === 'radar' && (
        <div className="flex justify-center">
          <div style={{ width: 160, height: 160 }}>
            <Radar
              data={{
                labels: TOP5_ITEMS.map((i) => i.label),
                datasets: [
                  {
                    data: TOP5_ITEMS.map(({ id }) =>
                      Math.round((itemScores![id]?.rawScore ?? 0) * 100)
                    ),
                    borderColor: accentColor,
                    backgroundColor: `${accentColor}20`,
                    borderWidth: 1.5,
                    pointBackgroundColor: accentColor,
                    pointRadius: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                  r: {
                    min: 0, max: 100,
                    ticks: { display: false },
                    grid: { color: 'rgba(94,107,138,0.25)' },
                    angleLines: { color: 'rgba(94,107,138,0.2)' },
                    pointLabels: { color: 'rgba(176,190,197,0.85)', font: { size: 9 } },
                  },
                },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: 'rgba(19,27,58,0.95)',
                    borderColor: 'rgba(94,107,138,0.4)', borderWidth: 1,
                    titleColor: '#b0bec5', bodyColor: '#ffffff',
                  },
                },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 말 카드 ─────────────────────────────────────────────────────────

function HorseCard({
  horse,
  prediction,
  history,
  runningStyle,
  bloodline,
  trainerStat,
  jockeyStat,
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
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const pStyle = PODIUM_STYLES[pRank - 1];
  const accentColor = pStyle?.accent ?? 'var(--color-text-disabled)';
  const borderColor = pRank <= 3 ? `${accentColor}50` : 'var(--color-bg-elevated)';

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-surface)', border: `1px solid ${borderColor}` }}
    >
      <div className="grid grid-cols-2 md:[grid-template-columns:2fr_1.2fr_3fr_2fr]">
        <div className="border-b border-r border-[var(--color-bg-elevated)] md:border-b-0">
          <ColHorseInfo
            horse={horse}
            prediction={prediction}
            runningStyle={runningStyle}
            accentColor={accentColor}
            bloodline={bloodline}
            history={history}
            trainerStat={trainerStat}
          />
        </div>
        <div className="border-b border-[var(--color-bg-elevated)] md:border-b-0 md:border-r">
          <ColJockeyInfo horse={horse} history={history} jockeyStat={jockeyStat} />
        </div>
        <div className="col-span-2 md:col-span-1 border-b border-[var(--color-bg-elevated)] md:border-b-0 md:border-r">
          <ColHistory history={history} />
        </div>
        <div className="col-span-2 md:col-span-1">
          <Col5Items
            itemScores={prediction?.item_scores}
            accentColor={accentColor}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
          />
        </div>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────

export function PredictionSheet() {
  const { meet: meetStr, date: dateStr, rcNo: rcNoStr } = useParams();
  const meet = Number(meetStr);
  const rcDate = Number(dateStr);
  const rcNo = Number(rcNoStr);

  const [viewMode, setViewMode] = useState<ViewMode>('bar');

  const { data: race } = useRaceMeta(rcDate, meet, rcNo);
  const { data: horses, isLoading, error } = useHorsesByRace(rcDate, meet, rcNo);
  const { data: predictions } = usePredictionsByRace(rcDate, meet, rcNo);

  const hrNames = useMemo(() => (horses ?? []).map((h) => h.hr_name), [horses]);
  const historyQueries = useMultipleHorseHistories(hrNames, rcDate);
  const { data: abilities } = useHorseSectionalAbilityByNames(hrNames);
  const { data: bloodlines } = useHorseBloodlinesByNames(hrNames);

  // 조교사 승수 (최근 2년 집계)
  const trainerNames = useMemo(
    () => [...new Set((horses ?? []).map((h) => h.trar_nm).filter(Boolean) as string[])],
    [horses]
  );
  const { data: trainerStatsMap } = useTrainerStatsBatch(trainerNames);

  // 기수 통산 성적 (jockey_stats 배치)
  const jckyNos = useMemo(
    () => [...new Set((horses ?? []).map((h) => h.jcky_no).filter(Boolean) as string[])],
    [horses]
  );
  const { data: jockeyStatsMap } = useJockeyStatsBatch(jckyNos, meet);

  // 해당 등급/거리 우승마 평균기록
  const { data: gradeStats } = useGradeWinnerStats(race?.prize_cond ?? null, race?.rc_dist ?? null);

  const predByName = useMemo(() => {
    const map = new Map<string, Prediction>();
    (predictions ?? []).forEach((p) => map.set(p.hr_name, p));
    return map;
  }, [predictions]);

  const styleByName = useMemo(() => {
    const map = new Map<string, RunningStyle>();
    (abilities ?? []).forEach((a) => {
      map.set(a.hr_name, classifyRunningStyle(a.avg_position_ratio, a.stddev_position_ratio));
    });
    return map;
  }, [abilities]);

  const historyByName = useMemo(() => {
    const map = new Map<string, RaceEntry[]>();
    hrNames.forEach((name, idx) => {
      map.set(name, historyQueries[idx]?.data ?? []);
    });
    return map;
  }, [hrNames, historyQueries]);

  const bloodlineByName = useMemo(() => {
    const map = new Map<string, BloodlineInfo>();
    (bloodlines ?? []).forEach((b) =>
      map.set(b.hr_name, { sire_hr_nm: b.sire_hr_nm, dam_hr_nm: b.dam_hr_nm })
    );
    return map;
  }, [bloodlines]);

  const pthrNoByName = useMemo(() => {
    const map = new Map<string, number>();
    (horses ?? []).forEach((h) => map.set(h.hr_name, h.pthr_no));
    return map;
  }, [horses]);

  const sortedHorses = useMemo(() => {
    if (!horses) return [];
    return [...horses].sort((a, b) => a.pthr_no - b.pthr_no);
  }, [horses]);

  const top3 = useMemo(
    () => [...(predictions ?? [])].sort((a, b) => a.predicted_rank - b.predicted_rank).slice(0, 3),
    [predictions]
  );

  const isPostRace = (horses ?? []).some((h) => h.ord != null);

  return (
    <div className="space-y-4 pb-8">
      {/* 경주 헤더 */}
      <div
        className="flex items-start gap-2 text-sm flex-wrap"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <Link
          to={`/race/${meet}/${rcDate}/${rcNo}/entries`}
          className="inline-flex items-center gap-1 hover:text-white transition-colors shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
          출마정보
        </Link>
        <span style={{ color: 'var(--color-text-disabled)' }}>|</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {MEET_NAMES[meet] ?? '?'} {rcNo}R
          </span>
          {race?.rc_dist != null && (
            <span className="font-mono-num" style={{ color: 'var(--color-text-primary)' }}>
              {race.rc_dist}m
            </span>
          )}
          {race?.rc_name && <span>{race.rc_name}</span>}
          {race?.age_cond && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
            >
              {race.age_cond}
            </span>
          )}
          {race?.prize_cond && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
            >
              {race.prize_cond}
            </span>
          )}
          {/* 해당등급 우승마 평균/최고기록 */}
          {gradeStats && (
            <span className="text-xs font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
              등급평균 {formatRcTime(gradeStats.avg)} / 최고 {formatRcTime(gradeStats.best)}
              <span className="ml-1">({gradeStats.count}경주)</span>
            </span>
          )}
          {race?.track && <span className="text-xs">{race.track}</span>}
          {race?.weather && <span className="text-xs">{race.weather}</span>}
          {race?.chaksun1 != null && race.chaksun1 > 0 && (
            <span className="text-xs font-mono-num" style={{ color: 'var(--color-accent-gold)' }}>
              1위 {formatErng(race.chaksun1)}
            </span>
          )}
          {isPostRace && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(0,200,83,0.12)',
                color: 'var(--color-success)',
                border: '1px solid rgba(0,200,83,0.25)',
              }}
            >
              사후
            </span>
          )}
          {horses && (
            <span className="text-xs font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
              {horses.length}마 출전
            </span>
          )}
        </div>
      </div>

      {/* Top 3 포디엄 */}
      {top3.length > 0 && <PodiumCards top3={top3} pthrNoByName={pthrNoByName} />}

      {/* 로딩 / 에러 */}
      {isLoading && (
        <div
          className="flex items-center justify-center py-16 gap-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          불러오는 중...
        </div>
      )}
      {error && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            background: 'rgba(255,23,68,0.08)',
            border: '1px solid rgba(255,23,68,0.25)',
            color: '#ff6b8a',
          }}
        >
          {(error as Error).message}
        </div>
      )}

      {/* 말 카드 목록 */}
      {!isLoading && sortedHorses.length > 0 && (
        <div className="space-y-3">
          {sortedHorses.map((horse) => (
            <HorseCard
              key={horse.pthr_no}
              horse={horse}
              prediction={predByName.get(horse.hr_name)}
              history={historyByName.get(horse.hr_name) ?? []}
              runningStyle={styleByName.get(horse.hr_name) ?? 'unknown'}
              bloodline={bloodlineByName.get(horse.hr_name)}
              trainerStat={trainerStatsMap?.get(horse.trar_nm ?? '')}
              jockeyStat={jockeyStatsMap?.get(horse.jcky_no ?? '')}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          ))}
        </div>
      )}

      {!isLoading && sortedHorses.length === 0 && !error && (
        <div
          className="rounded-xl p-8 text-center text-sm"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}
        >
          출전마 데이터 없음
        </div>
      )}
    </div>
  );
}
