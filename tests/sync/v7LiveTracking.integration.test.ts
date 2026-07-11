import { describe, it, expect, vi, beforeEach } from 'vitest';
import { joinResults, computeTiers } from '../../src/engine/eval/v7Accuracy.js';

/**
 * v7 라이브 추적 — 수요일→금요일→판정 端-to-端 통합 테스트.
 *
 * 개별 유닛 테스트(이미 존재, 재작성 금지):
 *   - tests/engine/scorePredictor.test.ts   forcePrecompetition 실동작 (Task 1)
 *   - tests/sync/dailySync.test.ts          syncDay의 predictions 쓰기 전략 4케이스 (Task 2/2b)
 *   - src/engine/eval/v7Accuracy.test.ts    joinResults/computeTiers 판정 로직 (Task 4)
 *
 * 이 파일은 그 조각들을 이어서 "전체 흐름이 실제로 연결되는가"만 검증한다:
 *   수요일 사전 예측(predictions 시드, actual_ord=NULL)
 *     → 금요일 syncDay() 실행 (race_entries ord 반영 + predictions 예측값 불변 + actual_ord만 채움 +
 *        예측 없는 경주는 forcePrecompetition으로 보충)
 *     → syncDay가 남긴 최종 predictions/race_entries 상태를 v7Accuracy 판정 함수에 그대로 흘려
 *        강추/주목/전체 적중률까지 계산되는지 확인.
 *
 * 설계: docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md §4(데이터 흐름) §5.2(통합 테스트)
 * 계획: docs/superpowers/plans/2026-07-11-v7-live-tracking.md Task 5
 */

// ── 페이크 Supabase (tests/sync/dailySync.test.ts와 동일한 체이닝 흉내 패턴) ──
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

const RC_DATE = 20260715;
const MEET = 1;

function makeHorseFixture(overrides: Record<string, unknown> = {}) {
  return {
    age: 3, ageCond: '3세', birthday: 20230101, budam: '', chulNo: 1,
    diffUnit: '', hrName: '말A', hrNo: 'HR001', hrTool: '', ilsu: 0,
    jkName: '기수1', jkNo: 'J001', meet: '서울', name: '', ord: 1, ordBigo: '',
    owName: '', owNo: 1, plcOdds: 2.1, prizeCond: '', rank: '', rankRise: 0,
    rating: 70, rcDate: RC_DATE, rcDay: '화', rcDist: 1800, rcName: '', rcNo: 1,
    rcTime: 110.5, sex: 'M', trName: '조교사1', trNo: 'T001', track: '서울/잔디',
    weather: '맑음', wgBudam: 58.5, wgBudamBigo: '', wgHr: '490(+3)', wgJk: 55,
    winOdds: 3.2,
    ...overrides,
  };
}

let fakeSb: FakeSupabase;
let mockGetAllRaceResults: ReturnType<typeof vi.fn>;
let mockPredictRace: ReturnType<typeof vi.fn>;

vi.mock('@kra/client.js', () => ({
  getKRAClient: () => ({ getAllRaceResults: mockGetAllRaceResults }),
}));
vi.mock('@db/supabase.js', () => ({
  getSupabaseAdmin: () => fakeSb,
}));
vi.mock('../../src/engine/scorePredictor.js', () => ({
  predictRace: (...args: unknown[]) => mockPredictRace(...args),
}));

