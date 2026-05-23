/**
 * Score Engine - 메인
 *
 * 17개 항목 점수 계산 + 종합 점수
 * - 핵심 5개 항목 (①③⑥⑨⑯): 정식 알고리즘 구현됨
 * - 나머지 12개: placeholder (0.5 중립)
 *
 * 사용법:
 *   const engine = new ScoreEngine();
 *   const score = engine.calculateScores(input);
 *   → score.total: 0-100
 *   → score.items: 17개 항목 상세
 */
import { ITEM_WEIGHTS, ITEM_NAMES, type ItemId } from '@types/index.js';
import { calculateRatingScore } from './scoreItems/01_rating.js';
import { calculateRecentFormScore } from './scoreItems/03_recent_form.js';
import { calculateDistanceFitnessScore } from './scoreItems/06_distance_fitness.js';
import { calculateJockeyFormScore } from './scoreItems/09_jockey_form.js';
import { calculateChemistryScore } from './scoreItems/16_jockey_horse_chemistry.js';

/**
 * 점수 계산을 위한 입력 데이터
 */
export interface ScoreEngineInput {
  // 항목 ① 레이팅
  rating: number;

  // 항목 ③ 착순 추세 (컨디션 신호 2)
  /** 최근 5경주 착순 (과거 → 최근) */
  ord5?: number[];

  // 항목 ⑥ 거리 적성
  /** 오늘 거리 이력 착순 */
  sameDistOrds?: number[];

  // 항목 ⑨ 기수 폼
  /** 기수 30일 모든 경주 착순 */
  jockey30DayOrds?: number[];

  // 항목 ⑯ 기수-말 궁합
  /** 말의 1년 내 모든 경주 착순 */
  horseAllOrds?: number[];
  /** 이 기수와 1년 내 조합 착순 */
  combinationOrds?: number[];

  // 향후 추가 (12개 항목 placeholder)
  // ... 추가 데이터 들어올 예정
}

/**
 * 항목별 점수 결과
 */
export interface ItemScore {
  itemId: ItemId;
  itemName: string;
  rawScore: number; // 0-1.0
  weight: number; // 비중 (17개 합계 = 100)
  weightedScore: number; // rawScore * weight
  status: 'implemented' | 'placeholder' | 'expert_pending';
}

/**
 * 종합 점수 결과 (Engine 출력)
 */
export interface HorseScoreResult {
  total: number; // 0-100
  items: Record<ItemId, ItemScore>;
}

/**
 * 핵심 Score Engine
 */
export class ScoreEngine {
  /**
   * 17개 항목 점수 계산
   */
  calculateScores(input: ScoreEngineInput): HorseScoreResult {
    const items: Partial<Record<ItemId, ItemScore>> = {};

    // ============================================
    // 핵심 5개 항목 (실제 알고리즘 구현됨)
    // ============================================

    // ① 레이팅
    items['01_rating'] = this.makeItemScore(
      '01_rating',
      calculateRatingScore({ rating: input.rating }),
      'implemented'
    );

    // ③ 착순 추세
    items['03_recent_form'] = this.makeItemScore(
      '03_recent_form',
      calculateRecentFormScore({ ord5: input.ord5 ?? [] }),
      'implemented'
    );

    // ⑥ 거리 적성
    items['06_distance_fitness'] = this.makeItemScore(
      '06_distance_fitness',
      calculateDistanceFitnessScore({
        sameDistOrds: input.sameDistOrds ?? [],
      }),
      'implemented'
    );

    // ⑨ 기수 폼
    items['09_jockey_form'] = this.makeItemScore(
      '09_jockey_form',
      calculateJockeyFormScore({
        recent30DayOrds: input.jockey30DayOrds ?? [],
      }),
      'implemented'
    );

    // ⑯ 기수-말 궁합
    items['16_jockey_horse_chemistry'] = this.makeItemScore(
      '16_jockey_horse_chemistry',
      calculateChemistryScore({
        horseAllOrds: input.horseAllOrds ?? [],
        combinationOrds: input.combinationOrds ?? [],
      }),
      'implemented'
    );

    // ============================================
    // 나머지 12개 항목 (placeholder - 0.5 중립)
    // ============================================
    const placeholderItems: ItemId[] = [
      '02_weight_change', // 마체중 변화
      '04_sectional_time', // 구간 시간
      '05_late_position', // 후반 순위
      '07_track_adaptation', // 주로 적응
      '08_burden_weight', // 부담중량 (전문가)
      '10_trainer_form', // 조교사 폼
      '11_race_interval', // 경주 간격
      '12_starting_position', // 출발번호
      '13_age_distance_gender', // 나이/거리/성별 (전문가)
      '14_pedigree', // 혈통 (전문가)
      '15_seasonal_pattern', // 계절
      '17_market_odds', // 배당률
    ];

    const expertItems: Set<ItemId> = new Set([
      '08_burden_weight',
      '13_age_distance_gender',
      '14_pedigree',
    ]);

    for (const id of placeholderItems) {
      items[id] = this.makeItemScore(
        id,
        0.5,
        expertItems.has(id) ? 'expert_pending' : 'placeholder'
      );
    }

    // ============================================
    // 종합 점수 (0-100)
    // ============================================
    const allItems = items as Record<ItemId, ItemScore>;
    const total = Object.values(allItems).reduce(
      (sum, item) => sum + item.weightedScore,
      0
    );

    return {
      total: Math.round(total * 100) / 100, // 소수점 2자리
      items: allItems,
    };
  }

  /**
   * 항목 점수 객체 생성 헬퍼
   */
  private makeItemScore(
    itemId: ItemId,
    rawScore: number,
    status: ItemScore['status']
  ): ItemScore {
    const weight = ITEM_WEIGHTS[itemId];
    const clampedScore = Math.max(0, Math.min(1, rawScore));
    return {
      itemId,
      itemName: ITEM_NAMES[itemId],
      rawScore: Math.round(clampedScore * 1000) / 1000,
      weight,
      weightedScore: Math.round(clampedScore * weight * 100) / 100,
      status,
    };
  }
}

// 싱글톤
let _engine: ScoreEngine | null = null;
export function getScoreEngine(): ScoreEngine {
  if (!_engine) _engine = new ScoreEngine();
  return _engine;
}
