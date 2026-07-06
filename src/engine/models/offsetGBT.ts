/**
 * 오프셋 그래디언트 부스팅 (순수 TS, 히스토그램 분할, XGBoost식 뉴턴 부스팅).
 *
 * 조건부로짓(경주내 softmax) 목적함수 + 배당 offset(base margin = log market_prob).
 *   margin_i(0라운드) = offset_i  ⇒  softmax(offset) = market_prob  ⇒  날배당 재현(자체검증).
 *   각 라운드: grad_i = p_i − y_i, hess_i = p_i(1−p_i)  (p = 경주내 softmax(margin))
 *             얕은 회귀트리로 (grad,hess) 적합 → margin += lr·tree.
 * offsetClogit과 동일 프레임(offset·softmax·grouped LL). GBT는 잔차만 학습.
 */

export interface TreeNode { leaf?: number; feat?: number; thr?: number; left?: TreeNode; right?: TreeNode; }
export interface GBT { trees: TreeNode[]; lr: number; binEdges: number[][]; }

export interface GBTOpts {
  rounds: number; lr: number; maxDepth: number;
  lambda: number; minChildWeight: number; nBins: number;
  valFrac?: number; patience?: number;   // early stopping (train 끝 시간순 val)
}

/** 피처별 분위수 bin 경계(train 기준). 중복 제거 후 최대 nBins-1 경계. */
function buildBinEdges(X: number[][], nBins: number): number[][] {
  const n = X.length, d = X[0]!.length;
  const edges: number[][] = [];
  for (let j = 0; j < d; j++) {
    const col = new Array(n);
    for (let i = 0; i < n; i++) col[i] = X[i]![j]!;
    col.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (let q = 1; q < nBins; q++) {
      const v = col[Math.floor((q / nBins) * (n - 1))]!;
      if (uniq.length === 0 || v > uniq[uniq.length - 1]!) uniq.push(v);
    }
    edges.push(uniq);
  }
  return edges;
}

/** 값 → bin 인덱스 (경계 이하면 그 bin). */
function binValue(edges: number[], v: number): number {
  let lo = 0, hi = edges.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (v <= edges[m]!) hi = m; else lo = m + 1; }
  return lo;
}

/** 전체 X를 피처별 Uint16 bin 배열로. */
function binMatrix(X: number[][], edges: number[][]): Uint16Array[] {
  const n = X.length, d = edges.length;
  const cols: Uint16Array[] = [];
  for (let j = 0; j < d; j++) {
    const c = new Uint16Array(n);
    for (let i = 0; i < n; i++) c[i] = binValue(edges[j]!, X[i]![j]!);
    cols.push(c);
  }
  return cols;
}

/** 경주내 softmax(margin). groups = 각 경주의 row 인덱스 배열. */
function softmaxGroup(margin: Float64Array, groups: number[][]): Float64Array {
  const p = new Float64Array(margin.length);
  for (const g of groups) {
    let mx = -Infinity;
    for (const r of g) if (margin[r]! > mx) mx = margin[r]!;
    let sum = 0;
    for (const r of g) { const e = Math.exp(margin[r]! - mx); p[r] = e; sum += e; }
    for (const r of g) p[r]! /= sum;
  }
  return p;
}

/** 히스토그램 회귀트리 1개 적합 (grad,hess). rows = 사용할 row 인덱스. */
function buildTree(
  rows: number[], binned: Uint16Array[], nBins: number,
  grad: Float64Array, hess: Float64Array, depth: number, o: GBTOpts,
): TreeNode {
  let G = 0, H = 0;
  for (const r of rows) { G += grad[r]!; H += hess[r]!; }
  const leafVal = -G / (H + o.lambda);
  if (depth >= o.maxDepth || rows.length < 2) return { leaf: leafVal };

  const d = binned.length;
  let bestGain = 1e-9, bestFeat = -1, bestThr = -1;
  const baseScore = (G * G) / (H + o.lambda);
  for (let j = 0; j < d; j++) {
    const hG = new Float64Array(nBins), hH = new Float64Array(nBins);
    const bj = binned[j]!;
    for (const r of rows) { hG[bj[r]!]! += grad[r]!; hH[bj[r]!]! += hess[r]!; }
    let GL = 0, HL = 0;
    for (let b = 0; b < nBins - 1; b++) {
      GL += hG[b]!; HL += hH[b]!;
      const GR = G - GL, HR = H - HL;
      if (HL < o.minChildWeight || HR < o.minChildWeight) continue;
      const gain = 0.5 * ((GL * GL) / (HL + o.lambda) + (GR * GR) / (HR + o.lambda) - baseScore);
      if (gain > bestGain) { bestGain = gain; bestFeat = j; bestThr = b; }
    }
  }
  if (bestFeat < 0) return { leaf: leafVal };

  const left: number[] = [], right: number[] = [];
  const bf = binned[bestFeat]!;
  for (const r of rows) (bf[r]! <= bestThr ? left : right).push(r);
  return {
    feat: bestFeat, thr: bestThr,
    left: buildTree(left, binned, nBins, grad, hess, depth + 1, o),
    right: buildTree(right, binned, nBins, grad, hess, depth + 1, o),
  };
}

