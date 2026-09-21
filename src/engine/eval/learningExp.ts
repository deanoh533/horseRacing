/** 학습 방식 실험 지표·판정 (spec 2026-09-18 §7, 사전등록). */
import { rankHorses, type ScorableModel } from './score.js';
import type { RaceRecord } from './types.js';

/**
 * 연승 적중률 — 1순위 픽이 **3착 안**. 이름의 `place`는 영어 경마 용어(2착 안)가
 * 아니라 KRA 연승을 가리킨다(D-001). 계산은 `ord <= 3`이 정본.
 */
export function placeRate(m: ScorableModel, races: RaceRecord[]): number {
  if (races.length === 0) return 0;
  let hit = 0;
  for (const r of races) { const top = rankHorses(m, r.horses)[0]; if (top && top.ord >= 1 && top.ord <= 3) hit++; }
  return hit / races.length;
}

export function verdict(base: number[], cand: number[]) {
  const deltas = cand.map((c, i) => c - base[i]!);
  const meanDelta = deltas.reduce((s, d) => s + d, 0) / (deltas.length || 1);
  const positive = deltas.filter((d) => d > 0).length;
  return { meanDelta, positive, quarters: deltas.length, pass: meanDelta >= 0.01 - 1e-12 && positive > deltas.length / 2 };
}
