import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import {
  DuckDBInstance,
  DuckDBStructValue, DuckDBListValue, DuckDBArrayValue, DuckDBMapValue,
} from '@duckdb/node-api';
import { makeLocalClient, getLocalDb, unwrapDuck } from './localDb.js';

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
    expect(data![3]!.race_date).toBe(20240301);
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
  it.skipIf(existsSync('data/local.duckdb'))('DB 파일 없으면 명확한 에러', async () => {
    await expect(getLocalDb()).rejects.toThrow('npm run db:pull');
  });
});

describe('getLocalDb 싱글턴 — 동시 호출 (2026-09-27 회귀)', () => {
  // 버그: `if (_conn)` 확인과 `_conn` 대입 사이가 await로 벌어져 있어, 동시에 부르면
  // 둘 다 "아직 없다"를 보고 둘 다 DuckDBInstance.create(같은 파일)를 실행했다.
  // 두 번째가 **자기 프로세스**를 가리키며 "다른 프로세스가 파일을 사용 중"으로 죽는다.
  // 실제로 터진 곳: scripts/probe_v7_accuracy.ts가 예측·결과를 Promise.all로 동시 로드 →
  // O-004 판정을 아예 못 돌렸다. 고침 = 연결이 아니라 "연결하는 중인 Promise"를 캐시.
  it.skipIf(!existsSync('data/local.duckdb'))('동시 호출해도 한 번만 열고 둘 다 쓸 수 있다', async () => {
    const [a, b] = await Promise.all([getLocalDb(), getLocalDb()]);

    for (const c of [a, b]) {
      const { error } = await c.from('races').select('race_date').limit(1);
      expect(error).toBeNull();
    }
    // 뒤이은 호출도 같은 연결에 올라탄다 (재오픈 시도 없음)
    const { error: later } = await (await getLocalDb()).from('races').select('race_date').limit(1);
    expect(later).toBeNull();
  });
});

describe('시각 컬럼 — supabase-js처럼 ISO 문자열로 나온다 (2026-09-27 회귀)', () => {
  // 버그: TIMESTAMP가 DuckDBTimestampValue{micros} 객체로 새어 나와 Date.parse가 NaN.
  // 터진 곳: isLivePrediction(created_at, race_date)이 전부 false → probe:v7-accuracy가
  // 예측 43,940건을 통째로 "백필"로 제외해 O-004 판정이 0행으로 나왔다.
  it('TIMESTAMP를 Date.parse 가능한 문자열로 준다', async () => {
    await conn.run(`CREATE TABLE ts_t (id INTEGER, created_at TIMESTAMP)`);
    await conn.run(`INSERT INTO ts_t VALUES (1, TIMESTAMP '2026-06-19 00:26:29.749')`);

    const { data, error } = await client.from('ts_t').select('*').eq('id', 1).single();
    expect(error).toBeNull();
    const c = (data as any).created_at;
    expect(typeof c).toBe('string');
    expect(Date.parse(c)).toBe(Date.parse('2026-06-19T00:26:29.749Z')); // UTC로 보존
  });

  it('STRUCT 안에 중첩된 TIMESTAMP도 문자열 (artifact.calibration.fitMeta.fitAt 경로)', async () => {
    await conn.run(`CREATE TABLE ts_nested (id INTEGER, meta STRUCT(fitAt TIMESTAMP, rows BIGINT))`);
    await conn.run(`INSERT INTO ts_nested VALUES (1, {'fitAt': TIMESTAMP '2026-07-10 12:00:00', 'rows': 500})`);

    const { data } = await client.from('ts_nested').select('*').eq('id', 1).single();
    const m = (data as any).meta;
    expect(typeof m.fitAt).toBe('string');
    expect(Date.parse(m.fitAt)).toBe(Date.parse('2026-07-10T12:00:00Z'));
    expect(m.rows).toBe(500);      // BigInt 변환은 그대로 유지
  });

  it('DATE는 YYYY-MM-DD', async () => {
    await conn.run(`CREATE TABLE d_t (id INTEGER, d DATE)`);
    await conn.run(`INSERT INTO d_t VALUES (1, DATE '2026-09-27')`);

    const { data } = await client.from('d_t').select('*').eq('id', 1).single();
    expect((data as any).d).toBe('2026-09-27');
  });

  it('NULL 시각은 null 그대로', async () => {
    await conn.run(`CREATE TABLE ts_null (id INTEGER, created_at TIMESTAMP)`);
    await conn.run(`INSERT INTO ts_null VALUES (1, NULL)`);

    const { data } = await client.from('ts_null').select('*').eq('id', 1).single();
    expect((data as any).created_at).toBeNull();
  });
});

