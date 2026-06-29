/**
 * 점수 항목 한국어 이름 — 클라이언트 단일 출처.
 *
 * ⚠️ 백엔드 정본 `src/types/index.ts`의 ITEM_NAMES(22개)를 미러링한다.
 * 클라이언트는 src/를 import할 수 없어 복제하되, 새 항목 추가 시 양쪽을 함께 갱신.
 * (이전엔 Statistics·Dashboard가 각자 17개짜리 부분 맵을 들고 드리프트했음 — 2026-06-29 통합.)
 */
export const ITEM_NAMES: Record<string, string> = {
  '01_rating': '레이팅',
  '02_weight_change': '마체중 변화',
  '03_recent_form': '착순 추세',
  '04_sectional_time': '구간 시간 단축',
  '05_late_position': '후반 구간 순위',
  '06_distance_fitness': '거리 적성',
  '07_track_adaptation': '주로 적응',
  '08_burden_weight': '부담중량',
  '09_jockey_form': '기수 폼',
  '09b_jockey_recent': '기수 최근폼',
  '10_trainer_form': '조교사 폼',
  '10b_trainer_recent': '조교사 최근폼',
  '11_race_interval': '경주 간격',
  '12_starting_position': '출발번호',
  '13_age_distance_gender': '나이×거리×성별',
  '14_pedigree': '혈통',
  '15_seasonal_pattern': '계절 패턴',
  '16_jockey_horse_chemistry': '기수-말 궁합',
  '17_market_odds': '배당률',
  '18_earnings': '수득상금',
  '19_running_style_pace': '주행성향×페이스',
  '20_speed_figure': '속도능력지수',
};

/** 항목 id → 한국어 이름 (미매핑이면 id 그대로). */
export function itemName(id: string): string {
  return ITEM_NAMES[id] ?? id;
}
