/**
 * 신규 후보 피처 ↔ 기존 피처 상관계수 진단 (읽기전용, 행렬만 사용).
 *
 * 원칙: 새 feature가 기존과 |r|>0.5면 중복(다중공선성) → 후보에서 뺀다.
 * 각 신규 후보에 대해 모든 다른 피처와 Pearson r을 계산, 상위 상관을 출력.
 *
 * 사용:
 *   npm run probe:corr -- --matrix data/training_matrix.jsonl
 *   npm run probe:corr -- --new early_pos_s1f_mean,late_200m_speed_mean
 */
import { readFileSync } from 'node:fs';
import type { Feature } from '../src/engine/features/types.js';

const DEFAULT_NEW = [
  'early_pos_s1f_mean', 'early_pos_s1f_ratio_mean',
  'late_pos_g1f_mean', 'late_pos_g1f_ratio_mean',
  'late_200m_speed_mean', 'early_to_finish_gain_mean',
];

interface Row { features: Feature[]; }

/** 그 행에서 피처가 실제로 present (이름 존재 AND __missing≠1). */
function presentMap(fs: Feature[]): Map<string, number> {
  const m = new Map(fs.map((f) => [f.name, f.value]));
  const out = new Map<string, number>();
  for (const [name, v] of m) {
    if (name.endsWith('__missing')) continue;
    if (m.get(`${name}__missing`) === 1) continue;
    out.set(name, v);
  }
  return out;
}

/** 두 배열 Pearson r (짝지어진 present 값만). */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const newFeats = arg('--new', DEFAULT_NEW.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

  const rows: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const maps = rows.map((r) => presentMap(r.features));

  // 전체 피처 이름 수집
  const allNames = new Set<string>();
  for (const m of maps) for (const k of m.keys()) allNames.add(k);

  console.log(`\n신규 후보 ↔ 기존 피처 상관 진단 — ${rows.length}행, 피처 ${allNames.size}개`);
  console.log('='.repeat(72));

  for (const nf of newFeats) {
    const present = maps.filter((m) => m.has(nf)).length;
    if (present === 0) { console.log(`\n❓ ${nf}: 행렬에 없음 (extract:matrix 재실행 필요)`); continue; }

    const corrs: { name: string; r: number; n: number }[] = [];
    for (const other of allNames) {
      if (other === nf) continue;
      const xs: number[] = [], ys: number[] = [];
      for (const m of maps) {
        if (m.has(nf) && m.has(other)) { xs.push(m.get(nf)!); ys.push(m.get(other)!); }
      }
      const r = pearson(xs, ys);
      if (Number.isFinite(r)) corrs.push({ name: other, r, n: xs.length });
    }
    corrs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const maxAbs = corrs[0] ? Math.abs(corrs[0].r) : 0;
    const verdict = maxAbs > 0.5 ? '❌ 중복(|r|>0.5) — 후보 제외' : '✅ 새 정보(|r|≤0.5) — holdout 진행';
    console.log(`\n▸ ${nf}  (present ${present}행)  → ${verdict}`);
    for (const c of corrs.slice(0, 5)) {
      const flag = Math.abs(c.r) > 0.5 ? ' ⚠️' : '';
      console.log(`    r=${c.r >= 0 ? '+' : ''}${c.r.toFixed(3)}  ${c.name} (n=${c.n})${flag}`);
    }
  }
  console.log('\n' + '='.repeat(72));
  console.log('|r|>0.5인 후보는 빼고, 살아남은 것만 backtest:box(top2)로 ROI 검증.');
}

main();
