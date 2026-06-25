# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 가장 먼저 읽습니다.
> 마지막 업데이트: 2026-06-20 (Platt 라이브 캘리브레이션 배포 + 조교 로그 라이브 현행화 376k)

---

## 🎯 한 줄 요약

KRA(한국마사회) 출마정보를 한 화면에 비교하고, 21개 항목 알고리즘 × Spearman 학습 가중치로 종합점수를 만들어 경주 1·2·3위를 예측한 뒤 결과로 적중률을 측정하는 개인용 분석 도구.

미래 계획: 경주별 AI 코멘트 / PDF 보고서 / 유튜브 대본 자동 생성.

---

## 📐 4단계 핵심 흐름

```
   ① 수집              ② 점수화           ③ 학습              ④ 검증
┌─────────────┐    ┌─────────────┐   ┌─────────────┐    ┌─────────────┐
│  KRA Open   │ →  │ ScoreEngine │ → │WeightLearner│ →  │  적중률 통계 │
│    API      │    │ 21 항목     │   │ Spearman ρ  │    │ 단/연/복승, │
│             │    │ raw 0~1     │   │ → 가중치    │    │ TOP3 교집합 │
└─────────────┘    └─────────────┘   └─────────────┘    └─────────────┘
       ↓                 ↓                  ↓                  ↑
  race_entries     predictions        weight_history     predictions
```

---

## 🛠 기술 스택

- **프론트엔드:** React + Vite + Tailwind ([client/](client/))
- **백엔드/스크립트:** Node.js + TypeScript ([src/](src/), [scripts/](scripts/)) — **로컬 수동 실행 전용** (상시 서버 X). Vercel에는 `client/`만 배포.
- **DB:** Supabase (PostgreSQL)
- **배포:** Vercel — main push 시 자동 배포 (`horse-racing-xi-one.vercel.app`)

---

## ⚡ 개발 시작

```bash
# 1. 환경 변수 설정
cp .env.example .env  # 아래 키 필수 입력

# 2. 의존성 설치
npm install && cd client && npm install && cd ..

# 3. 개발 서버 실행 (각각 별도 터미널)
npm run dev          # 백엔드 (포트 3000)
npm run client:dev   # 프론트엔드 (포트 5173)

# 타입체크 / 테스트
npm run build        # tsc 전체 타입체크
npm run test:run     # vitest 단위 테스트
```

**필수 환경 변수** (`.env.example` 참고):
- `KRA_API_KEY` — data.go.kr 공공데이터 포털 발급
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — `sk-ant-...` 형식

---

## 🗂 핵심 테이블

| 테이블/뷰 | 역할 | 채움 |
|---|---|---|
| `race_entries` | **사전+사후 통합 테이블** (PK: race_date·meet·rc_no·pthr_no) | raceCardSync / dailySync |
| `races` | 경주 메타 (거리·주로·날씨) | raceCardSync / dailySync |
| `predictions` | 경주마별 종합점수 + 항목점수 | dailySync / backfill |
| `weight_history` | Spearman 학습 가중치 변천 | apply_learned_weights |
| `horse_sectional_ability` | 마별 통산 구간 능력치 (view) | 007 마이그레이션 |
| `horse_running_style_by_distance` | 거리별 마필 주행 성향 (view) | 008 마이그레이션 |
| `race_sectional_stats` | 경주별 페이스 통계 (view) | 007 마이그레이션 |
| `training_logs` | 일별 훈련 기록 | trainingSync (API18_1) |
| `jockey_stats` | 기수 통산 성적 | jockeySync (jkpresult) |
| `horses` | 말 정보 + 혈통 | fetch_horse_info |

