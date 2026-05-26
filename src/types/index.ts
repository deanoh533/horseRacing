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
  // 구간별 부산경남 누적시간 (buG* = 부경, 0이면 해당 경마장 아님)
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
  // 구간별 서울 누적시간 (seG* = 서울, 0이면 해당 경마장 아님)
  seG1fAccTime?: number;  // 서울 G1F 누적통과시간 (초)
  seG3fAccTime?: number;  // 서울 G3F 누적통과시간
  seS1fAccTime?: number;  // 서울 S1F 누적통과시간
  se_1cAccTime?: number;  // 서울 1코너 누적통과시간
  se_2cAccTime?: number;  // 서울 2코너 누적통과시간
  se_3cAccTime?: number;  // 서울 3코너 누적통과시간
  se_4cAccTime?: number;  // 서울 4코너 누적통과시간
  sjG1fOrd?: number;      // 서울 G1F 구간순위
  sjG3fOrd?: number;      // 서울 G3F 구간순위
  sjS1fOrd?: number;      // 서울 S1F 구간순위
  sj_1cOrd?: number;      // 서울 1코너 구간순위
  sj_2cOrd?: number;      // 서울 2코너 구간순위
  sj_3cOrd?: number;      // 서울 3코너 구간순위
  sj_4cOrd?: number;      // 서울 4코너 구간순위
  // 제주 구간시간 (je* = 제주)
  jeG1fTime?: number;
  jeG3fTime?: number;
  jeS1fTime?: number;
  je_1cTime?: number;
  je_2cTime?: number;
  je_3cTime?: number;
  je_4cTime?: number;
  // 부경 구간별 개별시간
  buS1fTime?: number;
  bu_1fGTime?: number;
  bu_2fGTime?: number;
  bu_3fGTime?: number;
  bu_4_2fTime?: number;
  bu_6_4fTime?: number;
  bu_8_6fTime?: number;
  bu_10_8fTime?: number;
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
  '18_earnings',
] as const;

export type ScoreItemId = typeof SCORE_ITEM_IDS[number];

/** 별칭 (간결한 이름) */
export type ItemId = ScoreItemId;

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
  '18_earnings': 8.77,
};

/** 17개 항목 한국어 이름 */
export const ITEM_NAMES: Record<ScoreItemId, string> = {
  '01_rating': '레이팅',
  '02_weight_change': '마체중 변화',
  '03_recent_form': '착순 추세',
  '04_sectional_time': '구간 시간 단축',
  '05_late_position': '후반 구간 순위',
  '06_distance_fitness': '거리 적성',
  '07_track_adaptation': '주로 적응',
  '08_burden_weight': '부담중량',
  '09_jockey_form': '기수 폼',
  '10_trainer_form': '조교사 폼',
  '11_race_interval': '경주 간격',
  '12_starting_position': '출발번호',
  '13_age_distance_gender': '나이×거리×성별',
  '14_pedigree': '혈통',
  '15_seasonal_pattern': '계절 패턴',
  '16_jockey_horse_chemistry': '기수-말 궁합',
  '17_market_odds': '배당률',
  '18_earnings': '수득상금',
};

/** 본인이 평소 중시하는 4대 핵심 분석 영역 (UI 강조용) */
export const FOUR_CORE_AREAS: ScoreItemId[] = [
  '03_recent_form',
  '06_distance_fitness',
  '09_jockey_form',
  '16_jockey_horse_chemistry',
];

/** 기본 인사이트 4개 (사용자 변경 가능) */
export const DEFAULT_INSIGHT_INDICATORS: ScoreItemId[] = [
  '03_recent_form',
  '06_distance_fitness',
  '09_jockey_form',
  '16_jockey_horse_chemistry',
];

/** 말 종합 점수 (간단 버전) */
export interface HorseScore {
  hrName: string;
  hrNo: string;
  totalScore: number;          // 0-100
  itemScores: Record<ScoreItemId, number>;  // 각 항목 0-1.0
  itemContributions: Record<ScoreItemId, number>; // 가중치 적용 후
  predictedRank?: number;
  isDarkHorse?: boolean;
}
