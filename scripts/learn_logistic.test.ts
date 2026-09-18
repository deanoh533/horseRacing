import { describe, it, expect } from 'vitest';
import { groupRowsByRace, maxRaceDate, parseLearnArgs } from './learn_logistic.js';

const row = (d: number, rc: number, hr: string, ord: number) => ({ race_date: d, meet: 1, rc_no: rc, hr_name: hr, ord, top3: ord <= 3 ? 1 : 0, features: [{ name: 'x', value: ord }] });

describe('learn_logistic helpers', () => {
  it('경주 단위로 묶는다', () => {
    const g = groupRowsByRace([row(1, 1, 'A', 1), row(1, 1, 'B', 2), row(1, 2, 'C', 1)], ['x']);
    expect(g).toHaveLength(2);
    expect(g[0]!.horses.map((h) => h.ord)).toEqual([1, 2]);
  });
  it('train_until = 행렬의 최대 경주일', () => {
    expect(maxRaceDate([row(20260601, 1, 'A', 1), row(20260630, 1, 'B', 1)])).toBe(20260630);
  });
});

describe('parseLearnArgs', () => {
  it('기본값', () => {
    expect(parseLearnArgs([])).toEqual({
      matrixPath: 'data/training_matrix.jsonl',
      label: 'v4-logit',
      modelType: 'logistic',
      l2: 0.02,
      iters: 800,
      shadow: false,
    });
  });

  it('유효한 pl-top3 인자 파싱', () => {
    expect(parseLearnArgs(['--matrix', 'data/m.jsonl', '--label', 'v8-cand', '--model', 'pl-top3', '--l2', '0.05', '--iters', '500', '--shadow'])).toEqual({
      matrixPath: 'data/m.jsonl',
      label: 'v8-cand',
      modelType: 'pl-top3',
      l2: 0.05,
      iters: 500,
      shadow: true,
    });
  });

  it('잘못된 --model 값은 에러', () => {
    expect(() => parseLearnArgs(['--model', 'typo'])).toThrow();
  });

  it('잘못된 --l2 값(숫자 아님)은 에러', () => {
    expect(() => parseLearnArgs(['--l2', 'abc'])).toThrow();
  });

  it('잘못된 --l2 값(0 이하)은 에러', () => {
    expect(() => parseLearnArgs(['--l2', '0'])).toThrow();
    expect(() => parseLearnArgs(['--l2', '-1'])).toThrow();
  });

  it('잘못된 --iters 값(정수 아님)은 에러', () => {
    expect(() => parseLearnArgs(['--iters', 'abc'])).toThrow();
    expect(() => parseLearnArgs(['--iters', '3.5'])).toThrow();
  });

  it('잘못된 --iters 값(0 이하)은 에러', () => {
    expect(() => parseLearnArgs(['--iters', '0'])).toThrow();
    expect(() => parseLearnArgs(['--iters', '-5'])).toThrow();
  });
});
