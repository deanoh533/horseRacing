# earnings 누수 해소 — as-of 클래스 신호 대체 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 오염된 `earnings_log` 피처를 과거 ord 이력 기반 as-of 클래스 신호(통산 평균착순율·입상율)로 대체해 백테스트 미래누수를 제거하고, 로지스틱 후보의 정직값을 재측정 가능하게 만든다.

**Architecture:** `asOfHorseStats.ts`가 이미 가져온 과거 경주 배열(`race_date < 예측일`)에서 두 클래스 신호를 추가 계산(DB 호출 0 증가) → `ScoreEngineInput` → `buildFeatures`. v1(rho-legacy ⑱·`erng_sump`)은 무수정으로 동결, 로지스틱 경로(`buildFeatures`)에서만 earnings를 제거하고 클래스 신호를 추가한다.

**Tech Stack:** Node ESM(`.js` import), TypeScript, vitest, Supabase, tsx.

**스펙:** `docs/superpowers/specs/2026-06-05-earnings-asof-class-signal-design.md`

**기존 코드 사실(참고, 시그니처 유지):**
- `AsOfPastRace = { s1fOrd: number|null; ord: number|null; fieldSize: number; distCategory: DistCategory|null }` (`asOfHorseStats.ts:17`).
- `computeAsOfHorseStats(past: AsOfPastRace[], currentDistCategory): AsOfHorseStats` — 순수 함수. 내부에 `mean()` 헬퍼 존재(`asOfHorseStats.ts:97`).
- `AsOfHorseStats` 현재 필드: avgPositionRatio·stddevPositionRatio·frontRunSuccessRate·distFinishRatio·speedFigureAbilityRaw. `EMPTY` 상수(`asOfHorseStats.ts:36`)에 전부 null/undefined.
- `buildEngineInput(... asOf: AsOfHorseStats)`가 `ScoreEngineInput` 반환(`scorePredictor.ts:204-408`). 마지막에 `speedFigureAbilityRaw: asOf.speedFigureAbilityRaw`(line 406) 형태로 asOf 주입.
- `buildFeatures`의 `add(name, value)` 헬퍼와 `missingFlag(name, present)` 헬퍼(`buildFeatures.ts:31, 208-211`). `missingFlag`는 `${name}__missing`=present?0:1, 결측이면 `name`=0 추가.
- 현재 earnings: `buildFeatures.ts:150` `if (input.erngSump != null) add('earnings_log', Math.log1p(input.erngSump));`
- `input.erngSump`는 별도 경로(`scorePredictor.ts:151`)에서 세팅 — **건드리지 않음**(v1 ⑱가 ScoreEngine 경로에서 사용).
- `featureItemMap.ts:27` `earnings_log: '18_earnings',`.

---

## File Structure
- **Modify** `src/engine/asOfHorseStats.ts` — `AsOfHorseStats`에 3필드 + `computeAsOfHorseStats` 계산 + `EMPTY`.
- **Modify** `src/engine/asOfHorseStats.test.ts` — 클래스 신호 describe 블록 추가.
- **Modify** `src/engine/index.ts` — `ScoreEngineInput`에 3필드(optional).
- **Modify** `src/engine/scorePredictor.ts:406` 부근 — `buildEngineInput` 반환에 asOf 클래스 필드 주입.
- **Modify** `src/engine/features/buildFeatures.ts` — earnings_log 제거 + career_* 피처 + missing 플래그.
- **Modify** `src/engine/features/buildFeatures.test.ts` — earnings 테스트 → career 테스트 교체.
- **Modify** `src/engine/features/featureItemMap.ts` — earnings_log → career_* 매핑.
- **Modify** `src/engine/features/featureItemMap.test.ts` — 매핑 테스트 추가.

---

## Task 1: asOfHorseStats — 통산 클래스 신호 계산

