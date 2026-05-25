import { useState, useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  BarChart3,
  History,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import '../lib/chartSetup';
import { CHART_COLORS } from '../lib/chartSetup';
import {
  useMonthlyHitRate,
  useWeightHistory,
  useLatestCorrelations,
  useRecentArchives,
} from '../lib/queries';

const PERIODS = [
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '2년', months: 24 },
  { label: '전체', months: null as number | null },
] as const;

// 17개 항목 한국어 이름 (frontend용 매핑)
const ITEM_NAMES: Record<string, string> = {
  '01_rating': '① 레이팅',
  '02_weight_change': '② 마체중 변화',
  '03_recent_form': '③ 착순 추세',
  '04_sectional_time': '④ 구간 시간',
  '05_late_position': '⑤ 후반 구간',
  '06_distance_fitness': '⑥ 거리 적성',
  '07_track_adaptation': '⑦ 주로 적응',
  '08_burden_weight': '⑧ 부담 극복',
  '09_jockey_form': '⑨ 기수 폼',
  '10_trainer_form': '⑩ 조교사 폼',
  '11_race_interval': '⑪ 경주 간격',
  '12_starting_position': '⑫ 출발번호',
  '13_age_distance_gender': '⑬ 나이/거리/성별',
  '14_pedigree': '⑭ 혈통',
  '15_seasonal_pattern': '⑮ 계절 패턴',
  '16_jockey_horse_chemistry': '⑯ 기수-말 궁합',
  '17_market_odds': '⑰ 배당률',
};

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부산경남' };

