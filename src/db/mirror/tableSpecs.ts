/**
 * db:pull 테이블별 동기화 전략 (SSOT).
 * 근거·행수는 spec docs/superpowers/specs/2026-09-29-db-pull-incremental-design.md §4.
 */

export interface IncrementalSpec {
  mode: 'incremental';
  /** 날짜 키 컬럼 — PK 앞자리이며 인덱스가 있다 */
  dateCol: string;
  /** 지문 정렬 키 = PK에서 dateCol을 뺀 나머지. 순서가 흔들리면 해시가 달라지므로 고정. */
  orderCols: string[];
}

export interface FullSpec {
  mode: 'full';
  /** 뷰는 날짜 키가 없어 증분 자체가 불가 — 로그·문서용 구분 */
  isView?: boolean;
}

export type TableSpec = IncrementalSpec | FullSpec;

export function isIncremental(s: TableSpec): s is IncrementalSpec {
  return s.mode === 'incremental';
}

export const TABLE_SPECS: Record<string, TableSpec> = {
  // ── 증분 (날짜 키가 PK 앞자리) ──
  race_entries:       { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'pthr_no'] },
  predictions:        { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'hr_name', 'model_version'] },
  training_logs:      { mode: 'incremental', dateCol: 'train_date', orderCols: ['meet', 'hr_no', 'part'] },
  combo_dividends:    { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'pool', 'leg1', 'leg2', 'leg3'] },
  shadow_predictions: { mode: 'incremental', dateCol: 'race_date',  orderCols: ['meet', 'rc_no', 'hr_name', 'model_version'] },

  // ── 전량 (작아서 증분 이득 0) ──
  races:          { mode: 'full' },
  horses:         { mode: 'full' },
  jockey_stats:   { mode: 'full' },
  race_par_times: { mode: 'full' },
  weight_history: { mode: 'full' },
  model_versions: { mode: 'full' },

  // ── 전량 (뷰 — 날짜 키 없는 집계라 불가피) ──
  race_sectional_stats:            { mode: 'full', isView: true },
  horse_sectional_ability:         { mode: 'full', isView: true },
  horse_running_style_by_distance: { mode: 'full', isView: true },
};

/** db:pull 기본 대상 — 순서는 의존 없음(로그 가독성만 고려) */
export const ALL_TARGETS: string[] = Object.keys(TABLE_SPECS);
