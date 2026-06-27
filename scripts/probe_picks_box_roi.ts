// scripts/probe_picks_box_roi.ts
/**
 * 복승 박스 ROI (OOS walk-forward) — "3~4마리 골라 그 안에서 복승 박스" 전략 정직 검증. 읽기전용.
 *
 * 절차: base 로지스틱 = train(race_date<split) top3 학습 → test 경주마다 OOS 점수.
 *   topN 박스 = 점수 상위 N마리의 모든 2조합(C(N,2)개) 매수. 박스 적중 = 그중 한 쌍이 실제 1·2착(무순).
 *   ROI = Σ회수 / Σ비용(=조합수) − 1.  복승배당 = data/quinella_dividends.jsonl(마번키).
 *   강추박스 = OOS 보정 p_top3(Platt도 train만 적합) ≥ 강추임계 말이 ≥2면 그 풀 박스.
 *
 * 사용: npm run probe:picks:box [-- --split 20250101]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getLocalDb } from '../src/db/localDb.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { sigmoid, fitPlatt, applyPlatt, type Pair } from '../src/engine/eval/calibration.js';
import { pairKey } from '../src/engine/analysis/comboBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d; };
const signed = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
const quarter = (d: number): string => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;

interface MRow { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; top3: number; features: Feature[]; }

interface BoxAgg { cost: number; payout: number; hits: number; races: number; byQ: Map<string, { cost: number; payout: number }>; }
const newAgg = (): BoxAgg => ({ cost: 0, payout: 0, hits: 0, races: 0, byQ: new Map() });

function main(): void {
  const split = Number(arg('--split', '20250101'));
  const cfg = JSON.parse(readFileSync('client/src/config/selective_picks.json', 'utf8'));
  const sMin: number = cfg.tiers.strong.minProb;

  // 복승 배당
  const comboOdds = new Map<string, Map<string, number>>();
  for (const l of readFileSync('data/quinella_dividends.jsonl', 'utf8').split('\n').filter((s) => s.trim())) {
    const d = JSON.parse(l);
    const rk = `${d.race_date}-${d.meet}-${d.rc_no}`;
    if (!comboOdds.has(rk)) comboOdds.set(rk, new Map());
    comboOdds.get(rk)!.set(pairKey(d.a, d.b), d.odds);
  }

  void (async () => {
    // pthr 맵
    const db = await getLocalDb();
    const { data: e } = await db.from('race_entries').select('race_date, meet, rc_no, hr_name, pthr_no');
    const pthr = new Map<string, number>();
    for (const r of (e ?? []) as any[]) pthr.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r.pthr_no);

    // training_matrix
    const all: MRow[] = readFileSync('data/training_matrix.jsonl', 'utf8').split('\n').filter((s) => s.trim()).map((s) => JSON.parse(s));
    const train = all.filter((r) => r.race_date < split);
    const test = all.filter((r) => r.race_date >= split);
    const schema = buildSchema(train.map((r) => r.features));
    const base = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
    const rawProb = (r: MRow): number => sigmoid(predictLogit(base, toVector(r.features, schema)));
    const platt3 = fitPlatt(train.map((r): Pair => ({ p: rawProb(r), y: r.top3 })));

    const byRace = new Map<string, MRow[]>();
    for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }

    // 확신 임계값 스윕: p_top3 ≥ thr 인 말이 ≥2 인 경주만, 그 풀을 복승 박스
    const CONF_THRS = [0.5, 0.55, 0.6, 0.65, 0.7];
    const aggs: Record<string, BoxAgg> = { top2: newAgg(), top3: newAgg(), top4: newAgg(), strong: newAgg() };
    for (const t of CONF_THRS) aggs[`conf${t}`] = newAgg();

    const settle = (name: string, pool: { p: number }[], rk: string, winKey: string, odds: Map<string, number>, q: string) => {
      if (pool.length < 2) return;
      const a = aggs[name]!;
      let cost = 0, payout = 0, hit = false;
      for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
        cost += 1;
        if (pairKey(pool[i]!.p, pool[j]!.p) === winKey) { payout += odds.get(winKey) ?? 0; hit = true; }
      }
      a.cost += cost; a.payout += payout; a.races += 1; if (hit) a.hits += 1;
      const qc = a.byQ.get(q) ?? { cost: 0, payout: 0 };
      qc.cost += cost; qc.payout += payout; a.byQ.set(q, qc);
    };

    for (const [rk, hs] of byRace) {
      const odds = comboOdds.get(rk); if (!odds) continue;
      const withP = hs.map((h) => ({ h, p: pthr.get(`${rk}-${h.hr_name}`), s: predictLogit(base, toVector(h.features, schema)), pt3: applyPlatt(platt3, rawProb(h)) }))
        .filter((x) => x.p != null && x.h.ord != null) as { h: MRow; p: number; s: number; pt3: number }[];
      if (withP.length < 2) continue;
      const fin = [...withP].filter((x) => x.h.ord! >= 1).sort((a, b) => a.h.ord! - b.h.ord!);
      if (fin.length < 2) continue;
      const winKey = pairKey(fin[0]!.p, fin[1]!.p);
      const ranked = [...withP].sort((a, b) => b.s - a.s);
      const q = quarter(hs[0]!.race_date);
      settle('top2', ranked.slice(0, 2), rk, winKey, odds, q);
      settle('top3', ranked.slice(0, 3), rk, winKey, odds, q);
      settle('top4', ranked.slice(0, 4), rk, winKey, odds, q);
      settle('strong', withP.filter((x) => x.pt3 >= sMin), rk, winKey, odds, q);
      for (const t of CONF_THRS) settle(`conf${t}`, withP.filter((x) => x.pt3 >= t), rk, winKey, odds, q);
    }

    console.log(`📊 복승 박스 ROI (OOS) — split ${split} · test ${test.length}행`);
    console.log('   박스 = 점수 상위 N마리 모든 2조합 매수. 적중=박스 안에 실제 1·2착쌍(무순). 사후배당→낙관 상한. 손익분기 0%\n');
    console.log('전략       | 베팅경주 | 조합수 | 박스적중 | 박스적중률 | 회수배수 |   ROI');
    console.log('-'.repeat(72));
    const label: Record<string, string> = { top2: 'top2(1쌍)', top3: 'top3(3쌍)', top4: 'top4(6쌍)', strong: `강추박스(≥${sMin})` };
    for (const t of CONF_THRS) label[`conf${t}`] = `확신박스≥${t}`;
    const rowKeys = ['top2', 'top3', 'top4', 'strong', ...CONF_THRS.map((t) => `conf${t}`)];
    for (const k of rowKeys) {
      const a = aggs[k]!;
      const roi = a.cost ? (a.payout / a.cost - 1) * 100 : 0;
      const hitRate = a.races ? a.hits / a.races * 100 : 0;
      const retMult = a.cost ? a.payout / a.cost : 0;
      console.log(`${label[k]!.padEnd(11)} | ${String(a.races).padStart(8)} | ${String(a.cost).padStart(6)} | ${String(a.hits).padStart(8)} | ${hitRate.toFixed(1).padStart(9)}% | ${retMult.toFixed(3).padStart(7)} | ${signed(roi).padStart(7)}`);
    }

    console.log('\n═══ 분기별 ROI ═══');
    const quarters = [...new Set(test.map((r) => quarter(r.race_date)))].sort();
    console.log('전략       | ' + quarters.map((q) => q.padStart(11)).join(' | '));
    for (const k of ['top4', 'conf0.55', 'conf0.6', 'conf0.65']) {
      const a = aggs[k]!;
      const cells = quarters.map((q) => {
        const qc = a.byQ.get(q);
        if (!qc || qc.cost === 0) return '     -     ';
        return `${signed((qc.payout / qc.cost - 1) * 100)}(${qc.cost})`.padStart(11);
      });
      console.log(`${label[k]!.padEnd(11)} | ${cells.join(' | ')}`);
    }
    console.log('\n판정: 박스 키우면 적중률↑(조합 많음)이나 비용도↑ — ROI가 흑자로 바뀌는지가 핵심(공제율 벽).');
  })();
}

main();
