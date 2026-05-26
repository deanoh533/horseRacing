/**
 * React Query 훅 - Supabase 데이터 페칭
 */
import { useQuery } from '@tanstack/react-query';
import {
  supabase,
  type Race,
  type RaceEntry,
  type Prediction,
  type SectionalRecord,
  type TrainingLog,
  type JockeyStat,
} from './supabase';

/**
 * 특정 날짜의 모든 경주 (서울 + 부산경남)
 */
export function useRacesByDate(rcDate: number) {
  return useQuery({
    queryKey: ['races', rcDate],
    queryFn: async (): Promise<Race[]> => {
      const { data, error } = await supabase
        .from('races')
        .select('*')
        .eq('race_date', rcDate)
        .order('meet')
        .order('rc_no');

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000, // 5분
  });
}

/**
 * 특정 경주의 출전마들 (race_entries 기반 — 사전/사후 통합)
 */
export function useHorsesByRace(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['horses', rcDate, meet, rcNo],
    queryFn: async (): Promise<RaceEntry[]> => {
      const { data, error } = await supabase
        .from('race_entries')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo)
        .order('pthr_no');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 한 말의 과거 5경주 이력 (결과 있는 것만)
 */
export function useHorseHistory(hrName: string, beforeDate: number, limit = 5) {
  return useQuery({
    queryKey: ['horse-history', hrName, beforeDate, limit],
    queryFn: async (): Promise<RaceEntry[]> => {
      const { data, error } = await supabase
        .from('race_entries')
        .select('*')
        .eq('hr_name', hrName)
        .lt('race_date', beforeDate)
        .not('ord', 'is', null)
        .order('race_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!hrName,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * 가장 최근 가중치 (weight_history)
 */
export function useLatestWeights() {
  return useQuery({
    queryKey: ['weights', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weight_history')
        .select('*')
        .order('applied_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * 사용자 설정 (인사이트 지표 등)
 */
export function useUserSettings() {
  return useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * 특정 경주의 예측 결과 (Score Engine 사전 계산)
 */
export function usePredictionsByRace(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['predictions', rcDate, meet, rcNo],
    queryFn: async (): Promise<Prediction[]> => {
      const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo)
        .order('predicted_rank');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * 특정 날짜의 모든 경주 예측 (대시보드 미리보기용 - 부분 컬럼)
 */
export type PredictionPreview = Pick<
  Prediction,
  'race_date' | 'meet' | 'rc_no' | 'hr_name' | 'total_score' | 'predicted_rank' | 'actual_ord'
>;

export function usePredictionsByDate(rcDate: number) {
  return useQuery({
    queryKey: ['predictions-by-date', rcDate],
    queryFn: async (): Promise<PredictionPreview[]> => {
      const { data, error } = await supabase
        .from('predictions')
        .select('race_date, meet, rc_no, hr_name, total_score, predicted_rank, actual_ord')
        .eq('race_date', rcDate)
        .lte('predicted_rank', 3)
        .order('meet')
        .order('rc_no')
        .order('predicted_rank');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rcDate,
    staleTime: 10 * 60 * 1000,
  });
}

// ============================================
// 통계 페이지용 hooks
// ============================================

type MonthlyHitRate = {
  month: string; // 'YYYY-MM'
  total: number; // 유효 경주 수
  win: number;   // 단승 적중 수
  place: number; // 연승 (1~2위)
  show: number;  // 복승 (1~3위)
};

/**
 * 월별 적중률 추이
 *  - 모든 predictions 1위 vs actual_ord 비교 후 월 단위 group
 *  - period로 최근 N개월만 필터 (전체: null)
 */
export function useMonthlyHitRate(monthsBack: number | null = 12) {
  return useQuery({
    queryKey: ['monthly-hit-rate', monthsBack],
    queryFn: async (): Promise<MonthlyHitRate[]> => {
      // predictions 페이지네이션 fetch (1000 row limit 우회)
      const rows: { race_date: number; meet: number; rc_no: number; predicted_rank: number; actual_ord: number | null }[] = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supabase
          .from('predictions')
          .select('race_date, meet, rc_no, predicted_rank, actual_ord')
          .order('race_date')
          .order('meet')
          .order('rc_no')
          .range(off, off + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
      }

      // race 단위 group
      const byRace = new Map<string, typeof rows>();
      for (const r of rows) {
        const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
        if (!byRace.has(k)) byRace.set(k, []);
        byRace.get(k)!.push(r);
      }

      // 월 단위 적중률
      const byMonth = new Map<string, MonthlyHitRate>();
      for (const horses of byRace.values()) {
        const first = horses[0]!;
        const month = monthOf(first.race_date);
        const pred1 = horses.find((h) => h.predicted_rank === 1);
        if (!pred1 || pred1.actual_ord === null) continue;

        const m = byMonth.get(month) ?? { month, total: 0, win: 0, place: 0, show: 0 };
        m.total++;
        if (pred1.actual_ord === 1) m.win++;
        if (pred1.actual_ord <= 2) m.place++;
        if (pred1.actual_ord <= 3) m.show++;
        byMonth.set(month, m);
      }

      const sorted = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
      if (monthsBack === null) return sorted;
      return sorted.slice(-monthsBack);
    },
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * 가중치 학습 이력 (weight_history 시계열)
 */
export type WeightHistoryRow = {
  id: number;
  period_start: string; // YYYY-MM-DD
  period_end: string;
  race_count: number;
  weights: Record<string, number>;
  correlations: Record<string, number>;
  applied_at: string;
};

export function useWeightHistory(limit = 5) {
  return useQuery({
    queryKey: ['weight-history', limit],
    queryFn: async (): Promise<WeightHistoryRow[]> => {
      const { data, error } = await supabase
        .from('weight_history')
        .select('id, period_start, period_end, race_count, weights, correlations, applied_at')
        .order('applied_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as WeightHistoryRow[];
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * 17개 항목 상관계수 (최근 학습 결과)
 *  - weight_history 가장 최근 row의 correlations 사용
 */
export function useLatestCorrelations() {
  return useQuery({
    queryKey: ['latest-correlations'],
    queryFn: async (): Promise<Record<string, number> | null> => {
      const { data, error } = await supabase
        .from('weight_history')
        .select('correlations')
        .order('applied_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.correlations ?? null) as Record<string, number> | null;
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * 최근 경주별 적중 여부 (아카이브)
 */
export type ArchiveRow = {
  race_date: number;
  meet: number;
  rc_no: number;
  hit: boolean | null; // null = actual_ord 없음
  predicted_hr: string;
  actual_ord: number | null;
  total_score: number;
};

export function useRecentArchives(limit = 30) {
  return useQuery({
    queryKey: ['recent-archives', limit],
    queryFn: async (): Promise<ArchiveRow[]> => {
      // 최근 N race 가져오기 (predicted_rank=1만, 최신 경주순)
      const { data, error } = await supabase
        .from('predictions')
        .select('race_date, meet, rc_no, hr_name, actual_ord, total_score')
        .eq('predicted_rank', 1)
        .order('race_date', { ascending: false })
        .order('meet')
        .order('rc_no', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        race_date: r.race_date,
        meet: r.meet,
        rc_no: r.rc_no,
        predicted_hr: r.hr_name,
        actual_ord: r.actual_ord,
        total_score: r.total_score,
        hit: r.actual_ord === null ? null : r.actual_ord === 1,
      }));
    },
    staleTime: 10 * 60 * 1000,
  });
}

// ============================================
// 신규 API 훅 (P0b)
// ============================================

/**
 * 특정 경주의 구간별 통과기록
 * [TODO] sectional_records 테이블은 API37_1 구독 승인 후 데이터가 채워짐
 */
export function useSectionalRecords(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['sectional-records', rcDate, meet, rcNo],
    queryFn: async (): Promise<SectionalRecord[]> => {
      const { data, error } = await supabase
        .from('sectional_records')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo)
        .order('chul_no');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 60 * 60 * 1000, // 경기 후 기록은 변하지 않으므로 1시간 캐시
  });
}

/**
 * 특정 말의 최근 N일치 훈련 기록
 *
 * @param hrNo   말 번호 (예: "0050860")
 * @param daysBack 최근 며칠치 (기본 30)
 */
export function useHorseTraining(hrNo: string, daysBack = 30) {
  return useQuery({
    queryKey: ['horse-training', hrNo, daysBack],
    queryFn: async (): Promise<TrainingLog[]> => {
      const cutoff = getDateNDaysAgo(daysBack);
      const { data, error } = await supabase
        .from('training_logs')
        .select('*')
        .eq('hr_no', hrNo)
        .gte('train_date', cutoff)
        .order('train_date', { ascending: false })
        .order('part', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!hrNo,
    staleTime: 30 * 60 * 1000, // 30분 캐시
  });
}

/**
 * 기수 성적 조회
 * [TODO] jockey_stats 테이블은 jkresult API 구독 승인 후 데이터가 채워짐
 *
 * @param jckyNo 기수 번호 (예: "051174")
 */
export function useJockeyStats(jckyNo: string) {
  return useQuery({
    queryKey: ['jockey-stats', jckyNo],
    queryFn: async (): Promise<JockeyStat | null> => {
      const { data, error } = await supabase
        .from('jockey_stats')
        .select('*')
        .eq('jcky_no', jckyNo)
        .maybeSingle();

      if (error) throw error;
      return data ?? null;
    },
    enabled: !!jckyNo,
    staleTime: 24 * 60 * 60 * 1000, // 기수 성적은 하루 캐시
  });
}

/**
 * N일 전 날짜를 YYYYMMDD 숫자로 반환
 */
function getDateNDaysAgo(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return parseInt(`${y}${m}${day}`, 10);
}

function monthOf(rcDate: number): string {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100);
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ============================================
// 통계 (race_entries 기반)
// ============================================

/**
 * 수득상금 구간별 단승 적중률
 *  - race_entries (hr_name, erng_sump) JOIN predictions (hr_name)
 *  - 구간: 0 / 1~100만 / 100~1000만 / 1000만~1억 / 1억+
 */
export type EarningsBucket = {
  label: string;
  range: string;
  count: number; // 예측 1위 row 수
  hits: number;  // 그중 실제 1위
  rate: number;  // %
};

export function useEarningsHitRate() {
  return useQuery({
    queryKey: ['earnings-hit-rate'],
    queryFn: async (): Promise<EarningsBucket[]> => {
      // race_entries에서 erng_sump 조회 (race_cards 불필요)
      type EntryRow = { race_date: number; meet: number; rc_no: number; hr_name: string; erng_sump: number | null };
      const entries: EntryRow[] = [];
      for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase
          .from('race_entries')
          .select('race_date, meet, rc_no, hr_name, erng_sump')
          .order('race_date')
          .order('meet')
          .order('rc_no')
          .order('hr_name')
          .range(off, off + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        entries.push(...data);
        if (data.length < 1000) break;
      }

      // 예측 1위 row 가져오기
      type PredRow = { race_date: number; meet: number; rc_no: number; hr_name: string; actual_ord: number | null };
      const preds: PredRow[] = [];
      for (let off = 0; ; off += 1000) {
        const { data, error } = await supabase
          .from('predictions')
          .select('race_date, meet, rc_no, hr_name, actual_ord')
          .eq('predicted_rank', 1)
          .order('race_date')
          .order('meet')
          .order('rc_no')
          .range(off, off + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        preds.push(...data);
        if (data.length < 1000) break;
      }

      const entryKey = (r: { race_date: number; meet: number; rc_no: number; hr_name: string }) =>
        `${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`;
      const entryMap = new Map<string, EntryRow>();
      entries.forEach((e) => entryMap.set(entryKey(e), e));

      const buckets: EarningsBucket[] = [
        { label: '미입상', range: '0원', count: 0, hits: 0, rate: 0 },
        { label: '입문급', range: '1~100만', count: 0, hits: 0, rate: 0 },
        { label: '중수', range: '100~1000만', count: 0, hits: 0, rate: 0 },
        { label: '상수', range: '1000만~1억', count: 0, hits: 0, rate: 0 },
        { label: '최상위', range: '1억+', count: 0, hits: 0, rate: 0 },
      ];

      for (const p of preds) {
        if (p.actual_ord === null) continue;
        const entry = entryMap.get(entryKey(p));
        if (!entry || entry.erng_sump === null) continue;
        const e = entry.erng_sump;
        let idx: number;
        if (e === 0) idx = 0;
        else if (e < 1_000_000) idx = 1;
        else if (e < 10_000_000) idx = 2;
        else if (e < 100_000_000) idx = 3;
        else idx = 4;
        buckets[idx]!.count++;
        if (p.actual_ord === 1) buckets[idx]!.hits++;
      }

      buckets.forEach((b) => {
        b.rate = b.count > 0 ? (b.hits / b.count) * 100 : 0;
      });
      return buckets;
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * race_entries 데이터 커버리지 (디버그/모니터링용)
 */
export function useRaceCardsCoverage() {
  return useQuery({
    queryKey: ['race-entries-coverage'],
    queryFn: async () => {
      const { count: entryCount } = await supabase
        .from('race_entries')
        .select('*', { count: 'exact', head: true });
      const { data: dateRange } = await supabase
        .from('race_entries')
        .select('race_date')
        .order('race_date', { ascending: false })
        .limit(1);
      const { data: dateRangeStart } = await supabase
        .from('race_entries')
        .select('race_date')
        .order('race_date', { ascending: true })
        .limit(1);
      const { count: injuredCount } = await supabase
        .from('race_entries')
        .select('*', { count: 'exact', head: true })
        .not('latst_trea1_txt', 'is', null);
      return {
        totalRows: entryCount ?? 0,
        injuredRows: injuredCount ?? 0,
        latestDate: dateRange?.[0]?.race_date ?? null,
        earliestDate: dateRangeStart?.[0]?.race_date ?? null,
      };
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * DB에 데이터 있는 날짜 목록 (대시보드 날짜 선택용)
 */
export function useAvailableDates() {
  return useQuery({
    queryKey: ['available-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('races')
        .select('race_date')
        .order('race_date', { ascending: false });

      if (error) throw error;
      const dates = Array.from(new Set((data ?? []).map((r) => r.race_date)));
      return dates;
    },
    staleTime: 60 * 60 * 1000,
  });
}
