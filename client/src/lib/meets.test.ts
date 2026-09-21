import { describe, it, expect } from 'vitest';
import { meetGroup } from './meets';

describe('meetGroup', () => {
  // 순회경마: 같은 기수가 금=부경·일=영천을 매주 탄다
  it('부경과 영천은 같은 묶음', () => {
    expect(meetGroup(3)).toEqual([3, 4]);
    expect(meetGroup(4)).toEqual([3, 4]);
  });

  it('서울은 혼자', () => {
    expect(meetGroup(1)).toEqual([1]);
  });

  it('모르는 코드는 그 코드만 (조용히 넓히지 않는다)', () => {
    expect(meetGroup(2)).toEqual([2]);
  });
});
