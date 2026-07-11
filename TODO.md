# 📋 TODO — 우선순위별 할일

> 마지막 정리: 2026-06-12. 의문·검토 단계는 troubleshooting.md에 남기고, 결정 후 여기로 옮깁니다.

---

## 🟡 P1 — UX / 데이터 보강

### UI/UX 개선

- [ ] **E-004 트랙 이동 이력** — 서울↔부경 이동 말 마킹 (적응 기간 고려)
- [ ] **E-005 연속 완주 여부** — 최근 N경주 모두 완주 여부 (낙마·심정지 이력 경계)

### 신규 기능

- [ ] **F-001 페이스 예측** — 선행마 마릿수 집계 (running_style 데이터 활용 → 접전 여부 예측)
- [ ] **F-003 사용자 메모/별표** — 경주·말별 개인 메모 및 즐겨찾기 기능

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
- [ ] **T-005 ⑧⑭ 전문가 자문 후 산식 교체**
  - ⑧ 부담중량: ρ=0.321로 이미 강함. 핸디캡=능력proxy 메커니즘 이해 후 개선
  - ⑭ 혈통: 현재 데이터 없음(null). 활성화 전 데이터 확보 필요

## 🟢 P2 — 정리·기술 부채

- [ ] **T-009 적중률 분리 (출전마수·경마장·등급별)**
- [ ] **T-013 외부 데이터 출처 검토** (조교상태·마필가격·복기평·경주로 빠르기)

## 🚀 운영 직전 필수 — 런치 게이팅 항목

> 이 섹션이 전부 완료돼야 실사용(베팅 참고) 전환 가능.

- [x] **L-001 predictions 보존 전략 (v7 라이브 적중률 추적)** — 완료 2026-07-11
  - 원래 설계는 `prediction_logs` 불변 로그 테이블 신설이었으나, **기존 `predictions` 테이블의 쓰기 경로만
    바꿔 대체 구현**함 (스키마 변경 없음): `dailySync`가 사전 예측(수요일)을 재계산하지 않고 보존, 금요일
    결과 도착 시 `predictions.actual_ord`만 UPDATE(예측값 필드 불변). 예측 없는 경주는
    `forcePrecompetition`으로 사전 모드 보충 INSERT.
  - 판정: `npm run probe:v7-accuracy` (`src/engine/eval/v7Accuracy.ts` + `scripts/probe_v7_accuracy.ts`)
  - 설계: `docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md` · 계획: `docs/superpowers/plans/2026-07-11-v7-live-tracking.md`
  - 문서: `docs/accuracy_metrics.md §8.6`, `docs/prediction_mode.md §8`, `docs/data_flow.md`, `docs/status/02-model-benchmark.md`

- [ ] **L-002 sync 자동화 스케줄링**
  - 현재: 수동 `tsx scripts/...` 실행
  - 필요: 출마표(수 14:30) → `sync:cards` 자동 실행, 경기 결과(금·토·일 밤) → `sync` 자동 실행
  - 방법 미정 (cron / GitHub Actions / Vercel Cron 중 선택 필요)

- [ ] **L-003 가중치 재학습 주기 정책 결정**
  - 현재: 수동으로 `apply_learned_weights.ts --alpha=1.0` 실행
  - 결정 필요: 언제 재학습? (매월? 데이터 N경주 누적 시? 적중률 X% 이하 시?)
  - 자동 재학습(백필) 시 predictions 전체 재계산이 수반됨 — L-001 완료로 dailySync 경로는 보호되나, 백필 스크립트가 도는 동안 라이브 판정용 사전 예측이 덮이지 않도록 주의 필요

- [ ] **L-004 에러 알림 채널**
  - 현재: 콘솔 로그만 (아무도 안 보면 sync 실패 인지 불가)
  - 필요: sync 실패·API 오류 시 이메일 or 슬랙 or 카카오 알림
  - 최소 구현: sync 스크립트 exit code != 0 → 알림 발송

- [ ] **L-005 DB 백업·복구 계획**
  - 위험: `apply_learned_weights.ts` 버그 or 잘못된 alpha로 predictions 38K 행 오염
  - 필요: Supabase 자동 백업 주기 확인 + 수동 복원 절차 문서화
  - 최소 구현: 재학습 전 `predictions` 스냅샷 테이블 생성 스크립트

---

## 🔮 P3 — 향후 확장 (백로그)

- [ ] **AI 인사이트** — 각 경주에 Claude API 코멘트 (PRD Phase 2)
- [ ] **PDF 분석 보고서** — 경주별 자동 생성
- [ ] **유튜브 대본 자동 생성** — 경주별
- [ ] **win_odds 시계열 캡처** — 경주 직전 변동 추적

---

## 의문 (해결 필요)

- [ ] **Q-001** ⑤ "후반 구간"의 시작점 정의 (g3f vs g1f vs 둘 다)
- [ ] **Q-002** Spearman 학습 윈도우 (전 기간 vs 최근 1년 vs 슬라이딩)
- [ ] **Q-003** 가중치 학습 적용 빈도 (수동 vs 주기적 vs 임계점)
