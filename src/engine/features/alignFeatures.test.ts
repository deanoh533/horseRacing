import { describe, it, expect } from 'vitest';
import { buildSchema, toVector } from './alignFeatures.js';

describe('alignFeatures', () => {
  it('여러 행의 feature 이름 합집합을 정렬된 스키마로', () => {
    const rows = [
      [{ name: 'a', value: 1 }, { name: 'b', value: 2 }],
      [{ name: 'b', value: 3 }, { name: 'c', value: 4 }],
    ];
    expect(buildSchema(rows)).toEqual(['a', 'b', 'c']);
  });
  it('없는 feature는 0으로 채운다', () => {
    const schema = ['a', 'b', 'c'];
    expect(toVector([{ name: 'b', value: 3 }], schema)).toEqual([0, 3, 0]);
  });
});
