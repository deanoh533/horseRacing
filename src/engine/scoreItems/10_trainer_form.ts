/**
 * 항목 ⑩ 조교사 폼
 * 비중: 7.02점 / 100
 *
 * 알고리즘 (기수 폼과 동일 패턴, 60일):
 *   - 최근 60일 마방 전체 출전
 *   - 입상 비율 (1-3등 / 전체) + 1등 보너스 (×0.2)
 *   - 데이터 부족: 20회 미만 → 0.5
 */

export interface TrainerFormInput {
  /** 조교사 마방의 최근 60일 모든 경주 착순 */
  recent60DayOrds: number[];
}

export function calculateTrainerFormScore(input: TrainerFormInput): number {
  const { recent60DayOrds } = input;
  if (!recent60DayOrds || recent60DayOrds.length < 20) return 0.5;

  const total = recent60DayOrds.length;
  const top1 = recent60DayOrds.filter((o) => o === 1).length;
  const top3 = recent60DayOrds.filter((o) => o <= 3).length;

  const top3Rate = top3 / total;
  const top1Bonus = (top1 / total) * 0.2;

  return Math.min(1.0, top3Rate + top1Bonus);
}
