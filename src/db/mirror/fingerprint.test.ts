import { describe, it, expect } from 'vitest';
import {
  buildFingerprintSql, buildRowsByDatesSql, diffFingerprints, type Fingerprint,
} from './fingerprint.js';
import { TABLE_SPECS, type IncrementalSpec } from './tableSpecs.js';

const re = TABLE_SPECS['race_entries'] as IncrementalSpec;

describe('buildFingerprintSql', () => {
  it('날짜별 행수+md5, 정렬 키 고정, null 날짜 제외', () => {
    expect(buildFingerprintSql('race_entries', re)).toBe(
      'SELECT "race_date" AS d, count(*) AS n, ' +
      `md5(string_agg(t::text, '|' ORDER BY "meet", "rc_no", "pthr_no")) AS h ` +
      'FROM "race_entries" t WHERE "race_date" IS NOT NULL GROUP BY "race_date"'
    );
  });

  it('정렬 키가 여러 개인 테이블도 순서대로', () => {
    const cd = TABLE_SPECS['combo_dividends'] as IncrementalSpec;
    expect(buildFingerprintSql('combo_dividends', cd))
      .toContain('ORDER BY "meet", "rc_no", "pool", "leg1", "leg2", "leg3"');
  });
});

describe('buildRowsByDatesSql', () => {
  it('날짜 목록을 파라미터로 받는다 — 페이징 없음', () => {
    expect(buildRowsByDatesSql('race_entries', re)).toBe(
      'SELECT * FROM "race_entries" WHERE "race_date" = ANY($1)'
    );
  });
});

const fp = (dateKey: number, hash: string, rowCount = 10): Fingerprint => ({ dateKey, rowCount, hash });

describe('diffFingerprints', () => {
  it('해시 같으면 그대로', () => {
    expect(diffFingerprints([fp(20260101, 'a')], [fp(20260101, 'a')]))
      .toEqual({ changed: [], removed: [], unchanged: [20260101] });
  });

  it('해시 다르면 바뀜', () => {
    const d = diffFingerprints([fp(20260101, 'b')], [fp(20260101, 'a')]);
    expect(d.changed).toEqual([20260101]);
    expect(d.unchanged).toEqual([]);
  });

  it('저장에 없으면 바뀜(신규)', () => {
    expect(diffFingerprints([fp(20260102, 'x')], []).changed).toEqual([20260102]);
  });

  it('원천에 없으면 사라짐', () => {
    expect(diffFingerprints([], [fp(20260101, 'a')]))
      .toEqual({ changed: [], removed: [20260101], unchanged: [] });
  });

  it('행수만 달라도(해시 같으면) 그대로 — 해시가 판정 기준', () => {
    expect(diffFingerprints([fp(20260101, 'a', 11)], [fp(20260101, 'a', 10)]).unchanged)
      .toEqual([20260101]);
  });

  it('섞인 경우 + 결과는 날짜 오름차순', () => {
    const d = diffFingerprints(
      [fp(20260103, 'c'), fp(20260101, 'a'), fp(20260102, 'B')],
      [fp(20260101, 'a'), fp(20260102, 'b'), fp(20260104, 'd')]
    );
    expect(d.changed).toEqual([20260102, 20260103]);
    expect(d.removed).toEqual([20260104]);
    expect(d.unchanged).toEqual([20260101]);
  });

  it('양쪽 다 비면 전부 빈 배열', () => {
    expect(diffFingerprints([], [])).toEqual({ changed: [], removed: [], unchanged: [] });
  });
});
