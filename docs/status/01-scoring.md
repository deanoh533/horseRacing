# 점수·알고리즘 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_score_roadmap]], [[project_running_style_classification]], [[project_running_style_pace_map]], [[project_weight_versioning]], [[reference_running_style_insight_doc]]

## 현재 상태
21개 항목 raw(0~1) → 라이브 로지스틱이 buildFeatures one-hot으로 직접 학습(Spearman 가중치는 레거시). 활성 산식 안정. 항목별 ρ·가중치·개선상태 SSOT = [docs/score_roadmap.md](../score_roadmap.md) §1 마스터 상태표.

## 다음 후보·남음
- 🔲 최우선: ⑧ 부담중량 산식 개선 (ρ=0.316, 전문가 자문 대기) → TODO T-005
- 🔲 ⑭ 혈통 활성화 — 데이터 확보 후 → TODO T-005
- 🔲 ㉚ 절대능력지수 — KRA 등급변동 API(#15058076) 조사 → TODO T-012
- 🔲 PRD legend derived 5개 → TODO T-011
- 🔲 의문: ⑤ 후반구간 시작점·Spearman 윈도우·학습 빈도 → TODO Q-001~003

## 종결·기각 (요약)
- ✅ 가중치 버전관리 + look-ahead 누수 수정 (2026-06-02) — 옛 적중률 거짓, 정직값 복승 ~58%. `asOfHorseStats.ts`. [[project_weight_versioning]]
- ❌ 수득상금(earnings) 차원 — 예측력 0, 재설계 "+5.2%p"는 전부 미래누수였음 (2026-06-06). [[reference_earnings_asof_leak]]
- 🔚 ⑲ 스코어맵 종결 (2026-06-16) — SCORE_MAP=죽은코드, 로지스틱이 one-hot 직접학습. 재설계 불필요. [[project_running_style_pace_map]]

## 참고
- 문서: [score_roadmap.md](../score_roadmap.md), [score_algorithm.md](../score_algorithm.md), [running_style_insight.md](../running_style_insight.md)
- 할일: [TODO.md](../../TODO.md) (T-005·T-011·T-012·Q-001~003)
