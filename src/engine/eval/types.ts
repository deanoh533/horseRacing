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
  horses: HorseRecord[];
}
