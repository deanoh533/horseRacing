export interface Pair { p: number; y: number; }
export interface Bin { avgPred: number; actualRate: number; n: number; }

/** 로지스틱 확률 = 1/(1+e^−z). predictLogit은 logit을 주므로 확률 변환에 필요. */
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

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

/** 확률을 [1e−9, 1−1e−9]로 클립 후 logit. Platt 입출력 공용. */
function clipLogit(p: number): number {
  const c = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(c / (1 - c));
}

/** Platt 보정자: sigmoid(a·logit(p)+b)를 실제결과에 경사하강 적합. 빈 입력→항등. */
export function fitPlatt(
  pairs: Pair[],
  opts: { iters?: number; lr?: number } = {},
): { a: number; b: number } {
  const iters = opts.iters ?? 2000;
  const lr = opts.lr ?? 0.3;
  const n = pairs.length;
  if (n === 0) return { a: 1, b: 0 };
  const xs = pairs.map((pr) => clipLogit(pr.p));
  const ys = pairs.map((pr) => pr.y);
  let a = 1;
  let b = 0;
  for (let it = 0; it < iters; it++) {
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const pred = 1 / (1 + Math.exp(-(a * xs[i]! + b)));
      const err = pred - ys[i]!;
      ga += err * xs[i]!;
      gb += err;
    }
    a -= (lr * ga) / n;
    b -= (lr * gb) / n;
  }
  return { a, b };
}

/** Platt 적용: sigmoid(a·logit(p)+b). 단조 증가, (0,1). */
export function applyPlatt(cal: { a: number; b: number }, p: number): number {
  return 1 / (1 + Math.exp(-(cal.a * clipLogit(p) + cal.b)));
}

export interface CalibrationReport {
  modelWin: Pair[];
  marketWin: Pair[];
  modelTop3: Pair[];
  perQuarter: { key: string; modelEce: number; marketEce: number }[];
}

/** 신뢰도 표(P1착 모델 vs 시장 + P3착내 모델) + 요약수 + 분기별 ECE. ASCII. */
export function formatCalibration(r: CalibrationReport, nBins = 10): string {
  const f3 = (x: number) => x.toFixed(3);
  const lines: string[] = [];

  const mWin = reliabilityBins(r.modelWin, nBins);
  const kWin = reliabilityBins(r.marketWin, nBins);
  lines.push('=== P(1착) 신뢰도: 모델 vs 시장 (OOS 풀링) ===');
  lines.push('bin │ 모델예측 모델실제    n  │ 시장예측 시장실제    n');
  lines.push('─'.repeat(62));
  const cell = (b?: Bin) =>
    b ? `${f3(b.avgPred)}    ${f3(b.actualRate)}  ${String(b.n).padStart(4)}` : '   -        -       -';
  const nrows = Math.max(mWin.length, kWin.length);
  for (let i = 0; i < nrows; i++) {
    lines.push(`${String(i + 1).padStart(2)}  │ ${cell(mWin[i])} │ ${cell(kWin[i])}`);
  }
  lines.push('');
  lines.push('요약           모델       시장');
  lines.push(`ECE        ${f3(ece(mWin)).padStart(8)}  ${f3(ece(kWin)).padStart(8)}`);
  lines.push(`Brier      ${f3(brier(r.modelWin)).padStart(8)}  ${f3(brier(r.marketWin)).padStart(8)}`);
  lines.push(`log-loss   ${f3(logLoss(r.modelWin)).padStart(8)}  ${f3(logLoss(r.marketWin)).padStart(8)}`);
  lines.push('');

  const mT3 = reliabilityBins(r.modelTop3, nBins);
  lines.push('=== P(3착내) 신뢰도: 모델 단독 ===');
  lines.push('bin │ 모델예측 모델실제    n');
  for (let i = 0; i < mT3.length; i++) {
    const b = mT3[i]!;
    lines.push(`${String(i + 1).padStart(2)}  │ ${f3(b.avgPred)}    ${f3(b.actualRate)}  ${String(b.n).padStart(4)}`);
  }
  lines.push(`ECE=${f3(ece(mT3))}  Brier=${f3(brier(r.modelTop3))}  log-loss=${f3(logLoss(r.modelTop3))}`);
  lines.push('');

  lines.push('분기별 ECE(P1착)  [모델 / 시장]');
  for (const q of r.perQuarter) lines.push(`  ${q.key}: ${f3(q.modelEce)} / ${f3(q.marketEce)}`);

  return lines.join('\n');
}
