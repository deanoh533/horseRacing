# 점수 학습 재설계 — 계획 B2: 순수 TS GBDT 도전자

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 같은 de-biased feature로 **순수 TS 그래디언트 부스팅 트리(GBDT)** 를 학습해, 로지스틱·v1·시장과 챔피언전. "비선형·상호작용이 연승/시장격차를 더 줄이나" 확인. 이기면 B3 프로덕션화.

**Architecture:** XGBoost식 그래디언트-헤시안 부스팅. 로지스틱 손실의 leaf값 = `−G/(H+λ)`, split gain = 분할 이득 공식. 후보 분할은 **분위수 비닝(기본 64bin)** 으로 비용 제한. 학습·추론 모두 TS. `experiment_logistic.ts`를 확장해 GBDT 열 추가.

**Tech Stack:** TypeScript, Node, tsx, vitest. (Python 없음 — 이 머신 미설치 확인)

**선행:** 계획 B1 완료. 로지스틱 v1 대비 +5.6%p 연승(유의), 시장 -5.6%p. 행렬 `data/training_matrix.jsonl`(37,992행, 72피처).

---

## 파일 구조
- Create: `src/engine/models/gbdt.ts` — `fitGBDT`, `predictGBDT`, 트리 타입
- Create: `src/engine/models/gbdt.test.ts`
- Modify: `scripts/experiment_logistic.ts` — GBDT도 학습·채점해 비교 열 추가

---

## Task 1: GBDT 학습기 (그래디언트-헤시안 부스팅)

**Files:** Create `src/engine/models/gbdt.ts`, `gbdt.test.ts`

이진 분류(로지스틱 손실). 각 라운드: `p=σ(F)`, `g=p−y`(1차), `h=p(1−p)`(2차). 회귀트리를 (g,h)로 학습, leaf값 `=−Σg/(Σh+λ)`, split gain `=½[GL²/(HL+λ)+GR²/(HR+λ)−G²/(H+λ)]−γ`. `F += lr·leaf`. 후보 분할은 학습셋 각 피처의 분위수 경계(기본 64).

- [ ] **Step 1: 실패 테스트 (비선형 패턴 회복 — 로지스틱이 못 푸는 것)**

```typescript
import { describe, it, expect } from 'vitest';
import { fitGBDT, predictGBDT } from './gbdt.js';

function sigmoid(z: number) { return 1 / (1 + Math.exp(-z)); }

describe('fitGBDT', () => {
  it('XOR 비선형 패턴(로지스틱 불가)을 잡는다', () => {
    // y = 1 iff (x1>0) XOR (x2>0)  — 선형 분리 불가, 트리는 가능
    const X: number[][] = []; const y: number[] = [];
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 3000; i++) {
      const x1 = rnd() * 2 - 1, x2 = rnd() * 2 - 1;
      X.push([x1, x2]);
      y.push((x1 > 0) !== (x2 > 0) ? 1 : 0);
    }
    const model = fitGBDT(X, y, ['x1', 'x2'], { rounds: 60, maxDepth: 3, lr: 0.3, lambda: 1, minChild: 20, bins: 32 });
    // 네 사분면 예측이 XOR을 따른다
    expect(sigmoid(predictGBDT(model, [0.5, 0.5]))).toBeLessThan(0.4);   // 둘다 양 → 0
    expect(sigmoid(predictGBDT(model, [0.5, -0.5]))).toBeGreaterThan(0.6); // 엇갈림 → 1
    expect(sigmoid(predictGBDT(model, [-0.5, 0.5]))).toBeGreaterThan(0.6);
    expect(sigmoid(predictGBDT(model, [-0.5, -0.5]))).toBeLessThan(0.4);
  });

  it('상수 라벨이면 base만으로 안정 (NaN 없음)', () => {
    const X = [[0], [1], [2], [3]]; const y = [1, 1, 1, 1];
    const m = fitGBDT(X, y, ['a'], { rounds: 10, maxDepth: 2, lr: 0.3, lambda: 1, minChild: 1, bins: 8 });
    const p = sigmoid(predictGBDT(m, [1.5]));
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- gbdt` → FAIL

- [ ] **Step 3: 구현**

