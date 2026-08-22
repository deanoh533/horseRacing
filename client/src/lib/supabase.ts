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
  st_time: string | null;   // 발주 예정시각 (예: "출발 :10:45") — 출마표 sync가 채움
  chaksun1: number | null;
  chaksun2: number | null;
  chaksun3: number | null;
  chaksun4: number | null;
  chaksun5: number | null;
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
  rank_str: string | null;  // 한글 등급 (예: "국6등급")
  jcky_no: string | null;
  jcky_nm: string | null;
  trar_no: string | null;
  trar_nm: string | null;
  erng_sump: number | null; // 수득상금 통산
  erng_loy: number | null;  // 수득상금 최근 1년
  erng_lsm: number | null;  // 수득상금 최근 6개월
  prds: string | null;      // 출생지
  owner_nm: string | null;  // 마주
  sump_rcod_fplc: number | null; // 통산 1위
  sump_rcod_splc: number | null; // 통산 2위
  sump_rcod_tplc: number | null; // 통산 3위
  sump_rcod_sum: number | null;  // 통산 출주
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
  // 장구 (이번 경주 — race card에서 수집)
  asis_equip1: string | null;
  asis_equip2: string | null;
  asis_equip3: string | null;
  asis_equip4: string | null;
  asis_equip5: string | null;
  latst_bledg1: string | null;
  latst_bledg2: string | null;
  latst_trea1_txt: string | null;
  latst_trea2_txt: string | null;
  // 구간기록 — 부경 (부경 경주만 채워짐)
  bu_g1f_acc_time?: number | null;
  bu_g2f_acc_time?: number | null;
  bu_g3f_acc_time?: number | null;
  bu_g4f_acc_time?: number | null;
  bu_g6f_acc_time?: number | null;
  bu_g8f_acc_time?: number | null;
  bu_s1f_acc_time?: number | null;
  bu_g1f_ord?: number | null;
  bu_g2f_ord?: number | null;
  bu_g3f_ord?: number | null;
  bu_g4f_ord?: number | null;
  bu_g6f_ord?: number | null;
  bu_g8f_ord?: number | null;
  bu_s1f_ord?: number | null;
  // 구간기록 — 서울 (서울 경주만 채워짐)
  se_g1f_acc_time?: number | null;
  se_g3f_acc_time?: number | null;
  se_s1f_acc_time?: number | null;
  se_1c_acc_time?: number | null;
  se_2c_acc_time?: number | null;
  se_3c_acc_time?: number | null;
  se_4c_acc_time?: number | null;
  sj_g1f_ord?: number | null;
  sj_g3f_ord?: number | null;
  sj_s1f_ord?: number | null;
  sj_1c_ord?: number | null;
  sj_2c_ord?: number | null;
  sj_3c_ord?: number | null;
  sj_4c_ord?: number | null;
}

/** E-006: 등급+거리 특화 성적 집계 */
export interface GradeDistStat {
  total: number;
  wins: number;    // ord === 1
  places: number;  // ord <= 2
  shows: number;   // ord <= 3
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
  p_win: number | null;
  p_top3: number | null;
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

/**
 * 오늘 날짜를 race_date 형식(YYYYMMDD 숫자)으로 반환
 *  - TodayPicks 화면의 "오늘 이후 경주만" 필터 기준
 *  - docs/superpowers/plans/2026-07-11-v7-live-tracking.md Task 3
 */
export function getTodayRaceDate(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return parseInt(`${year}${month}${date}`, 10);
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
 * horses 테이블 — 말 정적 정보 (혈통 + 메타)
 */
export interface Horse {
  hr_no: string;
  hr_name: string;
  eng_hr_name: string | null;
  birthday: number | null;
  foalg_dt: string | null;
  sex: string | null;
  pcty_nm: string | null;       // 산지
  spcs_nm: string | null;       // 품종
  sire_hr_nm: string | null;    // 부마
  dam_hr_nm: string | null;     // 모마
  dam_sire_hr_nm: string | null; // 모부마
  dsa_bri_vl: number | null;
  dsa_clc_vl: number | null;
  dsa_ier_vl: number | null;
  dsa_prf_vl: number | null;
  dsa_coi_rt: number | null;
  dsidx_vl: number | null;
  last_updated: string | null;
}

/**
 * horse_sectional_ability VIEW (008 마이그레이션 — Step 4 Phase 1)
 *   마별 통산 구간 능력치. 거리-무관 차이값 기반.
 *   best_last_600m=막판 추격력, best_s1f=출발 가속력, surge_score 양수=추격형
 *
 *   [신규 — Step 4 주행 성향 분류용]
 *   avg_position_ratio: 출전두수 정규화 출발 위치 (0=1등, 1=꼴등)
 *   stddev_position_ratio: 스타일 안정성 (≥ 0.35 → 자유마)
 *   front_run_success_rate: 출발 상위 30% → 결승 상위 30% 비율
 */
export interface HorseSectionalAbility {
  hr_name: string;
  races: number;
  avg_s1f: number | null;
  best_s1f: number | null;
  avg_last_600m: number | null;
  best_last_600m: number | null;
  avg_last_200m: number | null;
  best_last_200m: number | null;
  avg_s1f_rank: number | null;
  avg_g3f_rank: number | null;
  avg_g1f_rank: number | null;
  surge_score: number | null;
  avg_ord: number | null;
  // Step 4 Phase 1 신규
  avg_position_ratio: number | null;
  stddev_position_ratio: number | null;
  front_run_success_rate: number | null;
}

/**
 * horse_running_style_by_distance VIEW (008 마이그레이션 — Step 4 Phase 3)
 *   거리 카테고리별 마별 주행 성향
 *   dist_category: 'short' (<1400m) / 'middle' (1400-1800m) / 'long' (>1800m)
 *   HAVING ≥ 2경주 (거리별이라 기준 완화)
 */
export interface HorseRunningStyleByDistance {
  hr_name: string;
  dist_category: 'short' | 'middle' | 'long';
  races: number;
  avg_position_ratio: number | null;
  stddev_position_ratio: number | null;
  avg_finish_ratio: number | null;
  avg_ord: number | null;
}

/**
 * race_sectional_stats VIEW (007 마이그레이션)
 *   경주별 페이스 표준 통계 (그 경주에서 가장 빠른 / 평균)
 */
export interface RaceSectionalStats {
  race_date: number;
  meet: number;
  rc_no: number;
  rc_dist: number | null;
  track_type: string | null;
  horses: number;
  best_last_600m: number | null;
  avg_last_600m: number | null;
  best_last_200m: number | null;
  avg_last_200m: number | null;
  best_s1f: number | null;
  avg_s1f: number | null;
}

/**
 * jockey_stats — 기수 통산 성적
 * 출처: jkpresult/getjkpresult (이미 구독, probe 검증됨)
 */
export interface JockeyStat {
  jcky_no: string;
  meet: number;               // 1=서울, 3=부산경남
  jcky_nm: string | null;
  race_cnt_t: number | null;  // 통산 출주 수
  first_cnt: number | null;   // 통산 1위 횟수
  second_cnt: number | null;  // 통산 2위 횟수
  third_cnt: number | null;   // 통산 3위 횟수
  win_rate_t: number | null;  // 통산 단승률 (%)
  qu_rate_t: number | null;   // 통산 입상률 (%)
  updated_at: string | null;
}

export interface ComboDividend {
  race_date: number;
  meet: number;
  rc_no: number;
  pool: string;
  leg1: number;
  leg2: number;
  leg3: number;
  odds: number;
}
