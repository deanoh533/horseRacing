import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyIncremental, tableExistsInMirror, writeRowsJson } from './load.js';
import { ensureSyncStateTable, readFingerprints } from './syncState.js';
import { makeLocalClient } from '../localDb.js';
import type { Fingerprint } from './fingerprint.js';

let conn: any;
const tmpFiles: string[] = [];

const tmpJson = (name: string, rows: unknown[]): string => {
  const p = join(tmpdir(), `loadtest_${name}_${Date.now()}.json`).replace(/\\/g, '/');
  writeFileSync(p, JSON.stringify(rows));
  tmpFiles.push(p);
  return p;
};

beforeEach(async () => {
  const instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  await ensureSyncStateTable(conn);
  await conn.run(`CREATE TABLE t (race_date BIGINT, meet BIGINT, note VARCHAR)`);
  await conn.run(`INSERT INTO t VALUES
    (20260101, 1, 'a1'), (20260101, 3, 'a3'),
    (20260102, 1, 'b1'), (20260102, 3, 'b3')`);
  for (const sql of [
    ...(await import('./syncState.js')).writeFingerprintsSql('t', [
      { dateKey: 20260101, rowCount: 2, hash: 'h1' },
      { dateKey: 20260102, rowCount: 2, hash: 'h2' },
    ], '2026-09-29T00:00:00Z'),
  ]) await conn.run(sql);
});

afterEach(() => {
  for (const f of tmpFiles.splice(0)) if (existsSync(f)) unlinkSync(f);
});

const rowsOf = async (): Promise<Array<{ race_date: number; meet: number; note: string }>> => {
  const r = await conn.runAndReadAll('SELECT race_date, meet, note FROM t ORDER BY race_date, meet');
  return (r.getRowObjects() as any[]).map((x) => ({
    race_date: Number(x.race_date), meet: Number(x.meet), note: x.note,
  }));
};

describe('tableExistsInMirror', () => {
  it('있으면 true, 없으면 false', async () => {
    expect(await tableExistsInMirror(conn, 't')).toBe(true);
    expect(await tableExistsInMirror(conn, 'nope')).toBe(false);
  });
});

describe('applyIncremental', () => {
  it('바뀐 날짜만 교체하고 다른 날짜는 건드리지 않는다', async () => {
    const path = tmpJson('changed', [
      { race_date: 20260102, meet: 1, note: 'B1-new' },
      { race_date: 20260102, meet: 3, note: 'B3-new' },
      { race_date: 20260102, meet: 4, note: 'B4-new' },
    ]);
    const fps: Fingerprint[] = [{ dateKey: 20260102, rowCount: 3, hash: 'h2-new' }];

    await applyIncremental({
      conn, table: 't', dateCol: 'race_date',
      load: [20260102], remove: [], rowsJsonPath: path,
      fingerprints: fps, syncedAtIso: '2026-09-29T05:00:00Z',
    });

    expect(await rowsOf()).toEqual([
      { race_date: 20260101, meet: 1, note: 'a1' },   // 그대로
      { race_date: 20260101, meet: 3, note: 'a3' },   // 그대로
      { race_date: 20260102, meet: 1, note: 'B1-new' },
      { race_date: 20260102, meet: 3, note: 'B3-new' },
      { race_date: 20260102, meet: 4, note: 'B4-new' },
    ]);
    const stored = await readFingerprints(conn, 't');
    expect(stored).toEqual([
      { dateKey: 20260101, rowCount: 2, hash: 'h1' },     // 안 건드림
      { dateKey: 20260102, rowCount: 3, hash: 'h2-new' }, // 갱신
    ]);
  });

  it('사라진 날짜는 데이터도 지문도 지운다', async () => {
    await applyIncremental({
      conn, table: 't', dateCol: 'race_date',
      load: [], remove: [20260101], rowsJsonPath: null,
      fingerprints: [], syncedAtIso: '2026-09-29T05:00:00Z',
    });

    expect((await rowsOf()).map((r) => r.race_date)).toEqual([20260102, 20260102]);
    expect((await readFingerprints(conn, 't')).map((f) => f.dateKey)).toEqual([20260102]);
  });

  it('실패하면 롤백돼 데이터·지문이 둘 다 이전 상태', async () => {
    const before = await rowsOf();
    const path = tmpJson('bad', [{ race_date: 20260102, meet: 1, nope_col: 'x' }]);

    await expect(applyIncremental({
      conn, table: 't', dateCol: 'race_date',
      load: [20260102], remove: [], rowsJsonPath: path,
      fingerprints: [{ dateKey: 20260102, rowCount: 1, hash: 'h2-bad' }],
      syncedAtIso: '2026-09-29T05:00:00Z',
    })).rejects.toThrow();

    expect(await rowsOf()).toEqual(before);
    expect((await readFingerprints(conn, 't')).find((f) => f.dateKey === 20260102)?.hash).toBe('h2');
  });

  it('BY NAME — JSON 키 순서가 테이블과 달라도 값이 제자리에 들어간다', async () => {
    const path = tmpJson('order', [{ note: 'zz', meet: 9, race_date: 20260103 }]);
    await applyIncremental({
      conn, table: 't', dateCol: 'race_date',
      load: [20260103], remove: [], rowsJsonPath: path,
      fingerprints: [{ dateKey: 20260103, rowCount: 1, hash: 'h3' }],
      syncedAtIso: '2026-09-29T05:00:00Z',
    });
    const added = (await rowsOf()).find((r) => r.race_date === 20260103);
    expect(added).toEqual({ race_date: 20260103, meet: 9, note: 'zz' });
  });
});

// Review Focus 5 — spec §8: 값 모양이 supabase-js와 같아야 한다
describe('증분 적재 뒤에도 값 모양이 유지된다', () => {
  it('TIMESTAMP는 ISO 문자열, jsonb STRUCT는 평범한 객체', async () => {
    await conn.run(`CREATE TABLE s (race_date BIGINT, created_at TIMESTAMP, payload STRUCT(k VARCHAR))`);
    await conn.run(`INSERT INTO s VALUES (20260101, TIMESTAMP '2026-01-01 00:00:00', {'k': 'old'})`);

    const path = tmpJson('shape', [
      { race_date: 20260102, created_at: '2026-06-19T00:26:29.749Z', payload: { k: 'new' } },
    ]);
    await applyIncremental({
      conn, table: 's', dateCol: 'race_date',
      load: [20260102], remove: [], rowsJsonPath: path,
      fingerprints: [{ dateKey: 20260102, rowCount: 1, hash: 'x' }],
      syncedAtIso: '2026-09-29T05:00:00Z',
    });

    const client = makeLocalClient(conn);
    const { data, error } = await client.from('s').select('*').eq('race_date', 20260102).single();
    expect(error).toBeNull();
    const row = data as any;
    expect(typeof row.created_at).toBe('string');
    expect(Date.parse(row.created_at)).toBe(Date.parse('2026-06-19T00:26:29.749Z'));
    expect(row.payload.k).toBe('new');
    expect(row.payload.entries).toBeUndefined();
  });
});

describe('writeRowsJson', () => {
  it('행이 없으면 null을 준다 (임시 파일 안 만듦)', () => {
    expect(writeRowsJson('t', [])).toBeNull();
  });

  it('행이 있으면 경로를 주고 읽을 수 있다', () => {
    const p = writeRowsJson('t', [{ a: 1 }]);
    expect(p).not.toBeNull();
    tmpFiles.push(p!);
    expect(existsSync(p!)).toBe(true);
  });
});
