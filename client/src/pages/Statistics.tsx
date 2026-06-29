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
  DollarSign,
  Heart,
} from 'lucide-react';
import '../lib/chartSetup';
import { CHART_COLORS } from '../lib/chartSetup';
import {
  useMonthlyHitRate,
  useWeightHistory,
  useLatestCorrelations,
  useRecentArchives,
  useEarningsHitRate,
  useRaceCardsCoverage,
  useSelectivePickAccuracy,
} from '../lib/queries';
import { ITEM_NAMES } from '../lib/itemNames';

const PERIODS = [
  { label: '3개월', months: 3 },
  { label: '6개월', months: 6 },
  { label: '1년', months: 12 },
  { label: '2년', months: 24 },
  { label: '전체', months: null as number | null },
] as const;

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부산경남' };

export function Statistics() {
  const [periodIdx, setPeriodIdx] = useState(2); // 기본 1년
  const period = PERIODS[periodIdx]!;

  const { data: monthlyHits, isLoading: hitLoading } = useMonthlyHitRate(period.months);
  const { data: history, isLoading: histLoading } = useWeightHistory(5);
  const { data: correlations, isLoading: corrLoading } = useLatestCorrelations();
  const { data: archives, isLoading: archLoading } = useRecentArchives(30);
  const { data: earningsBuckets, isLoading: earnLoading } = useEarningsHitRate();
  const { data: coverage, isLoading: covLoading } = useRaceCardsCoverage();

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

      {/* 선별 적중률 */}
      <SelectivePickSection />

      {/* 가중치 학습 이력 (레거시) */}
      <Card
        title="가중치 학습 이력 (레거시)"
        subtitle="옛 Spearman 가중치 파이프라인 · 현 라이브 모델은 로지스틱 직접학습"
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

      {/* 항목별 단변량 예측력 (레거시 진단) */}
      <Card
        title="항목별 예측력 (Spearman ρ · 레거시 진단)"
        subtitle="항목 단독의 결과 상관 (참고용) · 라이브 예측은 로지스틱이 직접 학습"
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

      {/* 수득상금 구간별 적중률 */}
      <Card
        title="수득상금 구간별 단승 적중률"
        subtitle="race_entries와 예측 결과 join"
        icon={<DollarSign className="w-4 h-4 text-[var(--color-accent-gold)]" />}
      >
        {earnLoading ? (
          <LoadingBox />
        ) : !earningsBuckets ? (
          <EmptyBox text="수득상금 데이터 없음" />
        ) : (
          <>
            <div className="h-64">
              <Bar
                data={{
                  labels: earningsBuckets.map((b) => `${b.label}\n(${b.range})`),
                  datasets: [
                    {
                      label: '단승 적중률',
                      data: earningsBuckets.map((b) => Math.round(b.rate * 10) / 10),
                      backgroundColor: earningsBuckets.map((b) =>
                        b.rate >= 30 ? CHART_COLORS.gold : b.rate >= 20 ? CHART_COLORS.cyan : CHART_COLORS.pink
                      ),
                      borderRadius: 4,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: '#131b3a',
                      borderColor: CHART_COLORS.cyan,
                      borderWidth: 1,
                      callbacks: {
                        label: (ctx) => {
                          const b = earningsBuckets[ctx.dataIndex]!;
                          return `${b.rate.toFixed(1)}% (${b.hits}/${b.count})`;
                        },
                      },
                    },
                  },
                  scales: {
                    y: { min: 0, max: 60, grid: { color: CHART_COLORS.grid }, ticks: { callback: (v) => `${v}%` } },
                    x: { grid: { display: false } },
                  },
                }}
              />
            </div>
            <div className="mt-3 text-xs text-[var(--color-text-secondary)]">
              💡 수득상금이 높을수록 (검증된 강자) 단승 적중률 ↑ 가설 확인
            </div>
          </>
        )}
      </Card>

      {/* 출마표 데이터 커버리지 */}
      <Card
        title="출마표 데이터 수집 현황"
        icon={<Heart className="w-4 h-4 text-[var(--color-accent-pink)]" />}
      >
        {covLoading ? (
          <LoadingBox />
        ) : !coverage ? (
          <EmptyBox text="데이터 없음" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="총 출주 기록" value={coverage.totalRows.toLocaleString()} unit="" />
            <Stat
              label="진료 이력 있음"
              value={`${((coverage.injuredRows / Math.max(coverage.totalRows, 1)) * 100).toFixed(1)}`}
              unit="%"
              color="pink"
            />
            <Stat
              label="가장 이른 날짜"
              value={coverage.earliestDate ? formatRcDate(coverage.earliestDate).slice(2) : '-'}
              unit=""
              color="gold"
            />
            <Stat
              label="가장 최근"
              value={coverage.latestDate ? formatRcDate(coverage.latestDate).slice(2) : '-'}
              unit=""
              color="gold"
            />
          </div>
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

function SelectivePickSection() {
  const { data } = useSelectivePickAccuracy(12);
  if (!data) return null;
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  const labelOf = (t: 'strong' | 'watch') => (t === 'strong' ? '강추' : '주목');
  return (
    <section className="rounded-lg border border-[var(--color-bg-elevated)] p-4">
      <h2 className="font-semibold mb-1">선별 적중률 (최근 12개월)</h2>
      <p className="text-xs text-[var(--color-text-secondary)] mb-3">
        전체 연승 베이스라인 {pct(data.baselinePlace)} · {data.totalRaces}경주
      </p>
      <table className="w-full text-sm">
        <thead className="text-[var(--color-text-secondary)] text-xs">
          <tr><th className="text-left">티어</th><th>건수</th><th>연승</th><th>단승</th><th>커버리지</th><th>리프트</th></tr>
        </thead>
        <tbody>
          {data.tiers.map((s) => (
            <tr key={s.tier} className="border-t border-[var(--color-bg-elevated)]">
              <td className="py-1 font-medium">{labelOf(s.tier)}</td>
              <td className="text-center">{s.picks}</td>
              <td className="text-center font-mono-num">{pct(s.placeHitRate)}</td>
              <td className="text-center font-mono-num">{pct(s.winHitRate)}</td>
              <td className="text-center font-mono-num">{pct(s.coverage)}</td>
              <td className="text-center font-mono-num text-[var(--color-accent-cyan)]">
                +{((s.placeHitRate - data.baselinePlace) * 100).toFixed(1)}%p
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.tiers.every((s) => s.picks === 0) && (
        <p className="text-xs text-[var(--color-text-disabled)] mt-2">임계값 미확정(probe 전) 또는 해당 구간 픽 없음.</p>
      )}
    </section>
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
