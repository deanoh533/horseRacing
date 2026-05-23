/**
 * 항목 ⑧ 부담중량
 * 비중: 4.39점 / 100
 * 상태: ⏸ 전문가 자문 대기 (임시 알고리즘)
 *
 * 알고리즘 (임시):
 *   - 출전마 평균 부담중량 대비 상대 유불리
 *   - 차이가 음수 = 가벼움 = 유리
 */

export interface BurdenWeightInput {
  /** 내 말의 부담중량 (kg) */
  myBudam: number;
  /** 출전마 전체의 부담중량 */
  raceBudams: number[];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function calculateBurdenWeightScore(input: BurdenWeightInput): number {
  const { myBudam, raceBudams } = input;
  if (!myBudam || !raceBudams || raceBudams.length === 0) return 0.5;

  const avgBudam = avg(raceBudams);
  const diff = myBudam - avgBudam; // 음수 = 가벼움 = 유리

  if (diff <= -3) return 1.0; // 평균보다 3kg+ 가벼움
  if (diff <= -1) return 0.75; // 약간 가벼움
  if (diff <= 1) return 0.5; // 비슷
  if (diff <= 3) return 0.25; // 약간 무거움
  return 0.0; // 매우 무거움
}
