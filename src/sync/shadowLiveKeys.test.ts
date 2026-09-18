import { describe, it, expect } from 'vitest';
import { fetchLiveShadowKeys, type LiveKeyRow } from './shadowLiveKeys.js';

describe('fetchLiveShadowKeys', () => {
  it('한 페이지 크기를 넘는 행도 여러 페이지에 걸쳐 전부 수집한다', async () => {
    // pageSize=2로 소규모 재현 — 실제로는 PostgREST 기본 1000행 캡 상황
    const rows: LiveKeyRow[] = [
      { race_date: 20260701, meet: 1, rc_no: 1 },
      { race_date: 20260701, meet: 1, rc_no: 2 },
      { race_date: 20260701, meet: 1, rc_no: 3 },
      { race_date: 20260701, meet: 1, rc_no: 4 },
      { race_date: 20260701, meet: 1, rc_no: 5 },
    ];
    const offsetsCalled: number[] = [];
    const fetchPage = async (offset: number, limit: number) => {
      offsetsCalled.push(offset);
      return rows.slice(offset, offset + limit);
    };
    const keys = await fetchLiveShadowKeys(fetchPage, 2);
    expect(keys.size).toBe(5);
    expect(keys.has('20260701-1-1')).toBe(true);
    expect(keys.has('20260701-1-5')).toBe(true);
    expect(offsetsCalled).toEqual([0, 2, 4]); // 3페이지 호출 — 첫 페이지에서 멈추지 않음을 증명
  });

  it('경주당 여러 행(마리마다)이 같은 키로 중복 없이 합쳐진다', async () => {
    const rows: LiveKeyRow[] = [
      { race_date: 20260701, meet: 1, rc_no: 1 },
      { race_date: 20260701, meet: 1, rc_no: 1 },
      { race_date: 20260701, meet: 1, rc_no: 1 },
    ];
    const fetchPage = async (offset: number, limit: number) => rows.slice(offset, offset + limit);
    const keys = await fetchLiveShadowKeys(fetchPage, 2);
    expect(keys.size).toBe(1);
    expect([...keys]).toEqual(['20260701-1-1']);
  });

  it('빈 결과는 빈 집합', async () => {
    const keys = await fetchLiveShadowKeys(async () => [], 1000);
    expect(keys.size).toBe(0);
  });
});
