import { toVector } from '../features/alignFeatures.js';
import { predictLogit } from '../models/logistic.js';
import { predictGBDT } from '../models/gbdt.js';
import { predictPL } from '../models/plackettLuce.js';
import type { RaceRecord, HorseRecord } from './types.js';
import type { TrainedModels } from './models.js';
import type { GateBResult } from './gates.js';
import { printGateB } from './gates.js';

// ── 평가 ──────────────────────────────────────────────────────────

interface RaceResult {
  win: boolean;
  place: boolean;
  quinella: boolean;
}

interface MethodTally {
  win: number; place: number; quinella: number; n: number;
}

const emptyTally = (): MethodTally => ({ win: 0, place: 0, quinella: 0, n: 0 });

function quarterOf(raceDate: number): string {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

const METHOD_KEYS = [
  'market', 'spearman',
  'logisticTop1', 'logisticTop2', 'logisticTop3',
  'gbdtTop1', 'gbdtTop2', 'gbdtTop3', 'pl',
] as const;

type MethodKey = typeof METHOD_KEYS[number];

function evaluateRace(
  race: RaceRecord,
  models: TrainedModels
): Record<MethodKey, RaceResult> {
  const { horses } = race;
  const schema = models.featureSchema;

  const scoreHorses = (scorer: (h: HorseRecord) => number): RaceResult => {
    const sorted = [...horses].sort((a, b) => scorer(b) - scorer(a));
    const top1 = sorted[0];
    const top2Nos = new Set([sorted[0]?.pthrNo, sorted[1]?.pthrNo]);
    const win = top1 ? top1.ord === 1 : false;
    const place = top1 ? top1.ord <= 3 : false;
    const actual12 = horses.filter((h) => h.ord <= 2).map((h) => h.pthrNo);
    const quinella = actual12.length === 2 && actual12.every((p) => top2Nos.has(p));
    return { win, place, quinella };
  };

  return {
    market: (() => {
      const hasOdds = horses.some((h) => h.winOdds != null && h.winOdds > 0);
      if (!hasOdds) return { win: false, place: false, quinella: false };
      return scoreHorses((h) => (h.winOdds != null && h.winOdds > 0) ? -h.winOdds! : -Infinity);
    })(),
    spearman: scoreHorses((h) => {
      let s = 0;
      for (const [id, w] of Object.entries(models.spearmanWeights))
        s += (h.rawScores[id] ?? 0) * w;
      return s;
    }),
    logisticTop1: scoreHorses((h) => predictLogit(models.logisticTop1, toVector(h.features, schema))),
    logisticTop2: scoreHorses((h) => predictLogit(models.logisticTop2, toVector(h.features, schema))),
    logisticTop3: scoreHorses((h) => predictLogit(models.logisticTop3, toVector(h.features, schema))),
    gbdtTop1: scoreHorses((h) => predictGBDT(models.gbdtTop1, toVector(h.features, schema))),
    gbdtTop2: scoreHorses((h) => predictGBDT(models.gbdtTop2, toVector(h.features, schema))),
    gbdtTop3: scoreHorses((h) => predictGBDT(models.gbdtTop3, toVector(h.features, schema))),
    pl:        scoreHorses((h) => predictPL(models.pl, toVector(h.features, schema))),
  };
}

export function evaluate(
  races: RaceRecord[],
  models: TrainedModels
): { overall: Record<MethodKey, MethodTally>; byQuarter: Map<string, Record<MethodKey, MethodTally>> } {
  const overall = Object.fromEntries(METHOD_KEYS.map((k) => [k, emptyTally()])) as Record<MethodKey, MethodTally>;
  const byQuarter = new Map<string, Record<MethodKey, MethodTally>>();

  for (const race of races) {
    const q = quarterOf(race.raceDate);
    if (!byQuarter.has(q)) {
      byQuarter.set(q, Object.fromEntries(METHOD_KEYS.map((k) => [k, emptyTally()])) as Record<MethodKey, MethodTally>);
    }
    const results = evaluateRace(race, models);
    for (const k of METHOD_KEYS) {
      const res = results[k];
      const t = overall[k];
      t.n++; if (res.win) t.win++; if (res.place) t.place++; if (res.quinella) t.quinella++;
      const qt = byQuarter.get(q)![k];
      qt.n++; if (res.win) qt.win++; if (res.place) qt.place++; if (res.quinella) qt.quinella++;
    }
  }
  return { overall, byQuarter };
}

// ── 리포트 출력 ───────────────────────────────────────────────────

const METHOD_LABELS: Record<MethodKey, string> = {
  market:       '시장 배당',
  spearman:     'Spearman',
  logisticTop1: 'Logistic (top1)',
  logisticTop2: 'Logistic (top2)',
  logisticTop3: 'Logistic (top3)',
  gbdtTop1:     'GBDT     (top1)',
  gbdtTop2:     'GBDT     (top2)',
  gbdtTop3:     'GBDT     (top3)',
  pl:           'Plackett-Luce',
};

function pct(n: number, d: number): string { return d ? `${(n / d * 100).toFixed(1)}%` : '-'; }

export function printReport(
  evalResult: ReturnType<typeof evaluate>,
  gateBResults: GateBResult[]
): void {
  const { overall, byQuarter } = evalResult;
  const quarters = [...byQuarter.keys()].sort();

  // 분기별 연승률
  console.log('\n=== 연승률 (1순위 예측마가 3착이내) ===\n');
  const qHeader = '방법'.padEnd(22) + '│' + quarters.map((q) => ` ${q}  `).join('│') + '│ 전체';
  console.log(qHeader);
  console.log('─'.repeat(qHeader.length));
  for (const k of METHOD_KEYS) {
    const row = METHOD_LABELS[k].padEnd(22) + '│'
      + quarters.map((q) => { const t = byQuarter.get(q)![k]; return ` ${pct(t.place, t.n).padStart(6)} `; }).join('│')
      + '│ ' + pct(overall[k].place, overall[k].n);
    console.log(row);
  }

  // 전체 요약
  console.log('\n=== 전체 요약 (2026년) ===\n');
  console.log('방법'.padEnd(22) + '│ 단승율 │ 연승율 │ 복승율 │ n경주');
  console.log('─'.repeat(65));
  for (const k of METHOD_KEYS) {
    const t = overall[k];
    console.log(
      METHOD_LABELS[k].padEnd(22) + '│'
      + ` ${pct(t.win, t.n).padStart(6)} │`
      + ` ${pct(t.place, t.n).padStart(6)} │`
      + ` ${pct(t.quinella, t.n).padStart(6)} │`
      + ` ${String(t.n).padStart(5)}`
    );
  }

  // 게이트 B 요약 (상단 참고용)
  console.log('\n=== 항목 포함 현황 (게이트 B 결과) ===');
  printGateB(gateBResults);
}