```typescript
/**
 * 순수 TS 그래디언트 부스팅 결정트리 (이진 로지스틱).
 * XGBoost식 grad/hess: leaf = -G/(H+λ), gain = ½[GL²/(HL+λ)+GR²/(HR+λ)-G²/(H+λ)]-γ.
 * 후보 분할 = 피처별 분위수 경계(bins). 학습·추론 모두 TS.
 */
export interface TreeNode {
  leaf?: number;          // 리프값(로짓 가산)
  feat?: number;          // 분할 피처 인덱스
  thr?: number;           // 분할 임계 (x < thr → left)
  left?: TreeNode;
  right?: TreeNode;
}
export interface GBDTModel {
  type: 'gbdt';
  features: string[];
  base: number;           // 초기 로짓 (base log-odds)
  lr: number;
  trees: TreeNode[];
}
export interface GBDTOpts {
  rounds?: number; maxDepth?: number; lr?: number;
  lambda?: number; gamma?: number; minChild?: number; bins?: number;
}

function sigmoid(z: number): number { return 1 / (1 + Math.exp(-z)); }

/** 피처별 분위수 분할 후보 (정렬 unique에서 bins개 경계) */
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

  let best = { gain: 0, feat: -1, thr: 0, left: [] as number[], right: [] as number[] };
  const baseScore = (G * G) / (H + o.lambda);
  for (let f = 0; f < cand.length; f++) {
    for (const thr of cand[f]!) {
      let GL = 0, HL = 0, nL = 0;
      for (const i of idx) { if (X[i]![f]! < thr) { GL += g[i]!; HL += h[i]!; nL++; } }
      const nR = idx.length - nL;
      if (nL < o.minChild || nR < o.minChild) continue;
      const GR = G - GL, HR = H - HL;
      const gain = 0.5 * ((GL * GL) / (HL + o.lambda) + (GR * GR) / (HR + o.lambda) - baseScore) - o.gamma;
      if (gain > best.gain) best = { gain, feat: f, thr, left: [], right: [] };
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
  // 분할 후보(학습셋 전체 기준, 1회 계산)
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

/** 로짓 반환 (확률 = sigmoid). */
export function predictGBDT(model: GBDTModel, row: number[]): number {
  let z = model.base;
  for (const t of model.trees) z += model.lr * evalTree(t, row);
  return z;
}
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- gbdt` → PASS (XOR·상수 둘 다)
- [ ] **Step 5: 커밋** — `feat(models): 순수 TS GBDT (grad/hess 부스팅, 분위수 비닝)`

---

## Task 2: 실험에 GBDT 비교 추가

**Files:** Modify `scripts/experiment_logistic.ts`

로지스틱과 **같은 train 스키마·행렬**로 GBDT도 학습하고, 테스트에서 GBDT의 연승·단승·묶음·ROI를 같이 출력. 기존 로지스틱·시장·v1 비교 유지.

- [ ] **Step 1: GBDT 학습 추가**

`fitLogistic` 호출 직후에:
```typescript
import { fitGBDT, predictGBDT } from '../src/engine/models/gbdt.js';
// ...
const gbdt = fitGBDT(Xtr, ytr, schema, { rounds: 120, maxDepth: 4, lr: 0.2, lambda: 1, minChild: 30, bins: 64 });
```

- [ ] **Step 2: 경주별 GBDT 픽·집계**

테스트 경주 루프에서 로지스틱 픽을 구하는 곳 옆에 GBDT 픽도 계산(점수 = `predictGBDT(gbdt, toVector(h.features, schema))`), 별도 Tally(`gModel`)로 연승·단승·묶음·ROI 누적. 로지스틱과 동일한 지표 정의·정렬(점수 내림차순) 사용.

- [ ] **Step 3: 출력 표에 GBDT 열/행 추가**

분기·누적 표에 `GBDT연승`·`GBDT단승`·`GBDT묶음`·`GBDTROI%` 추가(또는 모델별 블록 2개로 분리 출력). 최종 판정에 `GBDT vs 로지스틱`·`GBDT vs v1`·`GBDT vs 시장` 한 줄씩.

- [ ] **Step 4: 실행 (컨트롤러)**

Run: `npm run exp:logistic -- --matrix data/training_matrix.jsonl --split 20250101`
Expected: 로지스틱·GBDT·시장·v1 4자 비교 표.

- [ ] **Step 5: 커밋** — `feat(scripts): 실험에 GBDT 비교 추가 (로지스틱 vs GBDT vs v1 vs 시장)`

---

## 판정 게이트
- GBDT 연승이 로지스틱보다 **누적+다분기 우세 + 오차 밖** → GBDT를 B3 프로덕션 후보로.
- 비슷하거나 못하면 → **로지스틱 채택**(단순·설명 쉬움)하고 B3로. 어느 쪽이든 v1보단 이미 우세하므로 진행.
- 시장 격차(현 -5.6%p)를 GBDT가 더 줄이는지 주목.

## Self-Review (계획 B2)
- 스펙 커버리지: GBM 도전자(스펙 §2 결정7)=T1·T2. Python 대신 순수 TS(머신 미설치 반영, 사용자 승인).
- Placeholder: T2 Step2·3은 "로지스틱 픽 옆에 GBDT 픽 추가"로 기술 — 기존 코드 패턴 복제라 신규 알고리즘 아님. 지표 정의는 B1과 동일(명시됨).
- 타입 일관성: `GBDTModel`/`fitGBDT`/`predictGBDT`(T1) → T2 사용. `toVector`/`schema`/`Xtr`/`ytr`(B1) 재사용.
- 비용: 11k행×72피처×64bin×120라운드×depth4 — 분위수 비닝으로 노드당 O(n·d·bins). 수십초~1분 예상(오프라인 허용).
