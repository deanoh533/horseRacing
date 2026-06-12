# Stage 2 Phase 0 — 시장 엣지 탐색 probe 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** "같은 배당 구간 안에서 모델 점수 터셀이 실제 top3율을 가르나"를 4개 슬라이스 × 분기별로 측정하는 읽기전용 probe를 만든다.

**Architecture:** 테스트 가능한 순수 분석 헬퍼(`oddsBand`/`terciles`/`conditionalEdge`)를 분리하고, probe 스크립트가 행렬 로드 + 로지스틱 학습/채점 + `races` 조인 + 슬라이스별 헬퍼 호출 + 표 출력을 담당.

**Tech Stack:** TypeScript, Node, tsx, vitest, Supabase.

**스펙:** `docs/superpowers/specs/2026-06-04-stage2-market-edge-probe-design.md`
**선행 자산(재사용):** `data/training_matrix.jsonl`(race_date·meet·rc_no·hr_name·ord·win_odds·top3·features), `fitLogistic`/`predictLogit`(`src/engine/models/logistic.ts`), `buildSchema`/`toVector`(`src/engine/features/alignFeatures.ts`), `getSupabaseAdmin`(`src/db/supabase.ts`).

---

## 파일 구조
- Create: `src/engine/analysis/edgeProbe.ts` — 순수 분석 헬퍼
- Create: `src/engine/analysis/edgeProbe.test.ts`
- Create: `scripts/probe_market_edge.ts` — probe 실행 스크립트
- Modify: `package.json` — `probe:edge` 스크립트

---

## Task 1: 분석 헬퍼 (순수 함수)

**Files:** Create `src/engine/analysis/edgeProbe.ts`, `edgeProbe.test.ts`

핵심: 배당 구간 분류, 터셀 분할, 구간×터셀 top3율·스프레드.

- [ ] **Step 1: 실패 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { oddsBand, terciles, conditionalEdge } from './edgeProbe.js';

describe('oddsBand', () => {
  it('배당을 구간 라벨로', () => {
    expect(oddsBand(1.8)).toBe('<2');
    expect(oddsBand(3)).toBe('2-4');
    expect(oddsBand(6.9)).toBe('4-7');
    expect(oddsBand(15)).toBe('15-30');
    expect(oddsBand(31)).toBe('30+');
    expect(oddsBand(0)).toBe('na');
  });
});

