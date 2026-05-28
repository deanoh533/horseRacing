import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Loader2,
  Bot,
  ClipboardList,
  BarChart2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  useRacesByDate,
  useAvailableDates,
  usePredictionsByDate,
  useLatestWeights,
  type PredictionPreview,
} from '../lib/queries';
import { isCancelled } from '../lib/supabase';

const MEET_NAMES: Record<number, string> = {
  1: '서울',
  3: '부산경남',
};

const ITEM_LABELS: Record<string, string> = {
  '01_rating': '레이팅',
  '02_weight_change': '마체중 변화',
  '03_recent_form': '착순 추세',
  '05_late_position': '후반 구간 순위',
  '06_distance_fitness': '거리 적성',
  '08_burden_weight': '부담중량',
  '09_jockey_form': '기수 폼',
  '09b_jockey_recent': '기수 최근폼',
  '10_trainer_form': '조교사 폼',
  '10b_trainer_recent': '조교사 최근폼',
  '11_race_interval': '경주 간격',
  '12_starting_position': '출발번호',
  '14_pedigree': '혈통',
  '15_seasonal_pattern': '계절 패턴',
  '16_jockey_horse_chemistry': '기수-말 궁합',
  '17_market_odds': '배당률',
  '18_earnings': '수득상금',
};

