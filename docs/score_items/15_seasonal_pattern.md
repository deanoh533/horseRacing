# ⑫ 계절 패턴

**14개 항목 중 비중:** 5점
**상태:** ✅ PRD 그대로 (단순)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
rcDate: 경주 날짜 (예: 20260517)
ord: 착순
```

## 🎯 정의

"이 말이 현재 시즌(여름/겨울)에 잘 뛰는 경향이 있는가"

## 🗓️ 시즌 구분

```
여름 시즌: 4월 ~ 9월 (4, 5, 6, 7, 8, 9월)
겨울 시즌: 10월 ~ 3월 (10, 11, 12, 1, 2, 3월)
```

## 🧮 알고리즘

```javascript
function calculateSeasonalPatternScore(horseHistory, todayDate) {
  const todaySeason = getSeason(todayDate);
  
  // 같은 시즌 경주만 (최근 1년)
  const oneYearAgo = subtractDays(todayDate, 365);
  const sameSeasonRaces = horseHistory.filter(r => 
    r.rcDate >= oneYearAgo && getSeason(r.rcDate) === todaySeason
  );
  
  if (sameSeasonRaces.length === 0) return 0.5; // 중립
  
  const top3Count = sameSeasonRaces.filter(r => r.ord <= 3).length;
  return top3Count / sameSeasonRaces.length;
}

function getSeason(dateStr) {
  const month = parseInt(dateStr.substring(4, 6));
  return (month >= 4 && month <= 9) ? '여름' : '겨울';
}
```

## ⏳ 결정 필요 사항 (선택)

```
Q1. 시즌 구분이 적절한가?
   - 4-9월/10-3월 (PRD)
   - 또는 더 세분화 (봄/여름/가을/겨울)?

Q2. 데이터 기간 (1년)
   - 같은 시즌이면 더 길게? (2년)
```

## 🔗 의존성

- KRA API: API214_1 (`rcDate`, `ord`)
- DB: `horse_results.race_date`, `horse_results.ord`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성 (PRD 그대로) |
