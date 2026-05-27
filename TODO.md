# 📋 TODO — 우선순위별 할일

> 트러블슈팅(`docs/troubleshooting.md`)에서 "할 일"로 확정된 것을 우선순위로 정리.
> 의문·검토 단계는 troubleshooting.md에 남기고, 결정 후 여기로 옮깁니다.

---

## 🔴 P0 — 점수 정확도 직결

- [x] **T-001 ④ lastFurlong 연결** — 2026-05-27 확인: scorePredictor.ts line 138-139에 이미 구현됨 (`rc_time - se_g1f_acc_time`). ρ=0.060은 T-003 때문.
- [x] **T-002 ⑤ positions 채우기** — 2026-05-27 확인: scorePredictor.ts line 171-181에 이미 구현됨. ρ=0.350으로 정상 작동 확인.
- [x] **T-003 2025·2026 서울 구간기록 backfill** — 2026-05-27 완료. 2025: 49%→97.3%, 2026: 2.4%→97.9%. 에러 4건(~3%는 KRA API 원천 없음). → 예측 재계산(T-003b) 후 ④ ρ 재측정 필요.
- [x] **T-003b 예측 backfill 재실행** — 2026-05-28 완료. 3585경주 38517행 에러 0. — `npm run backfill` (T-003 구간기록 채움 후 ④ 점수 재계산). 완료 후 아래 SQL로 ④ ρ 재측정 (이전값 ρ=0.060).
  ```sql
  -- ⚠️ predictions 테이블은 actual_ord (ord 아님)
  WITH race_ranks AS (
    SELECT
      RANK() OVER (
        PARTITION BY p.race_date, p.meet, p.rc_no
        ORDER BY (p.item_scores->'04_sectional_time'->>'rawScore')::float DESC
      ) AS score_rank,
      RANK() OVER (
        PARTITION BY p.race_date, p.meet, p.rc_no
        ORDER BY p.actual_ord ASC
      ) AS finish_rank,
      COUNT(*) OVER (
        PARTITION BY p.race_date, p.meet, p.rc_no
      ) AS field_size
    FROM predictions p
    WHERE p.actual_ord IS NOT NULL
      AND (p.item_scores->'04_sectional_time'->>'rawScore') IS NOT NULL
  )
  SELECT
    ROUND(
      (1 - 6.0 * SUM(POWER(score_rank - finish_rank, 2))
        / NULLIF(SUM(field_size::float * (field_size::float * field_size::float - 1)), 0)
      )::numeric, 3
    ) AS rho_04_sectional_time,
    COUNT(*) AS n
  FROM race_ranks;
  ```
- [x] **T-014 ⑬ 나이×거리×성 비활성화** — 2026-05-27 완료. 가중치=0, 고정값 0.5. 소스: src/types/index.ts, src/engine/index.ts.
- [ ] **T-015 ① 레이팅 산식 재설계** — ρ=0.078 (가중치 1위인데 13위). Range restriction 문제. 절대값 → 클래스 내 상대값 또는 레이팅 변화 방향으로 전환.
- [ ] **T-016 ⑥⑤ 가중치 대폭 상향** — Spearman 가중치 학습 재실행 (⑬ 삭제 후). ρ 기반 이상 가중치: ⑥~20, ⑤~12.

## 🟡 P1 — UX / 데이터 보강

- [ ] **PRD v6.1 Phase 2** — HorseDetail 18항목 점수 → 원시값+맥락 표현
- [ ] **T-011 PRD legend derived 5개**
  - ⑨ 마주의 금일 출주두수
  - ⑩ 출전경주와 마필
  - ⑬ 최근 3개월 성적
  - ⑮ 출주간격
  - ⑯⑰ 조교사 통계
  - 방식: SQL view 신설 또는 client-side aggregation
- [ ] **T-012 ㉚ 절대능력지수 — KRA 등급변동 API (#15058076) 조사**
  - probe 스크립트 작성 → 가용성·스키마 확인
- [ ] **T-005 ⑧⑭ 전문가 자문 후 산식 교체** (⑬은 T-014로 삭제 결정)
  - ⑧ 부담중량: ρ=0.321로 이미 강함. 핸디캡=능력proxy 메커니즘 이해 후 개선
  - ⑭ 혈통: 현재 데이터 없음(null). 활성화 전 데이터 확보 필요

## 🟢 P2 — 정리·기술 부채

- [ ] **T-004 "17개" 주석 → "18개"** (index.ts, types/index.ts)
- [ ] **T-006 race_cards, horse_results, sectional_records DROP**
  - 마이그레이션 008
- [ ] **T-007 scripts/probe_*.ts 정리**
  - 유의미한 결과 → docs/메모, 일회성 → 삭제 또는 `scripts/probes/` 이동
- [ ] **T-009 적중률 분리 (출전마수·경마장·등급별)**
- [ ] **T-013 외부 데이터 출처 검토** (조교상태·마필가격·복기평·경주로 빠르기)

## 🔮 P3 — 향후 확장 (백로그)

- [ ] **AI 인사이트** — 각 경주에 Claude API 코멘트 (PRD Phase 2)
- [ ] **PDF 분석 보고서** — 경주별 자동 생성
- [ ] **유튜브 대본 자동 생성** — 경주별
- [ ] **자동화 cron/CI** — sync 자동 실행 + 알림
- [ ] **win_odds 시계열 캡처** — 경주 직전 변동 추적

---

## 의문 (해결 필요)

- [ ] **Q-001** ⑤ "후반 구간"의 시작점 정의 (g3f vs g1f vs 둘 다)
- [ ] **Q-002** Spearman 학습 윈도우 (전 기간 vs 최근 1년 vs 슬라이딩)
- [ ] **Q-003** 가중치 학습 적용 빈도 (수동 vs 주기적 vs 임계점)

---

## 변경 이력

| 일자 | 변경 |
|---|---|
| 2026-05-27 | 초안 — 트러블슈팅 13개 + PRD 미완 + 백로그 통합 |
| 2026-05-27 | T-001/T-002 구현 완료 확인. T-003이 진짜 P0. T-014(⑬삭제)/T-015(①재설계)/T-016(⑥⑤가중치) 신규 추가. Spearman ρ 검증 결과 반영. |
