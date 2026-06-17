import { normalizeProbs } from './calibration.js';

/** 한 경주의 합성 입력. 세 배열은 같은 말 순서·같은 길이. winnerIdx = ords에서 ord===1 위치. */
export interface BenterRace {
  marketProb: number[]; // 경주 내 합=1
  modelProb: number[];  // 경주 내 합=1
  ords: number[];       // 각 말 착순
  winnerIdx: number;    // 우승마 인덱스 (ords.indexOf(1))
}

/** 수치안정 softmax: max 빼기 후 exp 정규화. */
export function softmax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const mx = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - mx));
  return normalizeProbs(exps);
}

/** 단승배당 역수의 경주 내 정규화(공제율 제거). 유효 배당만 들어온다고 가정. */
export function marketProbsFromOdds(odds: number[]): number[] {
  return normalizeProbs(odds.map((o) => 1 / o));
}

const LN = (p: number) => Math.log(Math.max(p, 1e-12));

/** 합성확률 = softmax(a·ln시장 + b·ln모델). 경주 내 합=1. */
export function combinedProbs(a: number, b: number, marketProb: number[], modelProb: number[]): number[] {
  const scores = marketProb.map((m, k) => a * LN(m) + b * LN(modelProb[k]!));
  return softmax(scores);
}

export interface BenterFit { a: number; b: number; }

/** 우승 로그우도 경사상승으로 a,b 적합. 초기 a=1,b=0(=시장 단독). */
export function fitBenter(races: BenterRace[], opts: { iters?: number; lr?: number } = {}): BenterFit {
  const iters = opts.iters ?? 3000;
  const lr = opts.lr ?? 0.5;
  const n = races.length;
  if (n === 0) return { a: 1, b: 0 };
  let a = 1, b = 0;
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0;
    for (const r of races) {
      const u = r.marketProb.map(LN);
      const v = r.modelProb.map(LN);
      const probs = combinedProbs(a, b, r.marketProb, r.modelProb);
      let ea = 0, eb = 0;
      for (let k = 0; k < probs.length; k++) { ea += probs[k]! * u[k]!; eb += probs[k]! * v[k]!; }
      ga += u[r.winnerIdx]! - ea;
      gb += v[r.winnerIdx]! - eb;
    }
    a += (lr * ga) / n;
    b += (lr * gb) / n;
  }
  return { a, b };
}

/** 경주단위 우승 NLL = 평균(−ln 우승마확률). selector가 경주별 확률배열 반환. */
export function winNLL(races: BenterRace[], selector: (r: BenterRace) => number[]): number {
  if (races.length === 0) return 0;
  let s = 0;
  for (const r of races) s += -Math.log(Math.max(selector(r)[r.winnerIdx]!, 1e-12));
  return s / races.length;
}

export interface PickStat { win: number; show: number; n: number; }

/** argmax 확률 픽의 단승(ord===1)·연승(ord<=3) 집계. */
export function pickStats(races: BenterRace[], selector: (r: BenterRace) => number[]): PickStat {
  const stat: PickStat = { win: 0, show: 0, n: 0 };
  for (const r of races) {
    const p = selector(r);
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k]! > p[best]!) best = k;
    const ord = r.ords[best]!;
    stat.n++;
    if (ord === 1) stat.win++;
    if (ord <= 3) stat.show++;
  }
  return stat;
}
