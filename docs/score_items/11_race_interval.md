# ⑧ 경주 간격

**18개 항목 중 비중 (PRD 초기):** 3.51점
**학습 가중치 (2026-05-25):** 5.81점 (학습이 끌어올림)
**최신 학습 ρ:** +0.122
**상태:** ✅ 확정 (ilsu → 직접 계산)
**최근 업데이트:** 2026-05-26 (PRD 동기화)

---

## 📊 데이터 소스

```
⚠️ ilsu 필드는 사용 불가 (검증 결과: 휴식일수 아님)
   - 같은 날 모든 말이 동일한 값 → 경마장 운영일 카운터

✅ 대안: 말 이력에서 직접 계산
   - DB에서 해당 말의 직전 경주 날짜 조회
   - 오늘 날짜 - 직전 경주 날짜 = 간격
```

## 🎯 정의

"이 말이 오늘 경주에 최적인 간격으로 출전하는가"

## 🧮 알고리즘 (PRD v3.1 확정)

```javascript
async function calculateRaceIntervalScore(hrName, todayDate) {
  // DB에서 직전 경주 조회
  const prevRace = await db.query(`
    SELECT rc_date FROM horse_results
    WHERE hr_name = $1 AND rc_date < $2
    ORDER BY rc_date DESC
    LIMIT 1
  `, [hrName, todayDate]);
  
  if (!prevRace) return 0; // 데뷔전
  
  const interval = differenceInDays(
    parseDate(todayDate), 
    parseDate(prevRace.rc_date)
  );
  
  // 구간별 점수 (4점 만점)
  if (interval < 14) return 0;        // 너무 짧음
  if (interval <= 27) return 1/4;
  if (interval <= 35) return 1.0;     // 최적 (만점)
  if (interval <= 60) return 2/4;
  if (interval <= 90) return 1/4;
  return 0;                           // 90일 초과
}
```

## 📊 구간별 점수 (PRD 원문 그대로)

| 간격 | 점수 (4점 만점) | 의미 |
|------|---------------|------|
| < 14일 | 0/4 | 너무 짧음 (피로) |
| 14-27일 | 1/4 | 약간 짧음 |
| 28-35일 | **4/4** ⭐ | 최적 |
| 36-60일 | 2/4 | 약간 김 |
| 61-90일 | 1/4 | 김 |
| > 90일 | 0/4 | 너무 김 (감각저하) |

## 💡 AI 보정 연동

```
90일 초과 시:
  - ⑧ 점수 0점
  - AI 보정 케이스 E (-2점) 이중 적용
```

## 🔗 의존성

- DB: `horse_results.race_date`, `horse_results.hr_name`
- (KRA API는 데이터 수집 시에만 사용)

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | PRD v3.1: ilsu → 직접 계산 변경 (KRA API 검증 결과) |
| 2026-04 | 초기 PRD에서 ilsu 사용 (잘못된 가정) |
