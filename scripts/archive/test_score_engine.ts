/**
 * Score Engine 동작 테스트
 *
 * 두 가지 테스트:
 * 1. Mock 데이터 - 알고리즘 검증
 * 2. 실제 KRA 데이터 - 한 경주 출전마들 점수 비교
 */
import { ScoreEngine } from '../src/engine/index.js';
import { getKRAClient } from '../src/kra/client.js';
import { FOUR_CORE_AREAS, ITEM_NAMES } from '../src/types/index.js';

const engine = new ScoreEngine();

// ============================================
// Mock 데이터 테스트
// ============================================
function testMockHorses() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Mock 데이터 알고리즘 검증');
  console.log('='.repeat(60));

  const horses = [
    {
      name: '천리마 (이상적)',
      input: {
        rating: 95,
        ord5: [3, 3, 2, 1, 1], // 점진 향상
        sameDistOrds: [1, 1, 1, 2, 2], // 1300m 5번 입상
        jockey30DayOrds: [
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 1등 10
          2, 2, 3, 3, 3, // 입상 5
          4, 4, 5, 6, 7, // 미입상 5
        ],
        horseAllOrds: [1, 2, 2, 1, 3, 4, 1, 2, 3, 1],
        combinationOrds: [1, 1, 2, 1], // 4회 평균 1.25위
      },
    },
    {
      name: '황금날개 (안정)',
      input: {
        rating: 85,
        ord5: [2, 1, 3, 2, 1],
        sameDistOrds: [1, 2, 2, 3, 1],
        jockey30DayOrds: [
          2, 3, 2, 3, 1, 2, 3, 4, 2, 3,
          4, 5, 6, 3, 2, 4, 5, 6, 7, 3,
        ],
        horseAllOrds: [2, 2, 3, 2, 1, 3, 2, 2],
        combinationOrds: [2, 3, 2], // 3회 평균 2.33
      },
    },
    {
      name: '약자 (참고용)',
      input: {
        rating: 30,
        ord5: [7, 6, 5, 6, 5],
        sameDistOrds: [5, 6, 4, 7, 6],
        jockey30DayOrds: [
          5, 6, 7, 5, 6, 8, 7, 5, 6, 5,
          4, 6, 7, 8, 5, 6, 7, 5, 6, 7,
        ],
        horseAllOrds: [5, 6, 7, 5, 6, 7, 5, 6],
        combinationOrds: [], // 처음 조합
      },
    },
  ];

  for (const horse of horses) {
    const result = engine.calculateScores(horse.input);
    console.log(`\n🐎 ${horse.name}`);
    console.log(`   종합 점수: ${result.total}점`);
    console.log('   ⭐ 핵심 5개 항목:');

    const coreIds = [
      '01_rating',
      '03_recent_form',
      '06_distance_fitness',
      '09_jockey_form',
      '16_jockey_horse_chemistry',
    ] as const;

    for (const id of coreIds) {
      const item = result.items[id];
      const pct = (item.rawScore * 100).toFixed(0);
      console.log(
        `     ${item.itemName}: ${pct}% (${item.weightedScore.toFixed(2)}점)`
      );
    }
  }
}

// ============================================
// 실제 KRA 데이터 테스트
// ============================================
async function testRealRace() {
  console.log('\n' + '='.repeat(60));
  console.log('🏁 실제 KRA 데이터 - 부산경남 2026-05-17 1경주');
  console.log('='.repeat(60));

  const client = getKRAClient();
  const allHorses = await client.getRaceResults({
    meet: 3,
    rcDate: 20260517,
    numOfRows: 100,
  });

  // 1경주만 필터
  const race1 = allHorses.filter((h) => h.rcNo === 1);
  console.log(`\n총 ${race1.length}두 출전`);

  if (race1.length === 0) {
    console.log('⚠️ 데이터 없음');
    return;
  }

  // 각 말 점수 계산 (DB 데이터 없어서 일부는 mock)
  const results = race1.map((h) => {
    const result = engine.calculateScores({
      rating: h.rating,
      ord5: [], // DB 없어서 빈 배열 → 0.5 중립
      sameDistOrds: [],
      jockey30DayOrds: [],
      horseAllOrds: [],
      combinationOrds: [],
    });
    return {
      hrName: h.hrName,
      hrNo: h.hrNo,
      chulNo: h.chulNo,
      actualOrd: h.ord, // 실제 착순
      total: result.total,
      rating: h.rating,
    };
  });

  // 종합 점수로 정렬
  results.sort((a, b) => b.total - a.total);

  console.log('\n예측 vs 실제:');
  console.log('-'.repeat(60));
  console.log('순위 | 마번 마명             | 점수 | 레이팅 | 실제');
  console.log('-'.repeat(60));
  results.forEach((r, i) => {
    const rank = (i + 1).toString().padStart(2);
    const hrInfo = `${r.chulNo}번 ${r.hrName}`.padEnd(20);
    const score = r.total.toFixed(1).padStart(5);
    const rating = r.rating.toString().padStart(3);
    const actual = r.actualOrd.toString().padStart(2);
    console.log(`  ${rank} | ${hrInfo} | ${score} | ${rating}    | ${actual}위`);
  });

  console.log('\n💡 참고: DB 데이터 없음 → 핵심 5개 중 ① 레이팅만 실제 점수');
  console.log('         나머지 16개 항목은 placeholder (0.5 중립)');
  console.log('         → 실제 동기화 후 정확한 점수 계산 가능');
}

// ============================================
// 실행
// ============================================
async function main() {
  console.log('🧮 Score Engine 동작 테스트');

  testMockHorses();
  await testRealRace();

  console.log('\n' + '='.repeat(60));
  console.log('✅ 테스트 완료');
}

main().catch((err) => {
  console.error('💥 에러:', err);
  process.exit(1);
});
