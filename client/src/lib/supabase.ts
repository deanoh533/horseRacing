/**
 * Supabase 클라이언트 (Frontend)
 *
 * ⚠️ Anon Key만 사용 (RLS로 보호)
 * - VITE_SUPABASE_URL: 프로젝트 URL
 * - VITE_SUPABASE_ANON_KEY: anon public 키
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '❌ Supabase 환경 변수 누락: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY'
  );
  console.error('client/.env 파일을 확인하세요');
}

export const supabase = createClient(
  SUPABASE_URL ?? 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY ?? 'placeholder',
  {
    auth: { persistSession: false },
  }
);

// ============================================
// 도메인 타입 (Supabase 응답)
// ============================================

export interface Race {
  race_date: number;
  meet: number;
  rc_no: number;
  rc_dist: number | null;
  rc_name: string | null;
  rc_day: string | null;
  track: string | null;
  track_type: string | null;
  weather: string | null;
  age_cond: string | null;
  prize_cond: string | null;
  chaksun1: number | null;
}

export interface HorseResult {
  race_date: number;
  meet: number;
  rc_no: number;
  chul_no: number;
  st_ord: number | null;
  hr_no: string;
  hr_name: string;
  age: number | null;
  sex: string | null;
  rating: number | null;
  rank_str: string | null;
  ord: number | null;
  rc_time: number | null;
  rc_dist: number | null;
  track: string | null;
  wg_budam: number | null;
  wg_hr: number | null;
  wg_hr_diff: number | null;
  wg_jk: number | null;
  win_odds: number | null;
  popularity: number | null;
  jk_no: string | null;
  jk_name: string | null;
  tr_no: string | null;
  tr_name: string | null;
}
