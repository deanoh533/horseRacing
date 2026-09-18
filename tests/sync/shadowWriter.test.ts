import { describe, it, expect } from 'vitest';
import { writeShadowPredictions, updateShadowActualOrd } from '../../src/sync/shadowWriter.js';

// ── 페이크 Supabase (tests/sync/raceCardSync.test.ts 16~91행과 동일) ──
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

const row = (hr: string, v: number, rank: number) => ({
  race_date: 20260912, meet: 1, rc_no: 3, hr_name: hr, model_version: v,
  total_score: 1 / rank, predicted_rank: rank, p_top3: null, actual_ord: null,
});

describe('writeShadowPredictions', () => {
  it('같은 경주·버전의 기존 행을 지우고 source를 붙여 넣는다 (다른 버전은 보존)', async () => {
    const sb = new FakeSupabase();
    sb.tables['shadow_predictions'] = { rows: [
      { ...row('A', 8, 2), source: 'live' },
      { ...row('A', 9, 1), source: 'live' },
    ] };
    await writeShadowPredictions(sb as never, [row('A', 8, 1), row('B', 8, 2)], 'live');
    const rows = sb.tables['shadow_predictions']!.rows;
    expect(rows.filter((r) => r.model_version === 8)).toHaveLength(2);
    expect(rows.find((r) => r.model_version === 8 && r.hr_name === 'A')!.predicted_rank).toBe(1);
    expect(rows.filter((r) => r.model_version === 9)).toHaveLength(1);
    expect(rows.every((r) => r.source === 'live')).toBe(true);
  });

  it('빈 배열이면 아무것도 하지 않는다', async () => {
    const sb = new FakeSupabase();
    await writeShadowPredictions(sb as never, [], 'live');
    expect(sb.tables['shadow_predictions']).toBeUndefined();
  });
});

describe('updateShadowActualOrd', () => {
  it('모든 버전의 해당 말 actual_ord를 채우고 ord=null은 건너뛴다', async () => {
    const sb = new FakeSupabase();
    sb.tables['shadow_predictions'] = { rows: [row('A', 8, 1), row('A', 9, 2), row('B', 8, 2)] };
    await updateShadowActualOrd(sb as never, 20260912, 1, 3, [{ hrName: 'A', ord: 2 }, { hrName: 'B', ord: null }]);
    const rows = sb.tables['shadow_predictions']!.rows;
    expect(rows.filter((r) => r.hr_name === 'A').every((r) => r.actual_ord === 2)).toBe(true);
    expect(rows.find((r) => r.hr_name === 'B')!.actual_ord).toBeNull();
  });
});
