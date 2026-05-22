# ⑦ 조교사 폼

**14개 항목 중 비중:** 8점
**상태:** ⏳ 의논 대기
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
trNo: 조교사 번호
trName: 조교사명
ord: 마방 전체 말의 착순
```

## 🎯 정의

"조교사 마방 전체가 최근에 좋은 폼인가"

## 🧮 PRD v4.0 알고리즘

```javascript
function calculateTrainerFormScore(trNo, todayDate) {
  // 최근 30일 마방 전체 출전 결과
  const thirtyDaysAgo = subtractDays(todayDate, 30);
  const stableResults = db.query(`
    SELECT ord FROM horse_results
    WHERE tr_no = $1 AND race_date >= $2
  `, [trNo, thirtyDaysAgo]);
  
  if (stableResults.length < 10) return 0.5; // 마방 전체이니 더 많이
  
  const scoreMap = {1: 3, 2: 2, 3: 1};
  const totalScore = stableResults.reduce((s, r) => 
    s + (scoreMap[r.ord] ?? 0), 0);
  const maxPossible = stableResults.length * 3;
  
  return totalScore / maxPossible;
}
```

## ⚠️ 기수 폼과의 핵심 차이

```
⑥ 기수 폼: 본인(기수)의 출전 성적만
⑦ 조교사 폼: 마방 전체 말의 성적 (조교사가 관리하는 모든 말)

→ 조교사가 잘하면 마방 전체가 잘 됨
→ 데이터 양이 훨씬 많음 (한 조교사 = 여러 말)
```

## ⏳ 결정 필요 사항

```
Q1. 기간 (30일?)
Q2. 데이터 부족 임계값 (10회?)
Q3. 마방 크기별 보정?
   - 큰 마방 vs 작은 마방
```

## 🔗 의존성

- KRA API: API214_1 (`trNo`, `ord`)
- DB: `horse_results.tr_no`, `horse_results.race_date`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성 |
