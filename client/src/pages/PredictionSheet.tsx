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
import { RaceInfoBlock } from '../components/RaceInfoBlock';
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
  useTrainingBatchByNames,
  useJockeyHorseComboBatch,
  useHorseGateStatsBatch,
  type JockeyHorseComboStat,
} from '../lib/queries';
import {
  supabase,
  type RaceEntry,
  type Race,
  type Prediction,
  type ItemScore,
  type JockeyStat,
  type TrainingLog,
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


function daysBetween(a: number, b: number): number {
  const toDate = (d: number) =>
    new Date(Math.floor(d / 10000), Math.floor((d % 10000) / 100) - 1, d % 100);
  return Math.round(Math.abs(toDate(a).getTime() - toDate(b).getTime()) / 86_400_000);
}

function formatTrTerm(trTerm: number): string {
  if (trTerm < 60) return `${trTerm}초`;
  const min = Math.floor(trTerm / 60);
  const sec = trTerm % 60;
  return sec > 0 ? `${min}분${sec}초` : `${min}분`;
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
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium border ${info.className}`}>
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
              <div className="text-sm font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
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

// ─── 베팅 조합 추천 ──────────────────────────────────────────────────

type BetHorse = { name: string; no: number | undefined };

function BetCell({
  label,
  accentColor,
  lines,
}: {
  label: string;
  accentColor: string;
  lines: string[];
}) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1"
      style={{ background: 'var(--color-bg-elevated)', border: `1px solid ${accentColor}25` }}
    >
      <span
        className="text-[11px] font-bold uppercase tracking-wide"
        style={{ color: accentColor }}
      >
        {label}
      </span>
      {lines.map((l, i) => (
        <span key={i} className="text-sm font-mono-num font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {l}
        </span>
      ))}
    </div>
  );
}

function ComboBetBox({
  top3,
  pthrNoByName,
}: {
  top3: Prediction[];
  pthrNoByName: Map<string, number>;
}) {
  if (top3.length < 2) return null;

  const h = top3.slice(0, 3).map<BetHorse>((p) => ({
    name: p.hr_name,
    no: pthrNoByName.get(p.hr_name),
  }));
  const [h1, h2, h3] = h as [BetHorse, BetHorse, BetHorse | undefined];

  const fmt = (horse: BetHorse) =>
    horse.no != null ? `${horse.no}번(${horse.name})` : horse.name;
  const no = (horse: BetHorse) => (horse.no != null ? `${horse.no}번` : horse.name);

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-bg-elevated)' }}
    >
      <div className="text-[13px] font-semibold mb-3" style={{ color: 'var(--color-text-disabled)' }}>
        베팅 조합 추천
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <BetCell
          label="단승"
          accentColor="#ffd700"
          lines={[fmt(h1)]}
        />
        <BetCell
          label="쌍승식"
          accentColor="#a8a8b3"
          lines={[`${no(h1)} → ${no(h2)}`]}
        />
        {h3 && (
          <BetCell
            label="복연승"
            accentColor="#cd7f32"
            lines={[
              `${no(h1)}-${no(h2)}`,
              `${no(h1)}-${no(h3)}`,
              `${no(h2)}-${no(h3)}`,
            ]}
          />
        )}
        {h3 && (
          <BetCell
            label="삼복승식"
            accentColor="var(--color-accent-cyan)"
            lines={[`${no(h1)}-${no(h2)}-${no(h3)}`]}
          />
        )}
      </div>
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
  latestTraining,
  gateStats,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  runningStyle: RunningStyle;
  accentColor: string;
  bloodline: BloodlineInfo | undefined;
  history: RaceEntry[];
  trainerStat: { total: number; wins: number } | undefined;
  latestTraining: TrainingLog | undefined;
  gateStats: Map<number, { total: number; wins: number }> | undefined;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const pScore = prediction?.total_score ?? 0;
  const timeStats = useMemo(() => computeTimeStats(history), [history]);

  // E-001: 출전 공백기
  const lastRaceDate = history[0]?.race_date ?? null;
  const racingGap = lastRaceDate != null ? daysBetween(horse.race_date, lastRaceDate) : null;

  // E-003: 현재 게이트 통산 성적
  const currentGateStat = gateStats?.get(horse.pthr_no) ?? null;

  const currentEquip = [
    horse.asis_equip1, horse.asis_equip2, horse.asis_equip3,
    horse.asis_equip4, horse.asis_equip5,
  ].filter((e): e is string => !!e);
  const prevEquip = history[0]
    ? [
        history[0].asis_equip1, history[0].asis_equip2, history[0].asis_equip3,
        history[0].asis_equip4, history[0].asis_equip5,
      ].filter((e): e is string => !!e)
    : null;
  const equipAdded = prevEquip != null ? currentEquip.filter((e) => !prevEquip.includes(e)) : [];
  const equipRemoved = prevEquip != null ? prevEquip.filter((e) => !currentEquip.includes(e)) : [];
  const hasEquipChange = equipAdded.length > 0 || equipRemoved.length > 0;

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
            className="text-[13px] font-bold px-1.5 py-0.5 rounded font-mono-num shrink-0"
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
          <span className="text-[13px] font-mono-num shrink-0" style={{ color: accentColor }}>
            {pScore.toFixed(1)}
          </span>
        </div>
      )}

      {/* 번호 + 마명 + 성향 */}
      <div className="flex items-baseline gap-1 flex-wrap">
        <span className="text-base font-bold font-mono-num" style={{ color: accentColor }}>
          {horse.pthr_no}번
        </span>
        <span className="text-base font-bold leading-tight">{horse.hr_name}</span>
        <StyleBadge style={runningStyle} />
      </div>

      {/* 나이 / 성별 / 산지 / 레이팅 */}
      <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
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
        <div className="text-[13px]" style={{ color: 'var(--color-text-disabled)' }}>
          {bloodline.dam_hr_nm ?? '?'}(모) - {bloodline.sire_hr_nm ?? '?'}(부)
        </div>
      )}

      {/* 조교사 (+ 최근 2년 승수) / 마주 */}
      {(horse.trar_nm || horse.owner_nm) && (
        <div className="text-[13px]" style={{ color: 'var(--color-text-disabled)' }}>
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
          className="font-mono-num text-sm flex items-center gap-1.5 flex-wrap"
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
          <span className="text-sm font-semibold">{horse.wg_hr}kg</span>
          {horse.wg_hr_diff != null && horse.wg_hr_diff !== 0 && (
            <span
              className="text-[13px]"
              style={{ color: horse.wg_hr_diff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}
            >
              ({horse.wg_hr_diff > 0 ? '+' : ''}{horse.wg_hr_diff})
            </span>
          )}
        </div>
      )}

      {/* 최고 기록 */}
      {timeStats && (
        <div className="text-[13px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
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
        <div className="text-[13px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
          평 {formatRcTime(timeStats.avgTime)} {timeStats.count}전
          {timeStats.formStr && (
            <span className="ml-1" style={{ color: 'var(--color-text-disabled)' }}>
              ({timeStats.formStr})
            </span>
          )}
        </div>
      )}

      {/* E-001: 출전 공백기 */}
      {racingGap != null && (
        <div
          className="text-[13px] font-mono-num"
          style={{ color: racingGap >= 30 ? 'var(--color-accent-gold)' : 'var(--color-text-disabled)' }}
        >
          공백 {racingGap}일{racingGap >= 30 ? ' [장기]' : ''}
        </div>
      )}

      {/* E-003: 현재 게이트 통산 성적 */}
      {currentGateStat != null && currentGateStat.total >= 3 && (
        <div className="text-[13px] font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
          {horse.pthr_no}번 게이트 {currentGateStat.total}전{' '}
          <span style={{ color: currentGateStat.wins > 0 ? 'var(--color-success)' : undefined }}>
            {currentGateStat.wins}승
            ({Math.round((currentGateStat.wins / currentGateStat.total) * 100)}%)
          </span>
        </div>
      )}

      {/* 최근 조교 */}
      {latestTraining && (
        <div className="text-[13px] font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
          조교 {formatDate(latestTraining.train_date)}
          {latestTraining.tr_term != null && latestTraining.tr_term > 0 && (
            <span className="ml-1" style={{ color: 'var(--color-text-secondary)' }}>
              {formatTrTerm(latestTraining.tr_term)}
            </span>
          )}
          {latestTraining.pr_gubun && (
            <span className="ml-1">{latestTraining.pr_gubun}</span>
          )}
          {latestTraining.chul_gubun && (
            <span className="ml-1">[{latestTraining.chul_gubun}]</span>
          )}
        </div>
      )}

      {/* 장구 */}
      {(currentEquip.length > 0 || equipRemoved.length > 0) && (
        <div className="text-[13px]">
          <span style={{ color: 'var(--color-text-disabled)' }}>장구 </span>
          {hasEquipChange && (
            <span
              className="text-[11px] font-bold mr-1 px-1 rounded"
              style={{
                background: 'rgba(255,215,0,0.12)',
                color: 'var(--color-accent-gold)',
                border: '1px solid rgba(255,215,0,0.3)',
              }}
            >
              변경
            </span>
          )}
          {currentEquip.map((e) => (
            <span
              key={e}
              className="mr-1"
              style={{ color: equipAdded.includes(e) ? 'var(--color-success)' : 'var(--color-text-secondary)' }}
            >
              {e}
            </span>
          ))}
          {equipRemoved.map((e) => (
            <span
              key={`rm-${e}`}
              className="mr-1 line-through"
              style={{ color: 'var(--color-danger)' }}
            >
              {e}
            </span>
          ))}
        </div>
      )}

      {/* 건강정보 */}
      {(horse.latst_bledg1 || horse.latst_bledg2 || horse.latst_trea1_txt || horse.latst_trea2_txt) && (
        <div className="text-[13px] flex flex-col gap-0.5" style={{ color: 'var(--color-accent-pink)' }}>
          {horse.latst_bledg1 && <span>폐출혈1: {horse.latst_bledg1}</span>}
          {horse.latst_bledg2 && <span>폐출혈2: {horse.latst_bledg2}</span>}
          {horse.latst_trea1_txt && <span>진료1: {horse.latst_trea1_txt}</span>}
          {horse.latst_trea2_txt && <span>진료2: {horse.latst_trea2_txt}</span>}
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
  jockeyHorseCombo,
}: {
  horse: RaceEntry;
  history: RaceEntry[];
  jockeyStat: JockeyStat | undefined;
  jockeyHorseCombo: JockeyHorseComboStat | undefined;
}) {
  const lastBurdWgt = history[0]?.burd_wgt ?? null;
  const burdDiff =
    horse.burd_wgt != null && lastBurdWgt != null ? horse.burd_wgt - lastBurdWgt : null;

  return (
    <div className="p-3 flex flex-col gap-2">
      {/* 기수명 */}
      <div>
        <div className="text-[13px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>기수</div>
        <div className="text-base font-semibold">{horse.jcky_nm ?? '-'}</div>
      </div>

      {/* 부담중량 + 전경주 대비 변화 */}
      <div>
        <div className="text-[13px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>부담중량</div>
        <div className="flex items-baseline gap-1 font-mono-num">
          <span className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {horse.burd_wgt != null ? `${horse.burd_wgt}kg` : '-'}
          </span>
          {burdDiff != null && burdDiff !== 0 && (
            <span
              className="text-sm"
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
          <div className="text-[13px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>통산 성적</div>
          <div className="text-sm font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
            {jockeyStat.race_cnt_t != null ? `${jockeyStat.race_cnt_t}전` : '-'}
            {jockeyStat.first_cnt != null && (
              <span> ({jockeyStat.first_cnt}승)</span>
            )}
          </div>
          {jockeyStat.win_rate_t != null && (
            <div className="text-sm font-mono-num" style={{ color: 'var(--color-accent-cyan)' }}>
              승률 {jockeyStat.win_rate_t}%
            </div>
          )}
        </div>
      )}

      {/* E-002: 기수-말 조합 이력 */}
      {jockeyHorseCombo != null && jockeyHorseCombo.total > 0 && (
        <div>
          <div className="text-[13px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>조합 이력</div>
          <div className="text-sm font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
            {jockeyHorseCombo.total}전{' '}
            <span style={{ color: jockeyHorseCombo.wins > 0 ? 'var(--color-success)' : undefined }}>
              {jockeyHorseCombo.wins}승
            </span>
            {' / '}
            <span style={{ color: 'var(--color-text-disabled)' }}>
              연{jockeyHorseCombo.places} 복{jockeyHorseCombo.shows}
            </span>
          </div>
        </div>
      )}

      {/* 사후: 실제 착순 + 인기순위 */}
      {horse.ord != null && (
        <div>
          <div className="text-[13px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>실제 착순</div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-mono-num font-bold" style={{ color: ordColor(horse.ord) }}>
              {horse.ord}위
            </span>
            {horse.popularity != null && (
              <span className="text-sm font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
                인기 {horse.popularity}위
              </span>
            )}
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
      <div className="text-[10px] mb-1.5 font-semibold" style={{ color: 'var(--color-text-disabled)' }}>
        직전 경주
      </div>
      {history.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>이력 없음</p>
      ) : (
        <div className="space-y-1">
          <div className="grid text-[10px]" style={{ gridTemplateColumns: '3rem 5rem 2.5rem 3.5rem 2.5rem 2.5rem', color: 'var(--color-text-disabled)' }}>
            <span>날짜</span><span>경마장·거리</span><span className="text-center">착순</span>
            <span>기록</span><span>부담</span><span>주로</span>
          </div>
          {history.map((h, i) => (
            <div key={i} className="grid font-mono-num text-[11px]"
              style={{ gridTemplateColumns: '3rem 5rem 2.5rem 3.5rem 2.5rem 2.5rem' }}>
              <span style={{ color: 'var(--color-text-disabled)' }}>{formatDate(h.race_date)}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {MEET_NAMES[h.meet] ?? '?'} {h.rc_dist ?? '-'}m
              </span>
              <span className="text-center font-semibold" style={{ color: ordColor(h.ord) }}>
                {h.ord != null ? `${h.ord}위` : '-'}
              </span>
              <span style={{ color: 'var(--color-text-primary)' }}>{formatRcTime(h.rc_time)}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{h.burd_wgt ?? '-'}</span>
              <span style={{ color: 'var(--color-text-disabled)' }}>{h.track_type ?? '-'}</span>
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
        <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-disabled)' }}>
          5항목 점수
        </span>
        <div className="flex items-center rounded overflow-hidden text-[10px] font-medium"
          style={{ border: '1px solid var(--color-bg-elevated)' }}>
          <button
            onClick={() => onViewModeChange('bar')}
            className="flex items-center gap-0.5 px-2 py-1 transition-all"
            style={{
              background: viewMode === 'bar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'bar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}>
            <LayoutList className="w-2.5 h-2.5" />바
          </button>
          <button
            onClick={() => onViewModeChange('radar')}
            className="flex items-center gap-0.5 px-2 py-1 transition-all"
            style={{
              background: viewMode === 'radar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'radar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}>
            <Activity className="w-2.5 h-2.5" />레이더
          </button>
        </div>
      </div>

      {!hasScores && (
        <p className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>예측 없음</p>
      )}

      {hasScores && viewMode === 'bar' && (
        <div className="space-y-1.5">
          {TOP5_ITEMS.map(({ id, label }) => {
            const score = itemScores![id]?.rawScore ?? 0;
            const pending = itemScores![id]?.status === 'expert_pending';
            return (
              <div key={id} className="flex items-center gap-1.5">
                <span className="text-[11px] shrink-0 w-14 text-right"
                  style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--color-bg-elevated)' }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${score * 100}%`, background: pending ? 'var(--color-text-disabled)' : accentColor }} />
                </div>
                <span className="text-[10px] font-mono-num w-6 shrink-0"
                  style={{ color: pending ? 'var(--color-text-disabled)' : 'var(--color-text-primary)' }}>
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
                datasets: [{
                  data: TOP5_ITEMS.map(({ id }) => Math.round((itemScores![id]?.rawScore ?? 0) * 100)),
                  borderColor: accentColor,
                  backgroundColor: `${accentColor}20`,
                  borderWidth: 1.5,
                  pointBackgroundColor: accentColor,
                  pointRadius: 2,
                }],
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
  latestTraining,
  jockeyHorseCombo,
  gateStats,
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
      {/* 모바일: 2+2 그리드 / 데스크탑: 4열 그리드 */}
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
            latestTraining={latestTraining}
            gateStats={gateStats}
          />
        </div>
        <div className="border-b border-[var(--color-bg-elevated)] md:border-b-0 md:border-r">
          <ColJockeyInfo horse={horse} history={history} jockeyStat={jockeyStat} jockeyHorseCombo={jockeyHorseCombo} />
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

  // 조교 기록 (최근 30일, 말 이름 기준 배치 조회)
  const { data: trainingMap } = useTrainingBatchByNames(hrNames, meet, 30);

  // E-002: 기수-말 조합 이력
  const jockeyHorseCombos = useMemo(
    () =>
      (horses ?? [])
        .filter((h) => h.jcky_nm)
        .map((h) => ({ hrName: h.hr_name, jckyNm: h.jcky_nm! })),
    [horses]
  );
  const { data: jockeyHorseComboMap } = useJockeyHorseComboBatch(jockeyHorseCombos);

  // E-003: 게이트별 통산 성적
  const { data: gateStatsMap } = useHorseGateStatsBatch(hrNames);

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
      {/* 내비게이션 */}
      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        <Link
          to={`/race/${meet}/${rcDate}/${rcNo}/entries`}
          className="inline-flex items-center gap-1 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          출마정보
        </Link>
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
      </div>

      {/* 경주 정보 카드 */}
      <RaceInfoBlock
        rcDate={rcDate}
        meet={meet}
        rcNo={rcNo}
        race={race}
        horses={horses}
        gradeStats={gradeStats}
      />

      {/* Top 3 포디엄 */}
      {top3.length > 0 && <PodiumCards top3={top3} pthrNoByName={pthrNoByName} />}

      {/* F-002: 베팅 조합 추천 */}
      {top3.length >= 2 && <ComboBetBox top3={top3} pthrNoByName={pthrNoByName} />}

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
              latestTraining={trainingMap?.get(horse.hr_name)?.[0]}
              jockeyHorseCombo={jockeyHorseComboMap?.get(`${horse.hr_name}:${horse.jcky_nm ?? ''}`)}
              gateStats={gateStatsMap?.get(horse.hr_name)}
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
