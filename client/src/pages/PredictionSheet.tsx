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
import { useHorsesByRace, usePredictionsByRace, useHorseSectionalAbilityByNames } from '../lib/queries';
import { supabase, type RaceEntry, type Race, type Prediction, type ItemScore } from '../lib/supabase';
import { classifyRunningStyle, STYLE_INFO, type RunningStyle } from '../lib/runningStyle';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip);

// ─── 상수 ────────────────────────────────────────────────────────────

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경' };

// 비중 상위 5항목: 레이팅(17.5) · 기수폼(10.5) · 거리적성(8.8) · 착순추세(4.2) · 배당률(8.8)
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

// ─── 공통 서브 컴포넌트 ──────────────────────────────────────────────

function ScoreBar({ score, maxScore, color }: { score: number; maxScore: number; color?: string }) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  return (
    <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-elevated)' }}>
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color ?? 'var(--color-accent-cyan)' }} />
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

function PodiumCards({ top3, maxScore }: { top3: Prediction[]; maxScore: number }) {
  if (top3.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      {top3.map((p, i) => {
        const s = PODIUM_STYLES[i];
        return (
          <div key={p.hr_name}
            className={`rounded-xl border ${s.border} p-4 flex flex-col gap-2`}
            style={{ boxShadow: s.glow, background: 'var(--color-bg-surface)' }}>
            <div className={`text-xs font-semibold font-mono-num ${s.labelColor}`}>{s.label}</div>
            <div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>{p.predicted_rank}번</div>
              <div className="text-base font-bold leading-tight truncate">{p.hr_name}</div>
            </div>
            <div className="space-y-1">
              <ScoreBar score={p.total_score} maxScore={maxScore} color={s.accent} />
              <div className="text-right text-xs font-mono-num font-semibold" style={{ color: s.accent }}>
                {p.total_score.toFixed(1)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 열 1: 마정보 ────────────────────────────────────────────────────

function ColHorseInfo({
  horse, prediction, maxScore, runningStyle, accentColor,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  maxScore: number;
  runningStyle: RunningStyle;
  accentColor: string;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const pScore = prediction?.total_score ?? 0;

  const career = horse.sump_rcod_sum != null
    ? `${horse.sump_rcod_sum}전 ${horse.sump_rcod_fplc ?? 0}-${horse.sump_rcod_splc ?? 0}-${horse.sump_rcod_tplc ?? 0}`
    : null;

  return (
    <div className="p-3 flex flex-col gap-1.5 min-w-0">
      {/* AI 배지 */}
      {pRank < 999 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono-num shrink-0"
            style={{ background: `${accentColor}20`, color: accentColor, border: `1px solid ${accentColor}40` }}>
            AI {pRank}위
          </span>
          <div className="flex-1 min-w-0">
            <ScoreBar score={pScore} maxScore={maxScore} color={accentColor} />
          </div>
          <span className="text-[10px] font-mono-num shrink-0" style={{ color: accentColor }}>
            {pScore.toFixed(1)}
          </span>
        </div>
      )}

      {/* 번호 + 마명 */}
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-base font-bold font-mono-num" style={{ color: accentColor }}>
          {horse.pthr_no}번
        </span>
        <span className="text-base font-bold leading-tight">{horse.hr_name}</span>
      </div>

      {/* 성향 + 나이/성별 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StyleBadge style={runningStyle} />
        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          {horse.ag ?? '?'}세 {horse.gndr ?? ''}
          {horse.prds ? ` · ${horse.prds}` : ''}
        </span>
      </div>

      {/* 마체중 */}
      {horse.wg_hr != null && (
        <div className="flex items-baseline gap-1 font-mono-num">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {horse.wg_hr} kg
          </span>
          {horse.wg_hr_diff != null && horse.wg_hr_diff !== 0 && (
            <span className="text-[11px]"
              style={{ color: horse.wg_hr_diff > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
              ({horse.wg_hr_diff > 0 ? '+' : ''}{horse.wg_hr_diff})
            </span>
          )}
        </div>
      )}

      {/* 통산 성적 */}
      {career && (
        <span className="text-[11px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
          통산 {career}
        </span>
      )}

      {/* 수득상금 */}
      {horse.erng_sump != null && horse.erng_sump > 0 && (
        <span className="text-[11px] font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
          수득 {formatErng(horse.erng_sump)}
        </span>
      )}

      {/* 조교사 / 마주 */}
      <div className="flex flex-col gap-0.5 mt-0.5">
        {horse.trar_nm && (
          <span className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>
            조교 {horse.trar_nm}
          </span>
        )}
        {horse.owner_nm && (
          <span className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>
            마주 {horse.owner_nm}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── 열 2: 기수정보 ──────────────────────────────────────────────────

function ColJockeyInfo({ horse }: { horse: RaceEntry }) {
  return (
    <div className="p-3 flex flex-col gap-2">
      {/* 기수명 */}
      <div>
        <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>기수</div>
        <div className="text-sm font-semibold">{horse.jcky_nm ?? '-'}</div>
      </div>

      {/* 레이팅 */}
      <div>
        <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>레이팅</div>
        <div className="text-sm font-mono-num font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {horse.ratg && horse.ratg > 0 ? horse.ratg : '-'}
        </div>
      </div>

      {/* 부담중량 */}
      <div>
        <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>부담중량</div>
        <div className="text-sm font-mono-num font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {horse.burd_wgt ?? '-'}
        </div>
      </div>

      {/* 사후: 실제 착순 */}
      {horse.ord != null && (
        <div>
          <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-disabled)' }}>실제 착순</div>
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
      <div className="text-[10px] mb-1.5 font-semibold"
        style={{ color: 'var(--color-text-disabled)' }}>
        직전 경주
      </div>
      {history.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>이력 없음</p>
      ) : (
        <div className="space-y-1">
          {/* 헤더 */}
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
            <LayoutList className="w-2.5 h-2.5" />
            바
          </button>
          <button
            onClick={() => onViewModeChange('radar')}
            className="flex items-center gap-0.5 px-2 py-1 transition-all"
            style={{
              background: viewMode === 'radar' ? 'var(--color-accent-cyan)' : 'transparent',
              color: viewMode === 'radar' ? '#0a0e27' : 'var(--color-text-secondary)',
            }}>
            <Activity className="w-2.5 h-2.5" />
            레이더
          </button>
        </div>
      </div>

      {/* 점수 없음 */}
      {!hasScores && (
        <p className="text-[11px]" style={{ color: 'var(--color-text-disabled)' }}>예측 없음</p>
      )}

      {/* 바 리스트 */}
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

      {/* 레이더 */}
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
  horse, prediction, maxScore, history, runningStyle, viewMode, onViewModeChange,
}: {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  maxScore: number;
  history: RaceEntry[];
  runningStyle: RunningStyle;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}) {
  const pRank = prediction?.predicted_rank ?? 999;
  const pStyle = PODIUM_STYLES[pRank - 1];
  const accentColor = pStyle?.accent ?? 'var(--color-text-disabled)';

  const borderColor = pRank <= 3 ? `${accentColor}50` : 'var(--color-bg-elevated)';

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-surface)', border: `1px solid ${borderColor}` }}>
      <div className="grid"
        style={{ gridTemplateColumns: '2fr 1.2fr 3fr 2fr' }}>

        {/* 열 구분선 */}
        <div style={{ borderRight: '1px solid var(--color-bg-elevated)' }}>
          <ColHorseInfo
            horse={horse} prediction={prediction}
            maxScore={maxScore} runningStyle={runningStyle} accentColor={accentColor}
          />
        </div>

        <div style={{ borderRight: '1px solid var(--color-bg-elevated)' }}>
          <ColJockeyInfo horse={horse} />
        </div>

        <div style={{ borderRight: '1px solid var(--color-bg-elevated)' }}>
          <ColHistory history={history} />
        </div>

        <div>
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

  const sortedHorses = useMemo(() => {
    if (!horses) return [];
    return [...horses].sort((a, b) => {
      const ra = predByName.get(a.hr_name)?.predicted_rank ?? 999;
      const rb = predByName.get(b.hr_name)?.predicted_rank ?? 999;
      return ra !== rb ? ra - rb : a.pthr_no - b.pthr_no;
    });
  }, [horses, predByName]);

  const top3 = useMemo(
    () => [...(predictions ?? [])].sort((a, b) => a.predicted_rank - b.predicted_rank).slice(0, 3),
    [predictions]
  );

  const maxScore = useMemo(
    () => Math.max(...(predictions ?? []).map((p) => p.total_score), 1),
    [predictions]
  );

  const isPostRace = (horses ?? []).some((h) => h.ord != null);

  return (
    <div className="space-y-4 pb-8">
      {/* 경주 헤더 */}
      <div className="flex items-center gap-2 text-sm flex-wrap"
        style={{ color: 'var(--color-text-secondary)' }}>
        <Link to={`/race/${meet}/${rcDate}/${rcNo}/entries`}
          className="inline-flex items-center gap-1 hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" />
          출마정보
        </Link>
        <span style={{ color: 'var(--color-text-disabled)' }}>|</span>
        <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {MEET_NAMES[meet] ?? '?'} {rcNo}R
        </span>
        {race?.rc_dist && <span className="font-mono-num" style={{ color: 'var(--color-text-primary)' }}>{race.rc_dist}m</span>}
        {race?.rc_name && <span>{race.rc_name}</span>}
        {race?.track && <span>{race.track}</span>}
        {race?.weather && <span>{race.weather}</span>}
        {isPostRace && (
          <span className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(0,200,83,0.12)', color: 'var(--color-success)', border: '1px solid rgba(0,200,83,0.25)' }}>
            사후
          </span>
        )}
        {horses && (
          <span className="ml-auto text-xs font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>
            {horses.length}마 출전
          </span>
        )}
      </div>

      {/* Top 3 포디엄 */}
      {top3.length > 0 && <PodiumCards top3={top3} maxScore={maxScore} />}

      {/* 로딩 / 에러 */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          불러오는 중...
        </div>
      )}
      {error && (
        <div className="rounded-xl p-4 text-sm"
          style={{ background: 'rgba(255,23,68,0.08)', border: '1px solid rgba(255,23,68,0.25)', color: '#ff6b8a' }}>
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
              maxScore={maxScore}
              history={historyByName.get(horse.hr_name) ?? []}
              runningStyle={styleByName.get(horse.hr_name) ?? 'unknown'}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          ))}
        </div>
      )}

      {!isLoading && sortedHorses.length === 0 && !error && (
        <div className="rounded-xl p-8 text-center text-sm"
          style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)' }}>
          출전마 데이터 없음
        </div>
      )}
    </div>
  );
}
