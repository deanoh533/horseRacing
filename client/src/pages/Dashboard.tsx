import { useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Loader2,
  Bot,
  ClipboardList,
  BarChart2,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useRacesByDate,
  useAvailableDates,
  usePredictionsByDate,
  useActiveModelVersion,
  useRecentArchives,
  useWeeklyPicks,
  useRaceEntriesByDate,
  useComboDividends,
  type PredictionPreview,
  type RaceEntryLite,
} from '../lib/queries';
import { winningComboPayouts } from '../lib/combos';
import { classifyPick } from '../lib/selectivePicks';
import { fmtScore } from '../lib/sectional';
import { isCancelled } from '../lib/supabase';

const MEET_NAMES: Record<number, string> = {
  1: '서울',
  3: '부산경남',
};

const RECENT_WINDOW = 50; // 최근 N경주 복승권 적중률 표본

/** 순위 메달 — 예측 TOP3 타일(예측 순위)과 결과 줄(실제 착순)이 공유 */
const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function Dashboard() {
  const { data: availableDates } = useAvailableDates();
  const { data: activeVersion } = useActiveModelVersion();
  // 선택 날짜는 URL 쿼리(?date=)에 저장 — 다른 화면(출마정보·예상지)으로
  // 이동했다 뒤로가기해도 대시보드가 리마운트되며 유실되지 않도록.
  // 쿼리 없으면 availableDates 가장 최근 → 그것도 없으면 오늘.
  const [searchParams, setSearchParams] = useSearchParams();
  const manualDate = searchParams.has('date')
    ? Number(searchParams.get('date'))
    : null;
  const dateNum =
    manualDate ?? availableDates?.[0] ?? rcDateFromDate(new Date());
  const setDateNum = (next: number) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('date', String(next));
        return params;
      },
      { replace: true },
    );
  };

  const { data: races, isLoading, error } = useRacesByDate(dateNum);
  const { data: predictions } = usePredictionsByDate(dateNum);
  const { data: entries } = useRaceEntriesByDate(dateNum);

  // 예측 타일 번호용: `${meet}-${rc_no}-${hr_name}` → pthr_no
  const pthrMap = useMemo(() => {
    const map = new Map<string, number>();
    (entries ?? []).forEach((e) => map.set(`${e.meet}-${e.rc_no}-${e.hr_name}`, e.pthr_no));
    return map;
  }, [entries]);

  // 결과 줄용: 경주별 실제 1·2·3착 (`${meet}-${rc_no}` → 착순 순서 배열)
  const podiumByRace = useMemo(() => {
    const map = new Map<string, RaceEntryLite[]>();
    (entries ?? []).forEach((e) => {
      if (e.ord == null || e.ord < 1 || e.ord > 3) return;
      const k = `${e.meet}-${e.rc_no}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    });
    map.forEach((arr) => arr.sort((a, b) => (a.ord as number) - (b.ord as number)));
    return map;
  }, [entries]);

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

  // 현 활성 모델은 로지스틱 → weights={}, 계수는 artifact. 가중치 숫자 대신
  // "최근 복승권 적중률 + 이번주 강추/주목 수"로 모델 상태를 요약한다.
  const { data: archives } = useRecentArchives(RECENT_WINDOW);
  const { data: upcoming } = useWeeklyPicks();

  // 최근 N경주 예측 1위가 3착 안에 든 비율 (바운드 쿼리 — egress 작음)
  const recentShow = useMemo(() => {
    const judged = (archives ?? []).filter((a) => a.actual_ord != null);
    if (judged.length === 0) return null;
    const inTop3 = judged.filter((a) => a.actual_ord! <= 3).length;
    return { rate: (inTop3 / judged.length) * 100, n: judged.length };
  }, [archives]);

  // 이번주(사전 예측) 강추·주목 마릿수
  const pickCounts = useMemo(() => {
    let strong = 0;
    let watch = 0;
    for (const p of upcoming ?? []) {
      const tier = classifyPick(p.p_top3);
      if (tier === 'strong') strong++;
      else if (tier === 'watch') watch++;
    }
    return { strong, watch };
  }, [upcoming]);

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

      {/* 예측 모델 요약 — 강추/주목 보기로 이동 */}
      <Link
        to="/picks"
        className="block bg-[var(--color-bg-surface)] rounded-xl p-5 border border-[var(--color-bg-elevated)] hover:border-[var(--color-accent-cyan)]/40 transition-colors"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span className="text-[var(--color-accent-gold)]">⭐</span>
            예측 모델
          </h2>
          {activeVersion && (
            <span className="text-[10px] text-[var(--color-text-disabled)]">
              적용 {activeVersion.label}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ModelStat
            label={`최근 ${recentShow?.n ?? RECENT_WINDOW}경주 복승권`}
            value={recentShow ? recentShow.rate.toFixed(1) : '-'}
            unit={recentShow ? '%' : ''}
            color="cyan"
          />
          <ModelStat label="이번주 강추" value={`${pickCounts.strong}`} unit="마리" color="gold" />
          <ModelStat label="이번주 주목" value={`${pickCounts.watch}`} unit="마리" color="pink" />
        </div>
        <div className="mt-3 text-[11px] text-[var(--color-accent-cyan)]">
          강추·주목 보기 →
        </div>
      </Link>

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
                      pthrMap={pthrMap}
                      podium={podiumByRace.get(`${race.meet}-${race.rc_no}`)}
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
  pthrMap: Map<string, number> | undefined;
  podium: RaceEntryLite[] | undefined; // 실제 1·2·3착 (착순 순)
}

function RaceCard({ race, predictions, pthrMap, podium }: RaceCardProps) {
  const dateStr = race.race_date.toString();
  const top3 = predictions.slice(0, 3);
  const hasResult = predictions.some((p) => p.actual_ord !== null);
  const predictionUrl = `/race/${race.meet}/${dateStr}/${race.rc_no}`;
  const entriesUrl = `/race/${race.meet}/${dateStr}/${race.rc_no}/entries`;
  const sheetUrl = `/race/${race.meet}/${dateStr}/${race.rc_no}/sheet`;

  // 결과 줄: 1착 말(단승) + 적중 복승·삼복승 배당
  const winner = podium?.find((p) => p.ord === 1);
  const gates = useMemo(() => (podium ?? []).map((p) => p.pthr_no), [podium]);
  const { data: combos } = useComboDividends(race.race_date, race.meet, race.rc_no, gates);
  const payouts = useMemo(
    () => (combos && combos.length > 0 && gates.length >= 2 ? winningComboPayouts(combos, gates) : []),
    [combos, gates]
  );
  const quinella = payouts.find((p) => p.pool === '복승식');
  const trio = payouts.find((p) => p.pool === '삼복승식');

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
                  pthrNo={pthrMap?.get(`${race.meet}-${race.rc_no}-${p.hr_name}`)}
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

      {/* 결과 줄 — 실제 1·2·3착 + 단승·복승·삼복승 배당 한 줄.
          말 이름은 whitespace-nowrap으로 중간에 안 끊기고, 줄이 넘치면 flex-wrap으로 접힌다.
          복승·삼복승은 combo_dividends지만 착순 게이트로 서버 필터해 경주당 ~19행만 온다
          (1000행 캡 수정 때 도입한 필터 — 대시보드에 올려도 부담 없음). */}
      {podium && podium.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--color-bg-elevated)] flex items-center gap-x-3 gap-y-1 text-xs flex-wrap">
          {podium.map((h) => (
            <span key={h.ord} className="whitespace-nowrap">
              <span className="mr-0.5">{MEDALS[h.ord as number]}</span>
              <span className="text-[var(--color-text-secondary)] font-mono-num">{h.ord}착 </span>
              <span className="font-semibold">
                <span className="text-[var(--color-text-disabled)] font-mono-num">{h.pthr_no}.</span>
                {h.hr_name}
              </span>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-3 font-mono-num text-[var(--color-text-secondary)] whitespace-nowrap">
            {winner?.win_odds != null && (
              <span>단승 <span className="text-[var(--color-text-primary)]">{winner.win_odds.toFixed(1)}</span></span>
            )}
            {quinella && (
              <span>복승 <span className="text-[var(--color-text-primary)]">{quinella.odds.toFixed(1)}</span></span>
            )}
            {trio && (
              <span>삼복승 <span className="text-[var(--color-text-primary)]">{trio.odds.toFixed(1)}</span></span>
            )}
          </span>
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
  pthrNo: number | undefined;
  totalScore: number;
  actualOrd: number | null;
  hasResult: boolean;
}

function PredictionTile({ rank, hrName, pthrNo, totalScore, actualOrd, hasResult }: PredictionTileProps) {
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
      <div className="text-lg leading-none">{MEDALS[rank]}</div>
      <div className="font-semibold w-full text-center mt-1 text-[13px] leading-tight break-keep">
        {pthrNo != null && (
          <span className="text-[var(--color-text-disabled)] font-mono-num">{pthrNo}.</span>
        )}
        {hrName}
      </div>
      <div className="text-xs text-[var(--color-accent-cyan)] mt-0.5">
        {fmtScore(totalScore)}점
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

function ModelStat({
  label,
  value,
  unit,
  color = 'cyan',
}: {
  label: string;
  value: string;
  unit: string;
  color?: 'cyan' | 'gold' | 'pink';
}) {
  const colorClass = {
    cyan: 'text-[var(--color-accent-cyan)]',
    gold: 'text-[var(--color-accent-gold)]',
    pink: 'text-[var(--color-accent-pink)]',
  }[color];
  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className={`text-2xl font-bold font-mono-num ${colorClass} mt-1`}>
        {value}
        <span className="text-sm">{unit}</span>
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
