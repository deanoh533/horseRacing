/**
 * Score Engine - 메인
 *
 * 17개 항목 모두 알고리즘 구현 완료 (commit 21f752d 이후)
 * - 핵심 항목 정식 알고리즘 14개
 * - 전문가 자문 대기 3개 (⑧, ⑬, ⑭): 임시 알고리즘
 *
 * 사용법:
 *   const engine = new ScoreEngine();
 *   const score = engine.calculateScores(input);
 *   → score.total: 0-100
 *   → score.items: 17개 항목 상세
 */
import {
  ITEM_WEIGHTS,
  ITEM_NAMES,
  type ItemId,
} from '@app-types/index.js';

// 17개 항목 모두 import
import { calculateRatingScore } from './scoreItems/01_rating.js';
import { calculateWeightChangeScore } from './scoreItems/02_weight_change.js';
import { calculateRecentFormScore } from './scoreItems/03_recent_form.js';
import { calculateSectionalTimeScore } from './scoreItems/04_sectional_time.js';
import { calculateLatePositionScore } from './scoreItems/05_late_position.js';
import { calculateDistanceFitnessScore } from './scoreItems/06_distance_fitness.js';
import { calculateTrackAdaptationScore } from './scoreItems/07_track_adaptation.js';
import { calculateBurdenWeightScore } from './scoreItems/08_burden_weight.js';
import { calculateJockeyFormScore } from './scoreItems/09_jockey_form.js';
import { calculateTrainerFormScore } from './scoreItems/10_trainer_form.js';
import { calculateRaceIntervalScore } from './scoreItems/11_race_interval.js';
import { calculateStartingPositionScore } from './scoreItems/12_starting_position.js';
import { calculateAgeDistanceGenderScore } from './scoreItems/13_age_distance_gender.js';
import { calculatePedigreeScore } from './scoreItems/14_pedigree.js';
import { calculateSeasonalPatternScore } from './scoreItems/15_seasonal_pattern.js';
import { calculateChemistryScore } from './scoreItems/16_jockey_horse_chemistry.js';
import { calculateMarketOddsScore } from './scoreItems/17_market_odds.js';

/**
 * 점수 계산을 위한 입력 데이터
 */
export interface ScoreEngineInput {
  // ① 레이팅
  rating: number;

  // ② 마체중 변화
  weightDiffs?: number[];
  sex?: string;
  currentMonth?: number;

  // ③ 착순 추세
  ord5?: number[];

  // ④ 구간 시간 (같은 거리/주로 vs 같은 거리만)
  sameDistTrackTimes?: Array<{ rcTime: number; lastFurlong: number }>;
  sameDistOnlyTimes?: Array<{ rcTime: number; lastFurlong: number }>;

  // ⑤ 후반 구간 순위
  positions?: Array<{ startOrd: number; finishOrd: number }>;

  // ⑥ 거리 적성
  sameDistOrds?: number[];

  // ⑦ 주로 적응
  overallOrds?: number[];
  sameTrackOrds?: number[];

  // ⑧ 부담중량 (부담 극복 지수)
  burdenHistory?: Array<{ ord: number; myBudam: number; raceAvgBudam: number }>;

  // ⑨ 기수 폼
  jockey30DayOrds?: number[];

  // ⑩ 조교사 폼
  trainer60DayOrds?: number[];

  // ⑪ 경주 간격
  intervalDays?: number | null;

  // ⑫ 출발번호
  stOrd?: number;
  totalHorses?: number;
  rcDist?: number;

  // ⑬ 나이/거리/성별
  age?: number;

  // ⑭ 혈통 (API284 dsa*)
  pedigree?: {
    dsaBriVl?: number;
    dsaClcVl?: number;
    dsaIerVl?: number;
    dsaPrfVl?: number;
    dsidxVl?: number;
  };

  // ⑮ 계절 패턴
  sameSeasonOrds?: number[];

  // ⑯ 기수-말 궁합
  horseAllOrds?: number[];
  combinationOrds?: number[];

  // ⑰ 배당률
  recent5Popularities?: number[];
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
  status: 'implemented' | 'expert_pending';
}

/**
 * 종합 점수 결과
 */
export interface HorseScoreResult {
  total: number; // 0-100
  items: Record<ItemId, ItemScore>;
}

const EXPERT_PENDING = new Set<ItemId>([
  '08_burden_weight',
  '13_age_distance_gender',
  '14_pedigree',
]);

/**
 * 핵심 Score Engine
 */
