/**
 * Plackett-Luce 랭킹 모델 (배치 경사하강) — 순수 TS.
 * 로지스틱(이진 top2/top3)과 달리 경주 내 전체 착순(ord)을 우도로 학습한다.
 * z-표준화(전체 말 평균/표준편차)로 계수 비교 가능. 랭킹엔 선형 점수(predictPL)만 쓰면 됨.
 *
 * 우도 (경주별, ord 오름차순):
 *   ℓ = Σ_race Σ_i [ θ_i − log Σ_{j≥i} exp(θ_j) ],   θ_i = w·z_i
 * 위치 불변(경주 내 상수항은 상쇄) → intercept 미식별 → 항상 0. 구조 호환 위해 필드만 유지.
 */
export interface PLModel {
  type: 'plackett-luce';
  features: string[];
  means: number[];
  stds: number[];
  coef: Record<string, number>;
  intercept: number; // 항상 0 (PL 위치 불변). LogisticModel과 구조 호환용.
}

/** 경주 1건 — 말별 raw 피처 벡터 + 착순(ord, 1=1착). */
export interface PLRace { horses: { x: number[]; ord: number }[]; }

export interface PLFitOpts { l2?: number; iters?: number; lr?: number; }

export function fitPL(races: PLRace[], features: string[], opts: PLFitOpts = {}): PLModel {
  const { l2 = 0.02, iters = 800, lr = 0.2 } = opts;
  const d = features.length;

  // z-표준화: 전체 말 기준 평균/표준편차
  const allX: number[][] = [];
  for (const r of races) for (const h of r.horses) allX.push(h.x);
  const n = allX.length;
  const means = new Array(d).fill(0), stds = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let m = 0; for (let i = 0; i < n; i++) m += allX[i]![j]!; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (allX[i]![j]! - m) ** 2; v /= n;
    means[j] = m; stds[j] = Math.sqrt(v) || 1;
  }

  // 경주별 표준화 행렬 (ord 오름차순 정렬)
  const Zraces = races.map((r) =>
    [...r.horses].sort((a, b) => a.ord - b.ord)
      .map((h) => h.x.map((x, j) => (x - means[j]!) / stds[j]!)),
  );

  const w = new Array(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); // log-likelihood 기울기 (상승 방향)
    for (const Z of Zraces) {
      const K = Z.length;
      const theta = Z.map((z) => { let t = 0; for (let j = 0; j < d; j++) t += w[j]! * z[j]!; return t; });
      // 각 단계 i: 잔여집합 {i..K-1}에서 softmax 기대피처
      for (let i = 0; i < K; i++) {
        let mx = -Infinity; for (let k = i; k < K; k++) if (theta[k]! > mx) mx = theta[k]!;
        let sum = 0; for (let k = i; k < K; k++) sum += Math.exp(theta[k]! - mx);
        for (let j = 0; j < d; j++) {
          let expFeat = 0;
          for (let k = i; k < K; k++) expFeat += (Math.exp(theta[k]! - mx) / sum) * Z[k]![j]!;
          gw[j]! += Z[i]![j]! - expFeat;
        }
      }
    }
    // 음의 우도 + L2 경사하강: w -= lr * ( -gw/n + l2*w )
    for (let j = 0; j < d; j++) w[j]! -= lr * (-gw[j]! / n + l2 * w[j]!);
  }

  const coef: Record<string, number> = {};
  features.forEach((f, j) => (coef[f] = w[j]!));
  return { type: 'plackett-luce', features, means, stds, coef, intercept: 0 };
}

/** 표준화 공간 선형 점수(=랭킹 점수). PL은 위치 불변이라 intercept 없음. */
export function predictPL(model: PLModel, rawRow: number[]): number {
  let z = 0;
  model.features.forEach((f, j) => {
    const zj = (rawRow[j]! - model.means[j]!) / model.stds[j]!;
    z += model.coef[f]! * zj;
  });
  return z;
}
