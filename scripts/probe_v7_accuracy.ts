// scripts/probe_v7_accuracy.ts
/**
 * v7 라이브 판정 — predictions(수요일 사전 예측, 무변경) × race_entries(금요일 결과 ord)를
 * 조인해 강추/주목/전체 티어별 연승(3착내) 적중률을 model_version별로 계산한다.
 *
 * 읽기전용. 임계값은 client/src/config/selective_picks.json 단일출처(하드코딩 금지).
 * 판정 로직(티어 분류·적중 계산)은 src/engine/eval/v7Accuracy.ts 순수 함수 — 테스트는 거기서.
 *
 * 정직성: race_entries.ord를 직접 조인(predictions.actual_ord에 의존하지 않음) —
 *   가장 원본에 가까운 결과 원천으로 독립 검증 (스펙 §3.4/§4).
 *
 * 사용:
 *   npm run probe:v7-accuracy [-- --from YYYYMMDD --to YYYYMMDD]
 * (--from/--to 생략 시 전체 기간 대상 — DB 부하 큰 조회이므로 라이브 판정 시엔 범위 지정 권장)
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import {
  joinResults, computeTiersByVersion,
  type PredictionSlim, type ResultSlim,
} from '../src/engine/eval/v7Accuracy.js';

const CONFIG_PATH = 'client/src/config/selective_picks.json';
const pct = (x: number): string => x.toFixed(1) + '%';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadPredictions(from?: number, to?: number): Promise<PredictionSlim[]> {
  const sb = await getReadClient();
  let q = sb.from('predictions')
    .select('race_date, meet, rc_no, hr_name, p_top3, model_version')
    .not('p_top3', 'is', null);
  if (from) q = q.gte('race_date', from);
  if (to) q = q.lte('race_date', to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PredictionSlim[];
}

async function loadResults(from?: number, to?: number): Promise<ResultSlim[]> {
  const sb = await getReadClient();
  let q = sb.from('race_entries').select('race_date, meet, rc_no, hr_name, ord');
  if (from) q = q.gte('race_date', from);
  if (to) q = q.lte('race_date', to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ResultSlim[];
}

async function main(): Promise<void> {
  const from = arg('--from') ? Number(arg('--from')) : undefined;
  const to = arg('--to') ? Number(arg('--to')) : undefined;

  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const strongMin: number = cfg.tiers.strong.minProb;
  const watchMin: number = cfg.tiers.watch.minProb;

  const [preds, results] = await Promise.all([loadPredictions(from, to), loadResults(from, to)]);
  const joined = joinResults(preds, results);
  const pending = joined.filter((r) => r.actual_ord == null).length;

  console.log(`\n🏇 v7 라이브 판정${from ? ` — ≥${from}` : ''}${to ? ` ≤${to}` : ''}`);
  console.log(`   예측 ${preds.length}행 · 결과 도착 ${joined.length - pending} · 결과 미도착 제외 ${pending}`);
  console.log(`   임계값 강추≥${strongMin} · 주목≥${watchMin} (출처: ${CONFIG_PATH})\n`);

  const byVersion = computeTiersByVersion(joined, strongMin, watchMin);
  if (byVersion.length === 0) {
    console.log('결과가 도착한 예측이 없습니다 (경주 결과 미도착이거나 기간 필터를 확인하세요).');
    return;
  }

  for (const { modelVersion, tiers } of byVersion) {
    console.log(`── model_version=${modelVersion ?? '(없음/v1-fallback)'} ──`);
    for (const t of tiers) {
      console.log(`  ${t.category} : ${pct(t.accuracy).padStart(6)} (${t.correct}/${t.total})`);
    }
    console.log('');
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
