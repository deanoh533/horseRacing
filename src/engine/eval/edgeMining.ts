export interface SegmentLabels {
  favOddsBand: string;
  fieldBand: string;
  distBand: string;
  disagreeStrength: string;
}

/** 한 경주의 조건 라벨. 임계값은 2026-06-16 probe로 확정(스펙 §4.1). */
export function conditionRace(p: {
  favWinOdds: number;
  fieldSize: number;
  rcDist: number;
  favModelRank: number; // 1-based: 인기1위가 모델 순위에서 몇 등인가
}): SegmentLabels {
  // 배당대 경계 = 인기1위 win_odds 분위수(2026-06-16 probe: p25=1.8·p50=2.3·p75=2.9).
  const favOddsBand =
    p.favWinOdds <= 1.8 ? 'fav<=1.8'
    : p.favWinOdds <= 2.3 ? 'fav1.8-2.3'
    : p.favWinOdds <= 2.9 ? 'fav2.3-2.9'
    : 'fav>2.9';
  const fieldBand =
    p.fieldSize <= 9 ? 'field<=9'
    : p.fieldSize <= 11 ? 'field10-11'
    : 'field>=12';
  const distBand =
    p.rcDist <= 1400 ? 'dist<=1400'
    : p.rcDist <= 1700 ? 'dist1401-1700'
    : 'dist>1700';
  const disagreeStrength =
    p.favModelRank <= 2 ? 'dis2'
    : p.favModelRank === 3 ? 'dis3'
    : 'dis>=4';
  return { favOddsBand, fieldBand, distBand, disagreeStrength };
}
