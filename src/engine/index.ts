/**
 * Score Engine - 메인
 *
 * 21개 항목 모두 알고리즘 구현 완료 (01~19 + 09b·10b)
 * - SEALED·weight=0 항목(④⑦⑬ 등) 포함 — 실제 가중치는 학습으로 결정
 * - 항목별 ρ·가중치·상태: docs/score_roadmap.md §1 마스터 상태표
 *
 * 사용법:
 *   const engine = new ScoreEngine();
 *   const score = engine.calculateScores(input);
 *   → score.total: 0-100
 *   → score.items: 21개 항목 상세
 */
import {
  ITEM_WEIGHTS,
  ITEM_NAMES,
  type ItemId,
} from '@app-types/index.js';

// 19개 항목 모두 import
import { calculateRatingScore } from './scoreItems/01_rating.js';
import { calculateWeightChangeScore } from './scoreItems/02_weight_change.js';
import { calculateRecentFormScore } from './scoreItems/03_recent_form.js';
import { calculateSectionalTimeScore } from './scoreItems/04_sectional_time.js';
import { calculateLatePositionScore } from './scoreItems/05_late_position.js';
import { calculateDistanceFitnessScore } from './scoreItems/06_distance_fitness.js';
import { calculateTrackAdaptationScore } from './scoreItems/07_track_adaptation.js';
import { calculateBurdenWeightScore } from './scoreItems/08_burden_weight.js';
import { calculateJockeyFormScore } from './scoreItems/09_jockey_form.js';
import { calculateJockeyRecentScore } from './scoreItems/09b_jockey_recent.js';
import { calculateTrainerFormScore } from './scoreItems/10_trainer_form.js';
import { calculateTrainerRecentScore } from './scoreItems/10b_trainer_recent.js';
import { calculateRaceIntervalScore } from './scoreItems/11_race_interval.js';
import { calculateStartingPositionScore } from './scoreItems/12_starting_position.js';
// import { calculateAgeDistanceGenderScore } from './scoreItems/13_age_distance_gender.js'; // 비활성화
import { calculatePedigreeScore } from './scoreItems/14_pedigree.js';
import { calculateSeasonalPatternScore } from './scoreItems/15_seasonal_pattern.js';
import { calculateChemistryScore } from './scoreItems/16_jockey_horse_chemistry.js';
import { calculateMarketOddsScore } from './scoreItems/17_market_odds.js';
import { calculateEarningsScore } from './scoreItems/18_earnings.js';
import {
  calculateRunningStylePaceScore,
  type PaceType,
} from './scoreItems/19_running_style_pace.js';
import { calculateSpeedFigureScore } from './scoreItems/20_speed_figure.js';

/**
 * 점수 계산을 위한 입력 데이터
 */
export interface ScoreEngineInput {
  // ① 레이팅
  rating: number;
  allRaceRatings?: number[];  // 경주 내 전 출전마 레이팅 (T-015 상대 순위용)

  // ② 마체중 변화
  weightDiffs?: number[];
  sex?: string;
  currentMonth?: number;

  // ③ 착순 추세
  ord5?: number[];

  // ④ 구간 시간 (같은 거리/주로 vs 같은 거리만)
  sameDistTrackTimes?: Array<{ rcTime: number; lastFurlong: number }>;
  sameDistOnlyTimes?: Array<{ rcTime: number; lastFurlong: number }>;

  // ⑤ 후반 구간 순위 (Step 2 확장: fieldSize·g1fOrd 추가, frontRunSuccessRate multiplier)
  positions?: Array<{
    startOrd: number;
    finishOrd: number;
    fieldSize: number;
    g1fOrd?: number;
    last200mTime?: number; // 마지막 200m(g1f) 소요 시간(초) = rc_time − g1f_acc_time
  }>;
  frontRunSuccessRate?: number;

  // ⑥ 거리 적성
  sameDistOrds?: number[];
  /** horse_running_style_by_distance.avg_finish_ratio (primary, 있으면 우선) */
  distFinishRatio?: number | null;

  // ⑦ 주로 적응
  overallOrds?: number[];
  sameTrackOrds?: number[];

  // ⑧ 부담중량 (부담 극복 지수)
  burdenHistory?: Array<{ ord: number; myBudam: number; raceAvgBudam: number }>;

  // ⑨ 기수 통산 성적 (jockey_stats)
  jockeyCareerWinRate?: number | null;
  jockeyCareerQuRate?: number | null;
  // ⑨b 기수 최근 3개월형
  jockeyRecentOrds?: number[];

