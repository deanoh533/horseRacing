/**
 * ⚠️  임시 비상용 스크립트 — Supabase egress 소진 기간(~2026-06-23)에만 사용.
 *
 * 정상 루트:  npm run sync --date YYYYMMDD  (supabase-js REST)
 * 이 스크립트: DATABASE_URL Postgres 직접 연결로 REST egress 우회.
 *
 * 6/23 Supabase 리셋 후에는 반드시 정상 루트로 복귀할 것.
 * predictions 생성은 건너뜀 (benchmark가 DuckDB에서 직접 계산).
 *
 * 사용:
 *   npm run sync:pg -- --date 20260606
 *   npm run sync:pg -- --date 20260606 --meet 1
 *   npm run sync:pg -- --dates 20260606,20260607,20260608
 */
import 'dotenv/config';
import { Client, types } from 'pg';
import { getKRAClient } from '../src/kra/client.js';
import {
  toRaceRow,
  toRaceEntryResultRow,
  calculatePopularities,
} from '../src/sync/transformer.js';
import type { MeetCode } from '../src/types/index.js';


// NUMERIC → number (supabase-js REST와 동일)
types.setTypeParser(1700, (v: string) => parseFloat(v));

// ── 결과 컬럼 목록 (UPDATE/INSERT 공통) ─────────────────────────────
const RESULT_COLS = [
  'rc_dist', 'track_type', 'hr_no', 'jcky_no', 'trar_no',
  'ord', 'rc_time', 'diff_unit', 'wg_hr', 'wg_hr_diff', 'wg_jk',
  'win_odds', 'plc_odds', 'popularity',
  'bu_g1f_acc_time', 'bu_g2f_acc_time', 'bu_g3f_acc_time', 'bu_g4f_acc_time',
  'bu_g6f_acc_time', 'bu_g8f_acc_time', 'bu_s1f_acc_time',
  'bu_g1f_ord', 'bu_g2f_ord', 'bu_g3f_ord', 'bu_g4f_ord',
  'bu_g6f_ord', 'bu_g8f_ord', 'bu_s1f_ord',
  'bu_s1f_time', 'bu_1fg_time', 'bu_2fg_time', 'bu_3fg_time',
  'bu_4_2f_time', 'bu_6_4f_time', 'bu_8_6f_time', 'bu_10_8f_time',
  'se_g1f_acc_time', 'se_g3f_acc_time', 'se_s1f_acc_time',
  'se_1c_acc_time', 'se_2c_acc_time', 'se_3c_acc_time', 'se_4c_acc_time',
  'sj_g1f_ord', 'sj_g3f_ord', 'sj_s1f_ord',
  'sj_1c_ord', 'sj_2c_ord', 'sj_3c_ord', 'sj_4c_ord',
  'result_at',
] as const;

// ── races upsert ────────────────────────────────────────────────────
const RACE_COLS = [
  'race_date', 'meet', 'rc_no',
  'rc_dist', 'rc_name', 'rc_day', 'track', 'track_type', 'weather',
  'age_cond', 'prize_cond', 'chaksun1', 'chaksun2', 'chaksun3', 'chaksun4', 'chaksun5',
] as const;

async function upsertRace(pg: Client, raceRow: Record<string, unknown>): Promise<void> {
  const vals = RACE_COLS.map(c => raceRow[c] ?? null);
  const placeholders = RACE_COLS.map((_, i) => `$${i + 1}`).join(', ');
  const updates = RACE_COLS.slice(3).map((c, i) => `"${c}" = EXCLUDED."${c}"`).join(', ');

  await pg.query(
    `INSERT INTO races (${RACE_COLS.map(c => `"${c}"`).join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (race_date, meet, rc_no) DO UPDATE SET ${updates}`,
    vals
  );
}

// ── race_entries 결과 UPDATE ────────────────────────────────────────
async function updateEntry(
  pg: Client,
  rcDate: number,
  meet: MeetCode,
  rcNo: number,
  hrName: string,
  resultRow: Record<string, unknown>,
  raceRow: Record<string, unknown>,
  popularity: number | null,
): Promise<void> {
  const combined: Record<string, unknown> = {
    ...resultRow,
    rc_dist: raceRow['rc_dist'] ?? null,
    track_type: raceRow['track_type'] ?? null,
    popularity,
    result_at: new Date().toISOString(),
  };

  const setClauses = RESULT_COLS.map((c, i) => `"${c}" = $${i + 5}`).join(', ');
  const vals = [rcDate, meet, rcNo, hrName, ...RESULT_COLS.map(c => combined[c] ?? null)];

  await pg.query(
    `UPDATE race_entries SET ${setClauses}
     WHERE race_date = $1 AND meet = $2 AND rc_no = $3 AND hr_name = $4`,
    vals
  );
}

