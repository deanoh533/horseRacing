import { describe, it, expect } from 'vitest';
import { stripHrNameTag } from '../../src/utils/parsers.js';

/**
 * KRA API가 이적마 이름 앞에 지역 태그를 붙이는데 표기가 일정하지 않다
 * ("[부산경남]벌교의꿈" vs "[부]벌교의꿈" vs "벌교의꿈" — 같은 말인데 hr_name이 갈림).
 * hr_name은 과거전적·기수궁합·조교기록 등 전 프로젝트에서 매칭 키로 쓰이므로
 * 태그를 제거해 항상 동일한 값으로 정규화해야 한다.
 */
describe('stripHrNameTag', () => {
  it('전체 지역명 태그를 제거한다', () => {
    expect(stripHrNameTag('[부산경남]벌교의꿈')).toBe('벌교의꿈');
  });

  it('축약 지역 태그를 제거한다', () => {
    expect(stripHrNameTag('[부]벌교의꿈')).toBe('벌교의꿈');
  });

  it('태그 없는 이름은 그대로 둔다', () => {
    expect(stripHrNameTag('벌교의꿈')).toBe('벌교의꿈');
  });

  it('다른 지역 태그(서울 등)도 제거한다', () => {
    expect(stripHrNameTag('[서울]마명')).toBe('마명');
  });

  it('앞뒤 공백을 정리한다', () => {
    expect(stripHrNameTag('[부] 벌교의꿈')).toBe('벌교의꿈');
  });
});
