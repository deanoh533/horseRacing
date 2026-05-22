# ⑭ 배당률 (인기도)

**14개 항목 중 비중:** 10점
**상태:** ✅ PRD v3.1에서 변경 완료 (popularity 필드 없음 → winOdds 정렬)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
⚠️ popularity 또는 inkiOrd 필드 없음 (검증 완료)

✅ 대안: winOdds로 직접 계산
   winOdds: 단승 배당률 (낮을수록 인기 ↑)
   plcOdds: 연승 배당률
```

## 🎯 정의

"최근 5경주에서 1~2인기였던 빈도" (꾸준한 시장 인정)

## 🧮 알고리즘 (PRD v3.1)

```javascript
function calculatePopularity(race) {
  // 한 경주의 모든 말을 winOdds 오름차순 정렬
  const sorted = [...race.horses].sort((a, b) => a.winOdds - b.winOdds);
  
  // 인기 순위 = 정렬 순서
  const popularityMap = {};
  sorted.forEach((horse, idx) => {
    popularityMap[horse.hrName] = idx + 1; // 1인기, 2인기, ...
  });
  
  return popularityMap;
}

async function calculatePopScore(hrName, todayDate) {
  // 최근 5경주 조회
  const recent5 = await db.query(`
    SELECT * FROM horse_results 
    WHERE hr_name = $1 AND rc_date < $2
    ORDER BY rc_date DESC 
    LIMIT 5
  `, [hrName, todayDate]);
  
  if (recent5.length === 0) return 0; // 시장 인정 없음
  
  // 각 경주에서 1~2인기였는지
  let count = 0;
  for (const race of recent5) {
    const popMap = await getRacePopularity(race.race_date, race.meet, race.rc_no);
    if (popMap[hrName] <= 2) count++;
  }
  
  return count / 5;
}
```

## 📊 PRD 원문 정의

```
최근 5경주 전부 1~2인기 = 원점수 1.0 (만점)
인기마 기준: 1~2인기만 인정 (3인기 이하 제외 - 엄격)
이력 없음: 0점 (시장 인정 받은 적 없음)
```

## 💡 OFF 모드 (선택)

```
사용자가 배당률 항목 OFF 시:
  - 10점을 ⑥ 기수 폼 항목에 합산
  - 시장의 영향을 배제하고 분석 가능
```

## ⚠️ 검증 결과

- popularity 필드는 KRA API에 없음
- winOdds 정렬로 인기 순위 계산 가능 확인
- 모든 경주에서 winOdds 데이터 존재

## 🔗 의존성

- KRA API: API214_1 (`winOdds`)
- DB: `horse_results.win_odds`, `horse_results.popularity` (계산 후 저장)

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | PRD v3.1: popularity 필드 없음 확인, winOdds 정렬로 변경 |
| 2026-04 | 초기 PRD에서 popularity 가정 (틀린 가정) |
