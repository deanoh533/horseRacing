# ⑬ 기수-말 궁합

**14개 항목 중 비중:** 4점
**상태:** ⏳ 의논 대기 (4대 핵심 영역!)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
hrName: 마명
jkNo: 기수 번호
ord: 착순 (해당 조합의 경주 결과)
```

## 🎯 정의

"이 기수와 이 말의 조합이 평소보다 잘 맞는가"

## 🧮 PRD v4.0 알고리즘

```javascript
async function calculateChemistryScore(hrName, jkNo) {
  // 전체 기간 데이터
  const horseAllRaces = await db.query(`
    SELECT ord FROM horse_results WHERE hr_name = $1
  `, [hrName]);
  
  const combinationRaces = await db.query(`
    SELECT ord FROM horse_results 
    WHERE hr_name = $1 AND jk_no = $2
  `, [hrName, jkNo]);
  
  if (combinationRaces.length === 0) return 0.5; // 처음 조합
  
  // 향상도 = 말의 전체 평균 착순 - 이 기수와 조합 평균 착순
  const overallAvgOrd = avg(horseAllRaces.map(r => r.ord));
  const combinationAvgOrd = avg(combinationRaces.map(r => r.ord));
  const improvement = overallAvgOrd - combinationAvgOrd; // 양수 = 좋음
  
  // 신뢰도 계수 (이력 횟수)
  const trustMap = {1: 0.5, 2: 0.7, 3: 0.85, 4: 0.95};
  const trust = trustMap[combinationRaces.length] ?? 1.0;
  
  // 향상도 → 원점수
  const improvementScore = mapImprovement(improvement);
  
  // 최종: 신뢰도 적용
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

## 📊 신뢰도 표

| 조합 이력 횟수 | 신뢰도 | 의미 |
|--------------|--------|------|
| 1회 | 0.5 | 우연 가능성 ↑ |
| 2회 | 0.7 | 약간 신뢰 |
| 3회 | 0.85 | 보통 신뢰 |
| 4회 | 0.95 | 높은 신뢰 |
| 5회+ | 1.0 | 완전 신뢰 |

## 💡 본인이 평소 중시하는 영역 (도메인 인터뷰)

```
✅ "기수-말 궁합"이 4대 핵심 분석 영역 중 하나

→ 다음 세션에서 본인 노하우 반영 필요:
   - 궁합 좋은 조합 식별 방법
   - 처음 조합 (이력 없음) 처리
   - 신뢰도 곡선 조정
```

## 🔗 의존성

- DB: `horse_results.hr_name`, `horse_results.jk_no`, `horse_results.ord`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성, 4대 핵심 영역 (다음 세션 의논) |