**Files:** Modify `src/engine/asOfHorseStats.ts`, Test `src/engine/asOfHorseStats.test.ts`

- [ ] **Step 1: 실패 테스트 추가** — `asOfHorseStats.test.ts` 파일 끝(마지막 `});` 다음)에 추가:

```typescript
describe('computeAsOfHorseStats — 통산 클래스 신호 (earnings 누수 대체)', () => {
  it('과거 없으면 careerN=0, ratio/rate=null', () => {
    const r = computeAsOfHorseStats([], 'middle');
    expect(r.careerN).toBe(0);
    expect(r.careerFinishRatio).toBeNull();
    expect(r.careerPlaceRate).toBeNull();
  });

  it('careerFinishRatio = (ord-1)/(fieldSize-1) 평균, careerN=유효경주수', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 1, fieldSize: 11, distCategory: 'middle' },  // ratio 0
      { s1fOrd: null, ord: 11, fieldSize: 11, distCategory: 'middle' }, // ratio 1
    ];
    const r = computeAsOfHorseStats(past, 'middle');
    expect(r.careerFinishRatio).toBeCloseTo(0.5, 5);
    expect(r.careerN).toBe(2);
  });

  it('careerPlaceRate: 8두↑는 3착내 입상', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 3, fieldSize: 10, distCategory: 'middle' }, // 입상
      { s1fOrd: null, ord: 4, fieldSize: 10, distCategory: 'middle' }, // 비입상
    ];
    expect(computeAsOfHorseStats(past, 'middle').careerPlaceRate).toBeCloseTo(0.5, 5);
  });

  it('careerPlaceRate: 5~7두는 2착내만 입상', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 2, fieldSize: 6, distCategory: 'middle' }, // 입상
      { s1fOrd: null, ord: 3, fieldSize: 6, distCategory: 'middle' }, // 비입상(6두라 3착은 미입상)
    ];
    expect(computeAsOfHorseStats(past, 'middle').careerPlaceRate).toBeCloseTo(0.5, 5);
  });

  it('careerPlaceRate: 4두↓는 연승 미발매라 분모서 제외 (단 finishRatio엔 포함)', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 1, fieldSize: 4, distCategory: 'middle' },  // place 제외, finish 포함
      { s1fOrd: null, ord: 1, fieldSize: 10, distCategory: 'middle' }, // 입상
    ];
    const r = computeAsOfHorseStats(past, 'middle');
    expect(r.careerPlaceRate).toBeCloseTo(1.0, 5); // 1/1 (4두 경주 제외)
    expect(r.careerN).toBe(2);                     // finishRatio는 fieldSize>=2라 둘 다
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/engine/asOfHorseStats.test.ts`
  Expected: FAIL — `careerN`/`careerFinishRatio`/`careerPlaceRate`가 `AsOfHorseStats`에 없음(타입/undefined).

- [ ] **Step 3: 인터페이스 확장** — `asOfHorseStats.ts`의 `AsOfHorseStats` 인터페이스(line 24-30)에서 `speedFigureAbilityRaw` 줄 다음에 추가:

```typescript
  speedFigureAbilityRaw: number | null; // ⑳ 최근 N경주 figure 평균
  careerFinishRatio: number | null;     // ⑱ 통산 평균착순율 (earnings 대체)
  careerPlaceRate: number | null;       // ⑱ 통산 입상율 (KRA 연승규칙)
  careerN: number;                      // ⑱ 유효 과거 경주 수
```

- [ ] **Step 4: EMPTY 확장** — `asOfHorseStats.ts`의 `EMPTY` 상수(line 36-42)에서 `speedFigureAbilityRaw: null,` 다음에 추가:

```typescript
  speedFigureAbilityRaw: null,
  careerFinishRatio: null,
  careerPlaceRate: null,
  careerN: 0,
```

