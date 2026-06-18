/**
 * 라이브 Platt 보정자 학습 — P1 전용 모델 + Platt(P1·P3)을 활성 아티팩트에 임베드.
 * 보정자는 활성 모델의 학습행렬과 같은 데이터로 fit(누수 노트: 설계 §9).
 * 사용: npm run calib:fit-live -- [--matrix data/training_matrix.jsonl] [--renorm] [--target local|supabase]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { sigmoid, normalizeProbs, fitPlatt, type Pair } from '../src/engine/eval/calibration.js';
import type { Calibration } from '../src/engine/eval/calibratedProbs.js';
import type { Feature } from '../src/engine/features/types.js';

export interface MatrixRow {
  race_date: number; meet: number; rc_no: number;
  ord: number; top3: number; features: Feature[];
}

const CFG = { l2: 0.02, iters: 800, lr: 0.2 }; // learn_logistic과 동일

/** base 모델(랭킹용 top3)·학습행렬 → Calibration. 스키마는 base.features에 고정(라이브 패리티). */
export function buildCalibration(
  base: LogisticModel,
  rows: MatrixRow[],
  opts: { renormWin: boolean; baseModelId: number },
): Calibration {
  const schema = base.features;
  const X = rows.map((r) => toVector(r.features, schema));
  const y1 = rows.map((r) => (r.ord === 1 ? 1 : 0));
  const p1Model = fitLogistic(X, y1, schema, CFG);

  // platt3: base(top3) raw 확률 vs top3 라벨 (정규화 안 함)
  const p3Pairs: Pair[] = rows.map((r, i) => ({ p: sigmoid(predictLogit(base, X[i]!)), y: r.top3 }));
  const platt3 = fitPlatt(p3Pairs);

  // platt1: 경주내 정규화된 P1 vs ord===1 라벨
  const byRace = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    const arr = byRace.get(k);
    if (arr) arr.push(i); else byRace.set(k, [i]);
  });
  const p1Pairs: Pair[] = [];
  for (const idxs of byRace.values()) {
    const norm = normalizeProbs(idxs.map((i) => sigmoid(predictLogit(p1Model, X[i]!))));
    idxs.forEach((i, k) => p1Pairs.push({ p: norm[k]!, y: rows[i]!.ord === 1 ? 1 : 0 }));
  }
  const platt1 = fitPlatt(p1Pairs);

  return {
    p1Model, platt1, platt3, renormWin: opts.renormWin,
    fitMeta: {
      rows: rows.length,
      from: Math.min(...rows.map((r) => r.race_date)),
      to: Math.max(...rows.map((r) => r.race_date)),
      fitAt: new Date().toISOString(),
      baseModelId: opts.baseModelId,
    },
  };
}

async function readActiveArtifact(): Promise<{ id: number; artifact: LogisticModel }> {
  const sb = await getReadClient();
  const { data, error } = await sb.from('model_versions')
    .select('id, model_type, artifact').eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('활성 model_versions 없음');
  if (data.model_type !== 'logistic') throw new Error(`활성 모델이 logistic 아님: ${data.model_type}`);
  const artifact = typeof data.artifact === 'string' ? JSON.parse(data.artifact) : data.artifact;
  return { id: Number(data.id), artifact: artifact as LogisticModel };
}

async function writeLocal(id: number, artifact: object): Promise<void> {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const inst = await DuckDBInstance.create('data/local.duckdb');
  const conn = await inst.connect();
  // conn.run() supports positional $1/$2 parameters via DuckDBValue[] (string|number are native DuckDBValue)
  const json = JSON.stringify(artifact);
  await conn.run(
    `UPDATE model_versions SET artifact = $1 WHERE id = $2`,
    [json, id],
  );
}

async function writeSupabase(id: number, artifact: object): Promise<void> {
  const { getSupabaseAdmin } = await import('../src/db/supabase.js');
  const sb = getSupabaseAdmin();
  const { error } = await sb.from('model_versions').update({ artifact }).eq('id', id);
  if (error) throw error;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const renormWin = args.includes('--renorm');
  const target = arg('--target', 'local');

  const rows: MatrixRow[] = readFileSync(matrixPath, 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const { id, artifact: base } = await readActiveArtifact();
  console.log(`활성 모델 id=${id}, 학습행렬 ${rows.length}행, renormWin=${renormWin}`);

  const calibration = buildCalibration(base, rows, { renormWin, baseModelId: id });
  const augmented = { ...base, calibration };
  console.log(`platt1={a:${calibration.platt1.a.toFixed(3)},b:${calibration.platt1.b.toFixed(3)}} ` +
              `platt3={a:${calibration.platt3.a.toFixed(3)},b:${calibration.platt3.b.toFixed(3)}}`);

  if (target === 'supabase') { await writeSupabase(id, augmented); console.log('✅ Supabase 기록'); }
  else { await writeLocal(id, augmented); console.log('✅ 로컬 DuckDB 기록'); }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
