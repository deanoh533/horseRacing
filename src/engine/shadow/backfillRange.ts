/** 과거 채우기 범위 — 학습에 쓴 경주(≤ train_until)는 절대 채우지 않는다 (spec §4.4). */
export function nextDay(d: number): number {
  const y = Math.floor(d / 10000), m = Math.floor((d % 10000) / 100) - 1, day = d % 100;
  const t = new Date(Date.UTC(y, m, day + 1));
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

export function resolveBackfillRange(
  trainUntil: number | null, from: number | undefined, to: number | undefined, today: number,
): { from: number; to: number } {
  if (trainUntil == null) throw new Error('train_until 미기록 버전 — 학습 기간을 알 수 없어 과거 채우기 불가');
  const f = from ?? nextDay(trainUntil);
  const t = to ?? today;
  if (f <= trainUntil) throw new Error(`from(${f}) ≤ train_until(${trainUntil}) — 학습에 쓴 경주는 채울 수 없음`);
  if (f > t) throw new Error(`from(${f}) > to(${t})`);
  return { from: f, to: t };
}
