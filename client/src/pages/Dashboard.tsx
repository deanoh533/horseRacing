import { useState, useMemo, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  useRacesByDate,
  useAvailableDates,
  usePredictionsByDate,
  type PredictionPreview,
} from '../lib/queries';
import { formatActualOrd, isCancelled } from '../lib/supabase';

const MEET_NAMES: Record<number, string> = {
  1: '서울',
  3: '부산경남',
};

const MOCK_WEIGHTS_TOP4 = [
  { id: '01_rating', name: '레이팅', value: 17.5 },
  { id: '09_jockey_form', name: '기수 폼', value: 10.5 },
  { id: '06_distance_fitness', name: '거리 적성', value: 8.8 },
  { id: '17_market_odds', name: '배당률', value: 8.8 },
];

export function Dashboard() {
  const { data: availableDates } = useAvailableDates();
  // 기본값: 오늘 날짜 (availableDates 로드되면 가장 최근으로 자동 변경)
  const [dateNum, setDateNum] = useState<number>(() => rcDateFromDate(new Date()));
  const [autoJumped, setAutoJumped] = useState(false);

  // availableDates 로드되면 가장 최근 동기화 날짜로 자동 점프 (첫 1회만)
  useEffect(() => {
    if (!autoJumped && availableDates && availableDates[0]) {
      setDateNum(availableDates[0]);
      setAutoJumped(true);
    }
  }, [availableDates, autoJumped]);

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
            현재 적용 가중치 (상위 4)
          </h2>
          <span className="text-xs text-[var(--color-text-disabled)]">
            ⚠️ 학습 전 초기값
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {MOCK_WEIGHTS_TOP4.map((w) => (
            <div
              key={w.id}
              className="bg-[var(--color-bg-elevated)] rounded-lg p-3"
            >
              <div className="text-xs text-[var(--color-text-secondary)]">
                {w.name}
              </div>
              <div className="text-2xl font-bold font-mono-num text-[var(--color-accent-cyan)] mt-1">
                {w.value}
              </div>
            </div>
          ))}
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
  };
  predictions: PredictionPreview[];
}

function RaceCard({ race, predictions }: RaceCardProps) {
  const dateStr = race.race_date.toString();
  const top3 = predictions.slice(0, 3);
  const hasResult = predictions.some((p) => p.actual_ord !== null);

  return (
    <Link
      to={`/race/${race.meet}/${dateStr}/${race.rc_no}`}
      className="block bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] hover:border-[var(--color-accent-cyan)] transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="font-bold text-[var(--color-accent-cyan)]">
            {race.rc_no}R
          </span>
          <span className="font-mono-num">{race.rc_dist}m</span>
          <span className="text-[var(--color-text-secondary)]">
            {race.rc_name}
          </span>
          {race.track && (
            <span className="text-xs text-[var(--color-text-disabled)]">
              {race.track}
            </span>
          )}
        </div>
        <ArrowRight className="w-4 h-4 text-[var(--color-text-disabled)] group-hover:text-[var(--color-accent-cyan)] transition-colors" />
      </div>

      {/* 예측 1-3위 (Score Engine 결과) */}
      {top3.length > 0 ? (
        <>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent-gold)] mb-1.5 font-semibold">
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
                />
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-xs text-[var(--color-text-disabled)] py-2">
          {hasResult ? '예측 데이터 없음' : '예측 계산 대기 (npm run backfill)'}
        </div>
      )}
    </Link>
  );
}

interface PredictionTileProps {
  rank: 1 | 2 | 3;
  hrName: string;
  totalScore: number;
  actualOrd: number | null;
}

function PredictionTile({ rank, hrName, totalScore, actualOrd }: PredictionTileProps) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const colors = {
    1: 'text-[var(--color-accent-gold)] border-[var(--color-accent-gold)]',
    2: 'text-[var(--color-text-primary)] border-[var(--color-text-disabled)]',
    3: 'text-[var(--color-text-secondary)] border-[var(--color-text-disabled)]',
  };
  const isHit = actualOrd === rank;
  return (
    <div
      className={`flex flex-col items-center justify-center p-2 rounded border ${colors[rank]} bg-[var(--color-bg-primary)]/50`}
    >
      <div className="text-lg leading-none">{medals[rank]}</div>
      <div className="font-semibold truncate w-full text-center mt-1">{hrName}</div>
      <div className="text-xs text-[var(--color-accent-cyan)] mt-0.5">
        {totalScore.toFixed(1)}점
      </div>
      <div
        className={`text-[10px] mt-0.5 ${
          isCancelled(actualOrd)
            ? 'text-[var(--color-accent-pink)]'
            : isHit
              ? 'text-[var(--color-success)] font-bold'
              : 'text-[var(--color-text-disabled)]'
        }`}
      >
        {isCancelled(actualOrd) ? '🚫 출주 취소' : `실제 ${actualOrd}위${isHit ? ' ✓' : ''}`}
      </div>
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
