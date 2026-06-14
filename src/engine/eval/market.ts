import type { RaceRecord, HorseRecord } from './types.js';
import { rankHorses, type ScorableModel } from './score.js';

export interface Tally { win: number; place: number; show: number; n: number; }
const empty = (): Tally => ({ win: 0, place: 0, show: 0, n: 0 });
function add(t: Tally, ord: number | null) {
  if (ord === null || ord > 50) return;
  t.n++;
  if (ord === 1) t.win++;
  if (ord <= 2) t.place++;
  if (ord <= 3) t.show++;
}
const isShow = (ord: number | null | undefined) => ord != null && ord >= 1 && ord <= 3;

/** win_odds 오름차순(인기순), 유효 배당만. */
export function rankByOdds(horses: HorseRecord[]): HorseRecord[] {
  return horses
    .filter((h) => h.winOdds != null && h.winOdds > 0)
    .sort((a, b) => (a.winOdds as number) - (b.winOdds as number));
}

export interface MarketDiag {
  model: Tally;
  market: Tally;
  disModel: Tally;
  disFav: Tally;
  rankModel: { hit: number; n: number }[];
  rankMkt: { hit: number; n: number }[];
  setModelSum: number; setMktSum: number; setN: number;
}

/** 한 경주 집합에 대해 모델 vs 시장 깊은 진단. model로 채점, win_odds로 시장순위. */
export function marketDiagnostics(races: RaceRecord[], model: ScorableModel): MarketDiag {
  const d: MarketDiag = {
    model: empty(), market: empty(), disModel: empty(), disFav: empty(),
    rankModel: [0, 0, 0].map(() => ({ hit: 0, n: 0 })),
    rankMkt: [0, 0, 0].map(() => ({ hit: 0, n: 0 })),
    setModelSum: 0, setMktSum: 0, setN: 0,
  };
  for (const race of races) {
    const modelOrder = rankHorses(model, race.horses);
    const mktOrder = rankByOdds(race.horses);
    const mPick = modelOrder[0] ?? null;
    const fPick = mktOrder[0] ?? null;
    add(d.model, mPick?.ord ?? null);
    add(d.market, fPick?.ord ?? null);
    if (mPick && fPick && mPick.hrName !== fPick.hrName) {
      add(d.disModel, mPick.ord);
      add(d.disFav, fPick.ord);
    }
    for (let k = 0; k < 3; k++) {
      const mh = modelOrder[k];
      if (mh) { d.rankModel[k]!.n++; if (isShow(mh.ord)) d.rankModel[k]!.hit++; }
      const fh = mktOrder[k];
      if (fh) { d.rankMkt[k]!.n++; if (isShow(fh.ord)) d.rankMkt[k]!.hit++; }
    }
    const actualTop3 = new Set(race.horses.filter((h) => isShow(h.ord)).map((h) => h.hrName));
    if (actualTop3.size > 0) {
      d.setN++;
      d.setModelSum += modelOrder.slice(0, 3).filter((h) => actualTop3.has(h.hrName)).length;
      d.setMktSum += mktOrder.slice(0, 3).filter((h) => actualTop3.has(h.hrName)).length;
    }
  }
  return d;
}

export function printMarketDiag(d: MarketDiag): void {
  const pct = (a: number, n: number) => (n ? ((a / n) * 100).toFixed(1) : '-');
  console.log('-'.repeat(76));
  console.log(`[시장] 인기1위 — 연승 ${pct(d.market.show, d.market.n)} / 단승 ${pct(d.market.win, d.market.n)}  (n=${d.market.n})`);
  if (d.model.n && d.market.n) {
    const diff = ((d.model.show / d.model.n) - (d.market.show / d.market.n)) * 100;
    console.log(`  → 모델 연승 − 시장 연승 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p`);
  }
  console.log(`[불일치] 모델1순위≠인기1위: ${d.disModel.n}건`);
  if (d.disModel.n) {
    console.log(`  모델픽 연승 ${pct(d.disModel.show, d.disModel.n)} / 인기픽 연승 ${pct(d.disFav.show, d.disFav.n)}`);
    const edge = ((d.disModel.show / d.disModel.n) - (d.disFav.show / d.disFav.n)) * 100;
    console.log(`  → 엇갈릴 때 우위 ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p ${edge >= 0 ? '(부가가치 O)' : '(부가가치 X)'}`);
  }
  console.log('[순위별 연승] 1·2·3순위 픽이 3착내 비율');
  console.log(`  모델 | ${d.rankModel.map((r) => pct(r.hit, r.n).padStart(5)).join(' | ')}`);
  console.log(`  시장 | ${d.rankMkt.map((r) => pct(r.hit, r.n).padStart(5)).join(' | ')}`);
  if (d.setN) {
    console.log(`[상위3 묶음] 모델 ${(d.setModelSum / d.setN).toFixed(2)}마리 / 시장 ${(d.setMktSum / d.setN).toFixed(2)}마리`);
  }
}
