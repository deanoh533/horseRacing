// src/engine/eval/v7Accuracy.ts
/**
 * v7 라이브 적중률 판정 — 순수 로직.
 * predictions(수요일 사전 예측, 무변경)과 race_entries(금요일 결과 ord)를
 * 클라이언트에서 조인한 뒤, 강추/주목/전체 티어별 연승(3착내) 적중률을
 * model_version별로 계산한다.
 *
 * I/O 없음(테스트 용이) — DB 조회는 scripts/probe_v7_accuracy.ts가 담당.
 * race_entries.ord를 직접 조인하는 이유(가장 정직한 원천):
 *   predictions.actual_ord는 dailySync가 이미 race_entries.ord로 채워두지만,
 *   이 판정 스크립트는 스펙(§3.4/§4)이 지정한 원본 결과 테이블을 다시 조인해
 *   기록 경로에 의존하지 않고 독립적으로 검증한다.
 *
 * 설계: docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md
 * 티어 분류(classifyTier)는 src/engine/eval/selectivePicks.ts와 동일 경계를 재사용한다
 * (강추≥strongMin, 주목=[watchMin, strongMin) 배타 — 화면 표시와 동일 규칙).
 */
import { classifyTier, type PredRow } from './selectivePicks.js';

export interface PredictionSlim {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  p_top3: number | null;
  model_version: number | null;
}

export interface ResultSlim {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  ord: number | null;
}

export interface JoinedRow extends PredRow {
  model_version: number | null;
}

const rowKey = (r: { race_date: number; meet: number; rc_no: number; hr_name: string }): string =>
  `${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`;

/**
 * predictions × race_entries(ord) 클라이언트 조인.
 * 매칭되는 race_entries 행이 없거나 ord가 NULL(결과 미도착·실격 등)이면 actual_ord=null.
 */
export function joinResults(preds: PredictionSlim[], results: ResultSlim[]): JoinedRow[] {
  const ordMap = new Map<string, number | null>();
  for (const r of results) ordMap.set(rowKey(r), r.ord);
  return preds.map((p) => ({
    race_date: p.race_date,
    meet: p.meet,
    rc_no: p.rc_no,
    p_top3: p.p_top3,
    p_win: null,
    actual_ord: ordMap.get(rowKey(p)) ?? null,
    model_version: p.model_version,
  }));
}

export interface TierRow {
  category: '강추' | '주목' | '전체';
  total: number;
  correct: number;
  accuracy: number; // 퍼센트, 소수점 1자리
}

const isHit = (r: PredRow): boolean => r.actual_ord != null && r.actual_ord >= 1 && r.actual_ord <= 3;
const pct = (correct: number, total: number): number =>
  total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;

/**
 * 결과 도착(actual_ord != null) 행만 대상으로 강추/주목/전체 3개 카테고리 집계.
 * 결과 미도착 행은 세 카테고리 모두에서 제외한다.
 */
export function computeTiers(rows: PredRow[], strongMin: number, watchMin: number): TierRow[] {
  const resolved = rows.filter((r) => r.actual_ord != null && r.p_top3 != null);
  const strongRows: PredRow[] = [];
  const watchRows: PredRow[] = [];
  for (const r of resolved) {
    const tier = classifyTier(r.p_top3, strongMin, watchMin);
    if (tier === 'strong') strongRows.push(r);
    else if (tier === 'watch') watchRows.push(r);
  }
  const stat = (category: TierRow['category'], sel: PredRow[]): TierRow => {
    const correct = sel.filter(isHit).length;
    return { category, total: sel.length, correct, accuracy: pct(correct, sel.length) };
  };
  return [
    stat('강추', strongRows),
    stat('주목', watchRows),
    stat('전체', resolved),
  ];
}

export interface VersionTiers {
  modelVersion: number | null;
  tiers: TierRow[];
}

/** model_version별로 분리 집계(오름차순, null=활성버전 미도장 v1-fallback은 마지막). */
export function computeTiersByVersion(
  rows: JoinedRow[],
  strongMin: number,
  watchMin: number,
): VersionTiers[] {
  const byVersion = new Map<number | null, JoinedRow[]>();
  for (const r of rows) {
    const key = r.model_version;
    const bucket = byVersion.get(key);
    if (bucket) bucket.push(r);
    else byVersion.set(key, [r]);
  }
  const versions = [...byVersion.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  return versions.map((v) => ({
    modelVersion: v,
    tiers: computeTiers(byVersion.get(v)!, strongMin, watchMin),
  }));
}
