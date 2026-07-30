import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * dailySync의 predictions 쓰기 전략 검증.
 *
 * 배경: 수요일 raceCardSync가 사전 예측(predictions)을 저장하는데, 기존 dailySync는
 * 금요일 결과 동기화 시 해당 경주의 predictions을 DELETE→INSERT로 무조건 재계산해서
 * 수요일 사전 예측을 지워버렸다. v7 라이브 적중률을 정직하게 추적하려면 사전 예측이
 * 보존돼야 한다 (docs/superpowers/plans/2026-07-11-v7-live-tracking.md Task 2).
 *
 * 이 테스트는 실제 syncDay()를 호출하되, KRA API·Supabase를 인메모리 페이크로
 * 대체해 (1) 기존 predictions이 있으면 절대 건드리지 않고 (2) 없을 때만
 * forcePrecompetition:true로 보충 삽입하는지를 런타임에 검증한다.
 */

// ── 페이크 Supabase (테이블별 인메모리 배열 + supabase-js 체이닝 흉내) ──
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<[string, unknown]> = [];
  private op: 'select' | 'update' | 'upsert' | 'insert' = 'select';
  private payload: unknown;
  private onConflict: string | undefined;
  private limitVal: number | null = null;
  private singleMode: 'none' | 'maybeSingle' | 'single' = 'none';

  constructor(private table: { rows: Record<string, unknown>[] }) {}

  select(_cols?: string): this { this.op = 'select'; return this; }
  eq(col: string, val: unknown): this { this.filters.push([col, val]); return this; }
  maybeSingle(): this { this.singleMode = 'maybeSingle'; return this; }
  single(): this { this.singleMode = 'single'; return this; }
  limit(n: number): this { this.limitVal = n; return this; }
  update(payload: Record<string, unknown>): this { this.op = 'update'; this.payload = payload; return this; }
  insert(payload: unknown): this { this.op = 'insert'; this.payload = payload; return this; }
  upsert(payload: unknown, opts?: { onConflict?: string }): this {
    this.op = 'upsert'; this.payload = payload; this.onConflict = opts?.onConflict; return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every(([c, v]) => row[c] === v);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    switch (this.op) {
      case 'select': {
        let rows = this.table.rows.filter((r) => this.matches(r));
        if (this.limitVal != null) rows = rows.slice(0, this.limitVal);
        if (this.singleMode === 'maybeSingle') {
          if (rows.length > 1) return { data: null, error: new Error('multiple rows') };
          return { data: rows[0] ?? null, error: null };
        }
        if (this.singleMode === 'single') {
          if (rows.length !== 1) return { data: null, error: new Error('expected 1 row') };
          return { data: rows[0], error: null };
        }
        return { data: rows, error: null };
      }
      case 'update': {
        for (const row of this.table.rows) {
          if (this.matches(row)) Object.assign(row, this.payload as Record<string, unknown>);
        }
        return { data: null, error: null };
      }
      case 'insert': {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        this.table.rows.push(...(rows as Record<string, unknown>[]).map((r) => ({ ...r })));
        return { data: rows, error: null };
      }
      case 'upsert': {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const keys = (this.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        for (const r of rows as Record<string, unknown>[]) {
          const idx = this.table.rows.findIndex(
            (existing) => keys.length > 0 && keys.every((k) => existing[k] === r[k])
          );
          if (idx >= 0) this.table.rows[idx] = { ...this.table.rows[idx], ...r };
          else this.table.rows.push({ ...r });
        }
        return { data: rows, error: null };
      }
    }
  }
}

class FakeSupabase {
  tables: Record<string, { rows: Record<string, unknown>[] }> = {};
  from(name: string): FakeQuery {
    if (!this.tables[name]) this.tables[name] = { rows: [] };
    return new FakeQuery(this.tables[name]!);
  }
}

const RC_DATE = 20260710;
const MEET = 1;
const RC_NO = 1;

