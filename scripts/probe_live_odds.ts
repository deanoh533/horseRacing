/**
 * 경주 전 조합배당이 실시간으로 움직이는지 관찰 (TODO O-005).
 *
 * 같은 경주를 발주 전 여러 시각에 부르고, 호출할 때마다 원본을 저장한 뒤
 * 직전 호출·최초 호출과 비교해 배당이 변했는지 출력한다.
 *
 * 사용 (발주 전 시각을 벌려서 2~3번):
 *   npm run probe:live-odds -- --date 20260925 --meet 1 --rc 1
 *
 * 판정:
 *   배당이 변한다  → 발매 중 실시간 배당 → 배당 블렌드 트랙 재개 (연승 +7~11.5%p 후보)
 *   전혀 안 변한다 → 확정배당 선노출이거나 캐시 → O-005 종결
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getKRAClient } from '../src/kra/client.js';
import {
  summarizePools,
  diffSnapshots,
  hasMovement,
  type OddsSnapshot,
  type PoolDiff,
} from '../src/kra/oddsSnapshot.js';
import type { MeetCode } from '../src/types/index.js';

const MEET_NAME: Record<number, string> = { 1: '서울', 3: '부경' };
const OUT_ROOT = 'data/live_odds';

/** KST 기준 ISO 문자열 (파일명·출력 모두 KST로 읽히게) */
function nowKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace('Z', '+09:00');
}

/** 2026-09-25T14:40:12+09:00 → 1440 */
function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

function printDiff(title: string, diffs: PoolDiff[]): void {
  console.log(`\n  [${title}]`);
  for (const d of diffs) {
    const parts = [
      `변함 ${d.changed}`,
      `그대로 ${d.unchanged}`,
      `신규 ${d.added}`,
      `사라짐 ${d.removed}`,
    ];
    console.log(`    ${d.pool.padEnd(6)} ${parts.join(' / ')}`);
    for (const s of d.samples) {
      console.log(`       예: ${s.combo}  ${s.from} → ${s.to}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const date = Number(arg('--date'));
  const meet = Number(arg('--meet')) as MeetCode;
  const rc = Number(arg('--rc'));

  if (!Number.isInteger(date) || date < 20000101 || (meet !== 1 && meet !== 3) || !Number.isInteger(rc) || rc < 1) {
    console.error('사용: npm run probe:live-odds -- --date YYYYMMDD --meet 1|3 --rc 경주번호');
    process.exit(1);
  }

  const dir = join(OUT_ROOT, `${date}_m${meet}_r${rc}`);
  mkdirSync(dir, { recursive: true });

  // 이번 호출 전에 쌓인 스냅샷 (파일명이 시각순이라 정렬하면 호출순)
  const prior: OddsSnapshot[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as OddsSnapshot);

  const capturedAt = nowKST();
  const kra = getKRAClient();
  const items = await kra.getComboDividends({ meet, rcDate: date, rcNo: rc });
  const snapshot: OddsSnapshot = { capturedAt, raceDate: date, meet, rcNo: rc, items };

  const file = join(dir, `${capturedAt.slice(0, 10).replace(/-/g, '')}-${hhmm(capturedAt).replace(':', '')}.json`);
  if (existsSync(file)) {
    console.warn(`⚠️  같은 분(分)에 이미 호출한 기록이 있어 덮어씁니다: ${file}`);
  }
  writeFileSync(file, JSON.stringify(snapshot, null, 2));

  console.log(`\n📡 ${date} ${MEET_NAME[meet]} ${rc}R — ${hhmm(capturedAt)} 호출 (${prior.length + 1}번째)`);
  console.log(`   ${items.length}건 수신 → ${file}`);

  if (items.length === 0) {
    console.log('\n   조합배당이 아직 안 내려옵니다. (발매 전이거나 이 경주는 미제공)');
    return;
  }

  console.log('\n   pool별 건수 (배당 범위):');
  for (const p of summarizePools(items)) {
    console.log(`     ${p.pool.padEnd(6)} ${String(p.count).padStart(5)}건  ${p.minOdds} ~ ${p.maxOdds}`);
  }

  if (prior.length === 0) {
    console.log('\n   첫 호출입니다. 시간을 두고(20~40분) 같은 명령을 다시 실행하면 비교 결과가 나옵니다.');
    return;
  }

  const last = prior[prior.length - 1]!;
  const first = prior[0]!;
  const vsLast = diffSnapshots(last, snapshot);
  printDiff(`직전 ${hhmm(last.capturedAt)} → 지금 ${hhmm(capturedAt)}`, vsLast);

  const vsFirst = prior.length > 1 ? diffSnapshots(first, snapshot) : null;
  if (vsFirst) printDiff(`최초 ${hhmm(first.capturedAt)} → 지금 ${hhmm(capturedAt)}`, vsFirst);

  const moved = hasMovement(vsLast) || (vsFirst ? hasMovement(vsFirst) : false);
  console.log(
    moved
      ? '\n✅ 판정: 배당이 움직였다 → 발매 중 실시간 배당일 가능성이 높다 (O-005 양성)'
      : '\n⛔ 판정: 값이 그대로다 → 확정배당 선노출 또는 캐시 (호출 간격을 더 벌려 한 번 더 확인)'
  );
  console.log('');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
