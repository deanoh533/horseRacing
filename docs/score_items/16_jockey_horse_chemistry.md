# ⑯ 기수-말 궁합

**18개 항목 중 비중 (PRD 초기):** 3.51점
**학습 가중치 (2026-05-25):** 2.83점
**최신 학습 ρ:** +0.059
**카테고리:** 궁합
**상태:** ✅ 확정 (최근 1년 기준)
**최근 업데이트:** 2026-05-26 (PRD 동기화)

> ρ +0.06 = 약한 양의 신호. 같은 (기수, 말) 조합 이력이 평균 1-3건이라 통계 노이즈.
> 도메인 의견 "환상의 콤비" 효과는 실재하지만 작은 변수.

---

## 📊 KRA API 필드

```
hrName: 마명
jkNo: 기수 번호
ord: 착순 (해당 조합의 경주 결과)
race_date: 최근 1년 필터링용
```

## 🎯 정의

**"이 기수와 이 말의 조합이 평소보다 잘 맞는가" - 최근 1년 추세**

```
핵심 원칙:
  ✅ 향상도 측정 (말의 평균 vs 조합 평균)
  ✅ 신뢰도 계수 (이력 횟수)
  ✅ 최근 1년 데이터 (시간 흐름 반영)
```

## 🧮 알고리즘 (확정)

```javascript
async function calculateChemistryScore(hrName, jkNo, todayDate) {
  // 최근 1년 데이터 (오래된 조합은 더 이상 의미 없음)
  const oneYearAgo = subtractDays(todayDate, 365);
  
  // 말의 1년 내 모든 경주
  const horseRecent = await db.query(`
    SELECT ord FROM race_entries
    WHERE hr_name = $1 AND race_date >= $2 AND ord IS NOT NULL
  `, [hrName, oneYearAgo]);
  
  // 이 기수와의 조합 1년 내 경주
  const combinationRecent = await db.query(`
    SELECT ord FROM race_entries
    WHERE hr_name = $1 AND jcky_no = $2 AND race_date >= $3 AND ord IS NOT NULL
  `, [hrName, jkNo, oneYearAgo]);
  
  if (combinationRecent.length === 0) return 0.5; // 1년 내 처음 조합
  if (horseRecent.length < 3) return 0.5; // 말 데이터 부족
  
  // 향상도 = 말의 전체 평균 착순 - 이 조합 평균 착순
  // 양수 = 이 기수와 평소보다 좋음
  const overallAvg = avg(horseRecent.map(r => r.ord));
  const combinationAvg = avg(combinationRecent.map(r => r.ord));
  const improvement = overallAvg - combinationAvg;
  
  // 신뢰도 (조합 이력 횟수)
  const trustMap = {1: 0.5, 2: 0.7, 3: 0.85, 4: 0.95};
  const trust = trustMap[combinationRecent.length] ?? 1.0;
  
  // 향상도 → 0~1 점수
  const improvementScore = mapImprovement(improvement);
  
  // 신뢰도 적용: 0.5에서 출발 → 신뢰도만큼 향상/감소
  return 0.5 + (improvementScore - 0.5) * trust;
}

function mapImprovement(imp) {
  if (imp >= 2) return 1.0;
  if (imp >= 1) return 0.8;
  if (imp >= 0) return 0.6;
  if (imp >= -1) return 0.4;
  return 0.2;
}
```

## 📊 시나리오별 점수

| 상황 | 향상도 | 신뢰도 | **점수** |
|------|--------|--------|---------|
| 1년 내 처음 조합 | - | - | **0.5** (중립) |
| 1회 조합, 평소보다 1위 좋음 | +1.0 | 0.5 | **0.65** |
| 5회 조합, 평소보다 2위 좋음 | +2.0 | 1.0 | **1.0** ⭐⭐ |
| 5회 조합, 평소와 비슷 | 0 | 1.0 | **0.6** |
| 5회 조합, 평소보다 나쁨 | -1.0 | 1.0 | **0.4** |
| 1회 조합, 매우 좋음 | +2.0 | 0.5 | **0.75** |
| 10회 조합, 매우 좋음 | +2.0 | 1.0 | **1.0** ⭐⭐⭐ |

## 📊 신뢰도 표

| 1년 내 조합 횟수 | 신뢰도 | 의미 |
|----------------|--------|------|
| 1회 | 0.5 | 우연 가능성 ↑ |
| 2회 | 0.7 | 약간 신뢰 |
| 3회 | 0.85 | 보통 신뢰 |
| 4회 | 0.95 | 높은 신뢰 |
| 5회+ | 1.0 | 완전 신뢰 |

## ⚙️ 설계 결정 (2026-05-22 확정)

| 결정 | 선택 | 이유 |
|------|------|------|
| 데이터 기간 | **최근 1년** (PRD 전체에서 변경) | 오래된 조합은 변동 가능, 최근 추세 우선 |
| 향상도 측정 | 평균 착순 비교 | 가장 직관적 |
| 신뢰도 | PRD 표 그대로 | 검증된 곡선 |
| 처음 조합 | **0.5 중립** | "유불리 불명" 인정 |
| 말 데이터 최소 | 3경주 이상 | 평균 계산 안정성 |

## 💡 4대 핵심 영역 ⭐

```
"기수-말 궁합"이 본인이 평소 중시하는 4대 분석 영역 중 하나
→ 인사이트 지표로 선택 가능
→ 비중 3.51점 (작지만 핵심 의사결정 신호)
```

## ⚠️ 알고리즘 한계

```
1. 조합 이력 적으면 신뢰도 낮음
   → 처음 만나는 조합은 거의 항상 0.5
   
2. 말의 컨디션 변화 영향
   → 1년 전 잘 맞았어도 지금은 다를 수 있음
   → 최근 1년 필터로 일부 완화
   
3. 다른 변수 영향 (거리/주로/상대 강도)
   → 단순 평균 비교라 변수 미고려
   → 가중치 학습 시스템이 이를 보정
```

## 🔗 의존성

- DB: `race_entries.hr_name`, `race_entries.jcky_no`, `race_entries.ord`, `race_entries.race_date`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 최근 1년 기준 확정 (전체 기간에서 변경) |
| 2026-05-22 | 골격 작성 |