function makeHorseFixture(overrides: Record<string, unknown> = {}) {
  return {
    age: 3, ageCond: '3세', birthday: 20230101, budam: '', chulNo: 1,
    diffUnit: '', hrName: '테스트말', hrNo: 'HR001', hrTool: '', ilsu: 0,
    jkName: '기수1', jkNo: 'J001', meet: '서울', name: '', ord: 2, ordBigo: '',
    owName: '', owNo: 1, plcOdds: 2.1, prizeCond: '', rank: '', rankRise: 0,
    rating: 70, rcDate: RC_DATE, rcDay: '토', rcDist: 1800, rcName: '', rcNo: RC_NO,
    rcTime: 110.5, sex: 'M', trName: '조교사1', trNo: 'T001', track: '서울/잔디',
    weather: '맑음', wgBudam: 58.5, wgBudamBigo: '', wgHr: '490(+3)', wgJk: 55,
    winOdds: 3.2,
    ...overrides,
  };
}

let fakeSb: FakeSupabase;
let mockGetAllRaceResults: ReturnType<typeof vi.fn>;
let mockPredictRace: ReturnType<typeof vi.fn>;
let mockGetComboDividends: ReturnType<typeof vi.fn>;

vi.mock('@kra/client.js', () => ({
  getKRAClient: () => ({
    getAllRaceResults: mockGetAllRaceResults,
    getComboDividends: mockGetComboDividends,
  }),
}));
vi.mock('@db/supabase.js', () => ({
  getSupabaseAdmin: () => fakeSb,
}));
vi.mock('../../src/engine/scorePredictor.js', () => ({
  predictRace: (...args: unknown[]) => mockPredictRace(...args),
}));

