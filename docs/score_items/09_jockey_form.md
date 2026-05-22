# ⑥ 기수 폼

**14개 항목 중 비중:** 12점
**상태:** ⏳ 의논 대기 (다음 세션)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
jkNo: 기수 번호
jkName: 기수명
ord: 착순 (해당 기수의 모든 경주)
```

## 🎯 정의

"기수가 최근에 좋은 컨디션/폼인가"

## 🧮 PRD v4.0 알고리즘

```javascript
function calculateJockeyFormScore(jkNo, todayDate) {
  // 최근 30일 기수의 모든 경주
  const thirtyDaysAgo = subtractDays(todayDate, 30);
  const recentRaces = db.query(`
    SELECT ord FROM horse_results
    WHERE jk_no = $1 AND race_date >= $2
  `, [jkNo, thirtyDaysAgo]);
  
  if (recentRaces.length < 5) return 0.5; // 데이터 부족
  
  // 가중 점수
  const scoreMap = {1: 3, 2: 2, 3: 1};
  const totalScore = recentRaces.reduce((s, r) => 
    s + (scoreMap[r.ord] ?? 0), 0);
  const maxPossible = recentRaces.length * 3;
  
  return totalScore / maxPossible;
}
```

## ⏳ 결정 필요 사항 (다음 세션)

```
Q1. 기간 범위 (30일이 적당?)
   - 본인이 평소 보는 기수 폼 기간은?

Q2. 데이터 부족 임계값
   - 5회 미만 = 중립값? (PRD v4.0)
   - 다른 기준?

Q3. 경마장별 구분?
   - 서울 + 부산경남 통합 (PRD v4.0)
   - 또는 분리?
```

## 💡 본인이 평소 중시하는 영역 (도메인 인터뷰)

✅ "기수의 최근 성적"이 4대 핵심 분석 영역 중 하나

→ 단순 폼 측정보다 더 정교한 알고리즘 필요할 수 있음

## 🔗 의존성

- KRA API: API214_1 (`jkNo`, `ord`)
- DB: `horse_results.jk_no`, `horse_results.race_date`, `horse_results.ord`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성, 세부 의논 대기 |
