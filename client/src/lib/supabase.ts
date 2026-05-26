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

/** race_entries 통합 테이블 (사전 + 사후) */
export interface RaceEntry {
  race_date: number;
  meet: number;
  rc_no: number;
  pthr_no: number;          // 게이트 번호 (= chul_no)
  hr_name: string;
  ag: number | null;        // 연령
  gndr: string | null;      // 성별
  burd_wgt: number | null;  // 부담중량
  ratg: number | null;      // 레이팅
  jcky_no: string | null;
  jcky_nm: string | null;
  trar_no: string | null;
  trar_nm: string | null;
  erng_sump: number | null; // 수득상금 통산
  rc_dist: number | null;   // 경주 거리 (사후에 채워짐)
  track_type: string | null; // 주로 (사후에 채워짐)
  // 사후 결과 (경기 후 채워짐, 경기 전은 null)
  hr_no: string | null;
  ord: number | null;       // 최종 착순
  rc_time: number | null;
  wg_hr: number | null;
  wg_hr_diff: number | null;
  wg_jk: number | null;
  win_odds: number | null;
  popularity: number | null;
  result_at: string | null;
}

/** @deprecated race_entries로 대체됨 — 기존 코드 호환용 alias */
export type HorseResult = RaceEntry;

export interface ItemScore {
  itemId: string;
  itemName: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  status: 'implemented' | 'expert_pending';
}

export interface Prediction {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  total_score: number;
  predicted_rank: number;
  item_scores: Record<string, ItemScore>;
  actual_ord: number | null;
}

/**
 * 실제 착순 표시 라벨
 * - 숫자 → "N위"
 * - null → "출주 취소" (KRA 비주파 코드 정제됨)
 */
export function formatActualOrd(ord: number | null): string {
  return ord === null ? '출주 취소' : `${ord}위`;
}

export function isCancelled(ord: number | null): boolean {
  return ord === null;
}

// ============================================
// 신규 API 테이블 타입 (P0b)
// ============================================

/**
 * sectional_records — 경주 후 구간별 통과기록
 * [TODO] API37_1/sectionRecord_1 — 현재 403. 실제 필드 확인 후 수정 필요.
 */
export interface SectionalRecord {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_no: string;
  hr_name: string | null;
  chul_no: number | null;
  ord: number | null;
  bu_g1f_acc_time: number | null;
  bu_g2f_acc_time: number | null;
  bu_g3f_acc_time: number | null;
  bu_g4f_acc_time: number | null;
  bu_g6f_acc_time: number | null;
  bu_g8f_acc_time: number | null;
  bu_s1f_acc_time: number | null;
  bu_g1f_ord: number | null;
  bu_g2f_ord: number | null;
  bu_g3f_ord: number | null;
  bu_g4f_ord: number | null;
  bu_s1f_ord: number | null;
  fetched_at: string | null;
}

/**
 * training_logs — 일별 훈련 정보
 * (API18_1/dailyTraining_1 — 검증됨)
 */
export interface TrainingLog {
  train_date: number;
  meet: number;
  hr_no: string;
  part: number;
  hr_name: string | null;
  trar_nm: string | null;
  part_no: number | null;
  chul_gubun: string | null;
  pr_gubun: string | null;
  pr_no: string | null;
  run1_cnt: number | null;
  run2_cnt: number | null;
  st_time: number | null;
  sp_time: number | null;
  tr_term: number | null;
  fetched_at: string | null;
}

/**
 * jockey_stats — 기수별 성적
 * [TODO] jkresult API — 현재 500. 실제 필드 확인 후 수정 필요.
 */
export interface JockeyStat {
  jcky_no: string;
  meet: number | null;
  jcky_nm: string | null;
  total_races: number | null;
  win1: number | null;
  win2: number | null;
  win3: number | null;
  win_rate: number | null;
  plc_rate: number | null;
  loy1: number | null;
  loy2: number | null;
  lsm1: number | null;
  lsm2: number | null;
  updated_at: string | null;
}
