import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * raceCardSync의 사전 예측 스냅샷 보호 가드 검증.
 *
 * 배경: dailySync는 predictions을 보존하도록 바뀌었지만(v7 라이브 추적, L-001),
 * raceCardSync는 여전히 predictRace → DELETE → INSERT 재계산 구조다. 결과(ord)가
 * 이미 도착한 과거 날짜에 raceCardSync를 재실행하면 gatherRaceInputs가 사후 모드로
 * 자동 분기해 수요일의 정직한 사전 예측이 사후 재계산으로 조용히 덮인다.
 *
 * 가드: 해당 경주의 race_entries에 ord가 채워진 행이 하나라도 있으면 예측 재계산을
 * 건너뛴다. 결과가 없는 경주(정상 수·목요일 흐름)는 기존처럼 재계산해 경주 전
 * 데이터 갱신을 반영한다.
 */

// ── 페이크 Supabase (tests/sync/dailySync.test.ts와 동일 패턴 + delete 지원) ──
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Array<[string, unknown]> = [];
  private op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select';
  private payload: unknown;
  private onConflict: string | undefined;
  private limitVal: number | null = null;

  constructor(private table: { rows: Record<string, unknown>[] }) {}

  select(_cols?: string): this { this.op = 'select'; return this; }
  eq(col: string, val: unknown): this { this.filters.push([col, val]); return this; }
  limit(n: number): this { this.limitVal = n; return this; }
  update(payload: Record<string, unknown>): this { this.op = 'update'; this.payload = payload; return this; }
  insert(payload: unknown): this { this.op = 'insert'; this.payload = payload; return this; }
  delete(): this { this.op = 'delete'; return this; }
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
      case 'delete': {
        this.table.rows = this.table.rows.filter((r) => !this.matches(r));
        return { data: null, error: null };
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

/** API26_2 entrySheet 아이템 최소 픽스처 (transformer가 ?? null로 흡수) */
function makeEntrySheetItem(overrides: Record<string, unknown> = {}) {
  return {
    rcDate: RC_DATE, rcNo: RC_NO, meet: '서울', chulNo: 1,
    hrName: '테스트말', hrNo: 'HR001', age: 3, sex: 'M', rating: 70,
    wgBudam: 58.5, jkName: '기수1', jkNo: 'J001', trName: '조교사1', trNo: 'T001',
    owName: '마주1', rank: '국6', rcDist: 1800, rcName: '일반', rcDay: '토',
    ageCond: '3세', prizeCond: 'R0~30',
    ...overrides,
  };
}

let fakeSb: FakeSupabase;
let mockGetAllEntrySheet: ReturnType<typeof vi.fn>;
let mockGetRaceCard: ReturnType<typeof vi.fn>;
let mockPredictRace: ReturnType<typeof vi.fn>;

vi.mock('@kra/client.js', () => ({
  getKRAClient: () => ({
    getAllEntrySheet: (...args: unknown[]) => mockGetAllEntrySheet(...args),
    getRaceCard: (...args: unknown[]) => mockGetRaceCard(...args),
  }),
}));
vi.mock('@db/supabase.js', () => ({
  getSupabaseAdmin: () => fakeSb,
}));
vi.mock('../../src/engine/scorePredictor.js', () => ({
  predictRace: (...args: unknown[]) => mockPredictRace(...args),
}));

describe('syncRaceCards - 사전 예측 스냅샷 보호 가드', () => {
  beforeEach(() => {
    fakeSb = new FakeSupabase();
    mockGetAllEntrySheet = vi.fn().mockResolvedValue([makeEntrySheetItem()]);
    mockGetRaceCard = vi.fn().mockResolvedValue([]); // 보조싱크 무해화
    mockPredictRace = vi.fn().mockResolvedValue([]);
  });

  it('결과(ord)가 이미 있는 경주는 예측 재계산을 건너뛰고 기존 predictions을 보존한다', async () => {
    // 결과가 도착한 과거 경주 + 수요일의 사전 예측이 존재
    fakeSb.tables['race_entries'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, pthr_no: 1, hr_name: '테스트말', ord: 2,
      }],
    };
    fakeSb.tables['predictions'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말',
        predicted_rank: 1, total_score: 0.68, p_top3: 0.75, actual_ord: 2,
      }],
    };

    const { syncRaceCards } = await import('../../src/sync/raceCardSync.js');
    await syncRaceCards({ rcDate: RC_DATE, meets: [MEET as 1] });

    // 예측 재계산이 호출되지 않아야 함 (스냅샷 보호)
    expect(mockPredictRace).not.toHaveBeenCalled();

    // 기존 predictions은 그대로 (DELETE되지 않음)
    const predRows = fakeSb.tables['predictions']!.rows;
    expect(predRows).toHaveLength(1);
    expect(predRows[0]!.total_score).toBe(0.68);
    expect(predRows[0]!.p_top3).toBe(0.75);
    expect(predRows[0]!.actual_ord).toBe(2);
  });

  it('결과가 없는 경주(ord 전부 null)는 기존처럼 예측을 재계산한다', async () => {
    // 정상 수요일 흐름: race_entries 없음(첫 sync) → upsert 후 ord=null 상태
    mockPredictRace.mockResolvedValue([
      {
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말',
        total_score: 0.5, predicted_rank: 1, item_scores: {}, actual_ord: null,
        model_version: 7, p_top3: 0.68, p_win: 0.3,
      },
    ]);
    // 목요일 재실행 시나리오: 이전 예측이 이미 있어도 ord가 없으면 재계산으로 갱신
    fakeSb.tables['predictions'] = {
      rows: [{
        race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말',
        predicted_rank: 2, total_score: 0.4, actual_ord: null,
      }],
    };

    const { syncRaceCards } = await import('../../src/sync/raceCardSync.js');
    await syncRaceCards({ rcDate: RC_DATE, meets: [MEET as 1] });

    // 재계산 호출됨 (경주 전 데이터 갱신 반영 — 기존 동작 유지)
    expect(mockPredictRace).toHaveBeenCalledTimes(1);

    // DELETE→INSERT로 새 예측으로 교체됨
    const predRows = fakeSb.tables['predictions']!.rows;
    expect(predRows).toHaveLength(1);
    expect(predRows[0]!.total_score).toBe(0.5);
    expect(predRows[0]!.predicted_rank).toBe(1);
  });
});
