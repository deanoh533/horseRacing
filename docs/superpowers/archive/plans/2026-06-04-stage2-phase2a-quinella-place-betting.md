# Stage 2 Phase 2A — 복연승 value 백테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 복연승(2마리 모두 입상) 배당으로 모델 선별력을 화폐화하면 ROI가 양수인지, 사전 고정 3규칙으로 백테스트한다.

**Architecture:** 순수 헬퍼(`comboBacktest.ts`, 단위테스트) + 배당 수집 스크립트(`collect_combo_dividends.ts`) + 백테스트 스크립트(`backtest_combo_betting.ts`). Phase 1 헬퍼(`topTercileCutoffs`/`isBet`/`placePaid`/`roi`)와 Stage-1 로지스틱 재사용.

**Tech Stack:** Node ESM(`.js` import), tsx, vitest, Node 전역 fetch, p-limit, Supabase admin.

**스펙:** `docs/superpowers/specs/2026-06-04-stage2-phase2a-quinella-place-betting-design.md`
**배당 API:** `API160_1/integratedInfo_1`, `pool=='복연승식'` 필터(클라이언트), serviceKey 소문자. 상세는 메모리 reference-kra-dividend-api.

---

## File Structure
- **Create** `src/engine/analysis/comboBacktest.ts` — 조합 선정규칙·정산 순수함수.
- **Create** `src/engine/analysis/comboBacktest.test.ts` — 단위테스트.
- **Create** `scripts/collect_combo_dividends.ts` — 복연승 배당 수집 → JSONL.
- **Create** `scripts/backtest_combo_betting.ts` — 백테스트 러너.
- **Modify** `package.json` — `collect:combo`, `backtest:combo` 스크립트 추가.

---

## Task 1: comboBacktest 순수 헬퍼 (TDD)

**Files:** Create `src/engine/analysis/comboBacktest.ts`, Test `src/engine/analysis/comboBacktest.test.ts`

- [ ] **Step 1: 실패 테스트 작성** → `src/engine/analysis/comboBacktest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  pairKey, isMidTercile, selectTop2, selectValuePairs, selectTercilePairs, settlePair,
  type ComboHorse,
} from './comboBacktest.js';

const H = (chulNo: number, score: number, winOdds: number): ComboHorse => ({ chulNo, score, winOdds });

describe('pairKey', () => {
  it('무순 정규화 (작은 번호 먼저)', () => {
    expect(pairKey(3, 1)).toBe('1-3');
    expect(pairKey(1, 3)).toBe('1-3');
  });
});

describe('isMidTercile', () => {
  const cut = { '4-7': 0.5, '7-15': 0.2 };
  it('중배당 구간 AND 점수>=컷오프', () => {
    expect(isMidTercile(5, 0.6, cut, ['4-7', '7-15'])).toBe(true);
    expect(isMidTercile(5, 0.4, cut, ['4-7', '7-15'])).toBe(false); // 컷오프 미만
  });
  it('중배당 밖 구간은 false', () => {
    expect(isMidTercile(1.5, 0.9, cut, ['4-7', '7-15'])).toBe(false);
  });
});

describe('selectTop2', () => {
  it('모델 점수 상위 2마리 1조합', () => {
    const horses = [H(1, 0.1, 3), H(2, 0.9, 5), H(3, 0.5, 8)];
    expect(selectTop2(horses)).toEqual([[2, 3]]);
  });
  it('2마리 미만이면 빈 배열', () => {
    expect(selectTop2([H(1, 0.5, 3)])).toEqual([]);
  });
});

describe('selectValuePairs', () => {
  it('모델 1픽 × 중배당·상위터셀 말', () => {
    const cut = { '4-7': 0.4, '7-15': 0.4 };
    // 1픽=chulNo2(0.9). 중배당터셀 후보: chulNo3(odds5,score0.5>=0.4 ✓), chulNo4(odds20 비중배당 ✗), chulNo1(odds3 비중배당 ✗)
    const horses = [H(1, 0.1, 3), H(2, 0.9, 50), H(3, 0.5, 5), H(4, 0.45, 20)];
    expect(selectValuePairs(horses, cut, ['4-7', '7-15'])).toEqual([[2, 3]]);
  });
});

describe('selectTercilePairs', () => {
  it('중배당·상위터셀 말들의 모든 2조합', () => {
    const cut = { '4-7': 0.4 };
    // 후보(4-7 & score>=0.4): chulNo1(5,0.5), chulNo3(6,0.45). chulNo2(50 비중배당) 제외
    const horses = [H(1, 0.5, 5), H(2, 0.9, 50), H(3, 0.45, 6)];
    expect(selectTercilePairs(horses, cut, ['4-7'])).toEqual([[1, 3]]);
  });
});

describe('settlePair', () => {
  const placed = new Map([[1, true], [2, true], [3, false]]);
  const odds = new Map([['1-2', 4.5], ['1-3', 9.0]]);
  it('둘 다 입상이면 payout=odds', () => {
    expect(settlePair([1, 2], placed, odds)).toBe(4.5);
    expect(settlePair([2, 1], placed, odds)).toBe(4.5); // 무순
  });
  it('한쪽 미입상이면 null(손실)', () => {
    expect(settlePair([1, 3], placed, odds)).toBe(null);
  });
  it('둘 다 입상인데 배당 결측이면 null', () => {
    expect(settlePair([1, 2], placed, new Map())).toBe(null);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/analysis/comboBacktest.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** → `src/engine/analysis/comboBacktest.ts`:

```typescript
/**
 * Stage 2 Phase 2A — 복연승 백테스트 순수 헬퍼.
 * 조합 선정규칙(R1/R2/R3) + 무순 조합 정규화 + 정산. DB/IO 없음.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase2a-quinella-place-betting-design.md
 */
