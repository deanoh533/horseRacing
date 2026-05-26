# 🛠 트러블슈팅 — 발견된 의문점·수정 요망 사항

> 큰 그림을 잡으면서 코드와 문서를 대조했을 때 **드러난 불일치·의문**을 적습니다.
> 각 항목은 (1) 무엇이 (2) 왜 문제 (3) 어떻게 고칠지를 적습니다.
> 결정·수정 후에는 항목을 [TODO.md](../TODO.md)로 옮기거나 닫습니다.

---

## 🔴 High — 점수 정확도에 영향

### T-001. ④ 구간 시간 단축 — `lastFurlong` 항상 0
- **무엇:** [scorePredictor.ts:135-139](../src/engine/scorePredictor.ts#L135)에서
  ```ts
  sameDistTrackTimes = ... .map(r => ({ rcTime: r.rc_time, lastFurlong: 0 }))
  ```
  `lastFurlong`이 하드코드된 0.
- **왜 문제:** ④ 알고리즘은 `lastImprove`로 마지막 펄롱 단축을 본다.
  `lastFurlong = 0`이면 모든 말이 동일한 비교 → 변별력 사라짐 + 점수가 왜곡됨.
- **해결:** race_entries에 들어있는 구간기록 컬럼으로 계산해서 주입.
  ```
  서울 경주: lastFurlong = rc_time - se_g1f_acc_time  (마지막 200m)
  부경 경주: lastFurlong = rc_time - bu_g1f_acc_time
  ```
  관련 컬럼 의미는 [data_flow.md §구간기록](data_flow.md) 참고.
- **영향 범위:** 4/100점. 알고리즘 가중치는 2.37점이지만 정상 작동하면 변별력 추가.

---

### T-002. ⑤ 후반 구간 순위 — `positions: []` 빈 배열
- **무엇:** [scorePredictor.ts:212](../src/engine/scorePredictor.ts#L212)
  ```ts
  positions: [],
  ```
  항상 빈 배열로 입력됨.
- **왜 문제:** 알고리즘 ⑤는 `startOrd`/`finishOrd`로 추월·후퇴를 계산.
  입력이 비면 score = 0.5 (중립)로 고정 — 가중치 2.37점이 사실상 의미 없음.
- **해결:** race_entries `sj_*_ord`(서울)·`bu_*_ord`(부경)·`pthr_no`(출발 게이트 ≠ 코너 순위지만 시작점 대용 가능)로 채우기.
  ```
  finishOrd = ord  (실제 결승선 순위)
  startOrd  = sj_g3f_ord 또는 bu_g3f_ord  (마지막 600m 시점 순위 ≈ 후반부 시작)
  ```
  단, 정확한 의미 매핑은 사용자(경마 도메인 지식) 결정 필요.
- **영향 범위:** 2.37점. T-001과 함께 해결되면 구간 데이터 가치가 점수에 본격 반영.

---

### T-003. 2025·2026 서울 구간기록 backfill 누락
- **무엇:**
  | 연도 | 서울 total | with_se_g3f |
  |---|---|---|
  | 2024 | 6,437 | 100% |
  | 2025 | 10,723 | 51% |
  | 2026 | 4,416 | 2.4% |
- **왜 문제:** T-001·T-002 수정해도 이 데이터가 없으면 점수가 0.5(중립)로 빠짐.
- **해결:**
  ```
  npx tsx scripts/backfill_sectional.ts --start 20250101 --end 20260524
  ```
  서브에이전트(Sonnet)로 백그라운드 진행 권장 (시간 오래 걸림).

---

## 🟡 Medium — 동작은 하지만 정리 필요

### T-004. `ITEM_NAMES`·주석에 "17개" 표기 잔존
- **무엇:** [src/engine/index.ts:3](../src/engine/index.ts#L3) "17개 항목 모두…" 주석.
  [src/types/index.ts:171](../src/types/index.ts#L171) "17개 항목 ID" 주석.
- **왜 문제:** 실제는 18개 (`18_earnings` 포함). 신규 개발자 혼동.
- **해결:** 주석만 "18개"로 일괄 교체. 코드 동작엔 영향 없음.

---

### T-005. ⑧⑬⑭ 전문가 자문 대기 알고리즘
- **무엇:** `EXPERT_PENDING` Set에 3개 — 부담중량·나이거리성·혈통.
- **왜 문제:** 임시 산식이라 학습으로 가중치는 줄어들지만, raw_score가 부정확하면 학습도 부정확.
- **해결:** 사용자가 전문가 자문 받아 산식 결정 → 항목별 파일 교체 + 테스트 보강.
  - ⑧ 부담중량: KRA가 핸디캡 부여 규칙 공개? 마사회 핸디캐퍼 자료 필요
  - ⑬ 나이×거리×성: 도메인 지식 (어린 말 단거리 유리 등)
  - ⑭ 혈통: dsa* 지표의 정확한 의미 (KRA 매뉴얼 필요)

---

### T-006. `race_cards`, `horse_results` 테이블 잔존
- **무엇:** 코드는 더 이상 안 읽지만 DB에 row 남아있음.
- **왜 문제:** 신규 개발자/세션이 헷갈리고 스토리지 낭비.
- **해결:** 컬럼 의존성 grep으로 최종 확인 후 DROP 마이그레이션 추가.
  ```
  Grep 'race_cards|horse_results' --type ts
  ```
  확인 후 `migrations/008_drop_legacy.sql`.

---

### T-007. `scripts/probe_*.ts` 10개 — 탐색용
- **무엇:**
  - `probe_accessible.ts`, `probe_api6_jk.ts`, `probe_api6_jk2.ts`
  - `probe_final.ts`, `probe_jk3.ts`, `probe_jkpresult.ts`
  - `probe_new_apis.ts`, `probe_sectional_fields.ts`
  - `check_wizpoint.ts`, `query_db.ts`
- **왜 문제:** git untracked로 남아있어 정리 필요.
- **해결:** 둘 중 하나:
  - 가치 있는 결과 → `docs/`에 메모로 남기고 스크립트는 `scripts/probes/` 이동
  - 일회성 → `.gitignore`에 `scripts/probe_*.ts` 추가 또는 삭제

---

## 🟢 Low — 개선 아이디어

### T-008. 사후 win_odds 활용 미사용
- **무엇:** ⑰은 과거 popularity만 본다. 사후 모드에서도 그날 win_odds는 무시.
- **검토:** 사후 모드의 백테스트라면 당일 시장 정보를 쓸 수 있음 (반대로 사전과 점수 차이가 생김).
  → "사전/사후 동일 산식" 원칙을 깰 가치가 있는가? (현재는 부정 — 일관성 우선)

### T-009. 적중률 — 출전마수별 분리 없음
- **무엇:** 8마/12마/16마 다 같은 평균.
- **개선:** [accuracy_metrics.md §7](accuracy_metrics.md) 참고 — 출전마수별·경마장별·등급별 분리.

### T-010. `sectional_records` 빈 테이블
- **무엇:** 0 rows. race_entries로 통합됐는데 스키마만 남음.
- **해결:** T-006과 묶어서 DROP.

### T-011. PRD legend 미완 항목 (5개 derived)
- **무엇:** 출주두수·출전경주마필·최근 3개월·출주간격·조교사 통계 5개.
- **해결:** [PRD_v6.1_race_info_legend.md](PRD_v6.1_race_info_legend.md) 기반 SQL view 또는 client aggregation.

### T-012. PRD legend ㉚ 절대능력지수
- **무엇:** KRA 등급변동 API(#15058076) 미조사.
- **해결:** API probe 스크립트 작성 → 가용성 확인.

### T-013. PRD legend ⑭⑱㉝㉞ — 외부 데이터
- **무엇:** 조교상태·마필가격·복기평·경주로 빠르기 — KRA 공식 API에 없음.
- **검토:** 다른 출처(에이스경마 사이트 등) 필요. 라이선스·자동화 가능성 검토.

---

## 의문 (사용자 결정 필요)

### Q-001. ⑤ `startOrd` 정의
- **질문:** "후반 구간"의 시작은 어디인가?
  - 옵션 A: 마지막 600m 지점 (`sj_g3f_ord`) — 추격 구간 분석에 적합
  - 옵션 B: 마지막 200m 지점 (`sj_g1f_ord`) — 결승선 가속 분석에 적합
  - 옵션 C: 두 개 다 별도 항목으로?
- **현재:** 미정 — 사용자 도메인 지식 결정 필요

### Q-002. 학습 윈도우
- **질문:** Spearman 학습 시 데이터 윈도우는?
  - 현재: 전 기간 (2024~2099)
  - 대안: 최근 1년 — 시즌·룰 변화 반영
  - 대안: 슬라이딩 윈도우 — 매주 갱신
- **현재:** 전 기간

### Q-003. 가중치 학습 적용 빈도
- **질문:** 매주? 누적량 임계점? 수동?
- **현재:** 수동 (사용자가 `apply_learned_weights.ts` 실행)

---

## 변경 이력

| 일자 | 항목 | 변경 |
|---|---|---|
| 2026-05-27 | 초안 | 큰 그림 정리하며 발견된 13개 트러블 + 3개 의문 정리 |