export class ScoreEngine {
  calculateScores(input: ScoreEngineInput): HorseScoreResult {
    const items: Partial<Record<ItemId, ItemScore>> = {};

    // ① 레이팅
    items['01_rating'] = this.make(
      '01_rating',
      calculateRatingScore({ rating: input.rating })
    );

    // ② 마체중 변화
    items['02_weight_change'] = this.make(
      '02_weight_change',
      calculateWeightChangeScore({
        weightDiffs: input.weightDiffs ?? [],
        sex: input.sex,
        currentMonth: input.currentMonth,
      })
    );

    // ③ 착순 추세
    items['03_recent_form'] = this.make(
      '03_recent_form',
      calculateRecentFormScore({ ord5: input.ord5 ?? [] })
    );

    // ④ 구간 시간
    items['04_sectional_time'] = this.make(
      '04_sectional_time',
      calculateSectionalTimeScore({
        sameDistTrackTimes: input.sameDistTrackTimes ?? [],
        sameDistOnlyTimes: input.sameDistOnlyTimes ?? [],
      })
    );

    // ⑤ 후반 구간 순위
    items['05_late_position'] = this.make(
      '05_late_position',
      calculateLatePositionScore({ positions: input.positions ?? [] })
    );

    // ⑥ 거리 적성
    items['06_distance_fitness'] = this.make(
      '06_distance_fitness',
      calculateDistanceFitnessScore({ sameDistOrds: input.sameDistOrds ?? [] })
    );

    // ⑦ 주로 적응
    items['07_track_adaptation'] = this.make(
      '07_track_adaptation',
      calculateTrackAdaptationScore({
        overallOrds: input.overallOrds ?? [],
        sameTrackOrds: input.sameTrackOrds ?? [],
      })
    );

    // ⑧ 부담중량 (부담 극복 지수)
    items['08_burden_weight'] = this.make(
      '08_burden_weight',
      calculateBurdenWeightScore({
        history: input.burdenHistory ?? [],
      })
    );

    // ⑨ 기수 폼
    items['09_jockey_form'] = this.make(
      '09_jockey_form',
      calculateJockeyFormScore({ recent30DayOrds: input.jockey30DayOrds ?? [] })
    );

    // ⑩ 조교사 폼
    items['10_trainer_form'] = this.make(
      '10_trainer_form',
      calculateTrainerFormScore({ recent60DayOrds: input.trainer60DayOrds ?? [] })
    );

    // ⑪ 경주 간격
    items['11_race_interval'] = this.make(
      '11_race_interval',
      calculateRaceIntervalScore({ intervalDays: input.intervalDays ?? null })
    );

    // ⑫ 출발번호
    items['12_starting_position'] = this.make(
      '12_starting_position',
      calculateStartingPositionScore({
        stOrd: input.stOrd ?? 0,
        totalHorses: input.totalHorses ?? 0,
        rcDist: input.rcDist ?? 0,
      })
    );

    // ⑬ 나이/거리/성별
    items['13_age_distance_gender'] = this.make(
      '13_age_distance_gender',
      calculateAgeDistanceGenderScore({
        age: input.age ?? 0,
        sex: input.sex ?? '',
        rcDist: input.rcDist ?? 0,
      })
    );

    // ⑭ 혈통
    items['14_pedigree'] = this.make(
      '14_pedigree',
      calculatePedigreeScore(input.pedigree ?? {})
    );

    // ⑮ 계절 패턴
    items['15_seasonal_pattern'] = this.make(
      '15_seasonal_pattern',
      calculateSeasonalPatternScore({
        sameSeasonOrds: input.sameSeasonOrds ?? [],
      })
    );

    // ⑯ 기수-말 궁합
    items['16_jockey_horse_chemistry'] = this.make(
      '16_jockey_horse_chemistry',
      calculateChemistryScore({
        horseAllOrds: input.horseAllOrds ?? [],
        combinationOrds: input.combinationOrds ?? [],
      })
    );

    // ⑰ 배당률
    items['17_market_odds'] = this.make(
      '17_market_odds',
      calculateMarketOddsScore({
        recent5Popularities: input.recent5Popularities ?? [],
      })
    );

    // 종합 점수
    const allItems = items as Record<ItemId, ItemScore>;
    const total = Object.values(allItems).reduce(
      (sum, item) => sum + item.weightedScore,
      0
    );

    return {
      total: Math.round(total * 100) / 100,
      items: allItems,
    };
  }

  private make(itemId: ItemId, rawScore: number): ItemScore {
    const weight = ITEM_WEIGHTS[itemId];
    const clamped = Math.max(0, Math.min(1, rawScore));
    return {
      itemId,
      itemName: ITEM_NAMES[itemId],
      rawScore: Math.round(clamped * 1000) / 1000,
      weight,
      weightedScore: Math.round(clamped * weight * 100) / 100,
      status: EXPERT_PENDING.has(itemId) ? 'expert_pending' : 'implemented',
    };
  }
}

let _engine: ScoreEngine | null = null;
export function getScoreEngine(): ScoreEngine {
  if (!_engine) _engine = new ScoreEngine();
  return _engine;
}
