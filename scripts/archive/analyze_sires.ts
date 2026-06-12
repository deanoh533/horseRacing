/**
 * 부마(sire)별 자손 성적 분석
 *  - 자손 수 (자손 = 같은 sire_hr_nm 가진 horses)
 *  - 자손들의 평균 착순 (horse_results join)
 *  - 거리별 입상률 (단/중/장)
 *
 * 결과: 부마별 강점 거리 패턴 → ⑭ 알고리즘 재설계 근거
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

interface HorseRow {
  hr_no: string;
  hr_name: string;
  sire_hr_nm: string | null;
}

interface ResultRow {
  hr_no: string;
  ord: number | null;
  rc_dist: number | null;
}

async function fetchAll<T>(
  sb: ReturnType<typeof createClient>,
  table: string,
  select: string,
  order: string[]
): Promise<T[]> {
  const all: T[] = [];
  for (let off = 0; ; off += 1000) {
    let q = sb.from(table).select(select).range(off, off + 999);
    for (const o of order) q = q.order(o);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return all;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('[1/3] horses + race_entries 로드...');
  const horses = await fetchAll<HorseRow>(sb, 'horses', 'hr_no, hr_name, sire_hr_nm', ['hr_no']);
  const results = await fetchAll<ResultRow>(sb, 'race_entries', 'hr_no, ord, rc_dist', ['race_date', 'meet', 'rc_no', 'pthr_no']);
  console.log(`  horses ${horses.length}, results ${results.length}`);

  // hr_no → sire_hr_nm 맵
  const hrToSire = new Map<string, string>();
  horses.forEach((h) => {
    if (h.sire_hr_nm) hrToSire.set(h.hr_no, h.sire_hr_nm);
  });

  console.log('[2/3] 부마별 통계 집계...');
  type SireStats = {
    childCount: Set<string>;
    totalRaces: number;
    top3: number;
    top1: number;
    distShort: { races: number; top3: number }; // ≤ 1400
    distMid: { races: number; top3: number };   // 1500-1700
    distLong: { races: number; top3: number };  // ≥ 1800
  };
  const bySire = new Map<string, SireStats>();
  for (const r of results) {
    const sire = hrToSire.get(r.hr_no);
    if (!sire || r.ord === null) continue;
    let s = bySire.get(sire);
    if (!s) {
      s = {
        childCount: new Set(),
        totalRaces: 0,
        top3: 0,
        top1: 0,
        distShort: { races: 0, top3: 0 },
        distMid: { races: 0, top3: 0 },
        distLong: { races: 0, top3: 0 },
      };
      bySire.set(sire, s);
    }
    s.childCount.add(r.hr_no);
    s.totalRaces++;
    if (r.ord <= 3) s.top3++;
    if (r.ord === 1) s.top1++;
    const d = r.rc_dist ?? 0;
    const bucket = d <= 1400 ? s.distShort : d <= 1700 ? s.distMid : s.distLong;
    bucket.races++;
    if (r.ord <= 3) bucket.top3++;
  }

  console.log('[3/3] 상위 20 부마 (자손 5+, 출전 50+):\n');
  const ranked = [...bySire.entries()]
    .filter(([, s]) => s.childCount.size >= 5 && s.totalRaces >= 50)
    .map(([sire, s]) => ({
      sire,
      children: s.childCount.size,
      races: s.totalRaces,
      top3Rate: s.top3 / s.totalRaces,
      top1Rate: s.top1 / s.totalRaces,
      shortRate: s.distShort.races > 0 ? s.distShort.top3 / s.distShort.races : 0,
      midRate: s.distMid.races > 0 ? s.distMid.top3 / s.distMid.races : 0,
      longRate: s.distLong.races > 0 ? s.distLong.top3 / s.distLong.races : 0,
    }))
    .sort((a, b) => b.top3Rate - a.top3Rate)
    .slice(0, 20);

  console.log(
    '부마               | 자손 | 출전 | 입상%  | 1등%  | 단거리% | 중거리% | 장거리%'
  );
  console.log('-'.repeat(95));
  for (const r of ranked) {
    console.log(
      `${r.sire.padEnd(18)} | ${String(r.children).padStart(3)}  | ${String(r.races).padStart(4)} | ` +
        `${(r.top3Rate * 100).toFixed(1).padStart(5)}% | ${(r.top1Rate * 100).toFixed(1).padStart(4)}% | ` +
        `${(r.shortRate * 100).toFixed(1).padStart(5)}%  | ${(r.midRate * 100).toFixed(1).padStart(5)}%  | ${(r.longRate * 100).toFixed(1).padStart(5)}%`
    );
  }

  // 부마 총 unique
  console.log(`\n총 부마 (≥1 자손): ${bySire.size}`);
  console.log(`부마 (≥5 자손, 50+ 경주): ${ranked.length}`);
}
main().catch(console.error);
