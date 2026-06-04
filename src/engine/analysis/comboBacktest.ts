/**
 * Stage 2 Phase 2A — 복연승 백테스트 순수 헬퍼.
 * 조합 선정규칙(R1/R2/R3) + 무순 조합 정규화 + 정산. DB/IO 없음.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase2a-quinella-place-betting-design.md
 */
import { oddsBand } from './edgeProbe.js';

export interface ComboHorse {
  chulNo: number;   // 마번(pthr_no)
  score: number;    // 모델 P(top3) logit
  winOdds: number;  // 단승 배당(구간 판정용)
}

/** 무순 조합 정규화 키 (작은 chulNo 먼저). */
export function pairKey(a: number, b: number): string {
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

/** 중배당(midBands) 구간 AND 점수 >= 해당 구간 train 컷오프. */
export function isMidTercile(
  winOdds: number, score: number,
  cutoffs: Record<string, number>, midBands: string[],
): boolean {
  const b = oddsBand(winOdds);
  if (!midBands.includes(b)) return false;
  const c = cutoffs[b];
  return c != null && score >= c;
}

/** R1: 모델 점수 상위 2마리 1조합. 2마리 미만이면 빈 배열. */
export function selectTop2(horses: ComboHorse[]): Array<[number, number]> {
  if (horses.length < 2) return [];
  const s = [...horses].sort((a, b) => b.score - a.score);
  return [[s[0]!.chulNo, s[1]!.chulNo]];
}

/** R2: 모델 1픽 × {중배당·상위터셀} 말 (1픽 자신 제외). */
export function selectValuePairs(
  horses: ComboHorse[], cutoffs: Record<string, number>, midBands: string[],
): Array<[number, number]> {
  if (horses.length < 2) return [];
  const top = [...horses].sort((a, b) => b.score - a.score)[0]!;
  const out: Array<[number, number]> = [];
  for (const h of horses) {
    if (h.chulNo === top.chulNo) continue;
    if (isMidTercile(h.winOdds, h.score, cutoffs, midBands)) out.push([top.chulNo, h.chulNo]);
  }
  return out;
}

/** R3: {중배당·상위터셀} 말들의 모든 2조합. */
export function selectTercilePairs(
  horses: ComboHorse[], cutoffs: Record<string, number>, midBands: string[],
): Array<[number, number]> {
  const pool = horses.filter((h) => isMidTercile(h.winOdds, h.score, cutoffs, midBands));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      out.push([pool[i]!.chulNo, pool[j]!.chulNo]);
  return out;
}

/** 정산: 두 말 모두 입상(placedByChulNo) 시 payout=복연승odds, 아니면 null(손실). */
export function settlePair(
  pair: [number, number],
  placedByChulNo: Map<number, boolean>,
  comboOdds: Map<string, number>,
): number | null {
  const [a, b] = pair;
  if (!(placedByChulNo.get(a) && placedByChulNo.get(b))) return null;
  return comboOdds.get(pairKey(a, b)) ?? null;
}
