# ⑨ 기수 통산 성적

**18개 항목 중 비중 (PRD 초기):** 10.53점
**학습 가중치 (2026-05-25):** 9.00점
**최신 학습 ρ:** +0.188 (5번째 강한 신호)
**카테고리:** 폼
**상태:** ✅ 확정
**최근 업데이트:** 2026-05-28 (통산 성적으로 전환)

---

## 🎯 정의

**"기수 통산 입상률 (jockey_stats.qu_rate_t)"**

```
변경 이유:
  최근 30일 집계 → 최신 경기 결과가 없으면 0.5(중립) 처리
  통산 성적 → 데이터 항상 존재, 신인 기수만 중립
```

## 🧮 알고리즘

```typescript
function calculateJockeyFormScore({ careerWinRate, careerQuRate }) {
  if (careerQuRate == null) return 0.5; // 신인 등 데이터 없음

  const quScore   = careerQuRate / 100;          // 통산 입상률 % → 0~1
  const winBonus  = (careerWinRate ?? 0) / 100 * 0.2; // 단승률 보너스

  return Math.min(1.0, quScore + winBonus);
}
```

## 📊 데이터 소스

| 항목 | 값 |
|---|---|
| 테이블 | `jockey_stats` |
| 키 | `jcky_no + meet` |
| 주요 컬럼 | `qu_rate_t` (통산 입상률 %), `win_rate_t` (통산 단승률 %) |
| 동기화 | `npx tsx src/sync/jockeySync.ts` |

## 📊 시나리오별 점수 예시

| 기수 통산 성적 | qu_rate | win_rate | **점수** |
|---|---|---|---|
| 톱 기수 | 38% | 18% | **min(1.0, 0.38+0.036) = 0.416** |
| 중상위 | 25% | 10% | **0.27** |
| 평균 | 15% | 6% | **0.162** |
| 신인 / 데이터 없음 | - | - | **0.50** (중립) |

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-28 | 최근 30일 집계 → jockey_stats 통산 입상률/단승률로 전환 |
| 2026-05-22 | 최초 작성 (입상 비율 + 1등 보너스, 최근 30일) |