  // ⑩ 조교사 폼
  trainer60DayOrds?: number[];
  // ⑩b 조교사 최근 3개월형
  trainerRecentOrds?: number[];

  // ⑪ 경주 간격
  intervalDays?: number | null;

  // ⑫ 출발번호
  stOrd?: number;
  totalHorses?: number;
  rcDist?: number;
  avgPositionRatio?: number | null;     // 주행 성향 multiplier용
  stddevPositionRatio?: number | null;  // 자유마 판정용

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

  // ⑱ 수득상금 (race_cards에서)
  erngSump?: number;

  // ⑲ 주행성향 × 페이스
  runningStyleAvgRatio?: number | null;
  runningStyleStddev?: number | null;
  paceType?: PaceType;

  // ⑳ 속도능력지수 (as-of figure 평균)
  speedFigureAbilityRaw?: number | null;

  // ⑱ 통산 클래스 신호 (earnings 누수 대체 — as-of 과거 ord 이력)
  careerFinishRatio?: number | null;
  careerPlaceRate?: number | null;
  careerN?: number;
  earningsAsof?: number | null;  // ⑱ 진짜 as-of 누적 수득상금(API156 rk_purse 합)
}

/**
 * 항목별 점수 결과
 */
export interface ItemScore {
  itemId: ItemId;
  itemName: string;
  rawScore: number; // 0-1.0
  weight: number; // 비중 (21개 합계 = 100)
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
  /**
   * @param weights 항목별 가중치 (활성 모델 버전). 미지정 시 코드 상수 ITEM_WEIGHTS.
   */
  constructor(private readonly weights: Record<string, number> = ITEM_WEIGHTS) {}

  calculateScores(input: ScoreEngineInput): HorseScoreResult {
    const items: Partial<Record<ItemId, ItemScore>> = {};

    // ① 레이팅
    items['01_rating'] = this.make(
      '01_rating',
      calculateRatingScore({ rating: input.rating, allRaceRatings: input.allRaceRatings })
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
      calculateLatePositionScore({
        positions: input.positions ?? [],
        frontRunSuccessRate: input.frontRunSuccessRate,
      })
    );

    // ⑥ 거리 적성
    items['06_distance_fitness'] = this.make(
      '06_distance_fitness',
      calculateDistanceFitnessScore({
        sameDistOrds: input.sameDistOrds ?? [],
        distFinishRatio: input.distFinishRatio,
      })
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

    // ⑨ 기수 통산 성적
    items['09_jockey_form'] = this.make(
      '09_jockey_form',
      calculateJockeyFormScore({
        careerWinRate: input.jockeyCareerWinRate ?? null,
        careerQuRate: input.jockeyCareerQuRate ?? null,
      })
    );

    // ⑨b 기수 최근 3개월형
    items['09b_jockey_recent'] = this.make(
      '09b_jockey_recent',
      calculateJockeyRecentScore({ recentOrds: input.jockeyRecentOrds ?? [] })
    );

    // ⑩ 조교사 폼
    items['10_trainer_form'] = this.make(
      '10_trainer_form',
      calculateTrainerFormScore({ recent60DayOrds: input.trainer60DayOrds ?? [] })
    );

    // ⑩b 조교사 최근 3개월형
    items['10b_trainer_recent'] = this.make(
      '10b_trainer_recent',
      calculateTrainerRecentScore({ recentOrds: input.trainerRecentOrds ?? [] })
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
        avgPositionRatio: input.avgPositionRatio,
        stddevPositionRatio: input.stddevPositionRatio,
      })
    );

    // ⑬ 나이/거리/성별 — 비활성화 (Spearman ρ=-0.017, 역방향 확인). 가중치=0. 고정 중립값 기록.
    items['13_age_distance_gender'] = this.make('13_age_distance_gender', 0.5);

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

    // ⑱ 수득상금 (race_cards.erng_sump)
    items['18_earnings'] = this.make(
      '18_earnings',
      calculateEarningsScore({ erngSump: input.erngSump })
    );

    // ⑲ 주행성향 × 페이스
    items['19_running_style_pace'] = this.make(
      '19_running_style_pace',
      calculateRunningStylePaceScore({
        avgPositionRatio: input.runningStyleAvgRatio ?? null,
        stddevPositionRatio: input.runningStyleStddev ?? null,
        paceType: input.paceType ?? 'NORMAL',
      })
    );

    // ⑳ 속도능력지수
    items['20_speed_figure'] = this.make(
      '20_speed_figure',
      calculateSpeedFigureScore({ abilityRaw: input.speedFigureAbilityRaw ?? null })
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
    const weight = this.weights[itemId] ?? 0;
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
