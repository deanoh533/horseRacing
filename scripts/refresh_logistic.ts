/**
 * 로지스틱 재학습 + 검증 일괄 실행.
 * training_matrix.jsonl이 최신 상태라고 가정 (필요시 먼저 npm run extract:matrix 실행).
 *
 * 흐름:
 *   1. 타임스탬프 레이블 자동 생성 (예: logit-20260609)
 *   2. fitLogistic → model_versions 삽입 (is_active=false)
 *   3. verify: 파리티 + 섀도우 연승 출력
 *   4. 승격 여부 사람이 판단 → npm run promote -- --version <id>
 *
 * 사용:
 *   npm run refresh:logistic
 *   npm run refresh:logistic -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import type { ReadClient } from '../src/db/localDb.js';
import { scoreLogistic } from '../src/engine/logisticScorer.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row {
  race_date: number; meet: number; rc_no: number;
  hr_name: string; ord: number | null; top3: number;
  features: Feature[];
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));
  const maxRaces = Number(arg('--races', '80'));

  // 타임스탬프 레이블
  const today = new Date();
  const label = `logit-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  console.log(`\n🔄 로지스틱 재학습 — 행렬: ${matrixPath}  레이블: ${label}`);
  console.log('='.repeat(60));

  // ── 1. 학습 (전 데이터) ──────────────────────────────────────
  const all: Row[] = readFileSync(matrixPath, 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(all.map((r) => r.features));
  const model: LogisticModel = fitLogistic(
    all.map((r) => toVector(r.features, schema)),
    all.map((r) => r.top3),
    schema,
    { l2: 0.02, iters: 800, lr: 0.2 },
  );
  console.log(`[1/3] 학습 완료: ${all.length}행, 피처 ${schema.length}개, intercept ${model.intercept.toFixed(3)}`);

  // model_versions 삽입
  const sb = getSupabaseAdmin();
  const { data: inserted, error: insErr } = await sb
    .from('model_versions')
    .insert({
      label,
      model_type: 'logistic',
      weights: {},
      artifact: model,
      source: 'learned',
      is_active: false,
      notes: `refresh:logistic ${matrixPath} ${all.length}행`,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  const newId = inserted!.id as number;
  console.log(`      → model_versions id=${newId} (is_active=false)`);

  // ── 2. 오프라인 검증 (split 이후 테스트) ────────────────────
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);
  const trainSchema = buildSchema(train.map((r) => r.features));
  const trainModel: LogisticModel = fitLogistic(
    train.map((r) => toVector(r.features, trainSchema)),
    train.map((r) => r.top3),
    trainSchema,
    { l2: 0.02, iters: 800, lr: 0.2 },
  );

  const byRace = new Map<string, Row[]>();
  for (const r of test) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }
  let hit = 0, n = 0;
  for (const horses of byRace.values()) {
    const sorted = horses
      .map((h) => ({ ord: h.ord, s: predictLogit(trainModel, toVector(h.features, trainSchema)) }))
      .filter((x) => x.ord != null)
      .sort((a, b) => b.s - a.s);
    if (sorted.length) { n++; if ((sorted[0]!.ord as number) <= 3) hit++; }
  }
  const offlineShow = n ? ((hit / n) * 100).toFixed(1) : '-';
  console.log(`[2/3] 오프라인 검증 (train<${split}, test>=${split}): 연승 ${offlineShow}%  (n=${n}경주)`);

  // ── 3. 라이브 패리티 (최근 N경주) ──────────────────────────
  console.log(`[3/3] 라이브 패리티 검증 (최근 ${maxRaces}경주)...`);
  const recentRaces: { race_date: number; meet: number; rc_no: number }[] = [];
  const seen = new Set<string>();
  for (let off = 0; recentRaces.length < maxRaces; off += 200) {
    const { data, error } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no')
      .not('actual_ord', 'is', null)
      .gte('race_date', split)
      .order('race_date', { ascending: false })
      .range(off, off + 199);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number }[]) {
      const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
      if (!seen.has(k)) { seen.add(k); recentRaces.push(r); }
      if (recentRaces.length >= maxRaces) break;
    }
    if (data.length < 200) break;
  }

  let parityMismatch = 0, liveParity = 0, liveHit = 0, liveN = 0;
  const matrixByRace = new Map<string, Row[]>();
  for (const r of test) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!matrixByRace.has(k)) matrixByRace.set(k, []);
    matrixByRace.get(k)!.push(r);
  }

  for (const rc of recentRaces.slice(0, maxRaces)) {
    const rk = `${rc.race_date}-${rc.meet}-${rc.rc_no}`;
    const offline = matrixByRace.get(rk);
    if (!offline) continue;

    const liveInputs = await gatherRaceInputs(sb as unknown as ReadClient, rc.race_date, rc.meet, rc.rc_no);
    const live = liveInputs.map((row) => ({
      hr: row.hr_name,
      s: scoreLogistic(model, row.input).total,
      ord: row.ord,
    }));
    const offlineScores = offline.map((r) => ({
      hr: r.hr_name,
      s: predictLogit(model, toVector(r.features, schema)),
    }));

    const liveByHr = new Map(live.map((x) => [x.hr, x.s]));
    let mism = false;
    for (const o of offlineScores) {
      const lv = liveByHr.get(o.hr);
      if (lv == null || Math.abs(lv - o.s) > 1e-6) mism = true;
    }
    liveParity++;
    if (mism) parityMismatch++;

    const sortedLive = live.filter((x) => x.ord != null).sort((a, b) => b.s - a.s);
    if (sortedLive.length) { liveN++; if ((sortedLive[0]!.ord as number) <= 3) liveHit++; }
  }

  const parityOk = parityMismatch === 0;
  const liveShow = liveN ? ((liveHit / liveN) * 100).toFixed(1) : '-';
  console.log(`      패리티: ${liveParity}경주 중 불일치 ${parityMismatch} → ${parityOk ? '✅ OK' : '❌ 불일치(피처 재계산 버그)'}`);
  console.log(`      라이브 연승: ${liveShow}%  (n=${liveN}경주)`);

  // ── 요약 ────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`📋 요약`);
  console.log(`   신규 후보: id=${newId}  label=${label}  (is_active=false)`);
  console.log(`   오프라인 연승: ${offlineShow}%  |  라이브 연승: ${liveShow}%`);
  console.log(`   패리티: ${parityOk ? '✅' : '❌'}`);
  console.log('');
  if (parityOk) {
    console.log(`승격하려면: npm run promote -- --version ${newId}`);
  } else {
    console.log('⚠️  패리티 불일치 — 피처 재계산 확인 후 승격 결정');
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
