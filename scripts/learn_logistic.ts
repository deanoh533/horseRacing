/**
 * Stage-1 로지스틱/PL-top3 후보 버전 학습·삽입 (is_active=false).
 * 전 확정경주 학습행렬(training_matrix.jsonl) → fitLogistic|fitPL → model_versions(artifact).
 * 사용: npm run learn:logistic -- --matrix data/training_matrix.jsonl --label v4-logit
 *      npm run learn:logistic -- --matrix data/matrix.jsonl --label v8-cand --model pl-top3 --l2 0.02 --iters 800 --shadow
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { fitPL } from '../src/engine/models/plackettLuce.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

export interface MatrixRow {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  ord: number;
  top3: number;
  features: Feature[];
}

/** 학습행렬 행을 경주(race_date·meet·rc_no) 단위로 묶는다. PL 학습용. */
export function groupRowsByRace(rows: MatrixRow[], schema: string[]): { horses: { x: number[]; ord: number }[] }[] {
  const m = new Map<string, { x: number[]; ord: number }[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ x: toVector(r.features, schema), ord: r.ord });
  }
  return [...m.values()].map((horses) => ({ horses }));
}

/** train_until = 학습행렬의 최대 경주일. */
export function maxRaceDate(rows: { race_date: number }[]): number {
  return rows.reduce((mx, r) => Math.max(mx, r.race_date), 0);
}

export interface LearnArgs {
  matrixPath: string;
  label: string;
  modelType: 'logistic' | 'pl-top3';
  l2: number;
  iters: number;
  shadow: boolean;
}

/** CLI 인자 파싱 + 검증(순수 함수). --model/--l2/--iters 오탈자·비정상값을 조기 차단해 Supabase 삽입 전 provenance를 보호한다. */
export function parseLearnArgs(args: string[]): LearnArgs {
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const flag = (k: string) => args.includes(k);
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const label = arg('--label', 'v4-logit');

  const modelTypeRaw = arg('--model', 'logistic');
  if (modelTypeRaw !== 'logistic' && modelTypeRaw !== 'pl-top3') {
    throw new Error(`--model은 'logistic' 또는 'pl-top3'만 허용 (받은 값: ${modelTypeRaw})`);
  }

  const l2Raw = arg('--l2', '0.02');
  const l2 = Number(l2Raw);
  if (!Number.isFinite(l2) || l2 <= 0) {
    throw new Error(`--l2는 0보다 큰 유한수여야 함 (받은 값: ${l2Raw})`);
  }

  const itersRaw = arg('--iters', '800');
  const iters = Number(itersRaw);
  if (!Number.isInteger(iters) || iters <= 0) {
    throw new Error(`--iters는 0보다 큰 정수여야 함 (받은 값: ${itersRaw})`);
  }

  const shadow = flag('--shadow');

  return { matrixPath, label, modelType: modelTypeRaw, l2, iters, shadow };
}

async function main() {
  const { matrixPath, label, modelType, l2, iters, shadow } = parseLearnArgs(process.argv.slice(2));

  const rows: MatrixRow[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(rows.map((r) => r.features));
  const model = modelType === 'pl-top3'
    ? fitPL(groupRowsByRace(rows, schema), schema, { l2, iters, lr: 0.2, topK: 3 })
    : fitLogistic(rows.map((r) => toVector(r.features, schema)), rows.map((r) => r.top3), schema, { l2, iters, lr: 0.2 });
  const trainUntil = maxRaceDate(rows);
  console.log(`학습완료: ${rows.length}행, 피처 ${schema.length}, model=${modelType}, train_until=${trainUntil}`);

  const notes = `Stage-1 ${modelType} 후보. 학습행렬 ${matrixPath} ${rows.length}행. l2=${l2}, iters=${iters}, train_until=${trainUntil}.`;

  if (process.env.DATABASE_URL) {
    const pgModule = await import('pg') as any;
    const { Client, types } = pgModule.default ?? pgModule;
    types.setTypeParser(1700, (v: string) => parseFloat(v));
    const pgClient = new Client({ connectionString: process.env.DATABASE_URL.replace(/##/g, '%23%23'), ssl: { rejectUnauthorized: false } });
    await pgClient.connect();
    const res = await pgClient.query(
      `INSERT INTO model_versions (label, model_type, weights, artifact, source, is_active, is_shadow, train_until, notes)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8) RETURNING id`,
      [label, modelType, JSON.stringify({}), JSON.stringify(model), 'learned', shadow, trainUntil, notes]
    );
    await pgClient.end();
    console.log(`✅ 후보 삽입: id=${res.rows[0].id} label=${label} (is_active=false${shadow ? ', is_shadow=true' : ''}). 검증 후 promote.`);
  } else {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('model_versions').insert({
      label, model_type: modelType, weights: {}, artifact: model, source: 'learned', is_active: false,
      is_shadow: shadow, train_until: trainUntil, notes,
    }).select('id').single();
    if (error) throw error;
    console.log(`✅ 후보 삽입: id=${data!.id} label=${label} (is_active=false${shadow ? ', is_shadow=true' : ''}). 검증 후 promote.`);
  }
}

if (process.argv[1]?.endsWith('learn_logistic.ts')) main().catch((e) => { console.error('💥', e); process.exit(1); });
