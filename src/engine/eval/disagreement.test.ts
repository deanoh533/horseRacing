import { describe, it, expect } from 'vitest';
import { sliceDisagreement, bucket, type DisRow } from './disagreement.js';

const row = (dim: string, modelOrd: number, favOrd: number, modelOdds: number, favOdds: number): DisRow =>
  ({ modelOrd, favOrd, modelOdds, favOdds, dims: { 경마장: dim } });

describe('sliceDisagreement', () => {
  it('묶음별 모델픽·인기마 단승/연승률과 단승 회수율', () => {
    const rows = [row('서울', 1, 4, 8.0, 2.0), row('서울', 5, 1, 6.0, 2.0), row('부경', 3, 2, 5.0, 1.5)];
    const s = sliceDisagreement(rows, '경마장');
    const seoul = s.find((x) => x.bucket === '서울')!;
    expect(seoul.n).toBe(2);
    expect(seoul.modelWin).toBeCloseTo(0.5);
    expect(seoul.modelShow).toBeCloseTo(0.5);
    expect(seoul.favWin).toBeCloseTo(0.5);
    expect(seoul.favShow).toBeCloseTo(0.5);
    expect(seoul.modelRoi).toBeCloseTo(4.0);   // (8.0 + 0) / 2
    expect(seoul.favRoi).toBeCloseTo(1.0);     // (0 + 2.0) / 2
    expect(s.find((x) => x.bucket === '부경')!.modelShow).toBe(1);
  });

  it('묶음은 표본 많은 순', () => {
    const rows = [row('부경', 1, 2, 3, 2), row('서울', 1, 2, 3, 2), row('서울', 1, 2, 3, 2)];
    expect(sliceDisagreement(rows, '경마장').map((x) => x.bucket)).toEqual(['서울', '부경']);
  });
});

describe('bucket', () => {
  it('경계값은 다음 구간으로, NaN은 결측', () => {
    const edges = [3, 10];
    const labels = ['0~2', '3~9', '10+'];
    expect(bucket(2, edges, labels)).toBe('0~2');
    expect(bucket(3, edges, labels)).toBe('3~9');
    expect(bucket(10, edges, labels)).toBe('10+');
    expect(bucket(NaN, edges, labels)).toBe('결측');
  });
});
