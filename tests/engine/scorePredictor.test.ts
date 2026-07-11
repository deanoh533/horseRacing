import { describe, it, expect, beforeAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { gatherRaceInputs } from '../../src/engine/scorePredictor.js';
import { makeLocalClient } from '../../src/db/localDb.js';

/**
 * forcePrecompetition 옵션의 실제 동작 검증.
 *
 * 인메모리 DuckDB에 race_entries 최소 스키마(gatherRaceInputs가 조회하는
 * 전 컬럼 포함)를 만들고, ReadClient 어댑터(makeLocalClient)를 통해
 * 실제 함수를 호출한다 — 타입 체크가 아니라 런타임에 ord가 정말
 * null로 스크럽되는지/보존되는지 확인한다 (이전 버전은 expect(true).toBe(true)
 * 뿐이라 TDD 원칙 위반이었음, 07b8f9a 리뷰 지적사항).
 *
 * 다른 조회 대상 테이블(races/race_par_times/race_sectional_stats/
 * horses/jockey_stats/training_logs)은 스키마만 만들고 비워둔다 —
 * gatherRaceInputs 내부의 as-of 조회는 전부 `race_date < rcDate`
 * 조건이라 오늘 경주 하나뿐인 이 픽스처에서는 자연히 빈 결과를 받고
 * 안전하게 진행된다(코드가 옵셔널 체이닝·빈 배열 폴백으로 처리).
 */
describe('forcePrecompetition 옵션 - 실제 동작', () => {
  const RACE_DATE = 20260710;
  const MEET = 1;
  const RC_NO = 1;
  let sb: ReturnType<typeof makeLocalClient>;

  beforeAll(async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    await conn.run(`
      CREATE TABLE race_entries (
        race_date INTEGER, meet INTEGER, rc_no INTEGER, pthr_no INTEGER,
        hr_name VARCHAR, hr_no VARCHAR, ag INTEGER, gndr VARCHAR, ratg DOUBLE,
        ord INTEGER, rc_dist INTEGER, track_type VARCHAR, burd_wgt DOUBLE, wg_hr DOUBLE,
        jcky_no VARCHAR, trar_no VARCHAR, popularity INTEGER, erng_sump DOUBLE, erng_sump_asof DOUBLE,
        latst_bledg1 VARCHAR, latst_bledg2 VARCHAR, latst_trea1_txt VARCHAR,
        wg_hr_diff DOUBLE, win_odds DOUBLE, rc_time DOUBLE,
        se_g1f_acc_time DOUBLE, bu_g1f_acc_time DOUBLE, se_g3f_acc_time DOUBLE, bu_g3f_acc_time DOUBLE,
        sj_s1f_ord INTEGER, bu_s1f_ord INTEGER, sj_g1f_ord INTEGER, bu_g1f_ord INTEGER
      )
    `);
    await conn.run(`CREATE TABLE races (race_date INTEGER, meet INTEGER, rc_no INTEGER, rc_dist INTEGER, track_type VARCHAR, prize_cond VARCHAR)`);
    await conn.run(`CREATE TABLE race_par_times (meet INTEGER, rc_dist INTEGER, track_type VARCHAR, par_time DOUBLE, n_wins INTEGER)`);
    await conn.run(`CREATE TABLE race_sectional_stats (race_date INTEGER, meet INTEGER, rc_no INTEGER, horses INTEGER)`);
    await conn.run(`CREATE TABLE horses (hr_no VARCHAR, dsa_bri_vl DOUBLE, dsa_clc_vl DOUBLE, dsa_ier_vl DOUBLE, dsa_prf_vl DOUBLE, dsidx_vl DOUBLE)`);
    await conn.run(`CREATE TABLE jockey_stats (jcky_no VARCHAR, meet INTEGER, win_rate_t DOUBLE, qu_rate_t DOUBLE)`);
    await conn.run(`CREATE TABLE training_logs (hr_no VARCHAR, train_date INTEGER, tr_term INTEGER, run1_cnt INTEGER, run2_cnt INTEGER, pr_gubun VARCHAR)`);

    // 경기 후(사후) 결과가 이미 채워진 출주 1건 — ord=2.
    // forcePrecompetition이 실제로 이 값을 null로 스크럽하는지가 검증 대상.
    await conn.run(`
      INSERT INTO race_entries
        (race_date, meet, rc_no, pthr_no, hr_name, hr_no, ag, gndr, ratg, ord,
         rc_dist, track_type, burd_wgt, wg_hr, jcky_no, trar_no, popularity, erng_sump, erng_sump_asof)
      VALUES
        (${RACE_DATE}, ${MEET}, ${RC_NO}, 1, '테스트말', 'HR001', 3, 'M', 70, 2,
         1800, '잔디', 58.5, 490, 'J001', 'T001', 3, 1000000, 1000000)
    `);

    sb = makeLocalClient(conn);
  });

  it('forcePrecompetition=true면 사후 ord를 null로 강제한다', async () => {
    const rows = await gatherRaceInputs(sb, RACE_DATE, MEET, RC_NO, { forcePrecompetition: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ord).toBeNull();
  });

  it('옵션을 지정하지 않으면 사후 ord(실제 결과)를 보존한다', async () => {
    const rows = await gatherRaceInputs(sb, RACE_DATE, MEET, RC_NO);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ord).toBe(2);
  });

  it('forcePrecompetition=false를 명시해도 ord를 보존한다', async () => {
    const rows = await gatherRaceInputs(sb, RACE_DATE, MEET, RC_NO, { forcePrecompetition: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ord).toBe(2);
  });
});