export function Dashboard() {
  const { data: availableDates } = useAvailableDates();
  const { data: latestWeights } = useLatestWeights();
  // 사용자가 ◀▶ 또는 "최근 동기화" 클릭하면 override 저장
  // 그 외엔 availableDates 가장 최근 → 그것도 없으면 오늘 (derived state, useEffect 불필요)
  const [manualDate, setManualDate] = useState<number | null>(null);
  const dateNum =
    manualDate ?? availableDates?.[0] ?? rcDateFromDate(new Date());
  const setDateNum = setManualDate;

  const { data: races, isLoading, error } = useRacesByDate(dateNum);
  const { data: predictions } = usePredictionsByDate(dateNum);

  // race별 예측 top3 그룹핑
  const predictionsByRace = useMemo(() => {
    const map = new Map<string, PredictionPreview[]>();
    (predictions ?? []).forEach((p) => {
      const key = `${p.meet}-${p.rc_no}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    });
    return map;
  }, [predictions]);

  const date = useMemo(() => dateFromRcDate(dateNum), [dateNum]);

  const changeDate = (offset: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + offset);
    setDateNum(rcDateFromDate(d));
  };

  const racesByMeet = useMemo(() => {
    const groups: Record<number, typeof races> = { 1: [], 3: [] };
    (races ?? []).forEach((r) => {
      if (!groups[r.meet]) groups[r.meet] = [];
      groups[r.meet]!.push(r);
    });
    return groups;
  }, [races]);

  const top4Weights = useMemo(() => {
    const weights = latestWeights?.weights as Record<string, number> | undefined;
    if (!weights) return null;
    return Object.entries(weights)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([id, value]) => ({ id, name: ITEM_LABELS[id] ?? id, value }));
  }, [latestWeights]);

  return (
    <div className="space-y-6">
      {/* 날짜 선택 */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => changeDate(-1)}
          className="p-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors"
          aria-label="이전 날짜"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-surface)] rounded-lg">
          <Calendar className="w-4 h-4 text-[var(--color-accent-cyan)]" />
          <span className="font-medium font-mono-num">{formatDate(date)}</span>
        </div>
        <button
          onClick={() => changeDate(1)}
          className="p-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors"
          aria-label="다음 날짜"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* 동기화된 최근 날짜 빠른 이동 */}
        {availableDates && availableDates[0] && (
          <button
            onClick={() => setDateNum(availableDates[0]!)}
            className="ml-2 px-3 py-1.5 text-xs bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors"
          >
            최근 동기화: {formatRcDate(availableDates[0])}
          </button>
        )}
      </div>

      {/* 핵심 가중치 4개 (현재 mock) */}
      <section className="bg-[var(--color-bg-surface)] rounded-xl p-5 border border-[var(--color-bg-elevated)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span className="text-[var(--color-accent-gold)]">⭐</span>
            예측 핵심 지표 (가중치 상위 4)
          </h2>
          {latestWeights && (
            <span className="text-[10px] text-[var(--color-text-disabled)]">
              학습일 {latestWeights.period_end}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(top4Weights ?? []).map((w) => (
            <div
              key={w.id}
              className="bg-[var(--color-bg-elevated)] rounded-lg p-3"
            >
              <div className="text-xs text-[var(--color-text-secondary)]">
                {w.name}
              </div>
              <div className="text-2xl font-bold font-mono-num text-[var(--color-accent-cyan)] mt-1">
                {w.value.toFixed(1)}
              </div>
            </div>
          ))}
          {!top4Weights && (
            <div className="col-span-4 text-xs text-[var(--color-text-disabled)] py-2">
              가중치 로딩 중...
            </div>
          )}
        </div>
      </section>

      {/* 로딩 / 에러 / 빈 데이터 */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          로딩 중...
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          ❌ 데이터 로딩 실패: {(error as Error).message}
        </div>
      )}

      {races && races.length === 0 && !isLoading && (
        <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 text-center text-[var(--color-text-secondary)]">
          <div className="text-3xl mb-2">😴</div>
          <div>이 날짜는 동기화된 데이터가 없습니다</div>
          <div className="text-xs text-[var(--color-text-disabled)] mt-2">
            KRA 경마는 주로 금/토/일 개최
          </div>
        </div>
      )}

      {/* 경마장별 경주 목록 */}
      {races && races.length > 0 && (
        <>
          {[1, 3].map((meet) => {
            const meetRaces = racesByMeet[meet] ?? [];
            if (meetRaces.length === 0) return null;
            return (
              <section key={meet}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span>🏟️</span>
                  {MEET_NAMES[meet]} 경마 ({meetRaces.length}경주)
                </h2>
                <div className="space-y-3">
                  {meetRaces.map((race) => (
                    <RaceCard
                      key={`${race.meet}-${race.rc_no}`}
                      race={race}
                      predictions={predictionsByRace.get(`${race.meet}-${race.rc_no}`) ?? []}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

interface RaceCardProps {
  race: {
    meet: number;
    rc_no: number;
    race_date: number;
    rc_dist: number | null;
    rc_name: string | null;
    track: string | null;
    age_cond: string | null;
    prize_cond: string | null;
  };
  predictions: PredictionPreview[];
}

function RaceCard({ race, predictions }: RaceCardProps) {
  const dateStr = race.race_date.toString();
  const top3 = predictions.slice(0, 3);
  const hasResult = predictions.some((p) => p.actual_ord !== null);
  const predictionUrl = `/race/${race.meet}/${dateStr}/${race.rc_no}`;
  const entriesUrl = `/race/${race.meet}/${dateStr}/${race.rc_no}/entries`;
  const sheetUrl = `/race/${race.meet}/${dateStr}/${race.rc_no}/sheet`;

  return (
    <div className="bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] hover:border-[var(--color-accent-cyan)]/40 transition-colors">
      {/* 경주 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="font-bold text-[var(--color-accent-cyan)]">
            {race.rc_no}R
          </span>
          {race.rc_dist != null && (
            <span className="font-mono-num">{race.rc_dist}m</span>
          )}
          {race.rc_name && (
            <span className="text-[var(--color-text-secondary)]">{race.rc_name}</span>
          )}
          {race.age_cond && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)]">
              {race.age_cond}
            </span>
          )}
          {race.prize_cond && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)]">
              {race.prize_cond}
            </span>
          )}
          {race.track && (
            <span className="text-xs text-[var(--color-text-disabled)]">
              {race.track}
            </span>
          )}
        </div>
      </div>

      {/* 예측 1-3위 (Score Engine 결과) */}
      {top3.length > 0 ? (
        <>
          <div className="text-[12px] uppercase tracking-wider text-[var(--color-accent-gold)] mb-1.5 font-semibold">
            ⭐ 예측 TOP 3
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono-num text-sm">
            {[1, 2, 3].map((rank) => {
              const p = top3[rank - 1];
              if (!p) return <div key={rank} />;
              return (
                <PredictionTile
                  key={rank}
                  rank={rank as 1 | 2 | 3}
                  hrName={p.hr_name}
                  totalScore={p.total_score}
                  actualOrd={p.actual_ord}
                  hasResult={hasResult}
                />
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-xs text-[var(--color-text-disabled)] py-2">
          {hasResult ? '예측 데이터 없음' : '예측 점수 준비 중'}
        </div>
      )}

      {/* 세 입구: AI 예측 / 예상지 / 출마정보 */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Link
          to={predictionUrl}
          className="flex items-center justify-center gap-1.5 px-2 py-3 rounded-lg text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black transition-colors font-medium"
        >
          <Bot className="w-4 h-4" />
          AI 예측
        </Link>
        <Link
          to={sheetUrl}
          className="flex items-center justify-center gap-1.5 px-2 py-3 rounded-lg text-sm bg-[var(--color-accent-cyan)]/10 border border-[var(--color-accent-cyan)]/30 hover:bg-[var(--color-accent-cyan)] hover:text-black transition-colors font-medium text-[var(--color-accent-cyan)]"
        >
          <BarChart2 className="w-4 h-4" />
          예상지
        </Link>
        <Link
          to={entriesUrl}
          className="flex items-center justify-center gap-1.5 px-2 py-3 rounded-lg text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black transition-colors font-medium"
        >
          <ClipboardList className="w-4 h-4" />
          출마정보
        </Link>
      </div>
    </div>
  );
}

interface PredictionTileProps {
  rank: 1 | 2 | 3;
  hrName: string;
  totalScore: number;
  actualOrd: number | null;
  hasResult: boolean;
}

function PredictionTile({ rank, hrName, totalScore, actualOrd, hasResult }: PredictionTileProps) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const colors = {
    1: 'text-[var(--color-accent-gold)] border-[var(--color-accent-gold)]',
    2: 'text-[var(--color-text-primary)] border-[var(--color-text-disabled)]',
    3: 'text-[var(--color-text-secondary)] border-[var(--color-text-disabled)]',
  };
  const isHit = actualOrd === rank;

  // 경주 전(hasResult=false): 착순 표시 없음
  // 경주 후 + null: 실제 출주 취소
  // 경주 후 + 숫자: 착순 표시
  const resultLabel = !hasResult
    ? null
    : isCancelled(actualOrd)
      ? '취소'
      : `${actualOrd}위${isHit ? ' ✓' : ''}`;

  return (
    <div
      className={`flex flex-col items-center justify-center p-2 rounded border ${colors[rank]} bg-[var(--color-bg-primary)]/50`}
    >
      <div className="text-lg leading-none">{medals[rank]}</div>
      <div className="font-semibold truncate w-full text-center mt-1">{hrName}</div>
      <div className="text-xs text-[var(--color-accent-cyan)] mt-0.5">
        {totalScore.toFixed(1)}점
      </div>
      {resultLabel !== null && (
        <div
          className={`text-[12px] mt-0.5 ${
            isCancelled(actualOrd)
              ? 'text-[var(--color-accent-pink)]'
              : isHit
                ? 'text-[var(--color-success)] font-bold'
                : 'text-[var(--color-text-disabled)]'
          }`}
        >
          {resultLabel}
        </div>
      )}
    </div>
  );
}

// ============================================
// 유틸
// ============================================

function rcDateFromDate(d: Date): number {
  return (
    d.getFullYear() * 10000 +
    (d.getMonth() + 1) * 100 +
    d.getDate()
  );
}

function dateFromRcDate(rcDate: number): Date {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100) - 1;
  const d = rcDate % 100;
  return new Date(y, m, d);
}

function formatDate(d: Date): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
}

function formatRcDate(rcDate: number): string {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100);
  const d = rcDate % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