→ 전체 구조·관계는 [docs/architecture.md §5](docs/architecture.md#5-데이터-모델-db)

---

## 🔀 예측 모드 — 사전/사후

같은 `predictRace()`가 **`race_entries.ord` NULL 여부**로 자동 분기.

| 시점 | `ord` | 모드 |
|---|---|---|
| 수~경기 직전 | NULL | 사전 (베팅 전 예측) |
| 경기 후 | 1·2·3·… | 사후 (백테스트·학습) |

상세 데이터 출처 차이 → [docs/prediction_mode.md](docs/prediction_mode.md)

---

## 📆 한 주의 흐름

| 요일 | 이벤트 | 명령 |
|---|---|---|
| 수 오후 | 금경 출마표 발표 | `sync:racecard --date YYYYMMDD` |
| 목 오후 | 토경 출마표 발표 | 〃 |
| 금 오후 | 일경 출마표 발표 | 〃 |
| 금 밤 | 금경 결과 도착 | `sync:daily --date YYYYMMDD` |
| 토 밤 | 토경 결과 도착 | 〃 |
| 일 밤 | 일경 결과 도착 | 〃 |
| 주중 | 가중치 학습 (선택) | `apply_learned_weights.ts` |

상세 → [docs/data_lifecycle.md](docs/data_lifecycle.md)

---

## 🤝 협업 모드 (Claude)

- **PM/기획** → 단계별 의논 필수, 추측 단독 작성 X
- **SQL 쿼리·대용량 분석** → 사용자가 Supabase SQL Editor에서 실행 (토큰 절감)
- **빌드·타입체크·git** → Claude 직접
- **출력 100줄 넘는 명령** → 사용자에게 부탁
- **서브에이전트 spawn** → `model: 'sonnet'` 명시 (메인 Opus 비용 분리)
- **선택지 제시** → AskUserQuestion 버튼 UI 사용

---

## 📚 문서 인덱스

### 큰그림·아키텍처
- [docs/architecture.md](docs/architecture.md) — **시스템 전체 그림** (시작 추천)
- [docs/pipeline_guide.md](docs/pipeline_guide.md) — **파이프라인 실전 가이드**: 4개 데이터 소스 역할·라이브 예측 흐름·핵심 스크립트·전체 명령어. ⚠️ 새 스크립트·학습·검증 방법 추가 시 갱신
- [docs/data_flow.md](docs/data_flow.md) — **KRA API → DuckDB → ScoreEngine → Gate A/B → Benchmark → UI 전체 파이프라인** (2026-06-12 갱신)
- [docs/data_lifecycle.md](docs/data_lifecycle.md) — 출마표 발표·결과 도착 시점

### 알고리즘·예측
- [docs/score_algorithm.md](docs/score_algorithm.md) — 알고리즘 흐름 + **수정 가이드** (항목 목록·비중·산식은 roadmap·score_items 위임)
- [docs/score_roadmap.md](docs/score_roadmap.md) — **평가항목 고도화 로드맵** (클린 슬레이트 비교·변경 이력 Living Doc)
- [docs/prediction_mode.md](docs/prediction_mode.md) — 사전/사후 데이터 소스 차이
- [docs/accuracy_metrics.md](docs/accuracy_metrics.md) — **지표 관리 통합 문서**: 적중률 4개 지표 + Gate A/B 검증 표준 + 멀티모델 벤치마크 레이어. ⚠️ 새 검증/학습 방법 추가 시 이 문서도 갱신

### 화면·기능
- [docs/PRD_v6.1_entries_view.md](docs/PRD_v6.1_entries_view.md) — 출마정보 화면 PRD
- [docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md) — 에이스경마 1-34번 매핑

> **UI 현황 (2026-05-31):** 예상지 = 모바일 2+2 그리드 / 데스크탑 4열(`grid-cols-2 md:[grid-template-columns:2fr_1.2fr_3fr_2fr]`). 아코디언 레이아웃 미사용(사용자 확인). Col5Items = 가중치 상위 5개 동적 표시. RaceInfoBlock 공통 헤더(3개 화면 공유), 조교 이력 추가 완료. 대시보드 개발 용어 제거·모바일 버튼 개선 완료. **로딩 스켈레톤(U-001) 완료** — Loader2 스피너 → 4열 HorseCardSkeleton 8개. `lib/sectional.ts` 공통 유틸(getSectionalInfo·fmtSec·computeSameDistStats) 분리 완료. RaceEntries JockeyPanel(조합이력·최근3개월폼)·HorsePanel(구간기록·같은거리기록·조교·진료) 개선 완료.
>
> **HorseCard 컬럼 순서:** Col1=**마정보**(2fr) · Col2=**기수정보**(1.2fr) · Col3=**직전경주**(3fr) · Col4=**베팅조합**(2fr). skeleton·레이아웃 작업 시 혼동 주의.
>
> **구간기록 유틸:** `client/src/lib/sectional.ts` — `getSectionalInfo(entry)`, `fmtSec(t)`, `computeSameDistStats(history, dist)`. PredictionSheet·RaceEntries 공유. 페이지 파일에 재구현 금지.
>
> **training_logs 주의:** `st_time`/`sp_time`은 YYYYMMDDHHmmss 타임스탬프 (훈련 시작/종료 시각). 실제 소요시간은 `tr_term`(초). `pr_gubun` 범례: 이름=기수, 조=조교사, 관=주로조교, 생=교육생, 이름(트)=기수트랙라이더.

### 운영·디버깅
- [docs/api_spec.md](docs/api_spec.md) — **API 전체 명세 (SSOT)**: KRA 9개 엔드포인트·Supabase 스키마·React Query 훅·Claude API. ⚠️ **API 변경(엔드포인트·파라미터·필드·스키마) 시 이 문서를 함께 갱신**
- [docs/kra_api_quirks.md](docs/kra_api_quirks.md) — KRA API 컬럼명 함정
- [docs/troubleshooting.md](docs/troubleshooting.md) — 현재 발견된 의문·수정점
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 배포 메모

### 세션 인계 (새 세션 정독 추천)
- [docs/working_style.md](docs/working_style.md) — **시니어 개발자 + 설계자 관점, 협업 패턴**
- [docs/running_style_insight.md](docs/running_style_insight.md) — 주행 성향 분류 큰그림·현재 위치·다음 단계 (⑤⑥⑫⑲ 완료 / ⑲ 스코어맵 재설계 대기)
- [docs/session_history.md](docs/session_history.md) — 세션별 작업 히스토리 (2026-06-02 ~ 현재)

### 할일
- [TODO.md](TODO.md) — 우선순위별 할일

---

## ⚠️ 현재 실행 상태 (2026-06-25)

**▶ 2026-06-25 세션 완료 — C. 선별 표시·베팅 구현 (브랜치 `feat/selective-picks`):**
- **무엇:** 적중률 향상 트랙 C 채택. Platt `p_top3`(연승 보정확률)로 개별 마에 **강추/주목 2단계** 라벨 → UI 뱃지 + `/picks` '오늘의 강추' 뷰 + 통계 "선별 적중률" 섹션. **랭킹·예측 파이프라인 불변(읽기 레이어만)**. 위험 0. brainstorm→spec→plan→subagent-driven Task1~8. 스펙/플랜 `docs/superpowers/{specs,plans}/2026-06-25-selective-picks*`.
- **임계값(데이터 확정, 균형안):** `npm run probe:picks` 곡선 → **강추 p_top3≥0.72, 주목 ≥0.62**. 단일출처 `client/src/config/selective_picks.json`(튜닝 잦은 값=설정). track 실측(사후 38,518행): **강추 357건 연승 73.1%·커버 8.9% / 주목 1,207건 연승 65.4%·커버 26.8%** (베이스라인 연승 28.4% 대비 **+44.7/+37.0%p**). 표본 큰 평탄구간 채택(0.85↑는 10건 이하 과소적합 제외).
- **신규 코드:** `src/engine/eval/selectivePicks.ts`(순수 SSOT: classifyTier·buildSelectionCurve·tierAccuracy·pickThreshold) · `scripts/probe_selective_picks.ts`(`npm run probe:picks` — 곡선/`--strong H --watch H --write`/`--track`/`--from`, **로컬 DuckDB egress 0**) · `client/src/lib/selectivePicks.ts`·`components/PickBadge.tsx`·`pages/TodayPicks.tsx`(`/picks`) · 통계 `useSelectivePickAccuracy`. 임계값 바꾸려면 probe `--write` 또는 config 직접 수정 후 클라이언트 빌드.
- **🔲 남음:** ① 시각 확인(`/picks`·뱃지·통계 섹션 — Vercel/로컬). ② `feat/selective-picks` → main 머지 결정. ③ 병행 권고였던 **B. 조건부 엣지 마이닝** 재탐색은 미착수.
- 상세 [[project_selective_picks]] · 배경 [[project_market_edge_strategy]].

**🟢 다음 세션 시작 질문 (지난 지시, 이번에 C로 해소됨):** "다음 뭐 할까"로 시작하면 '적중률 향상 방향' 질문(A.시장블렌드 / B.조건부엣지 / C.선별표시). 이번 세션 **C 구현 완료** → 다음 후보는 B 재탐색 또는 선별 트랙 고도화(선별 베팅 ROI·엑조틱). 상세 [[project_market_edge_strategy]] · [[project_market_dominance_ceiling]].

**▶ 2026-06-22 세션 추가 완료:**
- **라이브 흐름 실습 검증** — 6/21 출마표+사전예측(`npm run sync:cards -- --date 20260621`)이 `predictRace` 자동호출로 predictions에 **Platt 확률(p_win/p_top3) 포함** 정상 기록(actual=NULL 사전모드). `sync:cards`=출마표+예측 한방, `sync`(dailySync)=결과+사후예측. ⚠️ npm 인자전달은 `npm run sync -- --date YYYYMMDD`(구분자 `--`, `==` 아님). 결과(API214_1)는 경기 후에만 옴.

**▶ 2026-06-20 세션 완료:**
- **✅ Platt 라이브 캘리브레이션 배포 완료** — backfill·머지·db:pull 3단계 끝(아래 Platt 섹션 "✅ 배포 완료"). 브랜치 main 머지됨. predictions p_win/p_top3 라이브.
- **✅ 조교 로그 라이브 현행화** — backfill은 로컬에만 쓰므로 라이브 Supabase `training_logs`는 옛 6,540행뿐이었음. **신규 `scripts/upload_training_logs.ts`(`npm run training:upload`)** = JSONL→Supabase pg직결 멱등 upsert. **6,540→376,372행**(2025-06-01~2026-06-20). 커밋 `0963c2b`(main push). 2단계 흐름: backfill(KRA→로컬 JSONL/DuckDB) → upload(JSONL→Supabase). ⚠️ db:pull은 로컬 training_logs를 덮으나 JSONL 원천서 복원. 상세 [[project_training_signals]].
- **남은 레버:** 조교 *다른* 조작화(흡수 입증 후 기대↓) · 마체중 D1. 공개피처+승/연승 시장격파는 종결([[project_market_dominance_ceiling]]).

**브랜치:** `main` (feat/duckdb-local-mirror 머지 완료 2026-06-20)  
**Supabase:** egress 결제주기 2026-06-23 리셋. **단 `DATABASE_URL` Postgres 직결은 egress 무관** — 2026-06-20 db:pull·SQL·조교 376k upsert 전부 정상. REST/웹앱만 egress 영향.  
**활성 모델:** id=6 (v6-class-move, logistic) — DuckDB is_active 확인(2026-06-14). 벤치 연승 62.5% / 단승 30.6% / 시장 68.2%(−5.7%p)  
**DuckDB 스펙:** `docs/superpowers/specs/2026-06-12-duckdb-local-mirror-design.md`  
**Benchmark 스크립트:** `scripts/benchmark_all.ts` — `npm run benchmark`. **롤링 통합 완료(2026-06-14).**  
**롤링 통합 완료 (2026-06-14):** benchmark가 walkforward 흡수 → `walkforward_eval.ts` 삭제. 분기 확장윈도우 9모델 + 챔피언(model_versions) 대결 + 시장 깊은 진단(불일치·순위별·묶음). CLI `--gate-only`/`--no-gate`/`--champion <id>`. 코드 `src/engine/eval/`. 실측: 챔피언 롤링 연승 61.4%(시장 68.8%, −7.4%p). 스펙/플랜 `docs/superpowers/{specs,plans}/2026-06-14-rolling-benchmark-integration*`.

**▶ 2026-06-19 세션 인수인계 (다음 세션 여기부터):**
- **조교 갭 backfill 완료 → 통제 A/B → 흡수 확정(채택 X).** 사용자가 갭(2026-02~05) 메워 커버리지 2025-06~2026-06 풀(766 date-meet). `npm run benchmark --gate-only` 클린런서 train_signal 게이트B 연승 **+1.8%p 재현**(top3 항목). **그러나 통제 A/B**(`_probe_train_signal_ab`, 같은 logistic top3, 조교 ON/OFF만 토글, 6분기 OOS): 연승 Δ **−0.12%p**(분기 부호 3+/3− 혼재), 단승 −0.04%p. → **게이트B +1.8%p는 통합효과 아님 = 흡수. 조교(현 train_signal 형태) 채택 X.** 이론검증 D2 흡수위험 실현 = 메타패턴 #2(실측신호≠모델가치, draw×거리 §C5와 동형) 재현. 기록 `docs/train_signal_ab_20260619.txt` + `docs/strategy/2026-06-17-ceiling-attempts-theoretical-review.md` D2.
- **⚠️ 게이트B 한계기여 과대보고 의심** — 게이트B(+1.8%p) vs 통제 A/B(−0.12%p) 괴리. **승격 판정은 통제 A/B(같은 스펙 토글)로 해야 정확.** class_move·⑳ 등 과거 게이트B 채택도 통제 A/B 재검 권장(별건, 단 class_move는 라이브 클린 별도확인됨).
- **남은 레버(우선순위):** ⓪ Platt 라이브(C2/B-4 — **유일하게 통제까지 통과한 양성**, 정직성/서비스, 설계 `3b3503c` → 아래 구현 완료) / 조교 *다른* 조작화(강도·간격 등 recent_form이 못 담는 각도) · 마체중 D1 — 단 흡수 입증 후라 기대↓.

**▶ Platt 라이브 연결 — 코드·프로덕션 fit 완료, 백필+배포만 남음 (2026-06-19, 별도 세션):**
- **무엇:** §C8 양성(재보정)을 라이브에 연결 = 첫 서비스 캘리브레이션. brainstorm→spec→plan→subagent-driven Task1~7. 스펙/플랜 `docs/superpowers/{specs,plans}/2026-06-19-platt-live-calibration*`.
- **접근법 A:** 기존 top3 랭킹모델 **불변** + P1 전용모델·Platt 2개를 `model_versions.artifact.calibration`에 임베드. `predictRace`가 `p_win`(우승)·`p_top3`(연승) 산출(**랭킹 불변**) → predictions 저장 → UI(PredictionSheet·RaceEntries) "우승 N%·연승 M%" 표시. **renormWin=false 확정**(calib:recal: plain Platt P1착 ECE **0.003**<시장 0.004<원본 0.016).
- **신규 코드:** `src/engine/eval/calibratedProbs.ts`(순수) · `src/engine/scorePredictor.ts`(p_win/p_top3) · `scripts/fit_live_calibration.ts`(`npm run calib:fit-live` — **Supabase jsonb 기록**, 로컬 DuckDB는 STRUCT추론이라 calibration 유실→`db:pull`로 갱신) · 마이그 `014_prediction_calibrated_probs.sql` · UI 3파일. 커밋 `91fc036`~`00aa753`(브랜치 feat/duckdb-local-mirror).
- **✅ 완료:** 코드 5단계(402 테스트·빌드 클린) · Supabase id=6에 calibration 기록(platt1 a1.279/b0.540·platt3 a1.057/b0.046) · 라이브 검증(샘플경주 본명 p_win 45%·Σ≈100%·랭킹불변) · 마이그 014 Supabase 적용(사용자).
- **✅ 배포 완료 (2026-06-20):** ① backfill 완료 — predictions p_win/p_top3 **39,331행 100%**(경주별 Σ≈1.0, 본명마 최댓값, 검증통과). ② **`feat/duckdb-local-mirror` → main fast-forward 머지+push 완료**(`finishing-a-development-branch`, 138커밋, Vercel 자동배포 트리거). ③ db:pull 동기화 + **calibration 보존 검증**(Postgres 직결은 STRUCT추론으로도 유실 X — line 183 우려는 REST 폴백 한정. platt1 a1.279/b0.540·platt3 a1.057/b0.046 로컬 일치). 상세 [[project_market_edge_strategy]] · [[project_duckdb_local_mirror]].
  - **🔲 남은 사용자 확인(안 급함):** Vercel 빌드 초록불 + 라이브 UI "우승%·연승%" 표시 + 조교 이력 패널.

**▶ 2026-06-18 세션 인수인계:**
- **Benter 2단계 음성 종결** — 롤링 6분기 OOS 2,559경주+유의성 probe. 방향은 실재(b 6/6분기 양수 p=0.031)이나 크기 0(Δ=+0.00035, 95%CI 0포함 p=0.43)·감쇠(b 0.32→0.13). "실재하나 무가치한 엣지" → 공개피처+시장블렌드 트랙 완전종결. 기록 `docs/benter_twostage_20260617.txt`·`benter_significance_20260617.txt`. 커밋 f51da87·8153453.
- **조교(training) 신호 backfill 착수 — 반공개 본류:** 친구 키(`KRA_API_KEY_FRIEND`)로 266,657행 적재(2025-06~2026-01 + 2026-05-18~06-18). **갭 2026-02~2026-05-17 미수집**(친구 키 쿼터소진). 내 키는 아직 쿼터 미복구(2026-06-18 확인).
- **버그 2건 수정:** ① backfill이 data.go.kr 소프트 스로틀(HTTP200 SOAP `LIMITED_NUMBER`)을 일반에러로 5회재시도·오분류 → `isQuotaSignal` 즉시중단+`errSink` 가시화(커밋 80ce526). ② **hr_no JSON 타입 추론 → 조교 피처 통째 누락**(KRA가 hrNo 문자열/숫자 혼재 → read_json_auto JSON추론 → IN비교 "Malformed JSON: number with leading zero"). `toTrainingRow` 7자리 패딩+마이그+회귀테스트(커밋 다음).
- **예비 게이트 양성(미확정):** train_signal 게이트B 연승 **+1.8%p**(②마체중·⑫출발 동급, 의료신호~0과 대조). **단 커버리지 8/12개월 → 갭 메운 클린런 전 채택 X.**
- **★다음:** 쿼터 복구 후 갭 backfill(`scripts/backfill_training.ts --from 20250601 --to 20260517`, 548 skip→갭부터) → `npm run benchmark` 클린런 → train_signal 채택 판정. 양성이면 첫 반공개 신호 채택. 상세 [[project_training_signals]].

**▶ 2026-06-16 세션 인수인계:**
- **공개 피처 발굴 3건 음성으로 종결** — ① fade/복승 보조채택(게이트 Phase0서 후보0, 스펙/플랜 `2026-06-15-gate-aux-adoption*` CLOSED-null) ② ⑪ 긴요양 골짜기(91-180일 우승 5.7% 실재하나 헤드라인 불변, 되돌림) ③ ⑲ SCORE_MAP 교정(`b842c61`, 레거시용·라이브무관, Spearman 61.8→61.5 노이즈). 셋 다 **흡수 천장** 재확인.
- **⑲ 스코어맵 종결:** SCORE_MAP=죽은코드(라이브 로지스틱은 buildFeatures one-hot으로 직접학습). "재설계 대기" 아님 — 종결.
- **신규 산출물:** `docs/feature_hypotheses.md`(가설 카탈로그: 재도전7·현역재검2·탈락확정·메타패턴) + `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md`(방법론 전환 전략).
- **방향 전환:** "공개 피처 더 짜기" 중단 → 4갈래(서비스 캘리브레이션 / 반공개 신호 / 조건부 엣지 / Benter 2단계). 상세 [[project_market_edge_strategy]].
- **✅ 웹 검증 완료(2026-06-16):** 전략문서 ⚠️ 4항목 외부출처 확인. **반증 1건: KRA 엑조틱 공제율 26% > 단복승 20%** → 엑조틱이 오히려 더 어려움(A4(d) 하향). 나머지(공제율 높음·dirt-only·Benter 2단계 구조차이·draw 안쪽우위) 기존 서술 확증. 검증로그 = 전략문서 끝.

**브랜치 상태 (2026-06-12 세션 완료):**
- `gatherRaceInputs` / `predictRace` → `ReadClient` 추상화 완료 (`src/engine/scorePredictor.ts` 외 관련 파일)
- `scripts/benchmark_all.ts` 신규 (560줄): collectRaces → Gate A(상관계수) → Gate B(연승률 개선) → 9개 모델 학습 → 평가 → ASCII 리포트
- 스펙: `docs/superpowers/specs/2026-06-12-multi-model-benchmark-design.md`
- 플랜: `docs/superpowers/plans/2026-06-12-multi-model-benchmark.md`

**다음 단계 (우선순위 — 2026-06-16 갱신):**
1. **조교(training) 신호** — 본류. KRA 전체서비스 복구(**6/17 09:00**) 후 사용자가 `scripts/backfill_training.ts` 실행(쿼터벽=최근12개월 먼저) → 커버리지 → `npm run benchmark` 게이트A/B. 코드 Task1~6 완료(325테스트). [[project_training_signals]]
2. **방법론 전환 후보 (각각 구현 전 brainstorm)** — ✅완료: ~~조건부 엣지 마이닝~~(§C6, 채택후보 0) · ~~캘리브레이션 평가축~~(§C7) · ~~재보정 Platt/isotonic~~(`npm run calib:recal`, §C8, **✅ Platt이 P(1착) ECE 0.017→0.004 시장동률**·정직성만 따라잡음) · ~~적중률 7각도 천장검증~~(§C9, **전부 음성**) · ~~**Benter 2단계(예측 정확도판)**~~ **✅ 음성 종결(2026-06-17)** — `benter_twostage`(롤링 6분기 OOS 2,559경주)+유의성 probe. **뉘앙스**: 방향은 실재(logistic b 6/6분기 양수, 부호검정 p=0.031)이나 크기는 0(합성−시장 우승확률 Δ=+0.00035, 95%CI [−0.0034,+0.0040] 0포함, p=0.43; 단승 37.7=37.7·연승 68.9≈69.0)이고 b 0.32→0.13 감쇠. **"실재하나 무가치한 엣지 = 균열은 보였으나 돌파 아님"** → 공개피처+시장블렌드 트랙 **완전종결**. 인사이트=`docs/benter_twostage_20260617.txt`+[[project_market_edge_strategy]]. **★다음 1순위 = ⓪ Platt 라이브 연결(서비스 캘리브레이션, §C8 양성) → 조교 신호(반공개 본류) → 마체중 직전수집.** 남은 엣지는 반공개 신호뿐.
3. ~~웹 검증 보강~~ **✅ 완료(2026-06-16)** — 전략문서 ⚠️ 4항목 외부출처 확인. **핵심 수정: KRA 엑조틱 공제율 26% > 단복승 20%** (엑조틱이 더 어려움, A4(d) 기대 하향). 공제율(단연 20/그외 26)·dirt-only·Benter 2단계 구조·draw편향(단거리 안쪽 35~38%) 확증. 검증로그 = `docs/strategy/2026-06-16-*` 문서 끝.
4. **model_versions 스키마 영구화** (6/23 이후) — `feature_schema`/`params` Supabase 반영 + 챔피언 artifact 저장.
5. **복승 배당 결손** — 2026-05-10~06-05 미수집 (6/23 이후 친구 키로 보충)

**롤백:** 이전 model_version id로 promote

> 세션별 상세 히스토리 → [docs/session_history.md](docs/session_history.md)

항목별 상태(완료/진행/ρ 값/개선 후보)는 아래 문서가 **단일 출처(SSOT)**입니다. 여기에 중복 기재하지 않습니다.

- **할일·우선순위** → [TODO.md](TODO.md) (P0~P3 + 런치 게이팅 + 의문 Q)
- **21항목 ρ·가중치·개선 상태** → [docs/score_roadmap.md](docs/score_roadmap.md) (Living Doc, §1 마스터 상태표)
- **의문·검토 중** → [docs/troubleshooting.md](docs/troubleshooting.md)

> 현재 최우선 개선 후보: ⑧ 부담중량 산식(ρ=0.316, 자문 대기). (⑲ 스코어맵은 2026-06-16 종결 — SCORE_MAP=죽은코드, 로지스틱이 직접학습) 상세는 위 문서 참조.

---

## DB 현황 (2026-05-30 기준)

| 테이블/뷰 | rows |
|---|---|
| race_entries | 37,453 |
| races | 3,585 |
| predictions | 38,517 |
| training_logs | 6,540 |
| jockey_stats | 59 (서울 34·부경 25) |
| horses | 2,864 (모두 혈통 있음) |

서울 구간기록 backfill: 2024 100% / 2025 97.3% / 2026 97.9% (부경 99.9%) — 에러 ~3%는 KRA 원천 없음

**race_entries 구간 컬럼 현황 (2026-05-30):**
- 서울: 누적시간(se_s1f/g1f/g3f/1c~4c) + 순위(sj_s1f/g1f/g3f/1c~4c) ✅
- 부경: 누적시간(bu_s1f/g1f~g8f) + 순위(bu_g1f~g4f/s1f) + **개별 구간 타임(bu_s1f_time/bu_1fg~bu_10_8f_time) ✅ 신규**
- 부경 G5f·G6f·G7f·G8f 순위: KRA API 미제공 (구조적 공백)
