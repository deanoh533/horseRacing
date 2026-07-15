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
- [ ] **F-004 H7 교차표 UI 노출** — "G3F 격차 × 달성확률 → 승률" 조회표 서비스화 (전개 스펙 §7 이월, 모델 무변경)
- [ ] **F-005 사후 리뷰 도구** — 경주 후 전개 복기 (전개 스펙 §7 이월. v7 라이브 결과 쌓이는 주말 이후 시기 적합)

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

- [x] **L-002 sync 자동화 스케줄링** — 완료 2026-07-12
  - GitHub Actions `.github/workflows/sync.yml`: 출마표 수·목·금 15:00 KST(`sync:cards`, 날짜 기본값=오늘+2일 코드 추가) / 결과 토·일·월 01:00 KST(`sync`, 어제 기본값). `workflow_dispatch`로 수동 재실행(날짜 입력 가능).
  - 함정 처리: 러너 UTC → `TZ: Asia/Seoul` / 러너에 미러 없음 → `DB_SOURCE: supabase`.

- [x] **L-003 가중치 재학습 주기 정책 결정** — 완료 2026-07-12 (정책 문서화)
  - **v7 라이브 1개 분기(약 12주) 누적 + probe:v7-accuracy 첫 판정까지 재학습·승격 동결.** 이후 분기 1회 수동 사이클: `db:snapshot` → `learn:candidate` → `db:pull --table model_versions` → `benchmark` → 사용자 판단 → `promote`. 자동 재학습·자동 승격 없음.

- [x] **L-004 에러 알림 채널** — 완료 2026-07-12
  - 워크플로우 실패 → GitHub 이메일 자동. `--fail-on-empty`로 "성공인데 0건" 조용한 실패도 실패 처리(휴장일 오탐은 확인 후 무시).

- [x] **L-005 DB 백업·복구 계획** — 완료 2026-07-12
  - `npm run db:snapshot`(predictions → predictions_snapshot_YYYYMMDD, DB 내부 복사·egress 0, `--force`/`--prune N`). 복원 SQL·db:pull 미러 복원 개요는 docs/pipeline_guide.md.
  - 설계: `docs/superpowers/specs/2026-07-11-launch-gating-ops-design.md`

---

## 🔮 P3 — 향후 확장 (백로그)

- [ ] **AI 인사이트** — 각 경주에 Claude API 코멘트 (PRD Phase 2)
- [ ] **PDF 분석 보고서** — 경주별 자동 생성
- [ ] **유튜브 대본 자동 생성** — 경주별
- [ ] **win_odds 시계열 캡처** — 경주 직전 변동 추적
- [ ] **당일 결과 폴링** (경마일 10:00~18:00, 10분 간격 Actions cron) — 2026-07-13 후순위 결정
  - **선행 확인**: 경마 당일 낮에 `sync`를 수동 실행해 방금 끝난 경주 결과가 KRA API에 실시간 반영되는지 확인 (밤 일괄 반영이면 폴링 무의미)
  - 구현 시: 폴링 전용 잡 분리(`--fail-on-empty` 제거 — 오전 0건은 정상), 결과 있는 경주 스킵은 L-001 로직이 처리
  - 주의: private repo면 Actions 무료한도(월 2,000분) 거의 소진 (~월 1,800분), cron 지연 5~20분 존재

---

## 의문 (해결 필요)

- [ ] **Q-001** ⑤ "후반 구간"의 시작점 정의 (g3f vs g1f vs 둘 다)
- [ ] **Q-002** Spearman 학습 윈도우 (전 기간 vs 최근 1년 vs 슬라이딩)
- [ ] **Q-003** 가중치 학습 적용 빈도 (수동 vs 주기적 vs 임계점)