/** 트리 예측 (bin 접근자). */
function treePred(node: TreeNode, binOf: (feat: number) => number): number {
  let n = node;
  while (n.leaf === undefined) n = binOf(n.feat!) <= n.thr! ? n.left! : n.right!;
  return n.leaf;
}

/**
 * 오프셋 GBT 학습. X=말별 피처, groups=경주별 row인덱스, winners=경주별 승자 row,
 * offset=말별 base margin(log market_prob). early stopping은 train 끝 시간순 val slice.
 * 반환: 모델 + 라운드별 train/val grouped-LL(수렴·과적합 진단용).
 */
export function fitOffsetGBT(
  X: number[][], groups: number[][], winners: number[], offset: Float64Array, o: GBTOpts,
): { gbt: GBT; bestRound: number; trainLL: number[]; valLL: number[] } {
  const n = X.length;
  const y = new Float64Array(n);
  for (const w of winners) y[w] = 1;
  const binEdges = buildBinEdges(X, o.nBins);
  const binned = binMatrix(X, binEdges);

  // train / val 분리 (경주 단위 시간순: groups는 이미 시간순 정렬 가정)
  const valFrac = o.valFrac ?? 0.15;
  const cut = Math.floor(groups.length * (1 - valFrac));
  const trainGroups = groups.slice(0, cut), valGroups = groups.slice(cut);
  const trainRows: number[] = [];
  for (const g of trainGroups) for (const r of g) trainRows.push(r);

  const margin = Float64Array.from(offset);
  const groupLL = (gs: number[][]) => {
    const p = softmaxGroup(margin, gs);
    let s = 0;
    for (const g of gs) { const w = g.find((r) => y[r] === 1); if (w !== undefined) s += -Math.log(Math.max(1e-12, p[w]!)); }
    return s / gs.length;
  };

  const trees: TreeNode[] = [];
  const trainLL: number[] = [], valLL: number[] = [];
  let bestVal = Infinity, bestRound = 0, since = 0;
  const patience = o.patience ?? 20;

  for (let t = 0; t < o.rounds; t++) {
    const p = softmaxGroup(margin, trainGroups);
    const grad = new Float64Array(n), hess = new Float64Array(n);
    for (const r of trainRows) { grad[r] = p[r]! - y[r]!; hess[r] = Math.max(1e-6, p[r]! * (1 - p[r]!)); }
    const tree = buildTree(trainRows, binned, o.nBins, grad, hess, 0, o);
    trees.push(tree);
    for (const r of trainRows) margin[r]! += o.lr * treePred(tree, (f) => binned[f]![r]!);
    for (const g of valGroups) for (const r of g) margin[r]! += o.lr * treePred(tree, (f) => binned[f]![r]!);

    trainLL.push(groupLL(trainGroups));
    const v = groupLL(valGroups);
    valLL.push(v);
    if (v < bestVal - 1e-6) { bestVal = v; bestRound = t + 1; since = 0; } else if (++since >= patience) break;
  }
  return { gbt: { trees: trees.slice(0, bestRound), lr: o.lr, binEdges }, bestRound, trainLL, valLL };
}

/** 말 한 마리의 부스팅 margin 보정분(offset 미포함). */
export function predictMargin(gbt: GBT, xRow: number[]): number {
  let s = 0;
  for (const tree of gbt.trees) s += gbt.lr * treePred(tree, (f) => binValue(gbt.binEdges[f]!, xRow[f]!));
  return s;
}