describe('unwrapDuck — DuckDB 래퍼 → supabase-js 호환 평범한 JS 값', () => {
  it('스칼라/BigInt', () => {
    expect(unwrapDuck(3)).toBe(3);
    expect(unwrapDuck('a')).toBe('a');
    expect(unwrapDuck(null)).toBe(null);
    expect(unwrapDuck(10n)).toBe(10);
  });

  it('Struct → 객체, List/Array → 배열, Map → {key:value}', () => {
    expect(unwrapDuck(new DuckDBStructValue({ a: 1n, b: 'x' }))).toEqual({ a: 1, b: 'x' });
    expect(unwrapDuck(new DuckDBListValue([1n, 2n, 3n]))).toEqual([1, 2, 3]);
    expect(unwrapDuck(new DuckDBArrayValue(['a', 'b']))).toEqual(['a', 'b']);
    expect(unwrapDuck(new DuckDBMapValue([
      { key: '01_rating', value: 0.5 }, { key: '03_recent_form', value: 0.2 },
    ]))).toEqual({ '01_rating': 0.5, '03_recent_form': 0.2 });
  });

  it('중첩 artifact(LogisticModel) 완전 복원 — 회귀 버그 재현', () => {
    const artifact = new DuckDBStructValue({
      type: 'logistic',
      features: new DuckDBListValue(['age', 'rating_abs']),
      means: new DuckDBListValue([4n, 80n]),          // read_json_auto가 BIGINT로 추론 가능
      stds: new DuckDBListValue([1.5, 10.2]),
      coef: new DuckDBStructValue({ age: -0.133, rating_abs: 0.42 }),
      intercept: -1.0489,
    });
    const m = unwrapDuck(artifact) as Record<string, any>;
    expect(m.features).toEqual(['age', 'rating_abs']); // 변환 전: undefined → forEach throw
    expect(m.means).toEqual([4, 80]);                   // BigInt → number
    expect(m.coef.age).toBeCloseTo(-0.133);             // 변환 전: undefined → 기여도 0
    expect(m.entries).toBeUndefined();                  // 래퍼 흔적 없음
  });
});

describe('읽기 경로 통합 — STRUCT/MAP 컬럼이 평범한 객체로 나온다 (jsonb 미러 회귀)', () => {
  it('artifact STRUCT(+ 내부 MAP coef)를 select하면 LogisticModel 형태', async () => {
    await conn.run(`CREATE TABLE mv (id INTEGER, artifact STRUCT(
      type VARCHAR, features VARCHAR[], coef MAP(VARCHAR, DOUBLE), intercept DOUBLE))`);
    await conn.run(`INSERT INTO mv VALUES (1, {
      'type': 'logistic',
      'features': ['age', 'rating_abs'],
      'coef': MAP {'age': -0.133, 'rating_abs': 0.42},
      'intercept': -1.0489 })`);

    const { data, error } = await client.from('mv').select('*').eq('id', 1).single();
    expect(error).toBeNull();
    const a = (data as any).artifact;
    expect(a.type).toBe('logistic');
    expect(a.features).toEqual(['age', 'rating_abs']);
    expect(a.coef.age).toBeCloseTo(-0.133);     // 핵심: coef가 {age:..} 객체 (MAP 래퍼 아님)
    expect(a.coef.rating_abs).toBeCloseTo(0.42);
    expect(a.intercept).toBeCloseTo(-1.0489);
    expect(a.entries).toBeUndefined();
  });
});
