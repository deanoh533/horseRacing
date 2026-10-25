/** W-003 학습 기간 곡선 — 시험 분기 시작 직전 N년만 학습에 쓰는 창. */
import type { RaceRecord } from './types.js';

export function windowStart(blockStart: number, years: number): number {
  return blockStart - years * 10000;
}

export function windowTrain(races: RaceRecord[], blockStart: number, years: number): RaceRecord[] {
  const lo = windowStart(blockStart, years);
  return races.filter((x) => x.raceDate >= lo && x.raceDate < blockStart);
}

/** 수집한 데이터가 창 시작일까지 내려가야 N년 창이 온전하다. */
export function windowCovered(dataFrom: number, blockStart: number, years: number): boolean {
  return dataFrom <= windowStart(blockStart, years);
}
