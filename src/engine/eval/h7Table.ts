/**
 * H7 교차표 빌더 — probe H9 SQL 결과 행을 검증·클린 라벨로 변환해 정적 JSON 구조를 만든다.
 * 소비처: scripts/export_h7_table.ts → client/src/data/h7_table.json → /insights 페이지.
 * 스펙: docs/superpowers/specs/2026-07-18-h7-insights-design.md §2
 */
export const GAP_BUCKETS = ['~0.5초', '~1.0초', '~1.5초', '1.5초+'] as const;
export const ACHIEVE_BUCKETS = ['낮음(~30%)', '중간(30~70%)', '높음(70%+)'] as const;
export type GapBucket = (typeof GAP_BUCKETS)[number];
export type AchieveBucket = (typeof ACHIEVE_BUCKETS)[number];

// probe H9 SQL의 정렬용 접두 라벨 → 클린 라벨
const GAP_FROM_SQL: Record<string, GapBucket> = {
  'a. ~0.5초': '~0.5초', 'b. ~1.0초': '~1.0초', 'c. ~1.5초': '~1.5초', 'd. 1.5초+': '1.5초+',
};
const ACH_FROM_SQL: Record<string, AchieveBucket> = {
  '1_낮음(~30%)': '낮음(~30%)', '2_중간(30~70%)': '중간(30~70%)', '3_높음(70%+)': '높음(70%+)',
};

export interface H7SqlRow {
  gapBucket: string;
  achieveBucket: string;
  starts: number;
  winRate: number;   // 0~1
  placeRate: number; // 0~1
}

export interface H7Cell {
  gapBucket: GapBucket;
  achieveBucket: AchieveBucket;
  starts: number;
  winRate: number;
  placeRate: number;
}

export interface H7Table {
  generatedAt: string;
  raceDateFrom: number;
  raceDateTo: number;
  totalStarts: number;
  formula: string;
  cells: H7Cell[];
}

const FORMULA =
  '격차=예측 G3F 시간차(as-of 이력) · 달성확률=필요 종반속도 달성 확률(개체 이력 정규근사)';

export function buildH7Table(
  rows: H7SqlRow[],
  meta: { generatedAt: string; raceDateFrom: number; raceDateTo: number }
): H7Table {
  const seen = new Set<string>();
  const cells: H7Cell[] = rows.map((r) => {
    const gap = GAP_FROM_SQL[r.gapBucket];
    const ach = ACH_FROM_SQL[r.achieveBucket];
    if (!gap || !ach) throw new Error(`미지 버킷 라벨: ${r.gapBucket} / ${r.achieveBucket}`);
    const key = `${gap}|${ach}`;
    if (seen.has(key)) throw new Error(`중복 칸: ${key}`);
    seen.add(key);
    if (!(r.starts > 0)) throw new Error(`starts 비정상 (${key}): ${r.starts}`);
    for (const [name, v] of [['winRate', r.winRate], ['placeRate', r.placeRate]] as const) {
      if (!(v >= 0 && v <= 1)) throw new Error(`${name} 범위 밖 (${key}): ${v}`);
    }
    return { gapBucket: gap, achieveBucket: ach, starts: r.starts, winRate: r.winRate, placeRate: r.placeRate };
  });
  if (cells.length !== 12) throw new Error(`칸 수 ${cells.length} ≠ 12 (격차 4 × 달성확률 3)`);
  return {
    ...meta,
    totalStarts: cells.reduce((s, c) => s + c.starts, 0),
    formula: FORMULA,
    cells,
  };
}