describe('syncDay - predictions 쓰기 전략 (v7 라이브 추적)', () => {
  beforeEach(() => {
    fakeSb = new FakeSupabase();
    mockGetAllRaceResults = vi.fn().mockResolvedValue([makeHorseFixture()]);
    mockPredictRace = vi.fn().mockResolvedValue([]);
    mockGetComboDividends = vi.fn().mockResolvedValue([
      { rcNo: RC_NO, pool: '복승식', chulNo: 1, chulNo2: 2, chulNo3: 0, odds: 12.4 },
      { rcNo: RC_NO, pool: '단승식', chulNo: 1, chulNo2: 0, chulNo3: 0, odds: 3.2 }, // 비대상 → 저장 안 됨
    ]);
  });

  it('기존 predictions이 있으면 재계산하지 않고 그대로 보존하되 actual_ord만 채운다', async () => {
    // 수요일에 저장된 사전 예측이 이미 존재 (race_entries도 카드로 이미 있음 → UPDATE 분기)
    fakeSb.tables['race_entries'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null,
      }],
    };
    fakeSb.tables['predictions'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말',
        predicted_rank: 1, total_score: 0.68, p_top3: 0.75, p_win: 0.3, actual_ord: null,
      }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    // predictRace가 호출되지 않았어야 함 (이미 예측 존재 → 보충 불필요)
    expect(mockPredictRace).not.toHaveBeenCalled();

    // predictions은 예측값 필드 무변경 + actual_ord만 결과(ord=2)로 채워짐
    const predRows = fakeSb.tables['predictions']!.rows;
    expect(predRows).toHaveLength(1);
    expect(predRows[0]!.predicted_rank).toBe(1);
    expect(predRows[0]!.total_score).toBe(0.68);
    expect(predRows[0]!.p_top3).toBe(0.75);
    expect(predRows[0]!.p_win).toBe(0.3);
    expect(predRows[0]!.actual_ord).toBe(2); // 결과 도착 → 채워짐

    // race_entries는 결과(ord)로 업데이트됨
    const entryRows = fakeSb.tables['race_entries']!.rows;
    expect(entryRows[0]!.ord).toBe(2);
  });

  it('predictions이 없으면 forcePrecompetition 모드로 보충 삽입하고 actual_ord도 채운다', async () => {
    // race_entries만 있고 predictions은 없음 (수요일 사전 예측 실패 시나리오)
    fakeSb.tables['race_entries'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null,
      }],
    };
    fakeSb.tables['predictions'] = { rows: [] };

    mockPredictRace.mockResolvedValue([
      {
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말',
        total_score: 0.5, predicted_rank: 1, item_scores: {}, actual_ord: null,
        model_version: 7, p_win: 0.3, p_top3: 0.68,
      },
    ]);

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    // forcePrecompetition:true로 보충 호출됨
    expect(mockPredictRace).toHaveBeenCalledTimes(1);
    const call = mockPredictRace.mock.calls[0]!;
    expect(call[1]).toBe(RC_DATE);
    expect(call[2]).toBe(MEET);
    expect(call[3]).toBe(RC_NO);
    expect(call[4]).toEqual({ forcePrecompetition: true });

    // predictions에 보충 삽입되고, 같은 sync 내에서 actual_ord도 결과(ord=2)로 채워짐
    const predRows = fakeSb.tables['predictions']!.rows;
    expect(predRows).toHaveLength(1);
    expect(predRows[0]!.hr_name).toBe('테스트말');
    expect(predRows[0]!.total_score).toBe(0.5); // 예측값 필드는 보충된 그대로
    expect(predRows[0]!.actual_ord).toBe(2); // 보충 예측도 결과가 채워짐
  });

  it('ord가 NULL(실격 등)인 엔트리는 actual_ord를 건드리지 않는다', async () => {
    // KRA API 실격 코드(>=90) → transformer가 ord를 null로 변환
    mockGetAllRaceResults.mockResolvedValue([makeHorseFixture({ ord: 99 })]);

    fakeSb.tables['race_entries'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null,
      }],
    };
    fakeSb.tables['predictions'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말',
        predicted_rank: 1, total_score: 0.68, actual_ord: 5, // 센티널: 건드려지면 안 됨
      }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    // race_entries의 ord는 null (실격)
    const entryRows = fakeSb.tables['race_entries']!.rows;
    expect(entryRows[0]!.ord).toBeNull();

    // predictions.actual_ord는 손대지 않아 센티널 값 그대로
    const predRows = fakeSb.tables['predictions']!.rows;
    expect(predRows[0]!.actual_ord).toBe(5);
  });

  it('skipPredictions=true면 보충 로직도 건너뛰고 actual_ord UPDATE도 건너뛴다 (백필 경로 보호)', async () => {
    fakeSb.tables['race_entries'] = { rows: [] }; // 과거 데이터: 카드 없이 결과만
    // 우연히 같은 키로 predictions row가 있어도(과거 backfill_predictions 흔적 등) 건드리지 않아야 함
    fakeSb.tables['predictions'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', actual_ord: null,
      }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET], skipPredictions: true });

    expect(mockPredictRace).not.toHaveBeenCalled();
    // 백필 경로에서는 actual_ord도 건드리지 않음 (predictions 관련 쿼리 자체를 스킵 — egress 보호)
    expect(fakeSb.tables['predictions']!.rows).toHaveLength(1);
    expect(fakeSb.tables['predictions']!.rows[0]!.actual_ord).toBeNull();
  });

  it('결과 sync 시 대상 pool 조합배당을 combo_dividends에 저장한다', async () => {
    fakeSb.tables['race_entries'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null }],
    };
    fakeSb.tables['predictions'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', predicted_rank: 1, actual_ord: null }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    expect(mockGetComboDividends).toHaveBeenCalledTimes(1);
    const combo = fakeSb.tables['combo_dividends']?.rows ?? [];
    expect(combo).toHaveLength(1); // 복승식만, 단승식 제외
    expect(combo[0]).toMatchObject({
      race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pool: '복승식', leg1: 1, leg2: 2, leg3: 0, odds: 12.4,
    });
  });

  it('수신은 있으나 대상 pool 매칭이 0건이면 combo_dividends에 아무것도 저장하지 않는다', async () => {
    // 대상이 아닌 pool(단승식)만 수신 → COMBO_POOLS 필터가 전부 걸러냄
    mockGetComboDividends.mockResolvedValue([
      { rcNo: RC_NO, pool: '단승식', chulNo: 1, chulNo2: 0, chulNo3: 0, odds: 3.2 },
    ]);

    fakeSb.tables['race_entries'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null }],
    };
    fakeSb.tables['predictions'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', predicted_rank: 1, actual_ord: null }],
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    expect(mockGetComboDividends).toHaveBeenCalledTimes(1);
    expect(fakeSb.tables['combo_dividends']?.rows ?? []).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('대상 pool 매칭 0건'));

    warnSpy.mockRestore();
  });

  it('skipPredictions=true(백필)면 조합배당을 수집하지 않는다', async () => {
    fakeSb.tables['race_entries'] = {
      rows: [{ race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: null }],
    };

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET], skipPredictions: true });

    expect(mockGetComboDividends).not.toHaveBeenCalled();
    expect(fakeSb.tables['combo_dividends']?.rows ?? []).toHaveLength(0);
  });
});
