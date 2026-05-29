import { describe, it, expect } from 'vitest';
import type { RaceEntry } from '../lib/supabase';

// computeSameDistStats를 직접 테스트하기 위해 모듈에서 export가 필요하다.
import { computeSameDistStats } from './PredictionSheet';

function makeEntry(overrides: Partial<RaceEntry>): RaceEntry {
  return {
    race_date: 20260501,
    meet: 1,
    rc_no: 1,
    pthr_no: 1,
    hr_name: 'TestHorse',
    ag: null, gndr: null, burd_wgt: null, ratg: null,
    jcky_no: null, jcky_nm: null, trar_no: null, trar_nm: null,
    erng_sump: null, erng_loy: null, erng_lsm: null,
    prds: null, owner_nm: null,
    sump_rcod_fplc: null, sump_rcod_splc: null, sump_rcod_tplc: null, sump_rcod_sum: null,
    rc_dist: null, track_type: null,
    hr_no: null, ord: null, rc_time: null,
    wg_hr: null, wg_hr_diff: null, wg_jk: null,
    win_odds: null, popularity: null, result_at: null,
    asis_equip1: null, asis_equip2: null, asis_equip3: null, asis_equip4: null, asis_equip5: null,
    latst_bledg1: null, latst_bledg2: null, latst_trea1_txt: null, latst_trea2_txt: null,
    ...overrides,
  };
}

describe('computeSameDistStats', () => {
  it('대상 거리 경주가 없으면 null을 반환한다', () => {
    const history = [
      makeEntry({ rc_dist: 1200, rc_time: 75.3, ord: 1 }),
      makeEntry({ rc_dist: 1200, rc_time: 76.1, ord: 2 }),
    ];
    expect(computeSameDistStats(history, 1400)).toBeNull();
  });

  it('rc_time이 null이거나 0인 경주는 무시한다', () => {
    const history = [
      makeEntry({ rc_dist: 1400, rc_time: null, ord: 1 }),
      makeEntry({ rc_dist: 1400, rc_time: 0, ord: 2 }),
    ];
    expect(computeSameDistStats(history, 1400)).toBeNull();
  });

  it('같은 거리 최고·평균·전적을 올바르게 계산한다', () => {
    const history = [
      makeEntry({ rc_dist: 1400, rc_time: 86.0, ord: 1, burd_wgt: 56, track_type: '양호', pthr_no: 3 }),
      makeEntry({ rc_dist: 1400, rc_time: 87.5, ord: 2, burd_wgt: 55, track_type: '불량', pthr_no: 5 }),
      makeEntry({ rc_dist: 1400, rc_time: 88.0, ord: 4, burd_wgt: 55, track_type: '양호', pthr_no: 2 }),
      makeEntry({ rc_dist: 1200, rc_time: 72.0, ord: 1, burd_wgt: 54, track_type: '양호', pthr_no: 1 }),
    ];
    const result = computeSameDistStats(history, 1400);
    expect(result).not.toBeNull();
    expect(result!.bestTime).toBeCloseTo(86.0);
    expect(result!.bestBurdWgt).toBe(56);
    expect(result!.bestTrackType).toBe('양호');
    expect(result!.bestOrd).toBe(1);
    expect(result!.bestPthrNo).toBe(3);
    expect(result!.avgTime).toBeCloseTo((86.0 + 87.5 + 88.0) / 3);
    expect(result!.count).toBe(3);
    expect(result!.wins).toBe(1);
    expect(result!.places).toBe(2);
    expect(result!.shows).toBe(2);
  });
});
