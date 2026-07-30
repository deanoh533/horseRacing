/**
 * 조합배당 pool 문자열 확인용 probe (1회성).
 * 한 경주의 API160_1/integratedInfo_1 응답에서 pool별 건수·샘플을 출력한다.
 * → src/sync/transformer.ts의 COMBO_POOLS 문자열을 실제값으로 확정하는 데 쓴다.
 *
 * 사용:
 *   npm run probe:combo-pools -- --date 20260726 --meet 1 --rc 1
 */
import { getKRAClient } from '../src/kra/client.js';
import type { MeetCode } from '../src/types/index.js';

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const date = Number(arg('--date'));
  const meet = Number(arg('--meet')) as MeetCode;
  const rc = Number(arg('--rc'));

  if (!date || (meet !== 1 && meet !== 3) || !rc) {
    console.error('사용: npm run probe:combo-pools -- --date YYYYMMDD --meet 1|3 --rc 경주번호');
    process.exit(1);
  }

  const kra = getKRAClient();
  const items = await kra.getComboDividends({ meet, rcDate: date, rcNo: rc });
  console.log(`\n총 ${items.length}건 수신 (date=${date} meet=${meet} rc=${rc})\n`);

  const byPool = new Map<string, typeof items>();
  for (const it of items) {
    if (!byPool.has(it.pool)) byPool.set(it.pool, []);
    byPool.get(it.pool)!.push(it);
  }

  console.log('pool별 건수 + 샘플 1건 (이 문자열을 COMBO_POOLS와 대조):');
  for (const [pool, rows] of [...byPool.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const s = rows[0]!;
    console.log(
      `  ${JSON.stringify(pool)}  ${rows.length}건  샘플: chulNo=${s.chulNo} chulNo2=${s.chulNo2} chulNo3=${s.chulNo3} odds=${s.odds}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
