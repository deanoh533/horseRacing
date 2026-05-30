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
  type HorseSectionalAbility,
  type HorseRunningStyleByDistance,
  type RaceSectionalStats,
  type Horse,
  type GradeDistStat,
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
 * 한 경주 출전마 전체의 최근 조교 기록 (예상지 일괄 조회용)
 * - hr_name 기준 조회 (사전 엔트리에 hr_no가 없을 수 있음)
 * - 말별 최신 기록 우선 (train_date desc, part desc)
 */
export function useTrainingBatchByNames(hrNames: string[], meet: number, daysBack = 30) {
  return useQuery({
    queryKey: ['training-batch-names', meet, hrNames.slice().sort().join(',')],
    queryFn: async (): Promise<Map<string, TrainingLog[]>> => {
      if (hrNames.length === 0) return new Map();
      const cutoff = getDateNDaysAgo(daysBack);
      const { data, error } = await supabase
        .from('training_logs')
        .select('*')
        .in('hr_name', hrNames)
        .eq('meet', meet)
        .gte('train_date', cutoff)
        .order('train_date', { ascending: false })
        .order('part', { ascending: false });
      if (error) throw error;
      const map = new Map<string, TrainingLog[]>();
      for (const r of data ?? []) {
        if (!r.hr_name) continue;
        const arr = map.get(r.hr_name) ?? [];
        arr.push(r);
        map.set(r.hr_name, arr);
      }
      return map;
    },
    enabled: hrNames.length > 0 && meet > 0,
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * 기수 통산 성적 조회 (meet별로 여러 row 가능)
 *
 * @param jckyNo 기수 번호 (예: "051174")
 * @param meet 1=서울, 3=부산경남. 생략 시 양쪽 모두
 */
export function useJockeyStats(jckyNo: string, meet?: number) {
  return useQuery({
    queryKey: ['jockey-stats', jckyNo, meet],
    queryFn: async (): Promise<JockeyStat[]> => {
      let q = supabase.from('jockey_stats').select('*').eq('jcky_no', jckyNo);
      if (meet != null) q = q.eq('meet', meet);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!jckyNo,
    staleTime: 24 * 60 * 60 * 1000, // 기수 성적은 하루 캐시
  });
}

// ============================================
// 구간기록 분석 view (007 마이그레이션)
// ============================================

/**
 * 마별 통산 구간 능력치 조회 (horse_sectional_ability view)
 *  - best_last_600m: 막판 추격력 (작을수록 빠름)
 *  - best_s1f:       출발 가속력 (작을수록 빠름)
 *  - surge_score:    양수=추격형, 음수=선행형
 *  - avg_ord:        평균 착순 (참고)
 */
export function useHorseSectionalAbility(hrName: string) {
  return useQuery({
    queryKey: ['horse-sectional-ability', hrName],
    queryFn: async (): Promise<HorseSectionalAbility | null> => {
      const { data, error } = await supabase
        .from('horse_sectional_ability')
        .select('*')
        .eq('hr_name', hrName)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!hrName,
    staleTime: 60 * 60 * 1000, // 1시간 캐시
  });
}

/**
 * 한 경주 출전마 전체의 구간 능력치 (펼침 영역에서 출전마 비교용)
 */
export function useHorseSectionalAbilityByNames(hrNames: string[]) {
  return useQuery({
    queryKey: ['horse-sectional-ability-batch', hrNames.slice().sort().join(',')],
    queryFn: async (): Promise<HorseSectionalAbility[]> => {
      if (hrNames.length === 0) return [];
      const { data, error } = await supabase
        .from('horse_sectional_ability')
        .select('*')
        .in('hr_name', hrNames);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hrNames.length > 0,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * 거리 카테고리별 마별 주행 성향 (horse_running_style_by_distance view)
 *  - 한 말이 short/middle/long 거리에서 다른 ratio 보일 수 있음
 *  - 펼침 영역 "거리별 성향" 표시용
 */
export function useHorseRunningStyleByDistance(hrName: string) {
  return useQuery({
    queryKey: ['horse-running-style-by-distance', hrName],
    queryFn: async (): Promise<HorseRunningStyleByDistance[]> => {
      const { data, error } = await supabase
        .from('horse_running_style_by_distance')
        .select('*')
        .eq('hr_name', hrName);
      if (error) throw error;
      return (data ?? []) as HorseRunningStyleByDistance[];
    },
    enabled: !!hrName,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * 경주별 페이스 표준 통계 (race_sectional_stats view)
 *  - "그 경주가 빠른 페이스였는지" 판단
 *  - best_last_600m=그 경주의 막판 600m 최단 / avg=평균
 */
export function useRaceSectionalStats(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['race-sectional-stats', rcDate, meet, rcNo],
    queryFn: async (): Promise<RaceSectionalStats | null> => {
      const { data, error } = await supabase
        .from('race_sectional_stats')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * 말의 혈통·메타 정보 (horses 테이블)
 */
export function useHorseInfo(hrNo: string) {
  return useQuery({
    queryKey: ['horse-info', hrNo],
    queryFn: async (): Promise<Horse | null> => {
      const { data, error } = await supabase
        .from('horses')
        .select('*')
        .eq('hr_no', hrNo)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!hrNo,
    staleTime: 24 * 60 * 60 * 1000, // 정적 정보는 하루 캐시
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
// 예상지 전용 배치 훅
// ============================================

/**
 * 조교사 통산 성적 배치 조회 (race_entries 직접 집계, 최근 2년)
 * trainer_stats 테이블 없음 — race_entries에서 on-demand 집계
 */
export function useTrainerStatsBatch(trainerNames: string[]) {
  return useQuery({
    queryKey: ['trainer-stats-batch', trainerNames.slice().sort().join(',')],
    queryFn: async (): Promise<Map<string, { total: number; wins: number }>> => {
      if (trainerNames.length === 0) return new Map();
      const cutoff = getDateNDaysAgo(730);
      const { data, error } = await supabase
        .from('race_entries')
        .select('trar_nm, ord')
        .in('trar_nm', trainerNames)
        .gte('race_date', cutoff)
        .not('ord', 'is', null);
      if (error) throw error;
      const map = new Map<string, { total: number; wins: number }>();
      for (const r of data ?? []) {
        if (!r.trar_nm) continue;
        const s = map.get(r.trar_nm) ?? { total: 0, wins: 0 };
        s.total++;
        if (r.ord === 1) s.wins++;
        map.set(r.trar_nm, s);
      }
      return map;
    },
    enabled: trainerNames.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * 기수 통산 성적 배치 조회 (jockey_stats 테이블, 59명 커버)
 * 커버 외 기수는 Map에 없음 — UI에서 조건부 표시
 */
export function useJockeyStatsBatch(jckyNos: string[], meet: number) {
  return useQuery({
    queryKey: ['jockey-stats-batch', meet, jckyNos.slice().sort().join(',')],
    queryFn: async (): Promise<Map<string, JockeyStat>> => {
      if (jckyNos.length === 0) return new Map();
      const { data, error } = await supabase
        .from('jockey_stats')
        .select('*')
        .in('jcky_no', jckyNos)
        .eq('meet', meet);
      if (error) throw error;
      const map = new Map<string, JockeyStat>();
      (data ?? []).forEach((s) => map.set(s.jcky_no, s));
      return map;
    },
    enabled: jckyNos.length > 0 && !!meet,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * 기수 최근 N일 성적 (race_entries 집계)
 * - JockeyPanel에서 "최근 3개월 폼" 표시에 사용
 * - meet 기준 필터: 서울/부경 분리
 */
export function useJockeyRecentForm(
  jckyNo: string,
  meet: number,
  daysBack = 90
) {
  return useQuery({
    queryKey: ['jockey-recent-form', jckyNo, meet, daysBack],
    queryFn: async (): Promise<{ total: number; wins: number; places: number; shows: number } | null> => {
      const cutoff = getDateNDaysAgo(daysBack);
      const { data, error } = await supabase
        .from('race_entries')
        .select('ord')
        .eq('jcky_no', jckyNo)
        .eq('meet', meet)
        .gte('race_date', cutoff)
        .not('ord', 'is', null);
      if (error) throw error;
      const items = data ?? [];
      if (items.length === 0) return null;
      return {
        total: items.length,
        wins: items.filter((r) => r.ord === 1).length,
        places: items.filter((r) => r.ord != null && r.ord <= 2).length,
        shows: items.filter((r) => r.ord != null && r.ord <= 3).length,
      };
    },
    enabled: !!jckyNo && !!meet,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * 해당 등급/거리 우승마 평균·최고 기록
 * race_entries JOIN races (Supabase 관계 필터) — migration 불필요
 * 3경주 미만이면 null 반환
 */
export function useGradeWinnerStats(prizeCond: string | null, rcDist: number | null) {
  return useQuery({
    queryKey: ['grade-winner-stats', prizeCond, rcDist],
    queryFn: async (): Promise<{ avg: number; best: number; count: number; avgBurdWgt: number | null } | null> => {
      if (!prizeCond || !rcDist) return null;
      const { data, error } = await supabase
        .from('race_entries')
        .select('rc_time, burd_wgt, races!inner(prize_cond, rc_dist)')
        .eq('ord', 1)
        .not('rc_time', 'is', null)
        .filter('races.prize_cond', 'eq', prizeCond)
        .filter('races.rc_dist', 'eq', rcDist);
      if (error) throw error;
      const items = (data ?? []).filter((r: any) => (r.rc_time as number) > 0);
      if (items.length < 3) return null;
      const times = items.map((r: any) => r.rc_time as number);
      const wgts = items
        .map((r: any) => r.burd_wgt as number | null)
        .filter((w): w is number => w != null && w > 0);
      return {
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        best: Math.min(...times),
        count: items.length,
        avgBurdWgt: wgts.length > 0 ? wgts.reduce((a, b) => a + b, 0) / wgts.length : null,
      };
    },
    enabled: !!prizeCond && !!rcDist,
    staleTime: 24 * 60 * 60 * 1000,
  });
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
 * 조교사 단건 성적 조회 (최근 2년, race_entries 집계)
 */
export function useTrainerStats(trainerName: string) {
  return useQuery({
    queryKey: ['trainer-stats', trainerName],
    queryFn: async (): Promise<{ total: number; wins: number; places: number; shows: number } | null> => {
      if (!trainerName) return null;
      const cutoff = getDateNDaysAgo(730);
      const { data, error } = await supabase
        .from('race_entries')
        .select('ord')
        .eq('trar_nm', trainerName)
        .gte('race_date', cutoff)
        .not('ord', 'is', null);
      if (error) throw error;
      const items = data ?? [];
      return {
        total: items.length,
        wins: items.filter((r) => r.ord === 1).length,
        places: items.filter((r) => r.ord != null && r.ord <= 2).length,
        shows: items.filter((r) => r.ord != null && r.ord <= 3).length,
      };
    },
    enabled: !!trainerName,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * E-002: 기수-말 조합 이력 배치 조회
 * - 여러 (hrName, jckyNm) 쌍의 역대 성적 (승·연·복 포함)
 * - key: "${hrName}:${jckyNm}"
 */
export type JockeyHorseComboStat = { total: number; wins: number; places: number; shows: number };

export function useJockeyHorseComboBatch(
  combos: Array<{ hrName: string; jckyNm: string }>
) {
  const hrNames = [...new Set(combos.map((c) => c.hrName))];
  const jckyNms = [...new Set(combos.map((c) => c.jckyNm))];
  const key = combos.map((c) => `${c.hrName}:${c.jckyNm}`).sort().join(',');
  return useQuery({
    queryKey: ['jockey-horse-combo-batch', key],
    queryFn: async (): Promise<Map<string, JockeyHorseComboStat>> => {
      if (combos.length === 0) return new Map();
      const { data, error } = await supabase
        .from('race_entries')
        .select('hr_name, jcky_nm, ord')
        .in('hr_name', hrNames)
        .in('jcky_nm', jckyNms)
        .not('ord', 'is', null);
      if (error) throw error;
      const validKeys = new Set(combos.map((c) => `${c.hrName}:${c.jckyNm}`));
      const map = new Map<string, JockeyHorseComboStat>();
      for (const r of data ?? []) {
        if (!r.hr_name || !r.jcky_nm) continue;
        const k = `${r.hr_name}:${r.jcky_nm}`;
        if (!validKeys.has(k)) continue;
        const s = map.get(k) ?? { total: 0, wins: 0, places: 0, shows: 0 };
        s.total++;
        if (r.ord === 1) s.wins++;
        if (r.ord != null && r.ord <= 2) s.places++;
        if (r.ord != null && r.ord <= 3) s.shows++;
        map.set(k, s);
      }
      return map;
    },
    enabled: combos.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * E-003: 게이트(pthr_no)별 통산 성적 배치 조회
 * - 여러 말의 게이트별 역대 성적
 * - key: hrName → Map<pthr_no, { total, wins }>
 */
export function useHorseGateStatsBatch(hrNames: string[]) {
  return useQuery({
    queryKey: ['horse-gate-stats-batch', hrNames.slice().sort().join(',')],
    queryFn: async (): Promise<Map<string, Map<number, { total: number; wins: number }>>> => {
      if (hrNames.length === 0) return new Map();
      const { data, error } = await supabase
        .from('race_entries')
        .select('hr_name, pthr_no, ord')
        .in('hr_name', hrNames)
        .not('ord', 'is', null);
      if (error) throw error;
      const map = new Map<string, Map<number, { total: number; wins: number }>>();
      for (const r of data ?? []) {
        if (!r.hr_name || r.pthr_no == null) continue;
        if (!map.has(r.hr_name)) map.set(r.hr_name, new Map());
        const gm = map.get(r.hr_name)!;
        const s = gm.get(r.pthr_no) ?? { total: 0, wins: 0 };
        s.total++;
        if (r.ord === 1) s.wins++;
        gm.set(r.pthr_no, s);
      }
      return map;
    },
    enabled: hrNames.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * 히스토리 경주들의 prize_cond 배치 조회
 * - ColHistory에서 경기조건 컬럼 표시에 사용
 * - key: `${race_date}-${meet}-${rc_no}` → prize_cond
 */
export function useHistoryRacesPrizeCond(
  keys: Array<{ race_date: number; meet: number; rc_no: number }>
) {
  const sortedKey = keys
    .map((k) => `${k.race_date}-${k.meet}-${k.rc_no}`)
    .sort()
    .join(',');

  return useQuery({
    queryKey: ['history-races-prize-cond', sortedKey],
    queryFn: async (): Promise<Map<string, string>> => {
      const uniqueKeys = [...new Map(keys.map((k) => [`${k.race_date}-${k.meet}-${k.rc_no}`, k])).values()];

      const { data, error } = await supabase
        .from('races')
        .select('race_date, meet, rc_no, prize_cond')
        .in('race_date', [...new Set(uniqueKeys.map((k) => k.race_date))])
        .in('meet', [...new Set(uniqueKeys.map((k) => k.meet))])
        .in('rc_no', [...new Set(uniqueKeys.map((k) => k.rc_no))]);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of data ?? []) {
        if (r.prize_cond) {
          map.set(`${r.race_date}-${r.meet}-${r.rc_no}`, r.prize_cond);
        }
      }
      return map;
    },
    enabled: keys.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
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

/**
 * E-006: 등급+거리 특화 성적 배치 조회
 * - 현재 경주와 동일한 prize_cond + rc_dist 에서의 전체 이력 집계
 * - 2단계 쿼리: races(prize_cond 필터) → race_entries(hrName+dist 필터) → 클라이언트 교집합
 * - key: hrName → GradeDistStat
 */
export function useHorseGradeDistStatsBatch(
  hrNames: string[],
  prizeCond: string | null,
  rcDist: number | null
) {
  const sortedNames = hrNames.slice().sort().join(',');
  return useQuery({
    queryKey: ['horse-grade-dist-stats', sortedNames, prizeCond ?? '', rcDist ?? 0],
    queryFn: async (): Promise<Map<string, GradeDistStat>> => {
      if (hrNames.length === 0 || !prizeCond || !rcDist) return new Map();

      // 1단계: prize_cond 일치 경주 키 목록
      const { data: matchingRaces, error: e1 } = await supabase
        .from('races')
        .select('race_date, meet, rc_no')
        .eq('prize_cond', prizeCond)
        .eq('rc_dist', rcDist);
      if (e1) throw e1;
      if (!matchingRaces || matchingRaces.length === 0) return new Map();

      const raceSet = new Set(
        matchingRaces.map((r) => `${r.race_date}-${r.meet}-${r.rc_no}`)
      );

      // 2단계: 해당 말들의 같은 거리 경주 결과
      const { data: entries, error: e2 } = await supabase
        .from('race_entries')
        .select('hr_name, race_date, meet, rc_no, ord')
        .in('hr_name', hrNames)
        .eq('rc_dist', rcDist)
        .not('ord', 'is', null);
      if (e2) throw e2;

      // 3단계: race 키 교집합 필터 후 집계
      const map = new Map<string, GradeDistStat>();
      for (const e of entries ?? []) {
        if (!e.hr_name || e.ord == null) continue;
        const key = `${e.race_date}-${e.meet}-${e.rc_no}`;
        if (!raceSet.has(key)) continue;

        const s = map.get(e.hr_name) ?? { total: 0, wins: 0, places: 0, shows: 0 };
        s.total++;
        if (e.ord === 1) s.wins++;
        if (e.ord <= 2) s.places++;
        if (e.ord <= 3) s.shows++;
        map.set(e.hr_name, s);
      }
      return map;
    },
    enabled: hrNames.length > 0 && !!prizeCond && !!rcDist,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
