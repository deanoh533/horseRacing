import { useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { TrendingUp, BarChart3, History, FileText, CheckCircle2, XCircle } from 'lucide-react';
import '../lib/chartSetup';
import { CHART_COLORS } from '../lib/chartSetup';

// ⚠️ Mock 데이터
const PERIODS = ['최근 30일', '3개월', '6개월', '1년', '전체'] as const;
type Period = typeof PERIODS[number];

const MOCK_HIT_RATE = {
  labels: ['1월', '3월', '5월', '7월', '9월', '11월'],
  data: [42, 51, 55, 62, 65, 62.5],
};

const MOCK_KEY_INDICATOR_HISTORY = [
  {
    period: '현재 (2026-05)',
    items: [
      { name: '① 레이팅', weight: 17.5 },
      { name: '⑨ 기수 폼', weight: 10.5 },
      { name: '⑥ 거리 적성', weight: 8.8 },
      { name: '⑰ 배당률', weight: 8.8 },
    ],
  },
  {
    period: '6개월 전 (2025-11)',
    items: [
      { name: '① 레이팅', weight: 19.0 },
      { name: '⑨ 기수 폼', weight: 11.5 },
      { name: '⑭ 혈통', weight: 9.0, note: '↓ 현재 5위' },
      { name: '⑦ 주로 적응', weight: 8.5 },
    ],
  },
];

const MOCK_CORRELATIONS = [
  { id: 1, name: '① 레이팅', corr: 0.71, isCore: true },
  { id: 9, name: '⑨ 기수 폼', corr: 0.69, isCore: true },
  { id: 6, name: '⑥ 거리 적성', corr: 0.62, isCore: true },
  { id: 17, name: '⑰ 배당률', corr: 0.61, isCore: true },
  { id: 2, name: '② 마체중 변화', corr: 0.51, isCore: false },
  { id: 3, name: '③ 착순 추세', corr: 0.48, isCore: false },
  { id: 7, name: '⑦ 주로 적응', corr: 0.45, isCore: false },
  { id: 10, name: '⑩ 조교사 폼', corr: 0.42, isCore: false },
  { id: 16, name: '⑯ 기수-말 궁합', corr: 0.38, isCore: false },
  { id: 14, name: '⑭ 혈통', corr: 0.35, isCore: false },
];

const MOCK_ARCHIVES = [
  { date: '2026-05-21', meet: '서울', rcNo: 8, hit: true },
  { date: '2026-05-21', meet: '부산', rcNo: 5, hit: false },
  { date: '2026-05-20', meet: '서울', rcNo: 10, hit: true },
  { date: '2026-05-20', meet: '부산', rcNo: 7, hit: true },
  { date: '2026-05-19', meet: '서울', rcNo: 3, hit: false },
];

export function Statistics() {
  const [period, setPeriod] = useState<Period>('1년');

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-[var(--color-accent-cyan)]" />
        통계 & 인사이트
      </h1>

      {/* 기간 선택 */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-[var(--color-text-secondary)] py-1.5">📅 기간:</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded transition-colors ${
              period === p
                ? 'bg-[var(--color-accent-cyan)] text-black font-semibold'
                : 'bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)]'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* 적중률 추이 */}
      <Card title="적중률 추이" icon={<TrendingUp className="w-4 h-4 text-[var(--color-success)]" />}>
        <div className="h-64">
          <Line
            data={{
              labels: MOCK_HIT_RATE.labels,
              datasets: [
                {
                  label: '1-3위 적중률',
                  data: MOCK_HIT_RATE.data,
                  borderColor: CHART_COLORS.cyan,
                  backgroundColor: `${CHART_COLORS.cyan}20`,
                  fill: true,
                  tension: 0.3,
                  pointBackgroundColor: CHART_COLORS.cyan,
                  pointRadius: 4,
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
                  callbacks: { label: (ctx) => `${ctx.parsed.y}%` },
                },
              },
              scales: {
                y: {
                  min: 30,
                  max: 80,
                  grid: { color: CHART_COLORS.grid },
                  ticks: { callback: (v) => `${v}%` },
                },
                x: { grid: { display: false } },
              },
            }}
          />
        </div>
        <div className="mt-3 flex gap-6 text-sm">
          <div>
            <span className="text-[var(--color-text-secondary)]">현재:</span>{' '}
            <span className="text-[var(--color-accent-cyan)] font-mono-num font-semibold">62.5%</span>
          </div>
          <div>
            <span className="text-[var(--color-text-secondary)]">최고:</span>{' '}
            <span className="text-[var(--color-success)] font-mono-num font-semibold">68.2% (8월)</span>
          </div>
          <div>
            <span className="text-[var(--color-text-secondary)]">1위 적중:</span>{' '}
            <span className="font-mono-num">35%</span>
          </div>
        </div>
      </Card>

      {/* 핵심 지표 변화 (가중치 학습 결과) */}
      <Card
        title="핵심 지표 변화"
        subtitle="가중치 학습 결과 - 자동"
        icon={<History className="w-4 h-4 text-[var(--color-accent-gold)]" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MOCK_KEY_INDICATOR_HISTORY.map((snapshot, i) => (
            <div key={i} className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
              <div className="text-xs text-[var(--color-text-secondary)] mb-2">{snapshot.period}</div>
              <ol className="space-y-1">
                {snapshot.items.map((item, j) => (
                  <li key={j} className="flex items-center justify-between text-sm">
                    <span>
                      <span className="text-[var(--color-text-disabled)] mr-2">{j + 1}순위:</span>
                      {item.name}
                      {item.note && (
                        <span className="ml-2 text-xs text-[var(--color-warning)]">{item.note}</span>
                      )}
                    </span>
                    <span className="font-mono-num font-semibold text-[var(--color-accent-cyan)]">{item.weight}점</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-[var(--color-text-secondary)] flex items-start gap-2">
          <span>💡</span>
          <span>인사이트: 혈통 영향력 감소 (5위로 하락) / 거리 적성 영향력 증가 (3위로 상승)</span>
        </div>
      </Card>

      {/* 17개 항목 상관계수 */}
      <Card
        title="17개 항목 상관계수 (예측력)"
        subtitle="값이 클수록 실제 결과와 일치"
        icon={<BarChart3 className="w-4 h-4 text-[var(--color-accent-pink)]" />}
      >
        <div className="h-96">
          <Bar
            data={{
              labels: MOCK_CORRELATIONS.map((c) => c.name),
              datasets: [
                {
                  data: MOCK_CORRELATIONS.map((c) => c.corr),
                  backgroundColor: MOCK_CORRELATIONS.map((c) =>
                    c.isCore ? CHART_COLORS.gold : CHART_COLORS.cyan
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
                  callbacks: { label: (ctx) => `상관계수: ${ctx.parsed.x}` },
                },
              },
              scales: {
                x: { min: 0, max: 1, grid: { color: CHART_COLORS.grid } },
                y: { grid: { display: false } },
              },
            }}
          />
        </div>
        <div className="mt-3 text-xs flex items-center gap-3 text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-[var(--color-accent-gold)] rounded"></span>
            핵심 지표 (상위 4)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-[var(--color-accent-cyan)] rounded"></span>
            나머지
          </span>
        </div>
      </Card>

      {/* 리포트 아카이브 */}
      <Card title="리포트 아카이브" icon={<FileText className="w-4 h-4 text-[var(--color-accent-cyan)]" />}>
        <div className="divide-y divide-[var(--color-bg-elevated)]">
          {MOCK_ARCHIVES.map((a, i) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="text-[var(--color-text-secondary)] font-mono-num">{a.date}</span>
                <span>{a.meet} {a.rcNo}R</span>
              </div>
              {a.hit ? (
                <span className="inline-flex items-center gap-1 text-[var(--color-success)] text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  적중
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--color-danger)] text-xs">
                  <XCircle className="w-3.5 h-3.5" />
                  빗나감
                </span>
              )}
            </div>
          ))}
        </div>
        <button className="mt-3 w-full py-2 text-xs text-[var(--color-accent-cyan)] hover:underline">
          더 보기
        </button>
      </Card>

      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-2">
        ⚠️ Mock 데이터입니다.
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
