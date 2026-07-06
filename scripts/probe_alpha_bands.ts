/**
 * 알파 구간분해 — 총량 알파는 없지만 특정 배당구간에 국소 알파가 있는가?
 * 오프셋 조건부 로지트(계수1 고정) 모델은 동일, 채점 집계만 구간별로 나눔.
 *
 *  ① 말단위(주분석): 각 말을 자기 배당구간에 넣고 이진 로그로스 Δ=(시장+피처)−시장.
 *     결과 비조건화 → 베팅 직결("N배 말, 시장vs모델 누가 정확"). 경주블록 부트스트랩 CI.
 *  ② 경주단위(보조): 승자 배당구간별 grouped-LL Δ. 결과조건화 편향 있어 해석 주의.
 *  ③ 불일치 경주: 모델 top pick ≠ 시장 top pick 경주에서 각자 적중률.
 *  다중비교 가드: 음수(알파) 구간은 3컷오프 전부 강건해야 인정.
 *
 * 사용: npm run probe:alpha:bands -- [--drop earnings_asof] [--boot 1000] [--l2 0.02]
 */
import { readFileSync } from 'node:fs';
import { buildSchema } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';
import {
  loadRaces, standardizer, fitOffsetCLogit, raceProbs, bootstrapRatio, clip, type Race,
} from '../src/engine/eval/offsetClogit.js';

const CUTOFFS = [20240901, 20250101, 20250401];
const BANDS: [number, number, string][] = [
  [0, 3, '~3배(인기)'], [3, 6, '3~6배'], [6, 10, '6~10배'], [10, 20, '10~20배'], [20, Infinity, '20배+(대박)'],
];
const bandOf = (odds: number) => BANDS.findIndex(([lo, hi]) => odds >= lo && odds < hi);
const binLL = (p: number, y: number) => -(y * Math.log(clip(p)) + (1 - y) * Math.log(1 - clip(p)));
const f4 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(4);

interface BandStat { delta: number; lo: number; hi: number; nHorse: number; nWin: number; llMkt: number; llMf: number; }

/** 말단위: 배당구간별 이진 로그로스 Δ (경주블록 부트스트랩). */
function horseBands(test: Race[], beta: number[], mean: number[], std: number[], boot: number): BandStat[] {
  return BANDS.map((_, b) => {
    let nHorse = 0, nWin = 0, sMkt = 0, sMf = 0;
    const perRace = test.map((r) => {
      const p = raceProbs(r, beta, mean, std);
      let num = 0, den = 0;
      for (let i = 0; i < r.odds.length; i++) {
        if (bandOf(r.odds[i]!) !== b) continue;
        const y = i === r.winner ? 1 : 0;
        const llMkt = binLL(r.marketProb[i]!, y), llMf = binLL(p[i]!, y);
        num += llMf - llMkt; den += 1;
        nHorse++; if (y) nWin++; sMkt += llMkt; sMf += llMf;
      }
      return { num, den };
    });
    const bs = bootstrapRatio(perRace, boot);
    return { delta: bs.mean, lo: bs.lo, hi: bs.hi, nHorse, nWin, llMkt: sMkt / nHorse, llMf: sMf / nHorse };
  });
}

/** 경주단위: 승자 배당구간별 grouped-LL Δ (승자 −log). */
function raceBands(test: Race[], beta: number[], mean: number[], std: number[], boot: number): BandStat[] {
  return BANDS.map((_, b) => {
    const inBand = test.filter((r) => bandOf(r.odds[r.winner]!) === b);
    let sMkt = 0, sMf = 0;
    const perRace = inBand.map((r) => {
      const wlMkt = -Math.log(clip(r.marketProb[r.winner]!));
      const wlMf = -Math.log(clip(raceProbs(r, beta, mean, std)[r.winner]!));
      sMkt += wlMkt; sMf += wlMf;
      return { num: wlMf - wlMkt, den: 1 };
    });
    const bs = inBand.length ? bootstrapRatio(perRace, boot) : { mean: NaN, lo: NaN, hi: NaN };
    return { delta: bs.mean, lo: bs.lo, hi: bs.hi, nHorse: inBand.length, nWin: inBand.length, llMkt: sMkt / inBand.length, llMf: sMf / inBand.length };
  });
}

