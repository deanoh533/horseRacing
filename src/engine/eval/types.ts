import type { Feature } from '../features/types.js';

export interface HorseRecord {
  hrName: string;
  pthrNo: number;
  ord: number;
  winOdds: number | null;
  rawScores: Record<string, number>;
  features: Feature[];
}

export interface RaceRecord {
  raceDate: number;
  meet: number;
  rcNo: number;
  rcDist?: number;   // 경주 거리(m). 조건부 엣지 마이닝용 (additive).
  horses: HorseRecord[];
}
