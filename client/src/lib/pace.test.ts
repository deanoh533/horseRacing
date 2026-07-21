import { describe, it, expect } from 'vitest';
import { computeRacePace, PACE_UI, labelActualPace, paceMatchLevel, PACE_MATCH_UI } from './pace';
import paceParJson from '../config/pace_par.json';
import { classifyRunningStyle, type RunningStyle } from './runningStyle';

const S = (s: string) => s as RunningStyle;

describe('computeRacePace — 서버 computePaceType 동일 규칙', () => {
  it('선두권(front|pace) 3마리 이상 → HOT', () => {
    const r = computeRacePace([S('front'), S('pace'), S('pace'), S('stalker'), S('closer')]);
    expect(r).toEqual({ paceType: 'HOT', frontCount: 3, knownCount: 5, total: 5 });
  });
  it('선두권 1마리 이하 → SLOW, 2마리 → NORMAL', () => {
    expect(computeRacePace([S('front'), S('stalker'), S('closer'), S('closer')])?.paceType).toBe('SLOW');
    expect(computeRacePace([S('front'), S('pace'), S('stalker'), S('closer')])?.paceType).toBe('NORMAL');
  });
  it('자유마는 선두권 카운트 제외 (서버 isFree 제외와 동치)', () => {
    // free 2 + front 2 → frontCount 2 → NORMAL (free가 카운트되면 HOT이 됐을 것)
    const r = computeRacePace([S('free'), S('free'), S('front'), S('front'), S('stalker'), S('closer')]);
    expect(r?.paceType).toBe('NORMAL');
    expect(r?.frontCount).toBe(2);
  });
  it('unknown은 knownCount에서 제외, 절반 미만이면 판정 불가(null)', () => {
    // 6두 중 known 2 (< 3 = 절반) → null
    expect(computeRacePace([S('front'), S('pace'), S('unknown'), S('unknown'), S('unknown'), S('unknown')])).toBeNull();
    // 6두 중 known 3 (= 절반, 미만 아님) → 판정함
    expect(computeRacePace([S('front'), S('pace'), S('pace'), S('unknown'), S('unknown'), S('unknown')])?.paceType).toBe('HOT');
  });
  it('빈 배열 → null', () => {
    expect(computeRacePace([])).toBeNull();
  });
  it('서버 규칙 동치 — (avg,std) 표 기반 대조', () => {
    // 서버 computePaceType(scorePredictor.ts): avg≤0.35 && !(std≥0.35) 카운트, ≥3 HOT / ≤1 SLOW
    const horses: Array<[number | null, number | null]> = [
      [0.10, 0.10], [0.30, 0.20], [0.34, 0.10], [0.50, 0.10], [0.80, 0.10], [0.20, 0.40], // free
    ];
    // 서버 방식 직접 계산
    let serverFront = 0;
    for (const [avg, std] of horses) {
      if (avg == null) continue;
      const isFree = std != null && std >= 0.35;
      if (!isFree && avg <= 0.35) serverFront++;
    }
    const serverPace = serverFront >= 3 ? 'HOT' : serverFront <= 1 ? 'SLOW' : 'NORMAL';
    // 클라 방식: classifyRunningStyle → computeRacePace
    const r = computeRacePace(horses.map(([a, s]) => classifyRunningStyle(a, s)));
    expect(r?.paceType).toBe(serverPace);
    expect(r?.frontCount).toBe(serverFront);
  });
});

describe('PACE_UI', () => {
  it('세 타입 모두 emoji·label·insight·className 보유', () => {
    for (const t of ['HOT', 'NORMAL', 'SLOW'] as const) {
      expect(PACE_UI[t].emoji).toBeTruthy();
      expect(PACE_UI[t].label).toBeTruthy();
      expect(PACE_UI[t].insight).toContain('실측');
      expect(PACE_UI[t].className).toMatch(/bg-.+text-.+border-/s);
    }
  });
});

describe('labelActualPace — avg_s1f vs par → 실측 페이스 (서버 labelPastRacePace 미러)', () => {
  const [someKey, somePar] = Object.entries(paceParJson as Record<string, number>)[0]!;
  const [meet, dist] = someKey.split('|').map(Number) as [number, number];

  it('par 정확히 = NORMAL', () => {
    expect(labelActualPace(somePar, meet, dist)).toBe('NORMAL');
  });
  it('par보다 충분히 빠름(−0.15) = HOT', () => {
    expect(labelActualPace(somePar - 0.15, meet, dist)).toBe('HOT');
  });
  it('par보다 충분히 느림(+0.15) = SLOW', () => {
    expect(labelActualPace(somePar + 0.15, meet, dist)).toBe('SLOW');
  });
  it('경계 안쪽(±0.05) = NORMAL', () => {
    expect(labelActualPace(somePar - 0.05, meet, dist)).toBe('NORMAL');
    expect(labelActualPace(somePar + 0.05, meet, dist)).toBe('NORMAL');
  });
  it('par 없는 버킷 → null', () => {
    expect(labelActualPace(14, 9, 99999)).toBeNull();
  });
  it('avgS1f null/0 → null', () => {
    expect(labelActualPace(null, meet, dist)).toBeNull();
    expect(labelActualPace(0, meet, dist)).toBeNull();
  });
});

describe('paceMatchLevel — HOT<NORMAL<SLOW ordinal 차이', () => {
  it('같으면 exact', () => {
    expect(paceMatchLevel('HOT', 'HOT')).toBe('exact');
    expect(paceMatchLevel('NORMAL', 'NORMAL')).toBe('exact');
    expect(paceMatchLevel('SLOW', 'SLOW')).toBe('exact');
  });
  it('한 칸 차이 adjacent', () => {
    expect(paceMatchLevel('HOT', 'NORMAL')).toBe('adjacent');
    expect(paceMatchLevel('NORMAL', 'HOT')).toBe('adjacent');
    expect(paceMatchLevel('NORMAL', 'SLOW')).toBe('adjacent');
    expect(paceMatchLevel('SLOW', 'NORMAL')).toBe('adjacent');
  });
  it('정반대 opposite', () => {
    expect(paceMatchLevel('HOT', 'SLOW')).toBe('opposite');
    expect(paceMatchLevel('SLOW', 'HOT')).toBe('opposite');
  });
});

describe('PACE_MATCH_UI', () => {
  it('세 단계 모두 symbol·label·className 보유', () => {
    for (const m of ['exact', 'adjacent', 'opposite'] as const) {
      expect(PACE_MATCH_UI[m].symbol).toBeTruthy();
      expect(PACE_MATCH_UI[m].label).toBeTruthy();
      expect(PACE_MATCH_UI[m].className).toBeTruthy();
    }
  });
});
