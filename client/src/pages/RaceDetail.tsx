import { useParams, Link } from 'react-router-dom';
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronDown, Sparkles, Bot, Loader2 } from 'lucide-react';
import { useHorsesByRace, usePredictionsByRace } from '../lib/queries';
import { supabase, type RaceEntry, type Race, type Prediction, formatActualOrd, isCancelled } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';

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

export function RaceDetail() {
  const { meet: meetStr, date: dateStr, rcNo: rcNoStr } = useParams();
  const meet = Number(meetStr);
  const rcDate = Number(dateStr);
  const rcNo = Number(rcNoStr);

  const [showLowerRanks, setShowLowerRanks] = useState(false);

  const { data: race } = useRaceMeta(rcDate, meet, rcNo);
  const { data: horses, isLoading, error } = useHorsesByRace(rcDate, meet, rcNo);
  const { data: predictions } = usePredictionsByRace(rcDate, meet, rcNo);

  // hr_name → Prediction 맵
  const predictionMap = useMemo(() => {
    const map = new Map<string, Prediction>();
    (predictions ?? []).forEach((p) => map.set(p.hr_name, p));
    return map;
  }, [predictions]);

  // 예측 순으로 정렬 (예측 없으면 pthr_no 순)
  const sortedHorses = useMemo(() => {
    if (!horses) return [];
    const withPred = [...horses];
    if (predictionMap.size === 0) return withPred;
    return withPred.sort((a, b) => {
      const pa = predictionMap.get(a.hr_name)?.predicted_rank ?? 999;
      const pb = predictionMap.get(b.hr_name)?.predicted_rank ?? 999;
      return pa - pb;
    });
  }, [horses, predictionMap]);

  const topHorses = sortedHorses.slice(0, 3);
  const lowerHorses = sortedHorses.slice(3);

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
        {race?.weather && (
          <>
            <span>|</span>
            <span>{race.weather}</span>
          </>
        )}
        {horses && (
          <span className="text-xs text-[var(--color-text-disabled)]">
            {horses.length}마
          </span>
        )}
      </div>

      {/* AI 요약 (placeholder - Phase 2) */}
      <div className="bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] flex items-start gap-3">
        <Bot className="w-5 h-5 text-[var(--color-accent-pink)] flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <span className="text-[var(--color-accent-pink)] font-semibold">AI 요약:</span>{' '}
          <span className="text-[var(--color-text-disabled)]">
            (Claude API 연동 후 표시 예정)
          </span>
        </div>
      </div>

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

      {/* 출전마 카드 (상위 3) */}
      {!isLoading && topHorses.length > 0 && (
        <div className="space-y-3">
          {topHorses.map((horse) => (
            <HorseCard
              key={horse.pthr_no}
              horse={horse}
              prediction={predictionMap.get(horse.hr_name)}
              meet={meetStr}
              date={dateStr}
              rcNo={rcNoStr}
            />
          ))}
        </div>
      )}

      {/* 4-N 펼치기 */}
      {lowerHorses.length > 0 && (
        <>
          <button
            onClick={() => setShowLowerRanks(!showLowerRanks)}
            className="w-full py-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] rounded-xl border border-[var(--color-bg-elevated)] transition-colors flex items-center justify-center gap-1"
          >
            4-{sortedHorses.length}위 펼치기
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showLowerRanks ? 'rotate-180' : ''}`}
            />
          </button>
          {showLowerRanks && (
            <div className="space-y-3">
              {lowerHorses.map((horse) => (
                <HorseCard
                  key={horse.pthr_no}
                  horse={horse}
                  prediction={predictionMap.get(horse.hr_name)}
                  meet={meetStr}
                  date={dateStr}
                  rcNo={rcNoStr}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 빈 데이터 */}
      {!isLoading && horses && horses.length === 0 && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 text-center text-[var(--color-text-secondary)]">
          출전마 데이터 없음
        </div>
      )}

      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-2">
        ℹ️ 실제 KRA 동기화 데이터. Score Engine 예측은 별도 페이지에서 제공 예정.
      </div>
    </div>
  );
}

// ============================================
// HorseCard
// ============================================

interface HorseCardProps {
  horse: RaceEntry;
  prediction: Prediction | undefined;
  meet: string | undefined;
  date: string | undefined;
  rcNo: string | undefined;
}

function HorseCard({ horse, prediction, meet, date, rcNo }: HorseCardProps) {
  const [showDetail, setShowDetail] = useState(true);

  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const predRank = prediction?.predicted_rank;
  const rankLabel = predRank ? (medals[predRank] ?? `${predRank}위`) : '-';
  const hasResult = horse.result_at !== null;
  const cancelled = isCancelled(horse.ord);
  const actualLabel = hasResult
    ? cancelled
      ? '🚫 출주 취소'
      : `실제 ${formatActualOrd(horse.ord)}`
    : '경기 전';
  const isHit = hasResult && !cancelled && predRank != null && horse.ord === predRank;
  const sexLabel = horse.gndr ?? '';

  return (
    <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] hover:border-[var(--color-accent-cyan)]/40 transition-colors overflow-hidden">
      {/* 상단: 순위 + 이름 + 종합 */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{rankLabel}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono-num text-[var(--color-text-secondary)] text-sm">
                {horse.pthr_no}번
              </span>
              <span className="font-semibold text-base">{horse.hr_name}</span>
              <span className="text-xs text-[var(--color-text-disabled)]">
                ({horse.ag ?? '?'}세 {sexLabel})
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          {prediction ? (
            <>
              <div className="text-2xl font-bold font-mono-num text-[var(--color-accent-cyan)]">
                {prediction.total_score.toFixed(1)}
                <span className="text-sm">점</span>
              </div>
              <div className="text-[10px] text-[var(--color-text-secondary)]">
                예측 종합
              </div>
            </>
          ) : (
            horse.ratg != null && horse.ratg > 0 && (
              <div className="text-xl font-bold font-mono-num text-[var(--color-accent-cyan)]">
                {horse.ratg}
                <span className="text-sm">레이팅</span>
              </div>
            )
          )}
          <div
            className={`text-[10px] mt-0.5 ${
              !hasResult
                ? 'text-[var(--color-text-disabled)]'
                : cancelled
                  ? 'text-[var(--color-accent-pink)]'
                  : isHit
                    ? 'text-[var(--color-success)] font-bold'
                    : 'text-[var(--color-text-disabled)]'
            }`}
          >
            {actualLabel}
            {isHit ? ' ✓' : ''}
          </div>
          {horse.popularity !== null && (
            <div className="text-[10px] text-[var(--color-text-disabled)]">
              {horse.popularity}인기
            </div>
          )}
        </div>
      </div>

      {/* 데이터 카테고리 */}
      {showDetail && (
        <div className="p-4 space-y-3">
          <DataCategory label="체중">
            {horse.burd_wgt !== null && (
              <DataRow label="부담중량" value={`${horse.burd_wgt}kg`} />
            )}
            {horse.wg_hr !== null && (
              <DataRow
                label="마체중"
                value={`${horse.wg_hr}kg ${formatDiff(horse.wg_hr_diff)}`}
              />
            )}
            {horse.wg_jk != null && horse.wg_jk !== 0 && (
              <DataRow label="기수 체중" value={`${horse.wg_jk}kg`} />
            )}
          </DataCategory>

          <DataCategory label="기수 / 조교사">
            {horse.jcky_nm && (
              <DataRow label="기수" value={`${horse.jcky_nm} (${horse.jcky_no ?? '-'})`} />
            )}
            {horse.trar_nm && (
              <DataRow label="조교사" value={`${horse.trar_nm} (${horse.trar_no ?? '-'})`} />
            )}
          </DataCategory>

          {hasResult && (
            <DataCategory label="경주 결과">
              <DataRow label="결승 순위" value={formatActualOrd(horse.ord)} />
              {horse.rc_time !== null && (
                <DataRow label="경주 기록" value={formatRcTime(horse.rc_time)} />
              )}
              {horse.win_odds !== null && (
                <DataRow label="단승 배당" value={`${horse.win_odds}배`} />
              )}
            </DataCategory>
          )}
        </div>
      )}

      <div className="px-4 py-2 flex items-center justify-between border-t border-[var(--color-bg-elevated)]">
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="text-xs text-[var(--color-text-secondary)] hover:text-white flex items-center gap-1"
        >
          {showDetail ? '간략히' : '상세 보기'}
          <ChevronDown
            className={`w-3 h-3 transition-transform ${showDetail ? 'rotate-180' : ''}`}
          />
        </button>
        <Link
          to={`/race/${meet}/${date}/${rcNo}/horse/${horse.pthr_no}`}
          className="text-xs text-[var(--color-accent-cyan)] hover:underline flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" />
          말 상세 분석
        </Link>
      </div>
    </div>
  );
}

function DataCategory({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent-cyan)] mb-1.5 font-semibold">
        [{label}]
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--color-text-secondary)] flex-shrink-0">{label}:</span>
      <span className="font-mono-num text-[var(--color-text-primary)] text-right">
        {value}
      </span>
    </div>
  );
}

function formatDiff(diff: number | null): string {
  if (diff === null) return '';
  if (diff === 0) return '(0)';
  return `(${diff > 0 ? '+' : ''}${diff})`;
}

function formatRcTime(rcTime: number): string {
  // KRA rc_time: 1/10초 단위 (예: 712 = 71.2초)
  const sec = rcTime / 10;
  const min = Math.floor(sec / 60);
  const rest = (sec - min * 60).toFixed(1);
  return min > 0 ? `${min}:${rest.padStart(4, '0')}` : `${rest}초`;
}
