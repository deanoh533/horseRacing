/**
 * 라이브 보정 확률 — 아티팩트(base 모델 + calibration) + 경주 내 정렬 벡터 → P(1착)·P(3착내).
 * 순수 함수. calibration 없으면 전부 null(구 아티팩트 무중단 호환).
 * 설계: docs/superpowers/specs/2026-06-19-platt-live-calibration-design.md
 */
import type { LogisticModel } from '../models/logistic.js';
import { sigmoid, normalizeProbs, applyPlatt } from './calibration.js';

export interface Calibration {
  p1Model: LogisticModel;            // ord===1 학습, P(1착) 전용
  platt1: { a: number; b: number };  // 경주내 정규화된 P1에 적용
  platt3: { a: number; b: number };  // base(top3) 모델 raw 확률에 적용
  renormWin: boolean;                // p_win에 Platt 후 경주내 재정규화 여부
  fitMeta: { rows: number; from: number; to: number; fitAt: string; baseModelId: number };
}

export type CalibratedArtifact = LogisticModel & { calibration?: Calibration };

/** model.features 순서의 raw 벡터로 logit → sigmoid. */
function rawProb(model: LogisticModel, vec: number[]): number {
  let z = model.intercept;
  model.features.forEach((f, j) => {
    z += (model.coef[f] ?? 0) * ((vec[j]! - model.means[j]!) / model.stds[j]!);
  });
  return sigmoid(z);
}

/**
 * 한 경주의 모든 출주마(벡터는 base 모델.features 순서) → 보정 확률.
 * p_top3: applyPlatt(platt3, sigmoid(base logit)) — 정규화 안 함.
 * p_win:  applyPlatt(platt1, normWin(sigmoid(p1 logit))) — renormWin이면 다시 정규화.
 */
export function calibratedRaceProbs(
  artifact: CalibratedArtifact,
  vectors: number[][],
): { pWin: (number | null)[]; pTop3: (number | null)[] } {
  const cal = artifact.calibration;
  if (!cal || vectors.length === 0) {
    return { pWin: vectors.map(() => null), pTop3: vectors.map(() => null) };
  }
  const pTop3 = vectors.map((v) => applyPlatt(cal.platt3, rawProb(artifact, v)));
  const rawP1 = vectors.map((v) => rawProb(cal.p1Model, v));
  const normWin = normalizeProbs(rawP1);
  const plattWin = normWin.map((p) => applyPlatt(cal.platt1, p));
  const pWin = cal.renormWin ? normalizeProbs(plattWin) : plattWin;
  return { pWin, pTop3 };
}
