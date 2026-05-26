# 📋 TODO — 우선순위별 할일

> 트러블슈팅(`docs/troubleshooting.md`)에서 "할 일"로 확정된 것을 우선순위로 정리.
> 의문·검토 단계는 troubleshooting.md에 남기고, 결정 후 여기로 옮깁니다.

---

## 🔴 P0 — 점수 정확도 직결 (다음 세션 추천)

- [ ] **T-001 ④ lastFurlong 연결** — scorePredictor.ts에서 `rc_time - se_g1f_acc_time`로 계산해 주입
- [ ] **T-002 ⑤ positions 채우기** — `(startOrd=sj_g3f_ord, finishOrd=ord)` 매핑 (단, Q-001 결정 필요)
- [ ] **T-003 2025·2026 서울 구간기록 backfill** — `npx tsx scripts/backfill_sectional.ts --start 20250101 --end 20260524`
  - 서브에이전트(Sonnet)로 백그라운드 진행

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
- [ ] **T-005 ⑧⑬⑭ 전문가 자문 후 산식 교체**
  - ⑧ 부담중량: 핸디캡 부여 규칙
  - ⑬ 나이×거리×성: 도메인 지식
  - ⑭ 혈통: dsa* 지표 의미

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