describe('v7 라이브 추적 — 수요일→금요일→판정 통합 흐름', () => {
  beforeEach(() => {
    fakeSb = new FakeSupabase();
    mockPredictRace = vi.fn();
  });

  it('사전 예측 보존 + 보충 삽입 + actual_ord 반영이 판정 함수까지 이어진다', async () => {
    // ── 수요일: raceCardSync가 남겼을 상태를 시드로 재현 ──
    // rc_no=1: 사전 예측 2건 존재 (raceCardSync 결과물)
    fakeSb.tables['race_entries'] = {
      rows: [
        { race_date: RC_DATE, meet: MEET, rc_no: 1, pthr_no: 1, hr_name: '말A', ord: null },
        { race_date: RC_DATE, meet: MEET, rc_no: 1, pthr_no: 2, hr_name: '말B', ord: null },
        // rc_no=2: 출주표만 있고 사전 예측이 없는 경주 (수요일 예측 실패 시나리오)
        { race_date: RC_DATE, meet: MEET, rc_no: 2, pthr_no: 1, hr_name: '말C', ord: null },
      ],
    };
    fakeSb.tables['predictions'] = {
      rows: [
        {
          race_date: RC_DATE, meet: MEET, rc_no: 1, hr_name: '말A',
          predicted_rank: 1, total_score: 0.9, p_top3: 0.8, p_win: 0.4,
          model_version: 7, actual_ord: null,
        },
        {
          race_date: RC_DATE, meet: MEET, rc_no: 1, hr_name: '말B',
          predicted_rank: 2, total_score: 0.4, p_top3: 0.5, p_win: 0.1,
          model_version: 7, actual_ord: null,
        },
      ],
    };

    // rc_no=2 보충 시 forcePrecompetition으로 호출될 predictRace의 반환값
    mockPredictRace.mockResolvedValue([
      {
        race_date: RC_DATE, meet: MEET, rc_no: 2, hr_name: '말C',
        total_score: 0.95, predicted_rank: 1, item_scores: {}, actual_ord: null,
        model_version: 7, p_win: 0.5, p_top3: 0.9,
      },
    ]);

    // ── 금요일: KRA 결과 API 응답 (경주별로 다른 결과) ──
    // syncMeet은 meet당 한 번 getAllRaceResults를 호출해 rcNo로 그룹핑하므로
    // 두 경주(rc_no=1,2)의 결과를 한 번에 반환하도록 구성한다.
    mockGetAllRaceResults = vi.fn().mockResolvedValue([
      makeHorseFixture({ hrName: '말A', chulNo: 1, ord: 1, rcNo: 1 }), // 강추 적중
      makeHorseFixture({ hrName: '말B', chulNo: 2, ord: 5, rcNo: 1 }), // 미적중
      makeHorseFixture({ hrName: '말C', chulNo: 1, ord: 2, rcNo: 2 }), // 보충 예측 적중
    ]);

    const { syncDay } = await import('../../src/sync/dailySync.js');
    await syncDay({ rcDate: RC_DATE, meets: [MEET] });

    // ── 검증 1: race_entries.ord가 결과로 반영됨 ──
    const entries = fakeSb.tables['race_entries']!.rows;
    expect(entries.find((r) => r.hr_name === '말A')!.ord).toBe(1);
    expect(entries.find((r) => r.hr_name === '말B')!.ord).toBe(5);
    expect(entries.find((r) => r.hr_name === '말C')!.ord).toBe(2);

    // ── 검증 2: 기존 예측(말A/말B)은 예측값 필드가 절대 불변, actual_ord만 채워짐 ──
    const preds = fakeSb.tables['predictions']!.rows;
    const predA = preds.find((r) => r.hr_name === '말A')!;
    const predB = preds.find((r) => r.hr_name === '말B')!;
    expect(predA.predicted_rank).toBe(1);
    expect(predA.total_score).toBe(0.9);
    expect(predA.p_top3).toBe(0.8);
    expect(predA.actual_ord).toBe(1);
    expect(predB.p_top3).toBe(0.5);
    expect(predB.actual_ord).toBe(5);

    // ── 검증 3: 예측 없던 rc_no=2는 forcePrecompetition으로 보충 삽입 + actual_ord도 채워짐 ──
    expect(mockPredictRace).toHaveBeenCalledTimes(1);
    const call = mockPredictRace.mock.calls[0]!;
    expect(call.slice(1)).toEqual([RC_DATE, MEET, 2, { forcePrecompetition: true }]);
    const predC = preds.find((r) => r.hr_name === '말C')!;
    expect(predC.total_score).toBe(0.95); // 보충된 예측값 그대로
    expect(predC.actual_ord).toBe(2);

    // ── 검증 4: syncDay가 남긴 최종 상태를 v7Accuracy 판정 함수에 그대로 흘려 적중률까지 계산 ──
    const predictionSlim = preds.map((r) => ({
      race_date: r.race_date as number,
      meet: r.meet as number,
      rc_no: r.rc_no as number,
      hr_name: r.hr_name as string,
      p_top3: r.p_top3 as number | null,
      model_version: r.model_version as number | null,
    }));
    const resultSlim = entries.map((r) => ({
      race_date: r.race_date as number,
      meet: r.meet as number,
      rc_no: r.rc_no as number,
      hr_name: r.hr_name as string,
      ord: r.ord as number | null,
    }));

    const joined = joinResults(predictionSlim, resultSlim);
    const tiers = computeTiers(joined, 0.72, 0.62);

    const strong = tiers.find((t) => t.category === '강추')!;
    const watch = tiers.find((t) => t.category === '주목')!;
    const all = tiers.find((t) => t.category === '전체')!;

    // 강추(p_top3>=0.72): 말A(0.8, 적중) + 말C(0.9, 적중) = 2/2 = 100%
    expect(strong.total).toBe(2);
    expect(strong.correct).toBe(2);
    expect(strong.accuracy).toBeCloseTo(100.0);

    // 주목([0.62,0.72)): 해당 없음 (말B는 0.5로 미달)
    expect(watch.total).toBe(0);

    // 전체: 3건 중 2건 적중(말A, 말C) — 말B는 5착으로 미적중
    expect(all.total).toBe(3);
    expect(all.correct).toBe(2);
    expect(all.accuracy).toBeCloseTo(66.7);
  });
});
