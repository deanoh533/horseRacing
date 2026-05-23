/**
 * KRA Analyzer - 공통 타입 정의
 */

// ============================================
// KRA API 응답 타입
// ============================================

/** API214_1 응답 - 경주 결과 (말 단위) */
export interface KRARaceResult {
  age: number;
  ageCond: string;
  birthday: number;
  budam: string;
  chulNo: number;
  diffUnit: string | number;
  hrName: string;
  hrNo: string;
  hrTool: string;
  ilsu: number;
  jkName: string;
  jkNo: string;
  meet: string;
  name: string;          // 산지
  ord: number;           // 착순
  ordBigo: string;
  owName: string;
  owNo: number | string;
  plcOdds: number;
  prizeCond: string;
  rank: string;          // 등급
  rankRise: number;
  rating: number;
  rcDate: number;
  rcDay: string;
  rcDist: number;
  rcName: string;
  rcNo: number;
  rcTime: number;
  sex: string;
  trName: string;
  trNo: string;
  track: string;
  weather: string;
  wgBudam: number;
  wgBudamBigo: string;
  wgHr: string;          // "463(+3)"
  wgJk: number;
  winOdds: number;
  // 구간별 시간/순위
  buG1fAccTime?: number;
  buG2fAccTime?: number;
  buG3fAccTime?: number;
  buG4fAccTime?: number;
  buG6fAccTime?: number;
  buG8fAccTime?: number;
  buS1fAccTime?: number;
  buG1fOrd?: number;
  buG2fOrd?: number;
  buG3fOrd?: number;
  buG4fOrd?: number;
  buS1fOrd?: number;
  // 상금
  chaksun1?: number;
  chaksun2?: number;
  chaksun3?: number;
}

/** racedetailresult 응답 - stOrd 포함 */
export interface KRARaceDetail {
  age: string;
  chulNo: number;
  stOrd: number;         // 실제 출발번호 ⭐
  hrName: string;
  hrNo: string;
  hrRating: number;
  jkName: string;
  jkNo: string;
  meet: string;
  rcDate: number;
  rcNo: number;
  rcTime: string;
  sex: string;
  trName: string;
  trNo: string;
  wgBudam: number;
  wgHr: number;
  win: number;
  plc: number;
  df: number;
  differ: string | number;
}

/** API284 응답 - 혈통 지수 */
export interface KRABloodInfo {
  hrno: string;
  korHrnm: string;
  engHrnm: string;
  dsaBriVl: number;
  dsaClcVl: number;
  dsaIerVl: number;
  dsaPrfVl: number;
  dsaCoiRt: number;
  dsaCtdIndxVl: number;
  dsidxVl: number;
  foalgDt: number;
}

/** horseinfohi 응답 - 말 정보 + 부마/모마 */
export interface KRAHorseInfo {
  hrno: string;
  korHrnm: string;
  sireHrnm: string;     // 부마
  damHrnm: string;      // 모마
  spcsNm: string;       // 품종
  pctyNm: string;       // 산지
  gndrNm: string;       // 성별
  foalgDt: string;
}

// ============================================
// 도메인 타입
// ============================================

export type MeetCode = 1 | 3; // 1=서울, 3=부산경남

export interface RaceKey {
  rcDate: number;
  meet: MeetCode;
  rcNo: number;
}

export interface ParsedWeight {
  weight: number;
  diff: number;
}

// ============================================
// 17개 항목 ID
// ============================================

export const SCORE_ITEM_IDS = [
  '01_rating',
  '02_weight_change',
  '03_recent_form',
  '04_sectional_time',
  '05_late_position',
  '06_distance_fitness',
  '07_track_adaptation',
  '08_burden_weight',
  '09_jockey_form',
  '10_trainer_form',
  '11_race_interval',
  '12_starting_position',
  '13_age_distance_gender',
  '14_pedigree',
  '15_seasonal_pattern',
  '16_jockey_horse_chemistry',
  '17_market_odds',
] as const;

export type ScoreItemId = typeof SCORE_ITEM_IDS[number];

/** 17개 항목 비중 (총 100점) */
export const ITEM_WEIGHTS: Record<ScoreItemId, number> = {
  '01_rating': 17.54,
  '02_weight_change': 4.21,
  '03_recent_form': 4.21,
  '04_sectional_time': 2.37,
  '05_late_position': 2.37,
  '06_distance_fitness': 8.77,
  '07_track_adaptation': 8.77,
  '08_burden_weight': 4.39,
  '09_jockey_form': 10.53,
  '10_trainer_form': 7.02,
  '11_race_interval': 3.51,
  '12_starting_position': 2.63,
  '13_age_distance_gender': 2.63,
  '14_pedigree': 4.39,
  '15_seasonal_pattern': 4.39,
  '16_jockey_horse_chemistry': 3.51,
  '17_market_odds': 8.77,
};

export interface HorseScore {
  hrName: string;
  hrNo: string;
  totalScore: number;          // 0-100
  itemScores: Record<ScoreItemId, number>;  // 각 항목 0-1.0
  itemContributions: Record<ScoreItemId, number>; // 가중치 적용 후
  predictedRank?: number;
  isDarkHorse?: boolean;
}
