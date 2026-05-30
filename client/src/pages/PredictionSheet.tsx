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
import { useParams, useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronLeft, LayoutList, Activity } from 'lucide-react';
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
  useHistoryRacesPrizeCond,
  useHorseGradeDistStatsBatch,
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
  type GradeDistStat,
} from '../lib/supabase';
import { classifyRunningStyle, STYLE_INFO, type RunningStyle } from '../lib/runningStyle';
import { getSectionalInfo, fmtSec, computeSameDistStats } from '../lib/sectional';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip);

// ─── 상수 ────────────────────────────────────────────────────────────

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경' };


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

function useMultipleHorseHistories(hrNames: string[], beforeDate: number, limit = 10) {
  return useQueries({
    queries: hrNames.map((hrName) => ({
      queryKey: ['horse-history', hrName, beforeDate, limit],
      queryFn: async (): Promise<RaceEntry[]> => {
        const { data, error } = await supabase
          .from('race_entries').select('*')
          .eq('hr_name', hrName).lt('race_date', beforeDate)
          .not('ord', 'is', null)
          .order('race_date', { ascending: false }).limit(limit);
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

function HorseCardSkeleton() {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-bg-elevated)' }}
    >
      {/* 데스크탑 (md+): 4열 grid — 실제 HorseCard 비율과 동일 */}
      <div className="hidden md:grid" style={{ gridTemplateColumns: '2fr 1.2fr 3fr 2fr' }}>
        {/* Col 1: 마정보 */}
        <div className="p-3 border-r border-[var(--color-bg-elevated)] flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/[.07] animate-pulse flex-shrink-0" />
            <div className="flex flex-col gap-1 flex-1">
              <div className="h-2.5 bg-white/[.07] animate-pulse rounded w-[70%]" />
              <div className="h-2 bg-white/[.07] animate-pulse rounded w-[50%]" />
            </div>
          </div>
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[80%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[55%]" />
        </div>
        {/* Col 2: 기수 정보 */}
        <div className="p-3 border-r border-[var(--color-bg-elevated)] flex flex-col gap-2">
          <div className="h-4 bg-white/[.07] animate-pulse rounded-full w-11" />
          <div className="h-2.5 bg-white/[.07] animate-pulse rounded w-[85%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[65%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[72%]" />
        </div>
        {/* Col 3: 직전경주 / 점수 */}
        <div className="p-3 border-r border-[var(--color-bg-elevated)] flex flex-col gap-2">
          <div className="h-11 bg-white/[.07] animate-pulse rounded" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[90%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[70%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[80%]" />
        </div>
        {/* Col 4: 베팅 조합 */}
        <div className="p-3 flex flex-col gap-2">
          <div className="h-3 bg-white/[.07] animate-pulse rounded w-[75%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-full" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[85%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[60%]" />
        </div>
      </div>
      {/* 모바일 (<md): 막대형 */}
      <div className="md:hidden p-3 flex flex-col gap-2">
        <div className="h-3 bg-white/[.07] animate-pulse rounded w-[60%]" />
        <div className="h-2.5 bg-white/[.07] animate-pulse rounded w-full" />
        <div className="h-2 bg-white/[.07] animate-pulse rounded w-[80%]" />
      </div>
    </div>
  );
}

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

export function computeTimeStats(history: RaceEntry[]): TimeStats | null {
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

export function StyleBadge({ style }: { style: RunningStyle }) {
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
  runningStyle: _runningStyle,
  accentColor: _accentColor,
  bloodline,
  history,
  trainerStat,
  gateStats,
  rcDist,
  gradeDistStat,
  racePrizeCond,
}: {
  horse: RaceEntry;
  runningStyle: RunningStyle;
  accentColor: string;
  bloodline: BloodlineInfo | undefined;
  history: RaceEntry[];
  trainerStat: { total: number; wins: number } | undefined;
  gateStats: Map<number, { total: number; wins: number }> | undefined;
  rcDist: number | null;
  gradeDistStat: GradeDistStat | undefined;
  racePrizeCond: string | null;
}) {
  // race_entries.rc_dist는 사후에만 채워짐 → races 테이블 rc_dist를 fallback으로 사용
  const targetDist = horse.rc_dist ?? rcDist;
  const sameDistStats = useMemo(
    () => (targetDist != null ? computeSameDistStats(history, targetDist) : null),
    [history, targetDist]
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

  const dist = targetDist;

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

      {/* 마체중 */}
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
            {gradeDistStat != null && gradeDistStat.total >= 2 && racePrizeCond != null && (
              <div
                className="font-mono-num mt-1 pt-1 border-t"
                style={{ fontSize: '10px', color: 'var(--color-text-disabled)', borderColor: 'var(--color-bg-elevated)' }}
              >
                <span style={{ color: 'var(--color-accent-cyan)' }}>{racePrizeCond} 특화</span>
                {' '}
                {gradeDistStat.total}전 {gradeDistStat.wins}승
                {(gradeDistStat.places - gradeDistStat.wins > 0 || gradeDistStat.shows - gradeDistStat.places > 0) && (
                  <span> (연{gradeDistStat.places - gradeDistStat.wins} 복{gradeDistStat.shows - gradeDistStat.places})</span>
                )}
              </div>
            )}
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

// ─── 열 2: 기수정보 ──────────────────────────────────────────────────

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

// ─── 열 3: 직전 경주 ─────────────────────────────────────────────────

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
              sec.cornerStr != null || sec.s1fOrd != null || sec.s1fTime != null ||
              sec.g3fOrd != null || sec.g3fSplit != null ||
              sec.g1fOrd != null || sec.g1fSplit != null;

            const prizeKey = `${h.race_date}-${h.meet}-${h.rc_no}`;
            const prizeCond = prizeCondMap.get(prizeKey) ?? '-';
            const rowBg = i % 2 === 1 ? 'var(--color-bg-primary)' : 'transparent';

            const tdStyle = { background: rowBg, color: 'var(--color-text-secondary)' };

            return (
              <>
                <tr key={`main-${h.race_date}-${h.pthr_no}`}>
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
                {hasSecData && (
                  <tr key={`sec-${h.race_date}-${h.pthr_no}`}>
                    <td
                      colSpan={9}
                      className="px-2 pb-1.5 text-left border-b border-[var(--color-bg-elevated)]"
                      style={{ background: rowBg, fontSize: '9px', color: 'var(--color-text-disabled)' }}
                    >
                      {sec.cornerStr != null && (
                        <span style={{ color: 'var(--color-accent-cyan)' }}>코너 {sec.cornerStr}</span>
                      )}
                      {(sec.s1fOrd != null || sec.s1fTime != null) && (
                        <span> · 출발 {[
                          sec.s1fOrd != null ? `${sec.s1fOrd}위` : null,
                          fmtSec(sec.s1fTime) != null ? `${fmtSec(sec.s1fTime)}s` : null,
                        ].filter(Boolean).join(' ')}</span>
                      )}
                      {(sec.g3fOrd != null || sec.g3fSplit != null) && (
                        <span> · 막판600m {[
                          sec.g3fOrd != null ? `${sec.g3fOrd}위` : null,
                          fmtSec(sec.g3fSplit) != null ? `${fmtSec(sec.g3fSplit)}s` : null,
                        ].filter(Boolean).join(' ')}</span>
                      )}
                      {(sec.g1fOrd != null || sec.g1fSplit != null) && (
                        <span> · 막판200m {[
                          sec.g1fOrd != null ? `${sec.g1fOrd}위` : null,
                          fmtSec(sec.g1fSplit) != null ? `${fmtSec(sec.g1fSplit)}s` : null,
                        ].filter(Boolean).join(' ')}</span>
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

// ─── 열 4: 주요 항목 점수 ───────────────────────────────────────────────

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
}) {
  const hasScores = itemScores && Object.keys(itemScores).length > 0;

  // 현재 가중치 기준 상위 5개 항목 동적 선택
  const top5Items = hasScores
    ? Object.values(itemScores!)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5)
    : [];

  return (
    <div className="p-3 flex flex-col gap-2 h-full">
      {/* A/B 토글 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-disabled)' }}>
          주요 항목 점수
        </span>
        <div className="flex items-center rounded overflow-hidden text-xs font-medium"
          style={{ border: '1px solid var(--color-bg-elevated)' }}>
          <button
            onClick={() => onViewModeChange(viewMode === 'bar' ? 'radar' : 'bar')}
            className="flex items-center justify-center gap-1 w-14 py-1.5 transition-all"
            style={{
              background: viewMode === 'bar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'bar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}>
            <LayoutList className="w-3 h-3" />바
          </button>
          <button
            onClick={() => onViewModeChange(viewMode === 'bar' ? 'radar' : 'bar')}
            className="flex items-center justify-center gap-1 w-14 py-1.5 transition-all"
            style={{
              background: viewMode === 'radar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'radar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}>
            <Activity className="w-3 h-3" />레이더
          </button>
        </div>
      </div>

      {/* 고정 높이 컨테이너 — bar/radar 모두 항상 DOM에 존재, display로만 전환 → reflow 없음 */}
      <div className="relative overflow-hidden" style={{ minHeight: 160, height: '100%' }}>
        {!hasScores && (
          <p className="text-sm absolute inset-0 flex items-center px-1"
            style={{ color: 'var(--color-text-disabled)' }}>예측 없음</p>
        )}

        {/* 바 차트 — 항상 마운트, 숨김만 토글 */}
        <div
          className="absolute inset-0 flex flex-col justify-center gap-3.5 px-1"
          style={{ display: hasScores && viewMode === 'bar' ? 'flex' : 'none' }}
        >
          {top5Items.map((item) => {
            const pending = item.status === 'expert_pending';
            return (
              <div key={item.itemId} className="flex items-center gap-2">
                <span className="text-[13px] shrink-0 w-16 text-right"
                  style={{ color: 'var(--color-text-secondary)' }}>{item.itemName}</span>
                <div className="flex-1 h-3 rounded-full overflow-hidden"
                  style={{ background: 'var(--color-bg-elevated)' }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${item.rawScore * 100}%`, background: pending ? 'var(--color-text-disabled)' : accentColor }} />
                </div>
                <span className="text-xs font-mono-num w-8 shrink-0"
                  style={{ color: pending ? 'var(--color-text-disabled)' : 'var(--color-text-primary)' }}>
                  {item.rawScore.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>

        {/* 레이더 차트 — 항상 마운트, 숨김만 토글 → Chart.js remount reflow 없음 */}
        <div
          className="absolute inset-0"
          style={{ display: hasScores && viewMode === 'radar' ? 'block' : 'none' }}
        >
          {hasScores && (
            <Radar
              data={{
                labels: top5Items.map((i) => i.itemName),
                datasets: [{
                  data: top5Items.map((i) => Math.round(i.rawScore * 100)),
                  borderColor: accentColor,
                  backgroundColor: `${accentColor}20`,
                  borderWidth: 2,
                  pointBackgroundColor: accentColor,
                  pointRadius: 3,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  r: {
                    min: 0, max: 100,
                    ticks: { display: false },
                    grid: { color: 'rgba(94,107,138,0.25)' },
                    angleLines: { color: 'rgba(94,107,138,0.2)' },
                    pointLabels: { color: 'rgba(176,190,197,0.9)', font: { size: 11 } },
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
          )}
        </div>
      </div>

      {/* 하단 AI 순위 + 총점 */}
      {pRank < 999 && (
        <div className="mt-auto pt-2 border-t border-[var(--color-bg-elevated)] text-center">
          <div className="text-[18px]">{rankEmoji(pRank)}</div>
          <div className="font-mono-num text-[12px] font-bold" style={{ color: accentColor }}>
            {pScore.toFixed(1)}점
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 말 카드 ─────────────────────────────────────────────────────────

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
      {runningStyle !== 'unknown' && <StyleBadge style={runningStyle} />}

      {/* 공백 배지 */}
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

      {/* AI 점수바 + 총점 + 순위 이모지 */}
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
  gradeDistStat,
  racePrizeCond,
  prizeCondMap,
  rcDist,
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
  gradeDistStat: GradeDistStat | undefined;
  racePrizeCond: string | null;
  prizeCondMap: Map<string, string>;
  rcDist: number | null;
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

      {/* 본문 4열 그리드 */}
      <div className="grid grid-cols-2 md:[grid-template-columns:1.5fr_1.2fr_2.8fr_1.5fr]">
        <div className="border-b border-r border-[var(--color-bg-elevated)] md:border-b-0">
          <ColHorseInfo
            horse={horse}
            runningStyle={runningStyle}
            accentColor={accent}
            bloodline={bloodline}
            history={history}
            trainerStat={trainerStat}
            gateStats={gateStats}
            rcDist={rcDist}
            gradeDistStat={gradeDistStat}
            racePrizeCond={racePrizeCond}
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

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────

export function PredictionSheet() {
  const { meet: meetStr, date: dateStr, rcNo: rcNoStr } = useParams();
  const meet = Number(meetStr);
  const rcDate = Number(dateStr);
  const rcNo = Number(rcNoStr);
  const navigate = useNavigate();

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

  // E-006: 등급+거리 특화 성적
  const { data: gradeDistStatsMap } = useHorseGradeDistStatsBatch(
    hrNames,
    race?.prize_cond ?? null,
    race?.rc_dist ?? null
  );

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
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          뒤로
        </button>
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
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <HorseCardSkeleton key={i} />
          ))}
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
              gradeDistStat={gradeDistStatsMap?.get(horse.hr_name)}
              racePrizeCond={race?.prize_cond ?? null}
              prizeCondMap={prizeCondMap}
              rcDist={race?.rc_dist ?? null}
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
