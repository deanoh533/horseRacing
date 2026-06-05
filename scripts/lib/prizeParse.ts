/** API156 rsutRkPurse 파서. "16,500,000" → 16500000. 빈/하이픈/null → null. */
export function parsePurse(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** schdRaceNo "1R" → 1. 숫자 부분 추출, 없으면 null. */
export function parseRcNo(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = String(s).match(/\d+/);
  return m ? Number(m[0]) : null;
}