import { oddsBand } from './edgeProbe.js';

export interface ComboHorse {
  chulNo: number;   // 마번(pthr_no)
  score: number;    // 모델 P(top3) logit
  winOdds: number;  // 단승 배당(구간 판정용)
}

/** 무순 조합 정규화 키 (작은 chulNo 먼저). */
export function pairKey(a: number, b: number): string {
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

/** 중배당(midBands) 구간 AND 점수 >= 해당 구간 train 컷오프. */
export function isMidTercile(
  winOdds: number, score: number,
  cutoffs: Record<string, number>, midBands: string[],
): boolean {
  const b = oddsBand(winOdds);
  if (!midBands.includes(b)) return false;
  const c = cutoffs[b];
  return c != null && score >= c;
}

/** R1: 모델 점수 상위 2마리 1조합. 2마리 미만이면 빈 배열. */
export function selectTop2(horses: ComboHorse[]): Array<[number, number]> {
  if (horses.length < 2) return [];
  const s = [...horses].sort((a, b) => b.score - a.score);
  return [[s[0]!.chulNo, s[1]!.chulNo]];
}

/** R2: 모델 1픽 × {중배당·상위터셀} 말 (1픽 자신 제외). */
export function selectValuePairs(
  horses: ComboHorse[], cutoffs: Record<string, number>, midBands: string[],
): Array<[number, number]> {
  if (horses.length < 2) return [];
  const top = [...horses].sort((a, b) => b.score - a.score)[0]!;
  const out: Array<[number, number]> = [];
  for (const h of horses) {
    if (h.chulNo === top.chulNo) continue;
    if (isMidTercile(h.winOdds, h.score, cutoffs, midBands)) out.push([top.chulNo, h.chulNo]);
  }
  return out;
}

/** R3: {중배당·상위터셀} 말들의 모든 2조합. */
export function selectTercilePairs(
  horses: ComboHorse[], cutoffs: Record<string, number>, midBands: string[],
): Array<[number, number]> {
  const pool = horses.filter((h) => isMidTercile(h.winOdds, h.score, cutoffs, midBands));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      out.push([pool[i]!.chulNo, pool[j]!.chulNo]);
  return out;
}

/** 정산: 두 말 모두 입상(placedByChulNo) 시 payout=복연승odds, 아니면 null(손실). */
export function settlePair(
  pair: [number, number],
  placedByChulNo: Map<number, boolean>,
  comboOdds: Map<string, number>,
): number | null {
  const [a, b] = pair;
  if (!(placedByChulNo.get(a) && placedByChulNo.get(b))) return null;
  return comboOdds.get(pairKey(a, b)) ?? null;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/engine/analysis/comboBacktest.test.ts` → 전체 PASS.
- [ ] **Step 5: 커밋**
```
git add src/engine/analysis/comboBacktest.ts src/engine/analysis/comboBacktest.test.ts
git commit -m "feat(analysis): 복연승 백테스트 헬퍼 (선정규칙 R1/R2/R3·정산)"
```

---

## Task 2: 배당 수집 스크립트

**Files:** Create `scripts/collect_combo_dividends.ts`, Modify `package.json`

- [ ] **Step 1: 스크립트 작성** → `scripts/collect_combo_dividends.ts`:

```typescript
/**
 * Stage 2 Phase 2A — 복연승 확정배당 수집 (읽기전용 외부 API).
 * API160_1/integratedInfo_1 호출 → pool=='복연승식' 추출 → data/combo_dividends.jsonl.
 * 사용: npm run collect:combo -- --from 20250101 --to 20991231 --out data/combo_dividends.jsonl
 * 메모리 reference-kra-dividend-api 참고.
 */
import 'dotenv/config';
import { writeFileSync, appendFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { getSupabaseAdmin } from '../src/db/supabase.js';

const KEY = process.env.KRA_API_KEY!;
const ENDPOINT = 'https://apis.data.go.kr/B551015/API160_1/integratedInfo_1';

interface DivItem { chulNo: number; chulNo2: number; chulNo3: number; odds: number; pool: string; rcNo: number; }

async function fetchRace(meet: number, rcDate: number, rcNo: number): Promise<DivItem[]> {
  const out: DivItem[] = [];
  for (let pageNo = 1; pageNo <= 5; pageNo++) {
    const qs = new URLSearchParams({
      serviceKey: KEY, pageNo: String(pageNo), numOfRows: '1000', _type: 'json',
      rc_date: String(rcDate), meet: String(meet), rc_no: String(rcNo),
    });
    const r = await fetch(`${ENDPOINT}?${qs}`);
    const txt = await r.text();
    let j: any;
    try { j = JSON.parse(txt); } catch { throw new Error(`비JSON 응답 ${meet}/${rcDate}/${rcNo}: ${txt.slice(0, 120)}`); }
    if (j.response?.header?.resultCode !== '00') throw new Error(`API에러 ${j.response?.header?.resultMsg}`);
    let items = j.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    out.push(...items);
    const total = j.response?.body?.totalCount ?? 0;
    if (pageNo * 1000 >= total) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20250101'));
  const to = Number(arg('--to', '20991231'));
  const out = arg('--out', 'data/combo_dividends.jsonl');

  const sb = getSupabaseAdmin();
  // 대상 경주 목록 (결과확정된 것)
  const races: { d: number; m: number; n: number }[] = [];
  const PAGE = 1000;
  const seen = new Set<string>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no')
      .gte('race_date', from).lte('race_date', to).not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number }[]) {
      const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
      if (!seen.has(k)) { seen.add(k); races.push({ d: r.race_date, m: r.meet, n: r.rc_no }); }
    }
    if (data.length < PAGE) break;
  }
  console.log(`대상 경주 ${races.length}건 → ${out}`);

  writeFileSync(out, '');
  const limit = pLimit(4);
  let done = 0, rows = 0;
  await Promise.all(races.map((rc) => limit(async () => {
    try {
      const items = await fetchRace(rc.m, rc.d, rc.n);
      const lines = items
        .filter((it) => it.pool === '복연승식')
        .map((it) => {
          const a = Math.min(it.chulNo, it.chulNo2), b = Math.max(it.chulNo, it.chulNo2);
          return JSON.stringify({ race_date: rc.d, meet: rc.m, rc_no: rc.n, a, b, odds: it.odds });
        });
      if (lines.length) { appendFileSync(out, lines.join('\n') + '\n'); rows += lines.length; }
    } catch (e) { console.error(`  ⚠️ ${rc.d}/${rc.m}/${rc.n}:`, (e as Error).message); }
    if (++done % 50 === 0) console.log(`  ${done}/${races.length} 경주, ${rows} 조합행`);
  })));
  console.log(`✅ ${rows} 복연승 조합행 → ${out}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: npm 스크립트 추가** — `package.json` scripts에 `"probe:edge"` 줄 근처에 추가:
```json
    "collect:combo": "tsx scripts/collect_combo_dividends.ts",
    "backtest:combo": "tsx scripts/backtest_combo_betting.ts",
```

- [ ] **Step 3: 타입체크** — `npm run build` → `collect_combo_dividends.ts` 에러 없음(`any` 사용은 의도적, eslint 무시). 다른 파일 기존 에러는 무시.

- [ ] **Step 4: 스모크 수집(1일치)** — `.env` 필요. `npm run collect:combo -- --from 20250103 --to 20250103 --out data/combo_dividends_smoke.jsonl`
  Expected: "대상 경주 N건" + "✅ M 복연승 조합행". `data/combo_dividends_smoke.jsonl` 생성, 각 줄 `{race_date,meet,rc_no,a,b,odds}`. 에러 없이 종료.

- [ ] **Step 5: 커밋**
```
git add scripts/collect_combo_dividends.ts package.json
git commit -m "feat(scripts): 복연승 확정배당 수집 (API160_1, pool 클라이언트 필터)"
```

> 참고: 전체 수집(`--from 20250101`)은 수백 경주×API라 수 분 소요 — 백테스트 직전 사람이 1회 실행. 스모크는 1일치만.

---

## Task 3: 복연승 백테스트 스크립트

**Files:** Create `scripts/backtest_combo_betting.ts`

- [ ] **Step 1: 스크립트 작성** → `scripts/backtest_combo_betting.ts`:

```typescript
/**
 * Stage 2 Phase 2A — 복연승 value 백테스트 (읽기전용).
 * 3 선정규칙(R1/R2/R3) × 복연승 배당으로 ROI(규칙·분기). 게이트는 사람 판단.
 * 사용: npm run backtest:combo -- --split 20250101 --div data/combo_dividends.jsonl
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase2a-quinella-place-betting-design.md
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { topTercileCutoffs, placePaid, roi, type Bet } from '../src/engine/analysis/valueBacktest.js';
import {
  selectTop2, selectValuePairs, selectTercilePairs, settlePair, pairKey, type ComboHorse,
} from '../src/engine/analysis/comboBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }
const MID = ['4-7', '7-15'];
const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;
const load = (p: string): Row[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

interface QBet extends Bet { quarter: string }

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const divPath = arg('--div', 'data/combo_dividends.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  // 1) 로지스틱 + train 컷오프
  const schema = buildSchema(train.map((r) => r.features));
  const model = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
  const trainScored = train.filter((r) => r.win_odds && r.win_odds > 0)
    .map((r) => ({ odds: r.win_odds as number, score: predictLogit(model, toVector(r.features, schema)) }));
  const cutoffs = topTercileCutoffs(trainScored);

  // 2) 복연승 배당 맵: race → Map(pairKey → odds)
  const divLines = load(divPath) as unknown as { race_date: number; meet: number; rc_no: number; a: number; b: number; odds: number }[];
  const comboOdds = new Map<string, Map<string, number>>();
  for (const d of divLines) {
    const rk = `${d.race_date}-${d.meet}-${d.rc_no}`;
    if (!comboOdds.has(rk)) comboOdds.set(rk, new Map());
    comboOdds.get(rk)!.set(pairKey(d.a, d.b), d.odds);
  }

  // 3) race_entries: (race,hr_name)→pthr_no, 그리고 fieldSize(plc_odds non-null 수)
  const sb = getSupabaseAdmin();
  const pthrMap = new Map<string, number>();   // race-hr_name → pthr_no
  const fieldSize = new Map<string, number>(); // race → 두수
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, pthr_no, plc_odds')
      .gte('race_date', split).order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; pthr_no: number; plc_odds: number | null }[]) {
      const rk = `${r.race_date}-${r.meet}-${r.rc_no}`;
      pthrMap.set(`${rk}-${r.hr_name}`, r.pthr_no);
      if (r.plc_odds != null) fieldSize.set(rk, (fieldSize.get(rk) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }

  // 4) 경주별 horses 구성 → 규칙별 베팅·정산
  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; (byRace.get(k) ?? byRace.set(k, []).get(k)!).push(r); }

  const bets: Record<string, QBet[]> = { R1: [], R2: [], R3: [], BASE: [] };
  let skipped = 0;
  for (const [rk, rows] of byRace) {
    const fs = fieldSize.get(rk) ?? 0;
    if (fs < 5) { skipped++; continue; }
    const odds = comboOdds.get(rk);
    if (!odds || odds.size === 0) { skipped++; continue; } // 배당 결측 경주 제외
    const q = quarter(rows[0]!.race_date);
    const placedByChulNo = new Map<number, boolean>();
    const horses: ComboHorse[] = [];
    for (const r of rows) {
      if (r.ord == null || !(r.win_odds && r.win_odds > 0)) continue;
      const chulNo = pthrMap.get(`${rk}-${r.hr_name}`);
      if (chulNo == null) continue;
      const score = predictLogit(model, toVector(r.features, schema));
      horses.push({ chulNo, score, winOdds: r.win_odds });
      placedByChulNo.set(chulNo, placePaid(r.ord, fs));
    }
    const push = (rule: string, pairs: Array<[number, number]>) => {
      for (const p of pairs) bets[rule]!.push({ band: rule, plcOdds: settlePair(p, placedByChulNo, odds), quarter: q });
    };
    push('R1', selectTop2(horses));
    push('R2', selectValuePairs(horses, cutoffs, MID));
    push('R3', selectTercilePairs(horses, cutoffs, MID));
    // 베이스라인: 전 마필 모든 2조합
    const basePairs: Array<[number, number]> = [];
    for (let i = 0; i < horses.length; i++) for (let j = i + 1; j < horses.length; j++) basePairs.push([horses[i]!.chulNo, horses[j]!.chulNo]);
    push('BASE', basePairs);
  }

  console.log(`\n테스트 경주 ${byRace.size} / 제외(소두수·배당결측) ${skipped} / 배당경주 ${comboOdds.size}`);
  console.log('\n규칙        | 베팅수 | 적중 | 적중율 | 평균배당 | ROI');
  console.log('-'.repeat(62));
  const quarters = [...new Set(test.map((r) => quarter(r.race_date)))].sort();
  const label: Record<string, string> = { R1: 'R1 상위2픽', R2: 'R2 중배당가치', R3: 'R3 터셀페어', BASE: '베이스라인' };
  for (const rule of ['R1', 'R2', 'R3', 'BASE']) {
    const b = bets[rule]!;
    const hits = b.filter((x) => x.plcOdds != null);
    const avg = hits.length ? hits.reduce((s, x) => s + (x.plcOdds as number), 0) / hits.length : 0;
    const rp = roi(b) * 100;
    console.log(`${label[rule]!.padEnd(13)}| ${String(b.length).padStart(6)} | ${String(hits.length).padStart(4)} | ${(b.length ? hits.length / b.length * 100 : 0).toFixed(0).padStart(5)}% | ${avg.toFixed(1).padStart(7)} | ${rp >= 0 ? '+' : ''}${rp.toFixed(1)}%`);
  }
  console.log('\n========== 규칙별 분기 ROI ==========');
  console.log('규칙          | ' + quarters.map((q) => q.padStart(10)).join(' | '));
  for (const rule of ['R1', 'R2', 'R3']) {
    const cells = quarters.map((q) => {
      const sub = bets[rule]!.filter((x) => x.quarter === q);
      if (sub.length === 0) return '    -     ';
      return `${(roi(sub) * 100 >= 0 ? '+' : '')}${(roi(sub) * 100).toFixed(0)}%(${sub.length})`.padStart(10);
    });
    console.log(`${label[rule]!.padEnd(13)} | ${cells.join(' | ')}`);
  }
  console.log('\n판정(사람): 어떤 규칙이 ROI>0 + 다분기 일관 + 베팅수 충분이면 → Phase 2B(라이브 추천 UI).');
  console.log('정직성: 배당은 사후 확정 final → ROI 낙관적 상한. 3규칙 사전고정·분기 일관성으로 판정(단일분기=노이즈).');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: 타입체크** — `npm run build` → `backtest_combo_betting.ts` 에러 없음.
- [ ] **Step 3: 스모크(전체수집 후)** — 먼저 전체 배당 수집 필요: `npm run collect:combo -- --from 20250101` (수 분). 그 뒤 `npm run backtest:combo -- --split 20250101`. Expected: 규칙별 ROI 표 + 분기 표, 에러 없이 종료. (수집 미완 시 `--div data/combo_dividends_smoke.jsonl`로 1일치 스모크 — 대부분 경주 "배당결측" 제외돼 표본 작음, 구조 확인용.)
- [ ] **Step 4: 커밋**
```
git add scripts/backtest_combo_betting.ts
git commit -m "feat(scripts): 복연승 value 백테스트 — 3규칙 ROI(규칙·분기)"
```

---

## Self-Review (작성자 체크 완료)
- **Spec coverage:** §2 3규칙=Task1(selectTop2/Value/Tercile)+Task3 / §3 정산(both placed→odds, placePaid 재사용)=Task1 settlePair+Task3 / §4 수집(복연승식 필터·a,b 정규화)=Task2 / §4 조인(hr_name→pthr_no=chulNo, fieldSize)=Task3 / §5 규칙별·분기 출력+베이스라인=Task3 / §6 정직성=Task3 출력문. 누락 없음.
- **Type consistency:** `ComboHorse{chulNo,score,winOdds}` 정의(Task1)와 Task3 사용 일치. `pairKey`/`settlePair`/`select*` 시그니처 일관. `Bet{band,plcOdds}`·`roi`·`placePaid`·`topTercileCutoffs`는 valueBacktest(기존)에서 import. 배당 JSONL 키 `{a,b,odds}`는 Task2 출력과 Task3 입력 일치.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝 실제 코드.
- **정직성:** train 컷오프(look-ahead 회피), 배당 사후확정(낙관적 상한), 3규칙 사전고정 — 스펙·스크립트 출력 반영.
