/**
 * 날짜별 내용 지문 — 무엇이 바뀌었는지 가려내는 부분.
 *
 * ⚠️ 비교 축: **원천 지금 vs 원천 그때**다. 미러에서 해시를 재계산하면 안 된다 —
 * Postgres와 DuckDB는 같은 행을 다르게 문자열로 펴므로(숫자·날짜·jsonb 표기) 모든 날짜가
 * 영원히 "바뀜"으로 나온다. spec §5.2.
 */
import type { IncrementalSpec } from './tableSpecs.js';

export interface Fingerprint {
  dateKey: number;
  rowCount: number;
  hash: string;
}

const q = (id: string): string => `"${id}"`;

/**
 * 날짜별 (행수, md5) 한 줄씩. `t::text`는 행 전체를 문자열로 펴므로 **어느 컬럼이 바뀌어도**
 * 해시가 달라진다. 정렬 키가 흔들리면 내용이 같아도 해시가 달라지므로 PK 나머지로 고정한다.
 * 날짜가 null인 행은 증분으로 추적할 수 없어 제외한다(그런 테이블은 호출부가 전량으로 돌린다).
 */
export function buildFingerprintSql(table: string, spec: IncrementalSpec): string {
  const order = spec.orderCols.map(q).join(', ');
  return (
    `SELECT ${q(spec.dateCol)} AS d, count(*) AS n, ` +
    `md5(string_agg(t::text, '|' ORDER BY ${order})) AS h ` +
    `FROM ${q(table)} t WHERE ${q(spec.dateCol)} IS NOT NULL GROUP BY ${q(spec.dateCol)}`
  );
}

/** 바뀐 날짜들의 행을 한 번에. 페이징 없음 — 직결이라 OFFSET 재스캔이 필요 없다. */
export function buildRowsByDatesSql(table: string, spec: IncrementalSpec): string {
  return `SELECT * FROM ${q(table)} WHERE ${q(spec.dateCol)} = ANY($1)`;
}

export interface FingerprintDiff {
  /** 재적재할 날짜 (해시 다름 + 신규) */
  changed: number[];
  /** 미러에서 지울 날짜 (원천에 없음) */
  removed: number[];
  unchanged: number[];
}

export function diffFingerprints(source: Fingerprint[], stored: Fingerprint[]): FingerprintDiff {
  const storedByDate = new Map(stored.map((f) => [f.dateKey, f]));
  const changed: number[] = [];
  const unchanged: number[] = [];

  for (const s of source) {
    const prev = storedByDate.get(s.dateKey);
    if (prev && prev.hash === s.hash) unchanged.push(s.dateKey);
    else changed.push(s.dateKey);
  }

  const sourceDates = new Set(source.map((f) => f.dateKey));
  const removed = stored.map((f) => f.dateKey).filter((d) => !sourceDates.has(d));

  const asc = (a: number, b: number): number => a - b;
  return { changed: changed.sort(asc), removed: removed.sort(asc), unchanged: unchanged.sort(asc) };
}
