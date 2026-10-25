/**
 * W-006 엇갈린 경주 해부 — 모델 1순위 ≠ 인기 1위 경주를 경주·말 특성별로 쪼갠다.
 * 모델: 분기마다 직전 2년만 학습한 Logistic(t3), 피처 = 챔피언 artifact.features (W-003: 2년 포화).
 * 챔피언 자체는 시험 구간을 이미 배웠으므로(T-015) 쓰지 않는다. 로컬 DuckDB 미러만 사용.
 *
 * 실행: npm run probe:disagreement [-- --first-test 2025Q1 --to 20260630]
 */
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import { rollingBlocks, quarterStart, parseYearQuarter } from '../src/engine/eval/rolling.js';
import { windowTrain, windowStart } from '../src/engine/eval/trainWindow.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { rankHorses } from '../src/engine/eval/score.js';
import { sliceDisagreement, bucket, type DisRow } from '../src/engine/eval/disagreement.js';
import type { HorseRecord } from '../src/engine/eval/types.js';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const firstTest = parseYearQuarter(arg('--first-test') ?? '2025Q1');
const dataTo = Number(arg('--to') ?? 20260630);
const YEARS = 2;

const feat = (h: HorseRecord, name: string): number => h.features.find((f) => f.name === name)?.value ?? NaN;
const pct = (v: number) => `${(v * 100).toFixed(1)}`.padStart(5);

async function main(): Promise<void> {
  const db = await getLocalDb();
  const champ = await loadVersion(db);
  if (!champ || champ.model.kind !== 'logistic') throw new Error('활성 logistic 챔피언 없음');
  const schema = champ.model.model.features;

  const firstStart = quarterStart(firstTest.year, firstTest.q);
  const races = await collectRaces(db, windowStart(firstStart, YEARS), dataTo, { shapeParCutoff: firstStart });
  console.log(`${races.length}경주 수집 · 피처 ${schema.length}개(${champ.row.label}) · 학습 창 직전 ${YEARS}년`);

  const rows: DisRow[] = [];
  const fieldRatings: number[] = [];
  let total = 0, agree = 0, agreeWin = 0, agreeShow = 0;

  for (const block of rollingBlocks(races, firstTest)) {
    const train = windowTrain(block.train, block.blockStart, YEARS);
    const X = train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y = train.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    const model = fitLogistic(X, y, schema, { l2: 0.02, iters: 800, lr: 0.2 });

    for (const race of block.test) {
      const byOdds = race.horses.filter((h) => h.winOdds != null && h.winOdds > 0)
        .sort((a, b) => (a.winOdds as number) - (b.winOdds as number));
      const fav = byOdds[0];
      const pick = rankHorses({ kind: 'logistic', model }, race.horses)[0];
      if (!fav || !pick || pick.winOdds == null) continue;
      total++;
      if (pick.pthrNo === fav.pthrNo) {
        agree++; if (pick.ord === 1) agreeWin++; if (pick.ord <= 3) agreeShow++;
        continue;
      }
      const oddsRank = byOdds.findIndex((h) => h.pthrNo === pick.pthrNo) + 1;
      const fr = feat(pick, 'field_rating_mean');
      fieldRatings.push(fr);
      rows.push({
        modelOrd: pick.ord, favOrd: fav.ord, modelOdds: pick.winOdds, favOdds: fav.winOdds as number,
        dims: {
          경마장: ({ 1: '서울', 3: '부경', 4: '영천' } as Record<number, string>)[race.meet] ?? String(race.meet),
          출전두수: bucket(race.horses.length, [9, 11, 13], ['8두 이하', '9~10두', '11~12두', '13두+']),
          거리: bucket(race.rcDist ?? NaN, [1300, 1500, 1800], ['1200 이하', '1300~1400', '1500~1700', '1800+']),
          인기마배당: bucket(fav.winOdds as number, [2.0, 3.0, 4.5], ['~1.9 (압도)', '2.0~2.9', '3.0~4.4', '4.5+ (혼전)']),
          모델픽인기순위: bucket(oddsRank, [3, 4, 6], ['2위', '3위', '4~5위', '6위+']),
          모델픽경력: bucket(feat(pick, 'career_n'), [3, 10], ['0~2전 (신마급)', '3~9전', '10전+']),
          인기마경력: bucket(feat(fav, 'career_n'), [3, 10], ['0~2전 (신마급)', '3~9전', '10전+']),
          모델픽휴양: bucket(feat(pick, 'interval_days'), [28, 61], ['~27일', '28~60일', '61일+']),
          모델픽등급이동: bucket(feat(pick, 'class_move'), [0, 1e-9], ['강급(-)', '유지(0)', '승급(+)']),
          _fr: String(fr),
        },
      });
    }
    console.log(`  [${block.key}] 학습 ${train.length}경주 · 시험 ${block.test.length}경주`);
  }

  // 경주 수준 = 출전마 레이팅 평균의 3분위 (엇갈린 경주 안에서)
  const sorted = fieldRatings.filter(Number.isFinite).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 3)]!, q2 = sorted[Math.floor((2 * sorted.length) / 3)]!;
  for (const r of rows) r.dims['경주수준'] = bucket(Number(r.dims._fr), [q1, q2], ['하위 1/3', '중위 1/3', '상위 1/3']);

  const dis = rows.length;
  const sum = sliceDisagreement(rows.map((r) => ({ ...r, dims: { 전체: '엇갈림 전체' } })), '전체')[0]!;
  console.log(`\n시험 ${total}경주 · 일치 ${agree}(${pct(agree / total)}%) 단승 ${pct(agreeWin / agree)} 연승 ${pct(agreeShow / agree)}`);
  console.log(`엇갈림 ${dis}(${pct(dis / total)}%) — 모델픽 단승 ${pct(sum.modelWin)} 연승 ${pct(sum.modelShow)} 회수 ${sum.modelRoi.toFixed(2)} | 인기마 단승 ${pct(sum.favWin)} 연승 ${pct(sum.favShow)} 회수 ${sum.favRoi.toFixed(2)}`);

  const dims = ['경마장', '출전두수', '거리', '경주수준', '인기마배당', '모델픽인기순위', '모델픽경력', '인기마경력', '모델픽휴양', '모델픽등급이동'];
  for (const d of dims) {
    console.log(`\n[${d}]  묶음             경주  | 단승 모델/인기 | 연승 모델/인기 | 단승회수 모델/인기`);
    for (const s of sliceDisagreement(rows, d)) {
      console.log(`  ${s.bucket.padEnd(16)} ${String(s.n).padStart(5)} | ${pct(s.modelWin)} /${pct(s.favWin)} | ${pct(s.modelShow)} /${pct(s.favShow)} | ${s.modelRoi.toFixed(2).padStart(5)} / ${s.favRoi.toFixed(2)}`);
    }
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
