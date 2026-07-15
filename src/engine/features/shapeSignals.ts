/**
 * 경주 전개(race shape) 신호 — 순수 계산.
 * 스펙: docs/superpowers/specs/2026-07-08-race-shape-features-design.md §2
 * probe 원형: scripts/probe_race_shape.ts H6·H9.
 * 오늘 경주의 par는 두 신호 모두에서 상쇄되므로 par는 과거 이력 환산에만 쓰인다.
 */

export type ShapeParMap = Map<string, { par3: number; par6: number }>;

export function shapeParKey(meet: number, rcDist: number): string {
  return `${meet}|${rcDist}`;
}

export interface ShapeHistRace {
  meet: number;
  rcDist: number | null;
  rcTime: number | null;
  g3fAcc: number | null;
}

export interface HorseShapeStats {
  meanD3: number;          // G3F 누적시간의 par 대비 편차 평균 (n≥2)
  meanD6: number;          // 종반 600m의 par 대비 편차 평균 (n≥2)
  stdD6: number | null;    // 표본표준편차 (n≥3 아니면 null)
  n: number;
}

const FIN600_MIN = 30;
const FIN600_MAX = 60;
const STD_FLOOR = 0.1;   // 측정 노이즈 미만 편차의 z 폭발 방지
const PHI_SLOPE = 1.702; // 정규 CDF 로지스틱 근사 계수

function sampleStd(values: number[]): number | null {
  if (values.length < 3) return null;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const ss = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

export function horseShapeStats(rows: ShapeHistRace[], par: ShapeParMap): HorseShapeStats | null {
  const d3s: number[] = [];
  const d6s: number[] = [];
  for (const r of rows) {
    if (r.rcDist == null || r.rcTime == null || r.g3fAcc == null) continue;
    if (!(r.rcTime > 0) || !(r.g3fAcc > 0)) continue;
    const fin600 = r.rcTime - r.g3fAcc;
    if (fin600 < FIN600_MIN || fin600 > FIN600_MAX) continue;
    const p = par.get(shapeParKey(r.meet, r.rcDist));
    if (!p) continue;
    d3s.push(r.g3fAcc - p.par3);
    d6s.push(fin600 - p.par6);
  }
  if (d3s.length < 2) return null;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { meanD3: mean(d3s), meanD6: mean(d6s), stdD6: sampleStd(d6s), n: d3s.length };
}

export interface ShapeSignal {
  predGap: number;           // 예측 격차(초). 예측 선두 = 0
  pAchieve: number | null;   // 필요속도 달성확률(순위 재료). stdD6 없으면 null
}

/** 경주 단위: 출주마 전원의 stats(순서 유지) → 말별 신호. stats 보유 말 < 2면 전원 null. */
export function raceShapeSignals(stats: (HorseShapeStats | null)[]): (ShapeSignal | null)[] {
  const present = stats.filter((s): s is HorseShapeStats => s !== null);
  if (present.length < 2) return stats.map(() => null);

  let leader = present[0]!;
  for (const s of present) if (s.meanD3 < leader.meanD3) leader = s;

  return stats.map((s) => {
    if (s === null) return null;
    const predGap = s.meanD3 - leader.meanD3;
    if (s.stdD6 === null) return { predGap, pAchieve: null };
    const required = leader.meanD6 - predGap;
    const z = (required - s.meanD6) / Math.max(s.stdD6, STD_FLOOR);
    return { predGap, pAchieve: 1 / (1 + Math.exp(-PHI_SLOPE * z)) };
  });
}