describe('terciles', () => {
  it('값 순위로 0(하)/1/2(상) 3분할', () => {
    expect(terciles([10, 20, 30, 40, 50, 60])).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('역순도 동일 분할', () => {
    expect(terciles([60, 50, 40, 30, 20, 10])).toEqual([2, 2, 1, 1, 0, 0]);
  });
});

describe('conditionalEdge', () => {
  it('배당 구간 안에서 모델 고점수 터셀의 top3율이 높으면 양의 스프레드', () => {
    // band 2-4: 6마리, score와 top3가 같은 방향(고점수=입상)
    const recs = [
      { odds: 3, score: 0.1, top3: 0 }, { odds: 3, score: 0.2, top3: 0 },
      { odds: 3, score: 0.5, top3: 0 }, { odds: 3, score: 0.6, top3: 1 },
      { odds: 3, score: 0.9, top3: 1 }, { odds: 3, score: 0.95, top3: 1 },
    ];
    const out = conditionalEdge(recs, 2);
    const band = out.find((b) => b.band === '2-4')!;
    expect(band.n).toBe(6);
    expect(band.hi.rate).toBeGreaterThan(band.lo.rate);
    expect(band.spread).toBeCloseTo(band.hi.rate - band.lo.rate, 5);
    expect(band.spread).toBeGreaterThan(0);
  });
  it('표본 부족 구간(minN 미만)은 제외', () => {
    const recs = [{ odds: 3, score: 0.5, top3: 1 }];
    expect(conditionalEdge(recs, 6)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- edgeProbe` → FAIL

- [ ] **Step 3: 구현**

```typescript
/**
 * 시장 엣지 탐색 순수 헬퍼.
 * 핵심: 같은 배당 구간 안에서 모델 점수 터셀이 실제 top3율을 가르나(스프레드).
 */
const BANDS: Array<[string, number, number]> = [
  ['<2', 0, 2], ['2-4', 2, 4], ['4-7', 4, 7], ['7-15', 7, 15], ['15-30', 15, 30], ['30+', 30, Infinity],
];

export function oddsBand(winOdds: number): string {
  if (!(winOdds > 0)) return 'na';
  for (const [label, lo, hi] of BANDS) if (winOdds >= lo && winOdds < hi) return label;
  return 'na';
}

/** 값 순위로 0(하)/1/2(상) 터셀. 동률은 입력 순서로 분리. 길이 동일 배열 반환. */
export function terciles(values: number[]): number[] {
  const n = values.length;
  const ranked = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array(n).fill(0);
  ranked.forEach((pair, rank) => {
    out[pair[1]] = Math.min(2, Math.floor((rank / n) * 3));
  });
  return out;
}

export interface CellStat { n: number; top3: number; rate: number; }
export interface BandEdge { band: string; n: number; lo: CellStat; mid: CellStat; hi: CellStat; spread: number; }

const emptyCell = (): CellStat => ({ n: 0, top3: 0, rate: 0 });
function finalize(c: CellStat): CellStat { c.rate = c.n ? c.top3 / c.n : 0; return c; }

/**
 * 레코드를 배당 구간으로 묶고, 구간 안에서 score 터셀별 top3율과 스프레드(상−하)를 낸다.
 * @param minN 구간 최소 표본 (미만이면 제외)
 */
export function conditionalEdge(
  recs: { odds: number; score: number; top3: number }[],
  minN = 30
): BandEdge[] {
  const byBand = new Map<string, { odds: number; score: number; top3: number }[]>();
  for (const r of recs) {
    const b = oddsBand(r.odds);
    if (b === 'na') continue;
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b)!.push(r);
  }
  const out: BandEdge[] = [];
  for (const [band] of BANDS) {
    const rows = byBand.get(band);
    if (!rows || rows.length < minN) continue;
    const t = terciles(rows.map((r) => r.score));
    const cells = [emptyCell(), emptyCell(), emptyCell()];
    rows.forEach((r, i) => { const c = cells[t[i]!]!; c.n++; c.top3 += r.top3; });
    cells.forEach(finalize);
    out.push({ band, n: rows.length, lo: cells[0]!, mid: cells[1]!, hi: cells[2]!, spread: cells[2]!.rate - cells[0]!.rate });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- edgeProbe` → PASS
- [ ] **Step 5: 커밋** — `feat(analysis): 시장 엣지 헬퍼 (배당구간·터셀·조건부 스프레드)`

---

## Task 2: probe 스크립트

**Files:** Create `scripts/probe_market_edge.ts`, Modify `package.json`

행렬 로드 → 로지스틱(train<split) 학습 → 테스트 horse 채점 → `races` 조인(rc_dist·track_type) → 4 슬라이스 × (전체+분기별) 조건부 엣지 + 시장 베이스라인 출력.

- [ ] **Step 1: package.json** — scripts에 `"probe:edge": "tsx scripts/probe_market_edge.ts",` 추가

- [ ] **Step 2: 스크립트 작성**

```typescript
/**
 * Stage 2 Phase 0 — 시장 엣지 탐색 probe (읽기전용).
 * 같은 배당 구간 안에서 모델 점수 터셀이 실제 top3율을 가르나를 4슬라이스×분기로 본다.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-market-edge-probe-design.md
 *
 * 사용: npm run probe:edge -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { conditionalEdge, oddsBand, type BandEdge } from '../src/engine/analysis/edgeProbe.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }
interface Rec { odds: number; score: number; top3: number; fieldSize: number; rcDist: number; meet: number; track: string; quarter: string; confTier: number; }

const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;

function load(path: string): Row[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function printEdge(title: string, edges: BandEdge[]) {
  console.log(`\n### ${title}`);
  console.log('배당구간 |    n | top3율 하/중/상        | 스프레드');
  console.log('-'.repeat(60));
  for (const e of edges) {
    const f = (c: { rate: number }) => (c.rate * 100).toFixed(0).padStart(3);
    const sp = (e.spread * 100);
    console.log(`${e.band.padEnd(8)} | ${String(e.n).padStart(4)} | ${f(e.lo)} / ${f(e.mid)} / ${f(e.hi)}            | ${sp >= 0 ? '+' : ''}${sp.toFixed(1)}%p`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  // 로지스틱 학습
  const schema = buildSchema(train.map((r) => r.features));
  const model = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });

  // races 조인 (rc_dist, track_type) — 1회 로드
  const sb = getSupabaseAdmin();
  const raceMeta = new Map<string, { rcDist: number; track: string }>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('races')
      .select('race_date, meet, rc_no, rc_dist, track_type')
      .gte('race_date', split)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; rc_dist: number | null; track_type: string | null }[]) {
      raceMeta.set(`${r.race_date}-${r.meet}-${r.rc_no}`, { rcDist: r.rc_dist ?? 0, track: r.track_type ?? '?' });
    }
    if (data.length < PAGE) break;
  }

  // 경주별 그룹 (field_size, 확신도 터셀용)
  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }

  // horse 레코드 생성
  const recs: Rec[] = [];
  for (const [k, horses] of byRace) {
    const scored = horses.map((h) => ({ h, s: predictLogit(model, toVector(h.features, schema)) }));
    const sortedDesc = [...scored].sort((a, b) => b.s - a.s);
    const top1 = sortedDesc[0]?.s ?? 0;
    const top2 = sortedDesc[1]?.s ?? top1;
    const gap = top1 - top2; // 경주 확신도
    const meta = raceMeta.get(k) ?? { rcDist: 0, track: '?' };
    for (const { h, s } of scored) {
      if (h.ord == null || h.ord > 50 || !(h.win_odds && h.win_odds > 0)) continue;
      recs.push({ odds: h.win_odds, score: s, top3: h.top3, fieldSize: horses.length, rcDist: meta.rcDist, meet: h.meet, track: meta.track, quarter: quarter(h.race_date), confTier: gap });
    }
  }

  console.log(`\n총 테스트 horse(유효배당): ${recs.length}  /  학습 ${train.length}행, 피처 ${schema.length}`);

  // === 슬라이스 1: 전체 (배당구간) ===
  printEdge('[전체] 배당구간 × 모델터셀', conditionalEdge(recs, 50));

  // === 슬라이스 2: 출전두수 ===
  for (const [lab, lo, hi] of [['소(≤8)', 0, 9], ['중(9-11)', 9, 12], ['다(≥12)', 12, 99]] as const) {
    printEdge(`[출전두수 ${lab}]`, conditionalEdge(recs.filter((r) => r.fieldSize >= lo && r.fieldSize < hi), 50));
  }

  // === 슬라이스 3: 거리 ===
  for (const [lab, lo, hi] of [['단(≤1300)', 0, 1301], ['중(1301-1700)', 1301, 1701], ['장(≥1701)', 1701, 9999]] as const) {
    printEdge(`[거리 ${lab}]`, conditionalEdge(recs.filter((r) => r.rcDist >= lo && r.rcDist < hi), 50));
  }
  // 경마장
  for (const m of [1, 3]) printEdge(`[경마장 meet=${m}]`, conditionalEdge(recs.filter((r) => r.meet === m), 50));

  // === 슬라이스 4: 모델 확신도 (경주 logit gap 터셀) ===
  {
    const gaps = recs.map((r) => r.confTier).sort((a, b) => a - b);
    const q1 = gaps[Math.floor(gaps.length / 3)]!, q2 = gaps[Math.floor((2 * gaps.length) / 3)]!;
    printEdge('[확신도 하위1/3]', conditionalEdge(recs.filter((r) => r.confTier <= q1), 50));
    printEdge('[확신도 상위1/3]', conditionalEdge(recs.filter((r) => r.confTier > q2), 50));
  }

  // === 분기 일관성 (전체 배당구간만) ===
  console.log('\n========== 분기별 일관성 (전체, 스프레드만) ==========');
  const quarters = [...new Set(recs.map((r) => r.quarter))].sort();
  for (const q of quarters) {
    const e = conditionalEdge(recs.filter((r) => r.quarter === q), 30);
    const sp = e.map((b) => `${b.band}:${(b.spread * 100 >= 0 ? '+' : '')}${(b.spread * 100).toFixed(0)}`).join('  ');
    console.log(`${q}  ${sp}`);
  }

  // === 시장 베이스라인 (배당구간별 실제 top3율 vs 평균 1/odds) ===
  console.log('\n========== 시장 베이스라인 (배당구간) ==========');
  console.log('배당구간 |    n | 실제top3율 | 평균(1/odds)');
  const bands = ['<2', '2-4', '4-7', '7-15', '15-30', '30+'];
  for (const b of bands) {
    const g = recs.filter((r) => oddsBand(r.odds) === b);
    if (g.length === 0) continue;
    const top3 = g.reduce((s, r) => s + r.top3, 0) / g.length;
    const impl = g.reduce((s, r) => s + 1 / r.odds, 0) / g.length;
    console.log(`${b.padEnd(8)} | ${String(g.length).padStart(4)} | ${(top3 * 100).toFixed(0).padStart(6)}% | ${(impl * 100).toFixed(0).padStart(6)}%`);
  }

  console.log('\n판정: 어떤 슬라이스가 다분기 일관 + 표본충분 + 큰 양의 스프레드면 Phase 1로. (정직성: 단일분기 큰값=노이즈)');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 3: 타입체크** — `npm run build` → 0 errors

- [ ] **Step 4: 실행 (컨트롤러)** — `npm run probe:edge -- --split 20250101`
  Expected: 슬라이스별 배당구간×터셀 top3율 표 + 분기 일관성 + 시장 베이스라인.

- [ ] **Step 5: 커밋** — `feat(scripts): 시장 엣지 탐색 probe (조건부 엣지 4슬라이스+분기)`

---

## Self-Review
- 스펙 커버리지: 조건부 엣지(§2.1)=Task1 conditionalEdge + Task2 출력 / 시장 베이스라인(§2.2)=Task2 / 4슬라이스(§3)=Task2 / 분기 일관성(§5)=Task2 / 정직성 표본·다분기(§6)=minN·분기루프·판정문구.
- Placeholder: 없음. 모든 스텝 실제 코드.
- 타입 일관성: `BandEdge`/`CellStat`(Task1) → Task2 `printEdge` 사용. `conditionalEdge(recs, minN)` 시그니처 일치. `Feature`(기존)·`fitLogistic`/`predictLogit`/`buildSchema`/`toVector`(기존) 재사용.
- 정리 완료: 빈 루프 제거, `oddsBand`는 상단 import로 통합.
