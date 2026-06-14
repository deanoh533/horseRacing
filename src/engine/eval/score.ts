import { toVector } from '../features/alignFeatures.js';
import { predictLogit, type LogisticModel } from '../models/logistic.js';
import { predictGBDT, type GBDTModel } from '../models/gbdt.js';
import { predictPL, type PLModel } from '../models/plackettLuce.js';
import type { HorseRecord } from './types.js';

export type ScorableModel =
  | { kind: 'weights'; weights: Record<string, number> }
  | { kind: 'logistic'; model: LogisticModel }
  | { kind: 'gbdt'; model: GBDTModel; schema: string[] }
  | { kind: 'pl'; model: PLModel; schema: string[] };

/** 한 마리 종합점수 (높을수록 1순위). 정렬 비교용 — 절대 스케일 의미 없음. */
export function scoreHorse(m: ScorableModel, h: HorseRecord): number {
  switch (m.kind) {
    case 'weights': {
      let s = 0;
      for (const [id, w] of Object.entries(m.weights)) s += (h.rawScores[id] ?? 0) * w;
      return s;
    }
    case 'logistic':
      return predictLogit(m.model, toVector(h.features, m.model.features));
    case 'gbdt':
      return predictGBDT(m.model, toVector(h.features, m.schema));
    case 'pl':
      return predictPL(m.model, toVector(h.features, m.schema));
  }
}

/** 종합점수 내림차순 정렬 (원본 불변). */
export function rankHorses(m: ScorableModel, horses: HorseRecord[]): HorseRecord[] {
  return [...horses].sort((a, b) => scoreHorse(m, b) - scoreHorse(m, a));
}