/** 불일치 경주: 모델 top pick vs 시장 top pick 적중률 (win / top3). */
function disagreement(test: Race[], beta: number[], mean: number[], std: number[], boot: number) {
  const perRace: { num: number; den: number }[] = [];  // num = (모델픽승 − 시장픽승), den=1
  let n = 0, modelWin = 0, mktWin = 0, modelTop3 = 0, mktTop3 = 0;
  for (const r of test) {
    const p = raceProbs(r, beta, mean, std);
    const mPick = p.indexOf(Math.max(...p));
    const kPick = r.marketProb.indexOf(Math.max(...r.marketProb));  // 최저배당
    if (mPick === kPick) continue;
    n++;
    const mWon = mPick === r.winner ? 1 : 0;
    const kWon = kPick === r.winner ? 1 : 0;
    modelWin += mWon; mktWin += kWon;
    perRace.push({ num: mWon - kWon, den: 1 });
  }
  const bs = n ? bootstrapRatio(perRace, boot) : { mean: NaN, lo: NaN, hi: NaN };
  return { n, modelWin, mktWin, diff: bs.mean, lo: bs.lo, hi: bs.hi };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const boot = Number(arg('--boot', '1000'));
  const dropTokens = arg('--drop', '').split(',').map((s) => s.trim()).filter(Boolean);
  const isDropped = (name: string) => dropTokens.some((t) => name.includes(t));
  const opts = { l2: Number(arg('--l2', '0.02')), iters: 1200, lr: 0.5 };

  const allRows: { features: Feature[] }[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const keep = buildSchema(allRows.map((r) => r.features)).filter((n) => !isDropped(n));
  const { races, dropped } = loadRaces(matrixPath, keep);
  const d = races[0]!.x[0]!.length;
  console.log(`경주 ${races.length}개 (제외 ${dropped}) · 피처 ${keep.length}개${dropTokens.length ? ` (drop)` : ''} · 부트스트랩 ${boot}회`);
  console.log('Δ<0 = 그 구간서 시장+피처가 시장보다 나음(국소 알파). ⚠=표본 얇음.\n');

  // 컷오프별 학습 → 밴드 채점
  const horseByCut: BandStat[][] = [], raceByCut: BandStat[][] = [];
  for (const cutoff of CUTOFFS) {
    const train = races.filter((r) => r.date < cutoff);
    const test = races.filter((r) => r.date >= cutoff);
    const { mean, std } = standardizer(train, d);
    const beta = fitOffsetCLogit(train, mean, std, opts);
    const hb = horseBands(test, beta, mean, std, boot);
    const rb = raceBands(test, beta, mean, std, boot);
    horseByCut.push(hb); raceByCut.push(rb);

    console.log(`━━ 컷오프 ${cutoff}  (train ${train.length} / test ${test.length}) ━━`);
    console.log('① 말단위 배당구간 (이진 로그로스, 결과 비조건화 = 베팅 직결)');
    console.log('   구간          말수  승자   [시장]   [+피처]    Δ         95% CI            판정');
    hb.forEach((s, i) => {
      const thin = s.nWin < 30 ? ' ⚠' : '';
      const sig = s.hi < 0 ? '✅알파' : s.lo > 0 ? '❌악화' : '△0포함';
      console.log(`   ${BANDS[i]![2].padEnd(12)} ${String(s.nHorse).padStart(5)} ${String(s.nWin).padStart(4)}  ${s.llMkt.toFixed(3)}   ${s.llMf.toFixed(3)}   ${f4(s.delta)}  [${f4(s.lo)},${f4(s.hi)}] ${sig}${thin}`);
    });
    console.log('② 경주단위 (승자 배당구간, grouped-LL, ⚠결과조건화 해석주의)');
    rb.forEach((s, i) => {
      if (!s.nHorse) return;
      const thin = s.nHorse < 40 ? ' ⚠' : '';
      const sig = s.hi < 0 ? '✅알파' : s.lo > 0 ? '❌악화' : '△0포함';
      console.log(`   ${BANDS[i]![2].padEnd(12)} 경주 ${String(s.nHorse).padStart(4)}      ${s.llMkt.toFixed(3)}   ${s.llMf.toFixed(3)}   ${f4(s.delta)}  [${f4(s.lo)},${f4(s.hi)}] ${sig}${thin}`);
    });
    const dg = disagreement(test, beta, mean, std, boot);
    // Δ = 모델픽승률 − 시장픽승률. >0 이면 모델 우위, <0 이면 시장 우위.
    console.log(`③ 불일치 경주(모델픽≠시장픽) ${dg.n}건: 모델픽 단승 ${(dg.modelWin/dg.n*100).toFixed(1)}% vs 시장픽 ${(dg.mktWin/dg.n*100).toFixed(1)}%  Δ=${f4(dg.diff)} [${f4(dg.lo)},${f4(dg.hi)}] ${dg.lo>0?'✅모델우위':dg.hi<0?'❌시장우위':'△0포함'}`);
    console.log();
  }

  // 다중비교 가드: 3컷오프 전부 음수+CI<0 인 구간만 국소알파 인정
  console.log('='.repeat(64));
  console.log('[다중비교 가드] 국소알파 = 3컷오프 전부 CI 상한<0 (말단위 기준)');
  let anyAlpha = false;
  BANDS.forEach((band, i) => {
    const cells = horseByCut.map((hb) => hb[i]!);
    const allNeg = cells.every((c) => c.hi < 0);
    const anyNeg = cells.some((c) => c.hi < 0);
    if (allNeg) { anyAlpha = true; console.log(`  ✅ ${band[2]}: 3컷오프 전부 알파 강건 → 국소알파 인정`); }
    else if (anyNeg) console.log(`  △ ${band[2]}: 일부 컷오프만 음수 (${cells.map((c)=>c.hi<0?'✓':'✗').join('')}) → 다중비교 함정, 기각`);
  });
  console.log('='.repeat(64));
  console.log(anyAlpha
    ? '판정: 위 구간에서 국소알파 후보 (공제율 25% 넘는지 별도 확인 필요)'
    : '판정: 전 구간 국소알파 없음 — 공개피처로 총량·국소 모두 시장 못 이김 (완전 종결)');
}

main();