// ── race_entries 신규 INSERT (출주표 없는 경우) ──────────────────────
async function insertEntry(
  pg: Client,
  horse: any,
  rcDate: number,
  meet: MeetCode,
  rcNo: number,
  resultRow: Record<string, unknown>,
  raceRow: Record<string, unknown>,
  popularity: number | null,
): Promise<void> {
  const row: Record<string, unknown> = {
    race_date: rcDate,
    meet,
    rc_no: rcNo,
    pthr_no: horse.chulNo,
    hr_name: horse.hrName,
    ag: horse.age ?? null,
    gndr: horse.sex ?? null,
    burd_wgt: horse.wgBudam ?? null,
    ratg: horse.rating && horse.rating > 0 ? horse.rating : null,
    jcky_nm: horse.jkName ?? null,
    trar_nm: horse.trName ?? null,
    ...resultRow,
    rc_dist: raceRow['rc_dist'] ?? null,
    track_type: raceRow['track_type'] ?? null,
    popularity,
    result_at: new Date().toISOString(),
  };

  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const vals = cols.map(c => row[c] ?? null);
  const conflictCols = ['race_date', 'meet', 'rc_no', 'pthr_no'];
  const updateCols = cols.filter(c => !conflictCols.includes(c));
  const updates = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

  await pg.query(
    `INSERT INTO race_entries (${cols.map(c => `"${c}"`).join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (race_date, meet, rc_no, pthr_no) DO UPDATE SET ${updates}`,
    vals
  );
}

// ── 날짜 1건 동기화 ────────────────────────────────────────────────
async function syncDate(pg: Client, rcDate: number, meets: MeetCode[]): Promise<void> {
  const kra = getKRAClient();
  console.log(`\n🔄 ${rcDate} 동기화 (meets: ${meets.join(',')})`);

  for (const meet of meets) {
    let racesSynced = 0;
    let horsesSynced = 0;
    const errors: string[] = [];

    try {
      const allHorses = await kra.getAllRaceResults({ meet, rcDate });
      console.log(`  [meet=${meet}] ${allHorses.length}건 수신`);

      if (allHorses.length === 0) {
        console.log(`  [meet=${meet}] 데이터 없음 (경마 없는 날)`);
        continue;
      }

      const racesByRcNo = new Map<number, typeof allHorses>();
      for (const horse of allHorses) {
        if (!racesByRcNo.has(horse.rcNo)) racesByRcNo.set(horse.rcNo, []);
        racesByRcNo.get(horse.rcNo)!.push(horse);
      }

      for (const [rcNo, horses] of racesByRcNo) {
        try {
          const raceRow = toRaceRow(horses[0]!) as unknown as Record<string, unknown>;
          await upsertRace(pg, raceRow);

          const popMap = calculatePopularities(horses);

          for (const horse of horses) {
            if (!horse.hrName) continue;

            const resultRow = toRaceEntryResultRow(horse) as unknown as Record<string, unknown>;
            const popularity = popMap.get(horse.hrNo) ?? null;

            const { rows: existing } = await pg.query(
              `SELECT pthr_no FROM race_entries
               WHERE race_date = $1 AND meet = $2 AND rc_no = $3 AND hr_name = $4
               LIMIT 1`,
              [rcDate, meet, rcNo, horse.hrName]
            );

            if (existing.length > 0) {
              await updateEntry(pg, rcDate, meet, rcNo, horse.hrName, resultRow, raceRow, popularity);
            } else {
              await insertEntry(pg, horse, rcDate, meet, rcNo, resultRow, raceRow, popularity);
            }
          }

          racesSynced++;
          horsesSynced += horses.length;
          console.log(`    [meet=${meet}, rcNo=${rcNo}] ✓ ${horses.length}두`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`rcNo=${rcNo}: ${msg}`);
          console.error(`    [meet=${meet}, rcNo=${rcNo}] ❌ ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`전체: ${msg}`);
      console.error(`  [meet=${meet}] ❌ ${msg}`);
    }

    console.log(`  [meet=${meet}] 완료: ${racesSynced}경주 / ${horsesSynced}두 / 에러 ${errors.length}`);
  }
}

// ── CLI ────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL 환경변수 없음 (.env 확인)');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dates: number[] = [];
  let meets: MeetCode[] = [1, 3];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      dates.push(parseInt(args[i + 1]!, 10));
      i++;
    } else if (args[i] === '--dates' && args[i + 1]) {
      args[i + 1]!.split(',').forEach(d => dates.push(parseInt(d.trim(), 10)));
      i++;
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map(s => parseInt(s, 10) as MeetCode)
        .filter((m): m is MeetCode => m === 1 || m === 3);
      i++;
    }
  }

  if (dates.length === 0) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const d = yesterday.getFullYear() * 10000 + (yesterday.getMonth() + 1) * 100 + yesterday.getDate();
    dates.push(d);
    console.log(`📅 날짜 없음 → 어제(${d})로 자동 설정`);
  }

  const connStr = process.env.DATABASE_URL.replace(/##/g, '%23%23');
  const pg = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  console.log('🔌 Postgres 직접 연결 성공');

  for (const date of dates) {
    await syncDate(pg, date, meets);
  }

  await pg.end();
  console.log('\n✅ 완료 — db:pull로 DuckDB도 갱신하세요: npm run db:pull');
}

main().catch(e => { console.error('💥', e); process.exit(1); });
