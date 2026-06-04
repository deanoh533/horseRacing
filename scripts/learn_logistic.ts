/**
 * Stage-1 로지스틱 후보 버전 학습·삽입 (is_active=false).
 * 전 확정경주 학습행렬(training_matrix.jsonl) → fitLogistic → model_versions(artifact).
 * 사용: npm run learn:logistic -- --matrix data/training_matrix.jsonl --label v4-logit
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { top3: number; features: Feature[]; }

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const label = arg('--label', 'v4-logit');

  const rows: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(rows.map((r) => r.features));
  const model = fitLogistic(rows.map((r) => toVector(r.features, schema)), rows.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
  console.log(`학습완료: ${rows.length}행, 피처 ${schema.length}, intercept ${model.intercept.toFixed(3)}`);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('model_versions').insert({
    label, model_type: 'logistic', weights: {}, artifact: model, source: 'learned', is_active: false,
    notes: `Stage-1 로지스틱 후보. 학습행렬 ${matrixPath} ${rows.length}행.`,
  }).select('id').single();
  if (error) throw error;
  console.log(`✅ 후보 삽입: id=${data!.id} label=${label} (is_active=false). 검증 후 promote.`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
