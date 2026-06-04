/**
 * 순수 TS 그래디언트 부스팅 결정트리 (이진 로지스틱).
 * XGBoost식 grad/hess: leaf = -G/(H+λ), gain = ½[GL²/(HL+λ)+GR²/(HR+λ)-G²/(H+λ)]-γ.
 * 후보 분할 = 피처별 분위수 경계(bins). 학습·추론 모두 TS.
 */
export interface TreeNode {
  leaf?: number;
  feat?: number;
  thr?: number;
  left?: TreeNode;
  right?: TreeNode;
}
export interface GBDTModel {
  type: 'gbdt';
  features: string[];
  base: number;
  lr: number;
  trees: TreeNode[];
}
export interface GBDTOpts {
  rounds?: number; maxDepth?: number; lr?: number;
  lambda?: number; gamma?: number; minChild?: number; bins?: number;
}

function sigmoid(z: number): number { return 1 / (1 + Math.exp(-z)); }

function quantileThresholds(col: number[], bins: number): number[] {
  const s = [...col].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < bins; i++) {
    const q = s[Math.floor((i / bins) * (s.length - 1))]!;
    if (out.length === 0 || q !== out[out.length - 1]) out.push(q);
  }
  return out;
}

function buildTree(
  X: number[][], g: Float64Array, h: Float64Array, idx: number[],
  cand: number[][], depth: number, o: Required<GBDTOpts>
): TreeNode {
  let G = 0, H = 0;
  for (const i of idx) { G += g[i]!; H += h[i]!; }
  const leafVal = -G / (H + o.lambda);
  if (depth >= o.maxDepth || idx.length <= o.minChild) return { leaf: leafVal };

  let best = { gain: 0, feat: -1, thr: 0 };
  const baseScore = (G * G) / (H + o.lambda);
  for (let f = 0; f < cand.length; f++) {
    for (const thr of cand[f]!) {
      let GL = 0, HL = 0, nL = 0;
      for (const i of idx) { if (X[i]![f]! < thr) { GL += g[i]!; HL += h[i]!; nL++; } }
      const nR = idx.length - nL;
      if (nL < o.minChild || nR < o.minChild) continue;
      const GR = G - GL, HR = H - HL;
      const gain = 0.5 * ((GL * GL) / (HL + o.lambda) + (GR * GR) / (HR + o.lambda) - baseScore) - o.gamma;
      if (gain > best.gain) best = { gain, feat: f, thr };
    }
  }
  if (best.feat < 0) return { leaf: leafVal };

  const L: number[] = [], R: number[] = [];
  for (const i of idx) (X[i]![best.feat]! < best.thr ? L : R).push(i);
  return {
    feat: best.feat, thr: best.thr,
    left: buildTree(X, g, h, L, cand, depth + 1, o),
    right: buildTree(X, g, h, R, cand, depth + 1, o),
  };
}

function evalTree(node: TreeNode, row: number[]): number {
  let n = node;
  while (n.leaf === undefined) n = (row[n.feat!]! < n.thr! ? n.left! : n.right!);
  return n.leaf;
}

export function fitGBDT(X: number[][], y: number[], features: string[], opts: GBDTOpts = {}): GBDTModel {
  const o: Required<GBDTOpts> = {
    rounds: opts.rounds ?? 100, maxDepth: opts.maxDepth ?? 4, lr: opts.lr ?? 0.3,
    lambda: opts.lambda ?? 1, gamma: opts.gamma ?? 0, minChild: opts.minChild ?? 20, bins: opts.bins ?? 64,
  };
  const n = X.length, d = features.length;
  const pos = y.reduce((s, v) => s + v, 0) / n;
  const base = Math.log((pos + 1e-6) / (1 - pos + 1e-6));
  const F = new Float64Array(n).fill(base);
  const cand: number[][] = [];
  for (let f = 0; f < d; f++) cand.push(quantileThresholds(X.map((r) => r[f]!), o.bins));

  const trees: TreeNode[] = [];
  const allIdx = Array.from({ length: n }, (_, i) => i);
  for (let r = 0; r < o.rounds; r++) {
    const g = new Float64Array(n), h = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = sigmoid(F[i]!); g[i] = p - y[i]!; h[i] = Math.max(p * (1 - p), 1e-6); }
    const tree = buildTree(X, g, h, allIdx, cand, 0, o);
    for (let i = 0; i < n; i++) F[i] += o.lr * evalTree(tree, X[i]!);
    trees.push(tree);
  }
  return { type: 'gbdt', features, base, lr: o.lr, trees };
}

export function predictGBDT(model: GBDTModel, row: number[]): number {
  let z = model.base;
  for (const t of model.trees) z += model.lr * evalTree(t, row);
  return z;
}
