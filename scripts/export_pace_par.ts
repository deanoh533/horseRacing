/**
 * 초반 페이스 par 정적 JSON 생성 — client가 실측 페이스 라벨(labelActualPace) 계산에 사용.
 * 로컬 미러 읽기(egress 0). buildPaceParMap(버킷별 avg_s1f 중앙값·최소 30경주) all-time.
 * 재생성: npm run export:pace-par (새 경주 누적 시 가끔). SSOT: src/engine/pacePar.ts.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { getLocalDb } from '../src/db/localDb.js';
import { buildPaceParMap, type PaceParSourceRow } from '../src/engine/pacePar.js';

const CUTOFF = 99991231; // all-time (측정 기준선)

async function main() {
  const sb = await getLocalDb();
  const rows: PaceParSourceRow[] = [];
  // pacePar.ts의 loadPaceParSource와 같은 페치를 의도적으로 재현 — 그 로더는 unexported +
  // 모듈 캐시 결합이라 import 불가. 스크립트를 self-contained로 두려는 파일범위 절충(중복 이유).
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f')
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_dist: number | null; avg_s1f: number | null }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(Number(r.avg_s1f) > 0)) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  const par = buildPaceParMap(rows, CUTOFF);
  const obj: Record<string, number> = {};
  for (const k of [...par.keys()].sort()) obj[k] = Math.round(par.get(k)! * 100) / 100;
  writeFileSync('client/src/config/pace_par.json', JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`✅ pace_par.json 생성 — ${Object.keys(obj).length}버킷`);
  for (const [k, v] of Object.entries(obj)) console.log(`  ${k}: ${v}초`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