- [ ] **Step 5: 계산 구현** — `computeAsOfHorseStats`에서 `return { avgPositionRatio, ... speedFigureAbilityRaw: null };`(line 94) 바로 앞에 계산 블록 삽입하고 return을 교체.

계산 블록(삽입):

```typescript
  // ⑱ 통산 클래스 신호 (earnings 누수 대체) — 과거 ord 이력만 사용
  const finishRatios: number[] = [];
  let placeEligible = 0;
  let placeHit = 0;
  for (const r of past) {
    if (r.fieldSize < 2 || r.ord == null) continue;
    finishRatios.push((r.ord - 1) / (r.fieldSize - 1));
    // KRA 연승 입상: 8두↑ 3착내 / 5~7두 2착내 / 4두↓ 미발매(분모 제외)
    if (r.fieldSize >= 8) { placeEligible++; if (r.ord <= 3) placeHit++; }
    else if (r.fieldSize >= 5) { placeEligible++; if (r.ord <= 2) placeHit++; }
  }
  const careerN = finishRatios.length;
  const careerFinishRatio = careerN > 0 ? mean(finishRatios) : null;
  const careerPlaceRate = placeEligible > 0 ? placeHit / placeEligible : null;
```

return 교체:

```typescript
  return {
    avgPositionRatio, stddevPositionRatio, frontRunSuccessRate, distFinishRatio,
    speedFigureAbilityRaw: null,
    careerFinishRatio, careerPlaceRate, careerN,
  };
```

> 주의: `fetchAsOfHorseStats`(line 168)는 `return { ...base, speedFigureAbilityRaw: ... }`로 `base`를 스프레드하므로 새 필드가 자동 전파됨. EMPTY 반환 경로(line 131)도 EMPTY에 필드 추가했으므로 OK. 추가 수정 불필요.

- [ ] **Step 6: 통과 확인** — Run: `npx vitest run src/engine/asOfHorseStats.test.ts`
  Expected: PASS (신규 5 + 기존 전부).

- [ ] **Step 7: 커밋**

```bash
git add src/engine/asOfHorseStats.ts src/engine/asOfHorseStats.test.ts
git commit -m "feat(engine): asOfHorseStats 통산 클래스 신호 (입상율·평균착순율, earnings 대체)"
```

---

## Task 2: ScoreEngineInput 타입 + scorePredictor 주입

**Files:** Modify `src/engine/index.ts`, Modify `src/engine/scorePredictor.ts`

- [ ] **Step 1: 타입 추가** — `src/engine/index.ts`의 `ScoreEngineInput`에서 `speedFigureAbilityRaw?: number | null;`(line 140) 다음에 추가:

```typescript
  speedFigureAbilityRaw?: number | null;

  // ⑱ 통산 클래스 신호 (earnings 누수 대체 — as-of 과거 ord 이력)
  careerFinishRatio?: number | null;
  careerPlaceRate?: number | null;
  careerN?: number;
```

> `erngSump?: number;`(line 132)는 **유지**(v1 ⑱가 ScoreEngine 경로에서 사용). 삭제 금지.

- [ ] **Step 2: 주입 추가** — `src/engine/scorePredictor.ts`의 `buildEngineInput` 반환 객체에서 `speedFigureAbilityRaw: asOf.speedFigureAbilityRaw,`(line 406) 다음에 추가:

```typescript
    speedFigureAbilityRaw: asOf.speedFigureAbilityRaw,
    careerFinishRatio: asOf.careerFinishRatio,
    careerPlaceRate: asOf.careerPlaceRate,
    careerN: asOf.careerN,
```

- [ ] **Step 3: 타입체크** — Run: `npm run build`
  Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/engine/index.ts src/engine/scorePredictor.ts
