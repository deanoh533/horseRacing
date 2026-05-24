/**
 * React Query 훅 - Supabase 데이터 페칭
 */
import { useQuery } from '@tanstack/react-query';
import { supabase, type Race, type HorseResult } from './supabase';

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
 * 특정 경주의 출전마들
 */
export function useHorsesByRace(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['horses', rcDate, meet, rcNo],
    queryFn: async (): Promise<HorseResult[]> => {
      const { data, error } = await supabase
        .from('horse_results')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo)
        .order('chul_no');

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 한 말의 과거 5경주 이력
 */
export function useHorseHistory(hrName: string, beforeDate: number, limit = 5) {
  return useQuery({
    queryKey: ['horse-history', hrName, beforeDate, limit],
    queryFn: async (): Promise<HorseResult[]> => {
      const { data, error } = await supabase
        .from('horse_results')
        .select('*')
        .eq('hr_name', hrName)
        .lt('race_date', beforeDate)
        .order('race_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!hrName,
    staleTime: 60 * 60 * 1000, // 1시간
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
