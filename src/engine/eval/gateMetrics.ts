import type { LogisticModel } from '../models/logistic.js';
import { predictLogit } from '../models/logistic.js';
import { toVector } from '../features/alignFeatures.js';
import type { RaceRecord } from './types.js';

export interface ScoredHorse { ord: number; winOdds: number | null; score: number; }
export type ScoredRace = ScoredHorse[];

/** 모델로 holdout 각 경주 말을 점수화. 정렬은 각 지표가 수행. */
export function scoreHoldout(
  model: LogisticModel,
  holdout: RaceRecord[],
  schema: string[]
): ScoredRace[] {
  return holdout.map((race) =>
    race.horses.map((h) => ({
      ord: h.ord,
      winOdds: h.winOdds,
      score: predictLogit(model, toVector(h.features, schema)),
    }))
  );
}

/** 연승: 모델 최고점 말이 3착내(ord 1~3). 분모=말 있는 경주. */
export function placeHitRate(races: ScoredRace[]): number {
  let hit = 0, n = 0;
  for (const race of races) {
    const top = [...race].sort((a, b) => b.score - a.score)[0];
    if (!top) continue;
    n++;
    if (top.ord >= 1 && top.ord <= 3) hit++;
  }
  return n ? hit / n : 0;
}

/** fade: 인기(winOdds 오름차순) 상위3 중 모델 최저점 말이 3착 밖(ord>3). 분모=인기후보≥2 경주. */
export function fadeHitRate(races: ScoredRace[]): number {
  let hit = 0, n = 0;
  for (const race of races) {
    const favs = race
      .filter((h) => h.winOdds != null && h.winOdds > 0)
      .sort((a, b) => a.winOdds! - b.winOdds!)
      .slice(0, 3);
    if (favs.length < 2) continue;
    const suspect = [...favs].sort((a, b) => a.score - b.score)[0]!;
    n++;
    if (suspect.ord > 3) hit++;
  }
  return n ? hit / n : 0;
}

/** 복승: 모델 상위2 집합이 실제 ord 1·2 둘 다 포함. 분모=실제 1·2위 둘 다 있는 경주. */
export function quinellaHitRate(races: ScoredRace[]): number {
  let hit = 0, n = 0;
  for (const race of races) {
    const has1 = race.some((h) => h.ord === 1);
    const has2 = race.some((h) => h.ord === 2);
    if (!has1 || !has2) continue;
    const top2 = [...race].sort((a, b) => b.score - a.score).slice(0, 2);
    if (top2.length < 2) continue;
    n++;
    const ords = new Set(top2.map((h) => h.ord));
    if (ords.has(1) && ords.has(2)) hit++;
  }
  return n ? hit / n : 0;
}
