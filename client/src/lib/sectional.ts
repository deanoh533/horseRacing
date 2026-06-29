import type { RaceEntry } from './supabase';

export interface SectionalInfo {
  cornerStr: string | null;
  s1fOrd: number | null;
  s1fTime: number | null;
  g3fOrd: number | null;
  g3fSplit: number | null;
  g1fOrd: number | null;
  g1fSplit: number | null;
}

export function getSectionalInfo(h: RaceEntry): SectionalInfo {
  const isSe = h.meet === 1;
  const cornerRanks = isSe
    ? [h.sj_1c_ord ?? null, h.sj_2c_ord ?? null, h.sj_3c_ord ?? null, h.sj_4c_ord ?? null]
    : [h.bu_g8f_ord ?? null, h.bu_g6f_ord ?? null, h.bu_g4f_ord ?? null, h.bu_g2f_ord ?? null];
  const validCornerRanks = cornerRanks.filter((r): r is number => r !== null);
  const s1fTime = isSe ? (h.se_s1f_acc_time ?? null) : (h.bu_s1f_acc_time ?? null);
  const g3fAcc = isSe ? (h.se_g3f_acc_time ?? null) : (h.bu_g3f_acc_time ?? null);
  const g1fAcc = isSe ? (h.se_g1f_acc_time ?? null) : (h.bu_g1f_acc_time ?? null);

  return {
    cornerStr: validCornerRanks.length > 0 ? validCornerRanks.join('-') : null,
    s1fOrd: isSe ? (h.sj_s1f_ord ?? null) : (h.bu_s1f_ord ?? null),
    s1fTime,
    g3fOrd: isSe ? (h.sj_g3f_ord ?? null) : (h.bu_g3f_ord ?? null),
    g3fSplit:
      h.rc_time != null && h.rc_time > 0 && g3fAcc != null
        ? +Math.max(0, h.rc_time - g3fAcc).toFixed(1)
        : null,
    g1fOrd: isSe ? (h.sj_g1f_ord ?? null) : (h.bu_g1f_ord ?? null),
    g1fSplit:
      h.rc_time != null && h.rc_time > 0 && g1fAcc != null
        ? +Math.max(0, h.rc_time - g1fAcc).toFixed(1)
        : null,
  };
}

export function fmtSec(time: number | null): string | null {
  return time != null ? `${time.toFixed(1)}` : null;
}

/** 0~1 확률 → 정수 %. null/undefined면 빈 문자열. */
export const fmtPct = (p: number | null | undefined): string =>
  p == null ? '' : `${Math.round(p * 100)}%`;

/**
 * 로지스틱 종합점수(logit) 표시. 0 중심 상대값이라 부호를 명시(+/−)해
 * "절대 점수가 아닌 상대 점수"임을 드러내고, −0.0 아티팩트를 0.0으로 정규화한다.
 * 우승%·연승%가 직관적 절대 지표, 이 값은 보조 상대 지표.
 */
export function fmtScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const r = Math.round(n * 10) / 10 + 0; // +0: -0 → 0
  const abs = Math.abs(r).toFixed(1);
  return r > 0 ? `+${abs}` : r < 0 ? `−${abs}` : '0.0';
}

export interface SameDistStats {
  bestTime: number;
  bestBurdWgt: number | null;
  bestTrackType: string | null;
  bestOrd: number | null;
  bestPthrNo: number;
  bestRaceDate: number;
  bestJckyNm: string | null;
  avgTime: number;
  count: number;
  wins: number;
  places: number;
  shows: number;
}

export function computeSameDistStats(
  history: RaceEntry[],
  targetDist: number
): SameDistStats | null {
  const valid = history.filter(
    (h) => h.rc_dist === targetDist && h.rc_time != null && h.rc_time > 0
  );
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => a.rc_time! - b.rc_time!);
  const best = sorted[0]!;
  const avgTime = valid.reduce((s, h) => s + h.rc_time!, 0) / valid.length;

  return {
    bestTime: best.rc_time!,
    bestBurdWgt: best.burd_wgt,
    bestTrackType: best.track_type,
    bestOrd: best.ord,
    bestPthrNo: best.pthr_no,
    bestRaceDate: best.race_date,
    bestJckyNm: best.jcky_nm,
    avgTime,
    count: valid.length,
    wins: valid.filter((h) => h.ord === 1).length,
    places: valid.filter((h) => h.ord != null && h.ord <= 2).length,
    shows: valid.filter((h) => h.ord != null && h.ord <= 3).length,
  };
}
