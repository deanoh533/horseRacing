// client/src/pages/Insights.tsx — 전개 인사이트 (F-004: H7 교차표)
import raw from '../data/h7_table.json';

const GAP_ORDER = ['~0.5초', '~1.0초', '~1.5초', '1.5초+'] as const;
const ACH_ORDER = ['낮음(~30%)', '중간(30~70%)', '높음(70%+)'] as const;

interface H7Cell {
  gapBucket: string; achieveBucket: string; starts: number; winRate: number; placeRate: number;
}
interface H7Table {
  generatedAt: string; raceDateFrom: number; raceDateTo: number;
  totalStarts: number; formula: string; cells: H7Cell[];
}
const h7 = raw as H7Table;

const MIN_N = 30; // 표본 적음 표기 기준

/** 승률에 따른 셀 배경 강도 (다크 테마, 라이브러리 없음) */
function cellBg(winRate: number): string {
  if (winRate >= 0.15) return 'bg-emerald-500/30';
  if (winRate >= 0.1) return 'bg-emerald-500/20';
  if (winRate >= 0.06) return 'bg-emerald-500/10';
  return '';
}

function fmtD(d: number): string {
  return `${Math.floor(d / 10000)}.${Math.floor(d / 100) % 100}.${d % 100}`;
}

export function Insights() {
  const cell = (g: string, a: string) =>
    h7.cells.find((c) => c.gapBucket === g && c.achieveBucket === a);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">전개 인사이트</h1>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">격차 × 역전 능력 → 실측 승률 (H7 교차표)</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          <b>격차</b> = 경주 전 예측되는 선두와의 G3F(결승 600m 전) 시간차 ·{' '}
          <b>달성확률</b> = 그 격차를 뒤집는 데 필요한 종반 속도를 이 말이 과거 이력상 낼 확률
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono-num border-collapse">
            <thead>
              <tr className="text-[var(--color-text-secondary)] text-xs">
                <th className="px-2 py-2 text-left">예측 격차 ＼ 달성확률</th>
                {ACH_ORDER.map((a) => (
                  <th key={a} className="px-2 py-2 text-right">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GAP_ORDER.map((g) => (
                <tr key={g} className="border-t border-[var(--color-bg-elevated)]">
                  <td className="px-2 py-2 text-[var(--color-text-secondary)]">{g}</td>
                  {ACH_ORDER.map((a) => {
                    const c = cell(g, a);
                    if (!c) return <td key={a} className="px-2 py-2 text-right">-</td>;
                    const dim = c.starts < MIN_N;
                    return (
                      <td key={a} className={`px-2 py-2 text-right ${cellBg(c.winRate)} ${dim ? 'opacity-50' : ''}`}>
                        <div className="font-semibold">승 {(c.winRate * 100).toFixed(1)}%</div>
                        <div className="text-xs text-[var(--color-text-secondary)]">
                          연 {(c.placeRate * 100).toFixed(1)}% · n={c.starts.toLocaleString()}
                          {dim && ' · 표본 적음'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--color-text-disabled)]">
          표본 {fmtD(h7.raceDateFrom)}~{fmtD(h7.raceDateTo)} · {h7.totalStarts.toLocaleString()}출주 ·
          생성 {h7.generatedAt} · {h7.formula}
        </p>
        <p className="text-xs text-[var(--color-text-disabled)]">
          ⚠️ 이 신호는 v7 모델이 이미 피처(shape_signal)로 학습에 사용 중 — 이 표는 사람용 배경 자료입니다.
        </p>
      </section>
    </div>
  );
}
