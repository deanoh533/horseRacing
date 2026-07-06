/**
 * 오프셋 조건부 로지트 (배당 log-확률 계수=1 고정) 공유 코어.
 *   경주 r 내 말 i:  η_i = log(market_prob_i) + β·z_i   (z = 표준화 피처)
 *   P(i 우승) = softmax_r(η)_i.  β=0 ⇒ P=market_prob (날배당 재현).
 * probe_alpha_logloss(총량) · probe_alpha_bands(구간분해) 공용.
 */
import { readFileSync } from 'node:fs';
import { toVector } from '../features/alignFeatures.js';
import type { Feature } from '../features/types.js';

export interface Row {
  race_date: number; meet: number; rc_no: number; ord: number; win_odds: number | null; features: Feature[];
}
export interface Race {
  date: number;
  x: number[][];          // 출주마별 피처벡터 (keep 스키마 순서)
  offset: number[];       // log(market_prob_i), 경주합=1
  marketProb: number[];   // market_prob_i = exp(offset_i)
  odds: number[];         // 원 win_odds
  winner: number;         // ord==1 인덱스
}

export const clip = (p: number) => Math.min(1 - 1e-12, Math.max(1e-12, p));

/** JSONL → 유효 경주(모든 win_odds>0·승자존재·≥3두). keep = 사용할 피처명(순서). */
export function loadRaces(matrixPath: string, keep: string[]): { races: Race[]; dropped: number } {
  const rows: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.race_date}-${r.meet}-${r.rc_no}`;
    (byRace.get(key) ?? byRace.set(key, []).get(key)!).push(r);
  }
  const races: Race[] = [];
  let dropped = 0;
  for (const runners of byRace.values()) {
    const valid = runners.every((r) => r.win_odds != null && r.win_odds > 0);
    const winner = runners.findIndex((r) => r.ord === 1);
    if (!valid || winner < 0 || runners.length < 3) { dropped++; continue; }
    const impl = runners.map((r) => 1 / (r.win_odds as number));
    const sum = impl.reduce((a, b) => a + b, 0);
    const marketProb = impl.map((v) => v / sum);
    races.push({
      date: runners[0]!.race_date,
      x: runners.map((r) => toVector(r.features, keep)),
      offset: marketProb.map((v) => Math.log(clip(v))),
      marketProb,
      odds: runners.map((r) => r.win_odds as number),
      winner,
    });
  }
  races.sort((a, b) => a.date - b.date);
  return { races, dropped };
}

/** train 피처 평균/표준편차(말단위). */
export function standardizer(races: Race[], d: number): { mean: number[]; std: number[] } {
  const mean = new Array(d).fill(0), std = new Array(d).fill(0);
  let n = 0;
  for (const r of races) for (const xi of r.x) { for (let k = 0; k < d; k++) mean[k]! += xi[k]!; n++; }
  for (let k = 0; k < d; k++) mean[k]! /= n;
  for (const r of races) for (const xi of r.x) for (let k = 0; k < d; k++) std[k]! += (xi[k]! - mean[k]!) ** 2;
  for (let k = 0; k < d; k++) std[k]! = Math.sqrt(std[k]! / n) || 1;
  return { mean, std };
}

/** 경주 내 softmax(offset_i + β·z_i). */
export function raceProbs(race: Race, beta: number[], mean: number[], std: number[]): number[] {
  const eta = race.x.map((xi, i) => {
    let s = race.offset[i]!;
    for (let k = 0; k < beta.length; k++) s += beta[k]! * ((xi[k]! - mean[k]!) / std[k]!);
    return s;
  });
  const mx = Math.max(...eta);
  const ex = eta.map((e) => Math.exp(e - mx));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / sum);
}

/** 경주단위 로그로스: 승자 확률의 −log 평균. */
export function groupedLL(races: Race[], beta: number[], mean: number[], std: number[]): number {
  let s = 0;
  for (const r of races) s += -Math.log(clip(raceProbs(r, beta, mean, std)[r.winner]!));
  return s / races.length;
}

/** 오프셋 조건부 로지트 학습 (β만; offset 계수=1 고정). L2 배치 경사하강. */
export function fitOffsetCLogit(
  races: Race[], mean: number[], std: number[], opts: { l2: number; iters: number; lr: number }
): number[] {
  const d = mean.length;
  const beta = new Array(d).fill(0);
  const nR = races.length;
  for (let it = 0; it < opts.iters; it++) {
    const g = new Array(d).fill(0);
    for (const r of races) {
      const p = raceProbs(r, beta, mean, std);
      for (let i = 0; i < r.x.length; i++) {
        const err = p[i]! - (i === r.winner ? 1 : 0);
        for (let k = 0; k < d; k++) g[k]! += err * ((r.x[i]![k]! - mean[k]!) / std[k]!);
      }
    }
    for (let k = 0; k < d; k++) beta[k]! -= opts.lr * (g[k]! / nR + opts.l2 * beta[k]!);
  }
  return beta;
}

/**
 * 경주블록 부트스트랩. 각 경주가 (분자합, 분모합) 기여를 준다.
 * Δ = Σnum / Σden. 경주 단위 재표집으로 mean·95% CI.
 */
export function bootstrapRatio(
  perRace: { num: number; den: number }[], reps: number
): { mean: number; lo: number; hi: number } {
  const agg = (idx: number[]) => {
    let num = 0, den = 0;
    for (const i of idx) { num += perRace[i]!.num; den += perRace[i]!.den; }
    return den > 0 ? num / den : NaN;
  };
  const all = perRace.map((_, i) => i);
  const mean = agg(all);
  const n = perRace.length;
  const means: number[] = [];
  for (let b = 0; b < reps; b++) {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(Math.random() * n));
    const m = agg(idx);
    if (!Number.isNaN(m)) means.push(m);
  }
  means.sort((a, b) => a - b);
  return { mean, lo: means[Math.floor(means.length * 0.025)]!, hi: means[Math.floor(means.length * 0.975)]! };
}
