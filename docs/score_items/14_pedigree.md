# ⑭ 혈통 (3대)

**18개 항목 중 비중 (PRD 초기):** 4.39점
**학습 가중치 (2026-05-25):** **0.00점** ⚠️ (ρ=0 → 가중치 0)
**최신 학습 ρ:** **0.000**
**상태:** 🚫 API284 미동기화 (사실상 미작동)
**최근 업데이트:** 2026-05-26 (PRD 동기화)

---

## 🎯 정의 / 의도 (이상)

**"부마/모마/모부마 자손들의 거리별 성적 패턴 → 해당 거리에서 이 말이 강할지 예측"**

### 비중 (PRD)

```
부마 (父馬): 50%
모마 (母馬): 30%
모부마 (母父馬): 20%   ← damHrnm 의 sireHrnm
```

---

## 🚫 현재 구현 (현실) — 미동기화 상태

### 시도 1: API284 (실패)

**파일:** [src/engine/scoreItems/14_pedigree.ts](../../src/engine/scoreItems/14_pedigree.ts)

```typescript
// 임시: API284 의 dsa* 지수 평균
function calculatePedigreeScore(input) {
  const indices = [
    input.dsaBriVl, input.dsaClcVl, input.dsaIerVl,
    input.dsaPrfVl, input.dsidxVl,
  ].filter(...);
  if (indices.length === 0) return 0.5;  // ← 현재 모든 호출이 이 경로
  return min(1.0, avg / 10);
}
```

**문제: API284 가 `hr_no` 파라미터를 필터링하지 않음.** [상세](../kra_api_quirks.md#-quirk-1-api284-의-hr_no-파라미터-무시됨)

```
GET /API284/HorseBloodBasicInfo?hr_no=0047073
→ totalCount=1135 (전체 dataset)
→ 첫 row 만 반환 (어떤 호출이든 같은 row)
```

→ 어떤 말의 hr_no 를 보내도 항상 같은 응답 (대길대장의 혈통). 사실상 사용 불가.

**결과:** scorePredictor 에서 `pedigree: {}` 로 빈값 전달 → 알고리즘은 0.5 (중립) 반환 → ρ=0.

---

## ✅ 대안 (진행 중)

### horseinfohi 로 부마/모마 이름 수집

**파일:** [scripts/fetch_horse_info.ts](../../scripts/fetch_horse_info.ts)

```
horseinfohi API 는 hrno (camelCase) 파라미터를 정확히 인식.
응답: sireHrnm (부마명), damHrnm (모마명), foalgDt (출생일), gndrNm (성별)
```

현재 horses 테이블 채움: **2,994 / 4,302 (약 70%)** (KRA 일일 한도로 분할 진행).

### 부마별 자손 거리 패턴 분석

**파일:** [scripts/analyze_sires.ts](../../scripts/analyze_sires.ts)

부마별 자손들의 거리 구간별 입상률 통계:

| 부마 | 자손 | 단거리 | 중거리 | 장거리 | 특화 |
|---|---|---|---|---|---|
| 트리플나인 | 12 | 31% | 42% | **72%** | 장거리 절대 강자 |
| 매직댄서 | 10 | 24% | **69%** | 40% | 중거리 특화 |
| 머스킷맨 | 100 | **38%** | 36% | 26% | 단거리 강자 |
| 콩코드포인트 | 82 | 31% | 34% | 33% | 균형형 |

→ **알고리즘 재설계 근거 확보**. PRD 원문의 "부마별 거리 특성" 직접 통계 가능.

---

## ⚠️ 알려진 한계 / 향후 개선

### 현재 가장 큰 한계

⑭ 항목이 사실상 무력화 상태 (ρ=0, 가중치 0). 18개 중 14개 항목만 실질적으로 작동.

### 향후 개선 (별개 세션 작업)

1. **부마별 거리 패턴 알고리즘 신규 작성**
   - input: hr_name → horses.sire_hr_nm → 같은 sire 의 자손들 + race_entries 거리 입상률
   - output: 이번 경주 거리에 대한 자손 평균 입상률 (정규화)
   - PRD 의 50/30/20 비중 적용 (부/모/모부)

2. **horses 테이블 100% 채움** (KRA 한도 회복 후)

3. **API284 우회 시도**
   - `hrname` (이름 기반 검색) 가능성 탐색
   - KRA 명세 PDF 직접 확인 (포털)

4. **dsa* KRA 지수 부활** (API284 우회 성공 시)
   - 우리 알고리즘 결과와 ensemble

---

## 🔗 의존성

- KRA API: API284 (❌ 미작동) / **horseinfohi** (✅, hrno camelCase)
- DB: `horses.sire_hr_nm`, `horses.dam_hr_nm`, `horses.foalg_dt`, `horses.sex`
- 분석 도구: scripts/analyze_sires.ts

---

## 📚 변경 이력

| 일자 | 변경 | Commit |
|---|---|---|
| 2026-05-26 | PRD 동기화 (미동기화 상태 + 부마 패턴 분석 결과 추가) | (문서만) |
| 2026-05-25 | horseinfohi 70% 백필 + 부마 통계 분석 도구 추가 | `de11d81` |
| 2026-05-22 | KRA API 검증, dsaBriVl 필드 확인 | - |
| 2026-04 | 초기 PRD 구조만 확정 | - |