export function Statistics() {
  const [periodIdx, setPeriodIdx] = useState(2); // 기본 1년
  const period = PERIODS[periodIdx]!;

  const { data: monthlyHits, isLoading: hitLoading } = useMonthlyHitRate(period.months);
  const { data: history, isLoading: histLoading } = useWeightHistory(5);
  const { data: correlations, isLoading: corrLoading } = useLatestCorrelations();
  const { data: archives, isLoading: archLoading } = useRecentArchives(30);

  // 적중률 통계 요약
  const summary = useMemo(() => {
    if (!monthlyHits || monthlyHits.length === 0) return null;
    const total = monthlyHits.reduce((s, m) => s + m.total, 0);
    const win = monthlyHits.reduce((s, m) => s + m.win, 0);
    const place = monthlyHits.reduce((s, m) => s + m.place, 0);
    const show = monthlyHits.reduce((s, m) => s + m.show, 0);
    const winPct = (win / total) * 100;
    const showPct = (show / total) * 100;
    const placePct = (place / total) * 100;
    const best = [...monthlyHits].sort((a, b) => b.show / b.total - a.show / a.total)[0]!;
    const bestPct = (best.show / best.total) * 100;
    return { total, winPct, placePct, showPct, bestMonth: best.month, bestPct };
  }, [monthlyHits]);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-[var(--color-accent-cyan)]" />
        통계 & 인사이트
      </h1>

      {/* 기간 선택 */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-[var(--color-text-secondary)] py-1.5">📅 기간:</span>
        {PERIODS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => setPeriodIdx(i)}
            className={`px-3 py-1.5 rounded transition-colors ${
              i === periodIdx
                ? 'bg-[var(--color-accent-cyan)] text-black font-semibold'
                : 'bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 적중률 추이 */}
      <Card title="적중률 추이 (월별)" icon={<TrendingUp className="w-4 h-4 text-[var(--color-success)]" />}>
        {hitLoading ? (
          <LoadingBox />
        ) : !monthlyHits || monthlyHits.length === 0 ? (
          <EmptyBox text="이 기간 데이터 없음" />
        ) : (
          <>
            <div className="h-64">
              <Line
                data={{
                  labels: monthlyHits.map((m) => m.month),
                  datasets: [
                    {
                      label: '복승 (1-3위)',
                      data: monthlyHits.map((m) => Math.round((m.show / m.total) * 1000) / 10),
                      borderColor: CHART_COLORS.cyan,
                      backgroundColor: `${CHART_COLORS.cyan}20`,
                      fill: true,
                      tension: 0.3,
                      pointBackgroundColor: CHART_COLORS.cyan,
                      pointRadius: 3,
                    },
                    {
                      label: '연승 (1-2위)',
                      data: monthlyHits.map((m) => Math.round((m.place / m.total) * 1000) / 10),
                      borderColor: CHART_COLORS.gold,
                      borderDash: [4, 4],
                      tension: 0.3,
                      pointRadius: 2,
                    },
                    {
                      label: '단승 (1위)',
                      data: monthlyHits.map((m) => Math.round((m.win / m.total) * 1000) / 10),
                      borderColor: CHART_COLORS.pink,
                      borderDash: [2, 2],
                      tension: 0.3,
                      pointRadius: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                      backgroundColor: '#131b3a',
                      borderColor: CHART_COLORS.cyan,
                      borderWidth: 1,
                      callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%` },
                    },
                  },
                  scales: {
                    y: { min: 0, max: 80, grid: { color: CHART_COLORS.grid }, ticks: { callback: (v) => `${v}%` } },
                    x: { grid: { display: false } },
                  },
                }}
              />
            </div>
            {summary && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="총 경주" value={`${summary.total.toLocaleString()}`} unit="" />
                <Stat label="단승 적중률" value={summary.winPct.toFixed(1)} unit="%" color="pink" />
                <Stat label="연승" value={summary.placePct.toFixed(1)} unit="%" color="gold" />
                <Stat label="복승" value={summary.showPct.toFixed(1)} unit="%" color="cyan" />
              </div>
            )}
          </>
        )}
      </Card>

      {/* 가중치 학습 이력 */}
      <Card
        title="가중치 학습 이력"
        subtitle="최근 학습 결과 (Spearman 기반)"
        icon={<History className="w-4 h-4 text-[var(--color-accent-gold)]" />}
      >
        {histLoading ? (
          <LoadingBox />
        ) : !history || history.length === 0 ? (
          <EmptyBox text="아직 학습 이력 없음 (apply_learned_weights 실행 후 표시)" />
        ) : (
          <div className="space-y-3">
            {history.map((snapshot) => {
              const top4 = Object.entries(snapshot.weights)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 4);
              return (
                <div key={snapshot.id} className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2 text-xs text-[var(--color-text-secondary)]">
                    <span>
                      {snapshot.period_start} ~ {snapshot.period_end} ({snapshot.race_count}경주)
                    </span>
                    <span className="text-[var(--color-text-disabled)]">
                      {new Date(snapshot.applied_at).toLocaleDateString('ko-KR')}
                    </span>
                  </div>
                  <ol className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {top4.map(([id, weight], j) => (
                      <li key={id} className="flex items-center justify-between text-sm">
                        <span>
                          <span className="text-[var(--color-text-disabled)] mr-2">{j + 1}.</span>
                          {ITEM_NAMES[id] ?? id}
                        </span>
                        <span className="font-mono-num font-semibold text-[var(--color-accent-cyan)]">
                          {weight.toFixed(1)}점
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 17개 항목 상관계수 */}
      <Card
        title="17개 항목 예측력 (Spearman ρ)"
        subtitle="값이 클수록 실제 결과와 일치 / 음수는 역효과"
        icon={<BarChart3 className="w-4 h-4 text-[var(--color-accent-pink)]" />}
      >
        {corrLoading ? (
          <LoadingBox />
        ) : !correlations ? (
          <EmptyBox text="아직 학습 결과 없음 (weight_history 비어있음)" />
        ) : (
          <CorrelationsChart correlations={correlations} />
        )}
      </Card>

      {/* 리포트 아카이브 */}
      <Card
        title="최근 경주 적중 (예측 1위 vs 실제 1위)"
        icon={<FileText className="w-4 h-4 text-[var(--color-accent-cyan)]" />}
      >
        {archLoading ? (
          <LoadingBox />
        ) : !archives || archives.length === 0 ? (
          <EmptyBox text="예측 데이터 없음" />
        ) : (
          <div className="divide-y divide-[var(--color-bg-elevated)]">
            {archives.map((a) => (
              <Link
                key={`${a.race_date}-${a.meet}-${a.rc_no}`}
                to={`/race/${a.meet}/${a.race_date}/${a.rc_no}`}
                className="flex items-center justify-between py-2 text-sm hover:bg-[var(--color-bg-elevated)] -mx-2 px-2 rounded transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[var(--color-text-secondary)] font-mono-num text-xs">
                    {formatRcDate(a.race_date)}
                  </span>
                  <span className="text-xs">
                    {MEET_NAMES[a.meet] ?? '?'} {a.rc_no}R
                  </span>
                  <span className="truncate">{a.predicted_hr}</span>
                  <span className="text-xs text-[var(--color-text-disabled)] font-mono-num">
                    {a.total_score.toFixed(1)}점
                  </span>
                </div>
                {a.hit === null ? (
                  <span className="inline-flex items-center gap-1 text-[var(--color-text-disabled)] text-xs flex-shrink-0">
                    <AlertCircle className="w-3.5 h-3.5" />
                    데이터 없음
                  </span>
                ) : a.hit ? (
                  <span className="inline-flex items-center gap-1 text-[var(--color-success)] text-xs flex-shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    적중
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[var(--color-danger)] text-xs flex-shrink-0">
                    <XCircle className="w-3.5 h-3.5" />
                    {a.actual_ord}위
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CorrelationsChart({ correlations }: { correlations: Record<string, number> }) {
  const sorted = useMemo(
    () =>
      Object.entries(correlations)
        .map(([id, rho]) => ({ id, name: ITEM_NAMES[id] ?? id, rho }))
        .sort((a, b) => b.rho - a.rho),
    [correlations]
  );

  return (
    <div className="h-[28rem]">
      <Bar
        data={{
          labels: sorted.map((s) => s.name),
          datasets: [
            {
              data: sorted.map((s) => Math.round(s.rho * 1000) / 1000),
              backgroundColor: sorted.map((s) =>
                s.rho >= 0.15
                  ? CHART_COLORS.gold
                  : s.rho >= 0.05
                    ? CHART_COLORS.cyan
                    : s.rho >= 0
                      ? '#6b7280'
                      : '#dc2626'
              ),
              borderRadius: 4,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#131b3a',
              borderColor: CHART_COLORS.cyan,
              borderWidth: 1,
              callbacks: { label: (ctx) => `ρ: ${ctx.parsed.x}` },
            },
          },
          scales: {
            x: { min: -0.2, max: 0.5, grid: { color: CHART_COLORS.grid } },
            y: { grid: { display: false }, ticks: { font: { size: 11 } } },
          },
        }}
      />
      <div className="mt-3 text-xs flex items-center gap-3 text-[var(--color-text-secondary)] flex-wrap">
        <Legend color={CHART_COLORS.gold} label="강한 신호 (ρ ≥ 0.15)" />
        <Legend color={CHART_COLORS.cyan} label="중간 (0.05~0.15)" />
        <Legend color="#6b7280" label="약함 (0~0.05)" />
        <Legend color="#dc2626" label="역효과 (ρ < 0)" />
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-[var(--color-bg-surface)] rounded-xl p-5 border border-[var(--color-bg-elevated)]">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {icon}
            {title}
          </h2>
          {subtitle && (
            <span className="text-xs text-[var(--color-text-disabled)] mt-1 block">{subtitle}</span>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  color = 'cyan',
}: {
  label: string;
  value: string;
  unit: string;
  color?: 'cyan' | 'gold' | 'pink';
}) {
  const colorClass = {
    cyan: 'text-[var(--color-accent-cyan)]',
    gold: 'text-[var(--color-accent-gold)]',
    pink: 'text-[var(--color-accent-pink)]',
  }[color];
  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className={`text-xl font-bold font-mono-num ${colorClass} mt-1`}>
        {value}
        <span className="text-sm">{unit}</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-3 h-3 rounded" style={{ backgroundColor: color }}></span>
      {label}
    </span>
  );
}

function LoadingBox() {
  return (
    <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      로딩 중...
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-sm text-[var(--color-text-disabled)]">{text}</div>
  );
}

function formatRcDate(rcDate: number): string {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100);
  const d = rcDate % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
