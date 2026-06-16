export interface Pair { p: number; y: number; }
export interface Bin { avgPred: number; actualRate: number; n: number; }

/** 값들을 합으로 나눠 합=1 분포로. 합이 0 이하면 전부 0(방어). */
export function normalizeProbs(values: number[]): number[] {
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= 0) return values.map(() => 0);
  return values.map((v) => v / sum);
}

/** 예측확률 오름차순 등개수 분위 bin. 각 bin: 평균예측·실제비율·표본수. */
export function reliabilityBins(pairs: Pair[], nBins = 10): Bin[] {
  if (pairs.length === 0) return [];
  const sorted = [...pairs].sort((a, b) => a.p - b.p);
  const n = sorted.length;
  const bins: Bin[] = [];
  for (let i = 0; i < nBins; i++) {
    const start = Math.floor((i * n) / nBins);
    const end = Math.floor(((i + 1) * n) / nBins);
    const slice = sorted.slice(start, end);
    if (slice.length === 0) continue;
    const avgPred = slice.reduce((s, x) => s + x.p, 0) / slice.length;
    const actualRate = slice.reduce((s, x) => s + x.y, 0) / slice.length;
    bins.push({ avgPred, actualRate, n: slice.length });
  }
  return bins;
}

/** 기대 캘리브레이션 오차 = Σ (bin비중)·|평균예측−실제비율|. */
export function ece(bins: Bin[]): number {
  const total = bins.reduce((s, b) => s + b.n, 0);
  if (total === 0) return 0;
  return bins.reduce((s, b) => s + (b.n / total) * Math.abs(b.avgPred - b.actualRate), 0);
}

/** Brier = 평균((p−y)²). */
export function brier(pairs: Pair[]): number {
  if (pairs.length === 0) return 0;
  return pairs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / pairs.length;
}

/** log-loss = −평균(y·ln p + (1−y)·ln(1−p)), p는 [1e−9, 1−1e−9] 클립. */
export function logLoss(pairs: Pair[]): number {
  if (pairs.length === 0) return 0;
  const clip = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
  const sum = pairs.reduce((s, x) => {
    const p = clip(x.p);
    return s + (x.y * Math.log(p) + (1 - x.y) * Math.log(1 - p));
  }, 0);
  return -sum / pairs.length;
}