git commit -m "feat(engine): ScoreEngineInput 통산 클래스 필드 + buildEngineInput 주입"
```

---

## Task 3: buildFeatures — earnings 제거, 클래스 피처 추가

**Files:** Modify `src/engine/features/buildFeatures.ts`, Test `src/engine/features/buildFeatures.test.ts`

- [ ] **Step 1: 실패 테스트 교체** — `buildFeatures.test.ts`의 `'⑱ 수득상금은 log1p로'` 테스트(line 39-42)를 아래로 교체:

```typescript
  it('⑱ 통산 클래스: finish_ratio·place_rate raw 통과, career_n 동반', () => {
    const input = { ...base, careerFinishRatio: 0.2, careerPlaceRate: 0.6, careerN: 5 };
    expect(val(input, 'career_finish_ratio')).toBeCloseTo(0.2, 5);
    expect(val(input, 'career_place_rate')).toBeCloseTo(0.6, 5);
    expect(val(input, 'career_n')).toBe(5);
  });
  it('⑱ earnings_log는 더 이상 출력 안 함 (누수 제거)', () => {
    expect(val({ ...base, erngSump: 100_000_000 }, 'earnings_log')).toBeUndefined();
  });
  it('⑱ 통산 클래스 결측이면 missing=1, career_n=0', () => {
    expect(val({ ...base }, 'career_finish_ratio__missing')).toBe(1);
    expect(val({ ...base }, 'career_place_rate__missing')).toBe(1);
    expect(val({ ...base }, 'career_n')).toBe(0);
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/engine/features/buildFeatures.test.ts`
  Expected: FAIL — `career_*` 미구현, `earnings_log`는 아직 출력됨.

- [ ] **Step 3: earnings 줄 교체** — `buildFeatures.ts:149-150`의

```typescript
  // ⑱ 수득상금 log
  if (input.erngSump != null) add('earnings_log', Math.log1p(input.erngSump));
```

를 아래로 교체:

```typescript
  // ⑱ 통산 클래스 신호 (earnings 누수 대체 — as-of 과거 ord 이력)
  if (input.careerFinishRatio != null) add('career_finish_ratio', input.careerFinishRatio);
  if (input.careerPlaceRate != null) add('career_place_rate', input.careerPlaceRate);
  add('career_n', input.careerN ?? 0);
```

- [ ] **Step 4: missing 플래그 추가** — `buildFeatures.ts`의 missingFlag 블록에서 `missingFlag('speed_ability_raw', ...)`(line 213) 다음에 추가:

```typescript
  missingFlag('speed_ability_raw', input.speedFigureAbilityRaw != null);
  missingFlag('career_finish_ratio', input.careerFinishRatio != null);
  missingFlag('career_place_rate', input.careerPlaceRate != null);
```

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/engine/features/buildFeatures.test.ts`
  Expected: PASS (신규 3 + 기존).

- [ ] **Step 6: 커밋**

```bash
git add src/engine/features/buildFeatures.ts src/engine/features/buildFeatures.test.ts
git commit -m "feat(features): earnings_log 제거 + 통산 클래스 피처(career_*) 추가"
```

---

## Task 4: featureItemMap — career_* → ⑱ 매핑

**Files:** Modify `src/engine/features/featureItemMap.ts`, Test `src/engine/features/featureItemMap.test.ts`

- [ ] **Step 1: 실패 테스트 추가** — `featureItemMap.test.ts`의 마지막 `it(...)` 다음(같은 describe 안)에 추가:

```typescript
  it('통산 클래스 신호는 ⑱로 매핑 (earnings 대체)', () => {
    expect(featureToItem('career_finish_ratio')).toBe('18_earnings');
    expect(featureToItem('career_place_rate')).toBe('18_earnings');
    expect(featureToItem('career_n')).toBe('18_earnings');
    expect(featureToItem('career_finish_ratio__missing')).toBe('18_earnings');
  });
  it('제거된 earnings_log는 미매핑(context)', () => {
    expect(featureToItem('earnings_log')).toBe('context');
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/engine/features/featureItemMap.test.ts`
  Expected: FAIL — `career_*`가 'context'로 떨어지고 `earnings_log`는 아직 '18_earnings'.

- [ ] **Step 3: 매핑 교체** — `featureItemMap.ts:27`의

```typescript
  earnings_log: '18_earnings',
```

를 아래로 교체:

```typescript
  career_finish_ratio: '18_earnings', career_place_rate: '18_earnings', career_n: '18_earnings',
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/engine/features/featureItemMap.test.ts`
  Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/features/featureItemMap.ts src/engine/features/featureItemMap.test.ts
git commit -m "feat(features): career_* → ⑱ 항목 매핑 (earnings_log 제거)"
```

---

## Task 5: 전체 검증

**Files:** (변경 없음 — 빌드/테스트만)

- [ ] **Step 1: 전체 타입체크** — Run: `npm run build`
  Expected: 에러 없음.

- [ ] **Step 2: 전체 단위테스트** — Run: `npm run test:run`
  Expected: 전부 PASS. (특히 asOfHorseStats·buildFeatures·featureItemMap·logisticScorer 관련.)

- [ ] **Step 3: earnings 잔재 스캔** — Run: `npx grep` 대신 검색으로 `earnings_log`가 `featureItemMap.ts`·`buildFeatures.ts`에 더 없음 확인(스펙 문서·주석 제외).
  Expected: 프로덕션 코드(buildFeatures/featureItemMap)에 `earnings_log` 없음. (v1 경로 `18_earnings.ts`·`erngSump`는 의도적으로 남음.)

---

## 운영 순서 (구현 완료 후, 사람이 수행 — DB·.env 필요)

피처가 학습행렬(JSONL)에 baked되므로 **재추출 없이는 측정이 옛 earnings로 오염**된다.

1. `npm run extract:matrix` — 학습행렬 재추출(37k행·수분). career_* 피처 반영, earnings_log 사라짐.
2. `npm run exp:logistic -- --walkforward` — **로지스틱-clean vs v1(동결)** 연승·단승·ROI 분기별.
3. 해석(사람): 기존 거품값(+5.2%p) / earnings제거만(+1.4%p) 대비 **클래스 신호로 회복된 정직 우위**. 회복 크면 "수득상금=클래스 깨끗 대체 가능", 미미하면 "earnings 거품은 누수 그 자체였음". 어느 쪽이든 정직 결론 → B3 승격 판정의 근거.
   - ⚠️ 비교는 "clean 로지스틱 vs leaky v1" — v1 백테스트는 여전히 누수 포함(v1 동결 선택). 출력 해석 시 명시.

---

## Self-Review (작성자 체크 완료)
- **Spec coverage:** §3 아키텍처(asOfHorseStats 확장)=Task1 / §4 신호정의(finish_ratio·place_rate·n)=Task1 계산+Task3 피처 / §5 교체범위(earnings 제거·v1 동결·featureItemMap)=Task3·Task4, erngSump/⑱ 무수정 명시 / §6 데이터흐름(input 타입·주입)=Task2 / §7 검증(재추출·exp:logistic·누수테스트)=운영순서+Task1 place규칙 테스트. 누락 없음.
- **Type consistency:** `careerFinishRatio`/`careerPlaceRate`/`careerN` 이름이 AsOfHorseStats(Task1)·ScoreEngineInput(Task2)·buildEngineInput 주입(Task2)·buildFeatures 소비(Task3)에서 일관. `career_finish_ratio`/`career_place_rate`/`career_n` 피처명이 buildFeatures(Task3)·featureItemMap(Task4)·테스트에서 일관. `mean()`은 asOfHorseStats 기존 헬퍼 재사용.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝 실제 코드.
- **Open items:** v1 동결 위해 `erngSump`·`18_earnings.ts` 의도적 잔존(스펙 §5 합의). featureItemMap 라벨 불일치(UI "수득상금"이 클래스 표시)는 점수 무영향, 개명은 범위 밖.
