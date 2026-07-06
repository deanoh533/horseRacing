/**
 * 재료 감사 — 운영 로지스틱(top3)이 먹는 피처가 실제로 일하는지 점검.
 *   ① 커버리지: 값이 실제로 있는 행 비율(0 아님)
 *   ② 단변량 상관: 각 피처 ↔ top3 point-biserial r (단독 신호)
 *   ③ 표준화 계수: 운영과 동일 로지스틱(l2 0.02) 적합 후 |1SD당 기여|
 * 다중공선성 탓에 coef 작아도 무용은 아님 → corr와 함께 봐야 판단.
 * 오프라인: data/training_matrix.jsonl만 읽음. 사용: npm run probe:features
 */
import { readFileSync } from 'node:fs';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { top3: number; features: Feature[]; }

function pointBiserial(x: number[], y: number[]): number {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]!; my += y[i]!; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i]! - mx, dy = y[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');

  const rows: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(rows.map((r) => r.features));
  const X = rows.map((r) => toVector(r.features, schema));
  const y = rows.map((r) => r.top3);
  const n = rows.length, d = schema.length;
  const baseRate = y.reduce((a, b) => a + b, 0) / n;

  const model = fitLogistic(X, y, schema, { l2: 0.02, iters: 800, lr: 0.2 });

  // 컬럼별 커버리지(0 아님) + 단변량 상관
  const stat = schema.map((name, j) => {
    let nz = 0;
    const col = new Array(n);
    for (let i = 0; i < n; i++) { const v = X[i]![j]!; col[i] = v; if (v !== 0) nz++; }
    return { name, coef: model.coef[name]!, corr: pointBiserial(col, y), cov: nz / n };
  });

  console.log(`행 ${n} · 피처 ${d} · top3 기저율 ${(baseRate * 100).toFixed(1)}%  (l2=0.02 로지스틱)\n`);

  const byCoef = [...stat].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));
  console.log('── 일하는 재료 TOP 25 (표준화 계수 = 1SD당 top3 logit 기여) ──');
  console.log('   coef     corr    cov%   피처');
  byCoef.slice(0, 25).forEach((s) => {
    const c = (s.coef >= 0 ? '+' : '') + s.coef.toFixed(3);
    const r = (s.corr >= 0 ? '+' : '') + s.corr.toFixed(3);
    console.log(`  ${c.padStart(7)}  ${r.padStart(6)}  ${(s.cov * 100).toFixed(0).padStart(4)}   ${s.name}`);
  });

  const dead = byCoef.filter((s) => Math.abs(s.coef) < 0.02);
  console.log(`\n── 죽은 무게 후보 |coef|<0.02 : ${dead.length}개 ──`);
  console.log('  (단변량 상관도 약하면 진짜 무용. corr 큰데 coef 작으면=다른 재료에 흡수)');
  dead.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr)).forEach((s) => {
    const flag = Math.abs(s.corr) > 0.05 ? ' ⚠흡수(corr유의)' : '';
    console.log(`  coef${(s.coef >= 0 ? '+' : '') + s.coef.toFixed(3)}  corr${(s.corr >= 0 ? '+' : '') + s.corr.toFixed(3)}  cov${(s.cov * 100).toFixed(0)}%  ${s.name}${flag}`);
  });

  const sparse = stat.filter((s) => s.cov < 0.3).sort((a, b) => a.cov - b.cov);
  console.log(`\n── 희소 재료 커버리지<30% : ${sparse.length}개 ──`);
  sparse.forEach((s) => console.log(`  cov${(s.cov * 100).toFixed(0).padStart(3)}%  coef${(s.coef >= 0 ? '+' : '') + s.coef.toFixed(3)}  ${s.name}`));
}

main();
