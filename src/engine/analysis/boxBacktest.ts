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
 * 한 경주 복승 박스 정산 — 상위 3마리 고정.
 * settleBoxN(horses, comboOdds, 3)의 별칭(기존 호출부 호환).
 */
export function settleBox(
  horses: BoxHorse[],
  comboOdds: Map<string, number>,
): BoxResult | null {
  return settleBoxN(horses, comboOdds, 3);
}

/**
 * 한 경주 복승 박스 정산 — 박스 두수 n을 인자로 받는 일반형.
 *
 * 비용은 실제 매수 조합 수 C(k,2) 단위(k = min(n, 출전두수)). 두수를 바꿔가며
 * 비교할 때 "조합 수가 늘면 비용도 는다"를 정산에 반영해야 ROI가 공정해진다.
 *
 * - 5두 미만(복승 미발매 가정), 1·2착 판별 불가, k<2 → null(베팅 제외).
 * - comboOdds: pairKey(마번,마번) → 복승 확정배당(1단위당 총회수, 배당률).
 */
export function settleBoxN(
  horses: BoxHorse[],
  comboOdds: Map<string, number>,
  n: number,
): BoxResult | null {
  if (horses.length < 5) return null;

  const k = Math.min(n, horses.length);
  if (k < 2) return null;
  const cost = (k * (k - 1)) / 2;

  const picks = [...horses].sort((a, b) => b.prob - a.prob).slice(0, k);
  const pickSet = new Set(picks.map((h) => h.pthrNo));

  const finishers = horses.filter((h) => h.ord >= 1 && h.ord <= 50).sort((a, b) => a.ord - b.ord);
  const first = finishers[0];
  const second = finishers[1];
  if (!first || !second) return null;

  const hit = pickSet.has(first.pthrNo) && pickSet.has(second.pthrNo);
  if (!hit) return { hit: false, profit: -cost };

  const odds = comboOdds.get(pairKey(first.pthrNo, second.pthrNo));
  if (odds == null) return { hit: true, profit: null };
  return { hit: true, profit: odds - cost };
}
