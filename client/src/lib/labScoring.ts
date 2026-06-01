/**
 * labScoring.ts — 실험실(Lab) 점수 재계산 유틸 (Phase 1)
 *
 * predictions.item_scores 에는 항목별 rawScore(0~1) 가 저장돼 있어,
 * 같은 rawScore 에 다른 가중치 벡터를 곱하면 v1 ↔ 실험 버전 순위를
 * 백엔드 없이 클라이언트에서 즉시 비교할 수 있다.
 *
 * ⚠️ V1_WEIGHTS 는 src/types/index.ts 의 ITEM_WEIGHTS 스냅샷이다.
 *    판단항목 고도화의 "v1 기준선"이며 이 값은 수정하지 않는다.
 *    (백엔드 가중치를 바꾸더라도 실험실의 v1 기준선은 여기서 고정)
 */
import type { Prediction } from './supabase';

/** v1 기준선 가중치 — src/types/index.ts ITEM_WEIGHTS 스냅샷 (2026-05-28). 수정 금지. */
export const V1_WEIGHTS: Record<string, number> = {
  '01_rating': 6.0,
  '02_weight_change': 0.5,
  '03_recent_form': 10.0,
  '04_sectional_time': 0,
  '05_late_position': 12.5,
  '06_distance_fitness': 24.0,
  '07_track_adaptation': 0,
  '08_burden_weight': 11.0,
  '09_jockey_form': 5.5,
  '09b_jockey_recent': 4.0,
  '10_trainer_form': 3.0,
  '10b_trainer_recent': 2.5,
  '11_race_interval': 3.0,
  '12_starting_position': 4.5,
  '13_age_distance_gender': 0,
  '14_pedigree': 3.0,
  '15_seasonal_pattern': 0.5,
  '16_jockey_horse_chemistry': 0.5,
  '17_market_odds': 3.0,
  '18_earnings': 3.0,
  '19_running_style_pace': 3.5,
};

/** 항목 ID 순서 (UI 표시용) */
export const SCORE_ITEM_IDS: string[] = Object.keys(V1_WEIGHTS);

/** 항목 한국어 이름 — src/types/index.ts ITEM_NAMES 스냅샷 */
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
};

/**
 * v1 기준선에서 가중치 0인 항목(=비활성/봉인).
 * 하드코딩 대신 V1_WEIGHTS===0에서 파생 → 기준선과 항상 일치(드리프트 방지).
 * (활성 여부는 본래 "버전별 weight>0"이 단일 기준)
 */
export const SEALED_ITEMS = new Set<string>(
  SCORE_ITEM_IDS.filter((id) => V1_WEIGHTS[id] === 0)
);

export interface RankedHorse {
  /** Σ(rawScore × weight) */
  score: number;
  /** 1-based, 내림차순 */
  rank: number;
}

/**
 * 주어진 가중치 벡터로 한 경주의 예측순위를 재계산한다 (순수 함수).
 * @returns hr_name → { score, rank }
 */
export function recomputeRanking(
  predictions: Prediction[],
  weights: Record<string, number>
): Map<string, RankedHorse> {
  const scored = predictions.map((p) => {
    let score = 0;
    const items = p.item_scores ?? {};
    for (const itemId of Object.keys(items)) {
      const raw = items[itemId]?.rawScore ?? 0;
      const w = weights[itemId] ?? 0;
      score += raw * w;
    }
    return { hr_name: p.hr_name, score };
  });

  // 점수 내림차순 정렬, 동점은 hr_name 으로 안정 정렬
  scored.sort((a, b) => b.score - a.score || a.hr_name.localeCompare(b.hr_name));

  const result = new Map<string, RankedHorse>();
  scored.forEach((s, i) => {
    result.set(s.hr_name, { score: s.score, rank: i + 1 });
  });
  return result;
}

/** 가중치 합계 (정규화·표시용) */
export function weightSum(weights: Record<string, number>): number {
  return Object.values(weights).reduce((a, b) => a + b, 0);
}
