/** 0개면 0. 선형회귀 기울기(인덱스 1..n vs 값). */
export function slope(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i + 1, y = arr[i] ?? 0;
    sx += x; sy += y; sxy += x * y; sx2 += x * x;
  }
  const den = n * sx2 - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

export function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}
