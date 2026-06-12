import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';
import { makeLocalClient, getLocalDb } from './localDb.js';

let instance: any;
let conn: any;
let client: ReturnType<typeof makeLocalClient>;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  await conn.run(`CREATE TABLE races (
    race_date INTEGER, meet INTEGER, rc_no INTEGER,
    rc_dist INTEGER, track_type VARCHAR, prize_cond VARCHAR,
    ord INTEGER
  )`);
  await conn.run(`INSERT INTO races VALUES
    (20240101, 1, 1, 1400, 'T', 'A', 1),
    (20240101, 1, 2, 1800, 'D', 'B', 2),
    (20240201, 2, 1, 1200, 'T', 'A', 3),
    (20240301, 1, 1, 1400, 'T', 'C', NULL)
  `);
  client = makeLocalClient(conn);
});

afterAll(async () => {
  // conn.close() / instance.close() 은 @duckdb/node-api에서 미지원 — GC가 자동 해제
});

describe('select', () => {
  it('기본: 전체 컬럼', async () => {
    const { data, error } = await client.from('races').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
    expect(data![0]).toHaveProperty('race_date');
  });

  it('특정 컬럼 선택', async () => {
    const { data } = await client.from('races').select('race_date, meet');
    expect(data).toHaveLength(4);
    expect(Object.keys(data![0]!).sort()).toEqual(['meet', 'race_date']);
  });
});

describe('eq / neq', () => {
  it('eq: meet = 1', async () => {
    const { data } = await client.from('races').select('*').eq('meet', 1);
    expect(data).toHaveLength(3);
    expect(data!.every((r: any) => r.meet === 1)).toBe(true);
  });

  it('neq: meet != 1', async () => {
    const { data } = await client.from('races').select('*').neq('meet', 1);
    expect(data).toHaveLength(1);
    expect(data![0]!.meet).toBe(2);
  });
});

describe('gt / gte / lt / lte', () => {
  it('gte: race_date >= 20240201', async () => {
    const { data } = await client.from('races').select('race_date').gte('race_date', 20240201);
    expect(data).toHaveLength(2);
  });

  it('lte: race_date <= 20240101', async () => {
    const { data } = await client.from('races').select('race_date').lte('race_date', 20240101);
    expect(data).toHaveLength(2);
  });

  it('gt: rc_dist > 1400', async () => {
    const { data } = await client.from('races').select('rc_dist').gt('rc_dist', 1400);
    expect(data).toHaveLength(1);
    expect(data![0]!.rc_dist).toBe(1800);
  });

  it('lt: rc_dist < 1400', async () => {
    const { data } = await client.from('races').select('rc_dist').lt('rc_dist', 1400);
    expect(data).toHaveLength(1);
    expect(data![0]!.rc_dist).toBe(1200);
  });
});

describe('in', () => {
  it('in: meet IN [1, 2]', async () => {
    const { data } = await client.from('races').select('*').in('meet', [1, 2]);
    expect(data).toHaveLength(4);
  });

  it('in: track_type IN ["D"]', async () => {
    const { data } = await client.from('races').select('*').in('track_type', ['D']);
    expect(data).toHaveLength(1);
    expect(data![0]!.track_type).toBe('D');
  });
});

describe('is / not', () => {
  it('is null: ord IS NULL', async () => {
    const { data } = await client.from('races').select('*').is('ord', null);
    expect(data).toHaveLength(1);
    expect(data![0]!.ord).toBeNull();
  });

  it('not is null: ord IS NOT NULL', async () => {
    const { data } = await client.from('races').select('*').not('ord', 'is', null);
    expect(data).toHaveLength(3);
    data!.forEach((r: any) => expect(r.ord).not.toBeNull());
  });
});

describe('복합 필터', () => {
  it('eq + gte + lte 조합', async () => {
    const { data } = await client.from('races').select('*')
      .eq('meet', 1)
      .gte('race_date', 20240101)
      .lte('race_date', 20240101);
    expect(data).toHaveLength(2);
  });

  it('in + not is null 조합', async () => {
    const { data } = await client.from('races').select('*')
      .in('track_type', ['T'])
      .not('ord', 'is', null);
    expect(data).toHaveLength(2);
  });
});

describe('order', () => {
  it('ascending: race_date ASC', async () => {
    const { data } = await client.from('races').select('race_date')
      .order('race_date', { ascending: true });
    expect(data).toHaveLength(4);
    expect(data![0]!.race_date).toBe(20240101);
  });

  it('descending: race_date DESC', async () => {
    const { data } = await client.from('races').select('race_date')
      .order('race_date', { ascending: false });
    expect(data).toHaveLength(4);
    expect(data![0]!.race_date).toBe(20240301);
  });

  it('다중 order: meet ASC, rc_no DESC', async () => {
    const { data } = await client.from('races').select('*')
      .order('meet', { ascending: true })
      .order('rc_no', { ascending: false });
    // meet=1인 행이 3개 있고, rc_no는 1, 2, 1 → rc_no DESC이면 2가 먼저
    expect(data).toHaveLength(4);
    expect(data![0]!.meet).toBe(1);
    expect(data![0]!.rc_no).toBe(2);
  });
});

describe('range / limit', () => {
  it('limit: limit(2)', async () => {
    const { data } = await client.from('races').select('*').limit(2);
    expect(data).toHaveLength(2);
  });

  it('range: range(1, 2)', async () => {
    const { data } = await client.from('races').select('*').range(1, 2);
    expect(data).toHaveLength(2);
  });

  it('range + order: 2번째부터 2개, race_date ASC', async () => {
    const { data } = await client.from('races').select('race_date')
      .order('race_date', { ascending: true })
      .range(1, 2);
    expect(data).toHaveLength(2);
    expect(data![0]!.race_date).toBe(20240101); // 2번째 (offset 1)
    expect(data![1]!.race_date).toBe(20240201); // 3번째
  });
});

describe('single / maybeSingle', () => {
  it('single: 정확히 1행', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('meet', 2)
      .single();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.meet).toBe(2);
  });

  it('single: 0행 → error', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('meet', 99)
      .single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('single: 다행 → error', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('meet', 1)
      .single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('maybeSingle: 0행 → null', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('meet', 99)
      .maybeSingle();
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('maybeSingle: 1행 → 객체', async () => {
    const { data, error } = await client.from('races').select('*')
      .eq('meet', 2)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.meet).toBe(2);
  });
});

describe('getLocalDb 에러', () => {
  it('DB 파일 없으면 명확한 에러', async () => {
    if (existsSync('data/local.duckdb')) {
      // 파일이 있으면 이 테스트 생략
      return;
    }
    await expect(getLocalDb()).rejects.toThrow('npm run db:pull');
  });
});
