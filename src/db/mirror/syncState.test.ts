import { describe, it, expect, beforeAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import {
  ensureSyncStateTable, readFingerprints, writeFingerprintsSql, deleteFingerprintsSql,
  readLastSyncedAt, mirrorAgeDays, staleWarning, MIRROR_STALE_DAYS, FULL_TABLE_DATE_KEY,
} from './syncState.js';

let conn: any;
beforeAll(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
});

describe('mirrorAgeDays (순수)', () => {
  const now = new Date('2026-09-29T00:00:00Z');
  it('하루 전이면 1', () => expect(mirrorAgeDays('2026-09-28T00:00:00Z', now)).toBe(1));
  it('같은 순간이면 0', () => expect(mirrorAgeDays('2026-09-29T00:00:00Z', now)).toBe(0));
  it('내림 처리 — 1.9일은 1', () => expect(mirrorAgeDays('2026-09-27T02:24:00Z', now)).toBe(1));
  // Review Focus 4 — 구 미러
  it('값이 없으면 null', () => expect(mirrorAgeDays(null, now)).toBeNull());
  it('파싱 불가도 null', () => expect(mirrorAgeDays('nonsense', now)).toBeNull());
});

describe('staleWarning (순수)', () => {
  it('임계 이하면 경고 없음', () => {
    expect(staleWarning(MIRROR_STALE_DAYS, '2026-09-26T00:00:00Z')).toBeNull();
  });
  it('임계 초과면 일수와 마지막 시각을 담은 문구', () => {
    const w = staleWarning(79, '2026-07-10T12:31:00Z');
    expect(w).toContain('79일');
    expect(w).toContain('2026-07-10');
    expect(w).toContain('db:pull');
  });
  it('null(구 미러)이면 경고 없음 — 판단 근거가 없다', () => {
    expect(staleWarning(null, null)).toBeNull();
  });
  it('MIRROR_STALE_DAYS는 3 — 주말 하나를 놓치면 알려준다', () => {
    expect(MIRROR_STALE_DAYS).toBe(3);
  });
});

describe('_sync_state 저장소 (DuckDB)', () => {
  it('없으면 만들고, 두 번 불러도 안전', async () => {
    await ensureSyncStateTable(conn);
    await ensureSyncStateTable(conn);
    const r = await conn.runAndReadAll(
      "SELECT count(*) n FROM information_schema.tables WHERE table_name = '_sync_state'"
    );
    expect(Number((r.getRowObjects()[0] as any).n)).toBe(1);
  });

  // Review Focus 4 — 구 미러에서 읽기
  it('구 미러(테이블 없음)에서 읽어도 터지지 않고 빈 결과', async () => {
    const fresh = await (await DuckDBInstance.create(':memory:')).connect();
    expect(await readFingerprints(fresh, 'race_entries')).toEqual([]);
    expect(await readLastSyncedAt(fresh)).toBeNull();
  });

  it('쓰고 읽으면 같은 지문이 나온다', async () => {
    await ensureSyncStateTable(conn);
    const fps = [
      { dateKey: 20260101, rowCount: 10, hash: 'aaa' },
      { dateKey: 20260102, rowCount: 20, hash: 'bbb' },
    ];
    for (const sql of writeFingerprintsSql('race_entries', fps, '2026-09-29T01:00:00Z')) {
      await conn.run(sql);
    }
    expect(await readFingerprints(conn, 'race_entries')).toEqual(fps);
  });

  it('다른 테이블 지문과 섞이지 않는다', async () => {
    for (const sql of writeFingerprintsSql('predictions', [{ dateKey: 20260101, rowCount: 5, hash: 'zzz' }], '2026-09-29T01:00:00Z')) {
      await conn.run(sql);
    }
    const re = await readFingerprints(conn, 'race_entries');
    expect(re.find((f) => f.hash === 'zzz')).toBeUndefined();
  });

  it('같은 날짜를 다시 쓰면 덮어쓴다 (멱등)', async () => {
    for (const sql of writeFingerprintsSql('race_entries', [{ dateKey: 20260101, rowCount: 11, hash: 'ccc' }], '2026-09-29T03:00:00Z')) {
      await conn.run(sql);
    }
    const got = await readFingerprints(conn, 'race_entries');
    expect(got.filter((f) => f.dateKey === 20260101)).toEqual([{ dateKey: 20260101, rowCount: 11, hash: 'ccc' }]);
  });

  it('삭제 SQL이 지정 날짜만 지운다', async () => {
    await conn.run(deleteFingerprintsSql('race_entries', [20260101]));
    expect((await readFingerprints(conn, 'race_entries')).map((f) => f.dateKey)).toEqual([20260102]);
  });

  it('빈 목록 삭제는 아무것도 안 지운다', async () => {
    await conn.run(deleteFingerprintsSql('race_entries', []));
    expect(await readFingerprints(conn, 'race_entries')).toHaveLength(1);
  });

  it('전량 테이블은 date_key=-1 한 줄', async () => {
    for (const sql of writeFingerprintsSql('races', [{ dateKey: FULL_TABLE_DATE_KEY, rowCount: 8214, hash: 'full' }], '2026-09-29T02:00:00Z')) {
      await conn.run(sql);
    }
    expect(await readFingerprints(conn, 'races')).toEqual([{ dateKey: -1, rowCount: 8214, hash: 'full' }]);
  });

  it('readLastSyncedAt은 전체에서 가장 최근', async () => {
    // 앞 테스트들이 남긴 상태에 의존하지 않도록 확실히 최신인 한 줄을 여기서 쓴다
    for (const sql of writeFingerprintsSql('jockey_stats', [{ dateKey: FULL_TABLE_DATE_KEY, rowCount: 59, hash: 'j' }], '2026-09-29T09:00:00Z')) {
      await conn.run(sql);
    }
    const last = await readLastSyncedAt(conn);
    expect(last).not.toBeNull();
    expect(Date.parse(last!)).toBe(Date.parse('2026-09-29T09:00:00Z'));
  });

  it('작은따옴표가 든 이름도 안전하게 처리', async () => {
    for (const sql of writeFingerprintsSql("od'd", [{ dateKey: 1, rowCount: 1, hash: "a'b" }], '2026-09-29T01:00:00Z')) {
      await conn.run(sql);
    }
    expect(await readFingerprints(conn, "od'd")).toEqual([{ dateKey: 1, rowCount: 1, hash: "a'b" }]);
  });
});
