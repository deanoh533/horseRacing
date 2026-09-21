// scripts/probe_meet_codes.ts
/**
 * 경마장(meet) 코드 실측 — KRA가 어떤 코드로 어떤 경마장을 내려주는지 직접 확인한다.
 *
 * 왜: 2026-09-13 **렛츠런파크 영천** 개장으로 "권역형 순회경마"가 시작됐다 — 부산경남의
 * 경주마·기수가 매주 일요일 영천으로 이동해 경주한다. 실제로 우리 DB는 9/13부터
 * **일요일 부경(meet=3) 경주가 0건**이고, 9/18 출마표 로그도 `20260920 meet=3: 0 races`였다.
 * 즉 영천은 meet=3이 아니라 **우리가 안 부르는 다른 코드**다.
 *
 * data.go.kr 문서는 아직 1=서울·2=제주·3=부산경남만 적고 있어 코드를 알 수 없다 →
 * 후보 코드를 직접 찔러보고 응답의 경마장명(`meet` 필드 원문)을 그대로 찍는다.
 *
 * ⚠️ KRA 호출: 후보 코드 수 × 2(출마표·결과). 기본 6회×2 = 12회 (일일 한도 3,000).
 *
 * 사용:
 *   npx tsx scripts/probe_meet_codes.ts                      # 20260920(일) 기준
 *   npx tsx scripts/probe_meet_codes.ts --date 20260913      # 개장일
 *   npx tsx scripts/probe_meet_codes.ts --codes 1,3,4,5
 */
import 'dotenv/config';
import { KRAClient } from '../src/kra/client.js';
import type { MeetCode } from '../src/types/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rcDate = Number(arg('--date') ?? 20260920);
const codes = (arg('--codes') ?? '1,2,3,4,5,6').split(',').map(Number);

/** 응답에서 경마장명 원문을 모아 본다 — 코드↔이름 대응이 이걸로 확정된다 */
const names = (items: Array<{ meet?: unknown }>): string =>
  [...new Set(items.map((i) => String(i.meet ?? '?')))].join(', ') || '-';

async function main(): Promise<void> {
  const kra = new KRAClient();
  console.log(`\n🔎 경마장 코드 실측 — ${rcDate}\n`);
  console.log('   코드  출마표(두)  경마장명        결과(두)  경마장명');

  for (const code of codes) {
    const meet = code as MeetCode; // 미등록 코드를 일부러 넣어보는 probe라 캐스팅
    let cardN = 0, cardName = '-', resN = 0, resName = '-';

    try {
      const card = await kra.getAllEntrySheet({ meet, rcDate });
      cardN = card.length;
      cardName = names(card);
    } catch (e) {
      cardName = `❌ ${(e as Error).message.slice(0, 40)}`;
    }

    try {
      const res = await kra.getRaceResults({ meet, rcDate, numOfRows: 100 });
      resN = res.length;
      resName = names(res);
    } catch (e) {
      resName = `❌ ${(e as Error).message.slice(0, 40)}`;
    }

    const mark = cardN > 0 || resN > 0 ? '✅' : '  ';
    console.log(
      `${mark} ${String(code).padStart(4)}  ${String(cardN).padStart(9)}  ${cardName.padEnd(14)}` +
      `  ${String(resN).padStart(7)}  ${resName}`
    );
  }

  console.log(`
※ 두수가 0이 아닌 코드가 우리가 불러야 할 경마장이다.
   경마장명 원문은 transformer.ts의 meetNameToCode()에 그대로 넣어야 한다
   — 지금은 모르는 이름에 0을 돌려줘서 meet=0으로 조용히 저장된다.`);
}

main().catch((e) => {
  console.error('❌', (e as Error).message);
  process.exit(1);
});
