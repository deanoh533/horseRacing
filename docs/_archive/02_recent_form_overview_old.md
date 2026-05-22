# ② 컨디션 분석 (최근 5경주) - 종합 개요

**점수 항목 번호:** ② (PRD 기준)
**14개 항목 중 비중:** 15점 (확정)
**최근 업데이트:** 2026-05-22
**상태:** 4개 신호 완전 확정

---

## 🎯 정의

"이 말이 지금 시점에 얼마나 좋은 컨디션인가" - 능력 자체(레이팅)와는 별개

## 📊 데이터 범위

- **최근 5경주** (확정)
- 5경주 미만 시: 있는 만큼 사용
- 데이터 0개 (데뷔전): 중립값 0.5

## 🔬 컨디션 신호 4개 (확정)

| # | 신호 | 비중 | 파일 |
|---|------|------|------|
| 1 | 마체중 변화 | **32%** | [signal_1_weight.md](signal_1_weight.md) |
| 2 | 착순 추세 | **32%** | [signal_2_form.md](signal_2_form.md) |
| 3 | 구간 시간 단축 | **18%** | [signal_3_time.md](signal_3_time.md) |
| 4 | 후반 구간 순위 | **18%** | [signal_4_late.md](signal_4_late.md) |
| | **합계** | **100%** | |

## ❌ 제거된 신호 (검토 후 제외)

| 신호 | 제거 이유 |
|------|----------|
| rankRise (레이팅 상승) | 항목 ① 레이팅과 중복 |
| 보술/간격/휴식 | 항목 ⑧ 경주 간격과 중복 |
| 출차 괄각 | 의미 불명 + 항목 ⑨ 출발번호와 중복 우려 |

## 🧮 종합 점수 계산

```javascript
function calculateRecentFormScore(horseHistory) {
  const recent5 = horseHistory.slice(0, 5);
  if (recent5.length === 0) return 0.5; // 데뷔전
  
  const signal1 = calculateWeightChangeScore(recent5);   // 마체중
  const signal2 = calculateFormTrendScore(recent5);      // 착순 추세
  const signal3 = calculateSectionalTimeScore(recent5);  // 구간 시간
  const signal4 = calculateLatePositionScore(recent5);   // 후반 순위
  
  const score = 
    signal1 * 0.32 +
    signal2 * 0.32 +
    signal3 * 0.18 +
    signal4 * 0.18;
  
  return score; // 0.0 ~ 1.0
}
```

## 💡 설계 철학

```
5년차 전문 분석가 노하우 + 데이터 사이언스 융합

⭐⭐ 핵심 (64%):
  - 마체중 변화 (본인이 가장 중요시)
  - 착순 추세 (3등 이내 빈도 + 가중 평균)

⭐ 보조 (36%):
  - 구간 시간 단축 (객관적 능력 향상)
  - 후반 구간 순위 (선두형/추월형 모두 우대)
```

## 📚 변경 이력

| 일자 | 변경 | 비고 |
|------|------|------|
| 2026-05-22 | 컨디션 4개 신호 확정 (rankRise/휴식/출차 제거) | 5년 노하우 인터뷰 반영 |
| 2026-04 | 초기 PRD에서 단순 평균으로 정의 | v2.3 |

## 🔗 관련 문서

- [PRD Overview](../../PRD_overview.md)
- [① 레이팅](../01_rating.md) (rankRise는 여기에서 다룸)
- [⑧ 경주 간격](../08_race_interval.md) (휴식 간격)
- [⑨ 출발번호](../09_starting_position.md)
