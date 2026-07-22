import { describe, it, expect } from 'vitest';
import { parseSyncBody } from './sync';

describe('parseSyncBody', () => {
  it('racecard 허용, date 없으면 inputs.date 생략', () => {
    expect(parseSyncBody({ target: 'racecard' })).toEqual({ ok: true, inputs: { target: 'racecard' } });
  });
  it('results + 8자리 date 채택', () => {
    expect(parseSyncBody({ target: 'results', date: '20260712' })).toEqual({
      ok: true,
      inputs: { target: 'results', date: '20260712' },
    });
  });
  it('date가 8자리 아니면 생략(에러 아님)', () => {
    expect(parseSyncBody({ target: 'racecard', date: '2026' })).toEqual({
      ok: true,
      inputs: { target: 'racecard' },
    });
  });
  it('target 미허용 → 에러', () => {
    expect(parseSyncBody({ target: 'nope' }).ok).toBe(false);
  });
  it('객체 아님 → 에러', () => {
    expect(parseSyncBody(null).ok).toBe(false);
    expect(parseSyncBody('x').ok).toBe(false);
  });
});
