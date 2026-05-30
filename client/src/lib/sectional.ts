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
