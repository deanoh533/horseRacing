import { describe, it, expect } from 'vitest';
import { parseSyncBody } from './sync';

describe('parseSyncBody', () => {
  it('racecard 허용, date 없으면 inputs.date 생략', () => {
    expect(parseSyncBody({ target: 'racecard' })).toEqual({ ok: true, inputs: { target: 'racecard' } });
  });
  it('racecard + 8자리 date 채택', () => {
    expect(parseSyncBody({ target: 'racecard', date: '20260712' })).toEqual({
      ok: true,
      inputs: { target: 'racecard', date: '20260712' },
    });
  });
  it('date가 8자리 아니면 생략(에러 아님)', () => {
    expect(parseSyncBody({ target: 'racecard', date: '2026' })).toEqual({
      ok: true,
      inputs: { target: 'racecard' },
    });
  });
  it('resultsPoll·resultsCatchup 허용 (외부 알람·수동 실행 통로)', () => {
    expect(parseSyncBody({ target: 'resultsPoll' })).toEqual({ ok: true, inputs: { target: 'resultsPoll' } });
    expect(parseSyncBody({ target: 'resultsCatchup' })).toEqual({ ok: true, inputs: { target: 'resultsCatchup' } });
  });
  it('옛 이름 results는 resultsPoll로 연결 (2026-08-29 워크플로 재설계 전 호환)', () => {
    expect(parseSyncBody({ target: 'results' })).toEqual({ ok: true, inputs: { target: 'resultsPoll' } });
  });
  it('결과 잡에는 date를 넘기지 않는다 (워크플로가 출마표에만 씀)', () => {
    expect(parseSyncBody({ target: 'resultsPoll', date: '20260712' })).toEqual({
      ok: true,
      inputs: { target: 'resultsPoll' },
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
