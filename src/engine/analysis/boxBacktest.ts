/**
 * 복승 3마리 박스 정산 — 순수 함수.
 *
 * 베팅: 경주마다 모델 확률 상위 3마리를 골라 복승 박스(A-B, A-C, B-C 세 조합)를 산다.
 * 박스 적중 = 상위 3마리 안에 실제 1착과 2착이 둘 다 포함.
 * 정산: 적중 시 (1착,2착) 쌍의 복승 배당 회수, 비용은 3조합(=3단위).
 */
import { pairKey } from './comboBacktest.js';

export interface BoxHorse {
  pthrNo: number;
  ord: number;       // 실제 착순 (1=1착). 미완주/결측은 >50 또는 0 등.
  prob: number;      // 모델 점수(logit 또는 확률) — 정렬용, 클수록 상위.
}

export interface BoxResult {
  hit: boolean;
  /** 박스 손익(단위). 적중=배당-3, 미적중=-3. 배당 결측이면 null(ROI 제외). */
  profit: number | null;
}

/**
 * 한 경주 복승 박스 정산.
 * - 5두 미만(복승 미발매 가정) 또는 1·2착 판별 불가 → null(베팅 제외).
 * - comboOdds: pairKey(마번,마번) → 복승 확정배당(1단위당 총회수, 배당률).
 */
export function settleBox(
  horses: BoxHorse[],
  comboOdds: Map<string, number>,
): BoxResult | null {
  if (horses.length < 5) return null;

  const top3 = [...horses].sort((a, b) => b.prob - a.prob).slice(0, 3);
  const top3Set = new Set(top3.map((h) => h.pthrNo));

  const finishers = horses.filter((h) => h.ord >= 1 && h.ord <= 50).sort((a, b) => a.ord - b.ord);
  const first = finishers[0];
  const second = finishers[1];
  if (!first || !second) return null;

  const hit = top3Set.has(first.pthrNo) && top3Set.has(second.pthrNo);
  if (!hit) return { hit: false, profit: -3 };

  const odds = comboOdds.get(pairKey(first.pthrNo, second.pthrNo));
  if (odds == null) return { hit: true, profit: null };
  return { hit: true, profit: odds - 3 };
}
