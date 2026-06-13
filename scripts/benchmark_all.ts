/**
 * Multi-Model Benchmark
 * TRAIN: 2024-01-01 ~ 2025-12-31  TEST: 2026-01-01 ~ 현재
 * 사용: npm run benchmark
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateA, printGateA, runGateB, printGateB } from '../src/engine/eval/gates.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { evaluate, printReport } from '../src/engine/eval/report.js';

// Re-export types for backward compatibility
export type { RaceRecord, HorseRecord } from '../src/engine/eval/types.js';
export type { GateAWarning, GateBResult } from '../src/engine/eval/gates.js';
export type { TrainedModels } from '../src/engine/eval/models.js';
export { collectRaces, runGateA, printGateA, runGateB, printGateB, trainAllModels, evaluate, printReport };

// ── main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const TRAIN_FROM = 20240101, TRAIN_TO = 20251231;
  const TEST_FROM  = 20260101, TEST_TO   = 99991231;

  const db = await getLocalDb();

  console.log('📊 Multi-Model Benchmark 시작\n');
  console.log(`데이터 수집 중 (${TRAIN_FROM}~${TEST_TO})...`);
  const allRaces = await collectRaces(db, TRAIN_FROM, TEST_TO);
  const trainRaces = allRaces.filter((r) => r.raceDate <= TRAIN_TO);
  const testRaces  = allRaces.filter((r) => r.raceDate >= TEST_FROM);
  console.log(`  TRAIN: ${trainRaces.length}경주 / TEST: ${testRaces.length}경주`);

  console.log('\n[게이트 A] 상관계수 점검...');
  const gateAWarnings = runGateA(trainRaces);
  printGateA(gateAWarnings);

  console.log('\n[게이트 B] 연승률 개선량 계산 중...');
  const gateBResults = runGateB(trainRaces);

  const approvedItems = new Set(gateBResults.filter((r) => r.include).map((r) => r.itemId));
  console.log(`  → ${approvedItems.size}개 항목 승인됨`);

  const models = trainAllModels(trainRaces, approvedItems);
  console.log('  ✅ 학습 완료');

  console.log('\n[테스트] 2026년 평가 중...');
  const evalResult = evaluate(testRaces, models);

  printReport(evalResult, gateBResults);
}

// 직접 실행 시에만 main() 구동 (import 부작용 방지 — getLocalDb 중복 오픈 race 차단)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('💥', e); process.exit(1); });
}
