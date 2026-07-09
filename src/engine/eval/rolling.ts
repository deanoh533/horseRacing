import type { RaceRecord } from './types.js';

export interface YearQuarter { year: number; q: number; }
export interface RollingBlock { key: string; blockStart: number; train: RaceRecord[]; test: RaceRecord[]; }

export function quarterKey(raceDate: number): string {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** YYYY-Qn의 시작 YYYYMMDD (포함 경계) */
export function quarterStart(year: number, q: number): number {
  return year * 10000 + ((q - 1) * 3 + 1) * 100 + 1;
}

/** YYYY-Qn의 마지막 날 YYYYMMDD (포함 경계) */
export function quarterEnd(year: number, q: number): number {
  const md = [331, 630, 930, 1231][q - 1];
  return year * 10000 + md;
}

/** CLI 인자 "YYYYQn" (예: 2024Q3) 파싱 */
export function parseYearQuarter(s: string): YearQuarter {
  const m = /^(\d{4})Q([1-4])$/.exec(s);
  if (!m) throw new Error(`--first-test 형식은 YYYYQn (예: 2024Q3), 입력값: "${s}"`);
  return { year: Number(m[1]), q: Number(m[2]) };
}

export function splitByQuarter(races: RaceRecord[]): Map<string, RaceRecord[]> {
  const m = new Map<string, RaceRecord[]>();
  for (const r of races) {
    const k = quarterKey(r.raceDate);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/**
 * 확장윈도우 블록 목록. firstTest 이상인 분기마다:
 *   train = raceDate < 분기시작 인 모든 경주 (확장)
 *   test  = 해당 분기 경주
 * firstTest 이전 분기는 부트스트랩(학습에만 쓰임, test 블록 없음).
 */
export function rollingBlocks(races: RaceRecord[], firstTest: YearQuarter): RollingBlock[] {
  const byQ = splitByQuarter(races);
  const firstStart = quarterStart(firstTest.year, firstTest.q);
  const blocks: RollingBlock[] = [];
  for (const key of [...byQ.keys()].sort()) {
    const [yStr, qStr] = key.split('-Q');
    const blockStart = quarterStart(Number(yStr), Number(qStr));
    if (blockStart < firstStart) continue;
    blocks.push({
      key, blockStart,
      train: races.filter((r) => r.raceDate < blockStart),
      test: byQ.get(key)!,
    });
  }
  return blocks;
}
