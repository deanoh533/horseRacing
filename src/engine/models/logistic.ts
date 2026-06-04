/**
 * L2 규제 로지스틱 회귀 (배치 경사하강) — 순수 TS.
 * z-표준화(학습셋 평균/표준편차)로 계수 비교 가능. 랭킹엔 logit 선형부만 쓰면 됨.
 */
export interface LogisticModel {
  type: 'logistic';
  features: string[];
  means: number[];
  stds: number[];
  coef: Record<string, number>;
  intercept: number;
}

export interface FitOpts { l2?: number; iters?: number; lr?: number; }

export function fitLogistic(
  X: number[][], y: number[], features: string[], opts: FitOpts = {}
): LogisticModel {
  const { l2 = 0.01, iters = 500, lr = 0.1 } = opts;
  const n = X.length, d = features.length;
  const means = new Array(d).fill(0), stds = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let m = 0; for (let i = 0; i < n; i++) m += X[i]![j]!; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (X[i]![j]! - m) ** 2; v /= n;
    means[j] = m; stds[j] = Math.sqrt(v) || 1;
  }
  const Z = X.map((row) => row.map((x, j) => (x - means[j]!) / stds[j]!));
  const w = new Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b; for (let j = 0; j < d; j++) z += w[j]! * Z[i]![j]!;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += err * Z[i]![j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j]! -= lr * (gw[j]! / n + l2 * w[j]!);
    b -= lr * (gb / n);
  }
  const coef: Record<string, number> = {};
  features.forEach((f, j) => (coef[f] = w[j]!));
  return { type: 'logistic', features, means, stds, coef, intercept: b };
}

/** 표준화 공간 logit(=랭킹 점수). 확률 = sigmoid(반환값). */
export function predictLogit(model: LogisticModel, rawRow: number[]): number {
  let z = model.intercept;
  model.features.forEach((f, j) => {
    const zj = (rawRow[j]! - model.means[j]!) / model.stds[j]!;
    z += model.coef[f]! * zj;
  });
  return z;
}
