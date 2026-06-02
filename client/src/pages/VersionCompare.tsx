/**
 * VersionCompare — 모델 버전 비교 (Stage C, Phase 1)
 *
 * 버전 목록 + 항목별 가중치 + v1 대비 차이 강조 + ρ(상관계수) 표시.
 * 승격/롤백은 화면에서 직접 안 함 → 로컬 명령 안내만 (쓰기=service_role, 안전).
 *
 * (분기별 적중률 비교표는 Phase 2 — 예측 대량 계산 필요)
 */
import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useModelVersions, useLatestCorrelations } from '../lib/queries';
import { SCORE_ITEM_IDS, ITEM_NAMES } from '../lib/labScoring';

export function VersionCompare() {
  const { data: versions, isLoading } = useModelVersions();
  const { data: correlations } = useLatestCorrelations();

  const v1 = useMemo(() => versions?.find((v) => v.label === 'v1') ?? null, [versions]);
  // 비교 대상 = v1이 아닌 버전 중 가장 최신(id 최대). Δ = 이 후보 − v1.
  const compareVer = useMemo(() => {
    const cands = (versions ?? []).filter((v) => v.label !== 'v1');
    return cands.length ? cands.reduce((a, b) => (b.id > a.id ? b : a)) : null;
  }, [versions]);

  // 항목 목록 = 표준 21개 ∪ 버전들이 쓰는 항목(미래 새 항목 대비), ρ 내림차순
  const itemIds = useMemo(() => {
    const set = new Set<string>(SCORE_ITEM_IDS);
    (versions ?? []).forEach((v) => Object.keys(v.weights ?? {}).forEach((k) => set.add(k)));
    const rho = (correlations ?? {}) as Record<string, number>;
    return [...set].sort((a, b) => (rho[b] ?? -99) - (rho[a] ?? -99));
  }, [versions, correlations]);

  if (isLoading) {
    return <div className="text-sm text-[var(--color-text-secondary)] py-8">버전 로딩 중…</div>;
  }
  if (!versions || versions.length === 0) {
    return (
      <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 text-center text-[var(--color-text-secondary)]">
        모델 버전이 없습니다. (마이그레이션 010 적용 필요)
      </div>
    );
  }

  const rho = (correlations ?? {}) as Record<string, number>;
  const fmtW = (w: number | undefined) => (w == null ? '—' : w === 0 ? '·' : w.toFixed(1));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-[var(--color-accent-cyan)]" />
          <h1 className="text-lg font-semibold">버전 비교</h1>
          <span className="text-xs text-[var(--color-text-disabled)]">가중치 · 차이 · ρ</span>
        </div>
        <Link to="/lab" className="text-xs text-[var(--color-accent-cyan)] hover:underline">
          ← 실험실(단일경주)
        </Link>
      </div>

      {/* 버전 목록 */}
      <div className="flex flex-wrap gap-2">
        {versions.map((v) => (
          <div
            key={v.id}
            className={`rounded-lg px-3 py-2 text-xs border ${
              v.is_active
                ? 'border-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/10'
                : 'border-[var(--color-bg-elevated)] bg-[var(--color-bg-surface)]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-semibold">{v.label}</span>
              {v.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent-cyan)] text-black">
                  활성(라이브)
                </span>
              )}
              <span className="text-[var(--color-text-disabled)]">id={v.id}</span>
            </div>
            <div className="text-[var(--color-text-disabled)] mt-0.5">
              {v.source} · {new Date(v.created_at).toLocaleDateString('ko-KR')}
            </div>
          </div>
        ))}
      </div>

      {/* 비교표 */}
      <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-bg-elevated)]">
              <th className="text-left font-medium px-3 py-2">항목</th>
              <th className="text-right font-medium px-2 py-2">ρ</th>
              {versions.map((v) => (
                <th key={v.id} className="text-right font-medium px-2 py-2">
                  {v.label}
                </th>
              ))}
              {v1 && compareVer && (
                <th className="text-right font-medium px-2 py-2">Δ({compareVer.label}−v1)</th>
              )}
            </tr>
          </thead>
          <tbody className="font-mono-num">
            {itemIds.map((id) => {
              const r = rho[id];
              const v1w = v1?.weights?.[id] ?? 0;
              const cmpW = compareVer?.weights?.[id] ?? 0;
              const delta = cmpW - v1w;
              const bigDiff = Math.abs(delta) >= 3;
              return (
                <tr key={id} className="border-b border-[var(--color-bg-elevated)]/40">
                  <td className="px-3 py-1.5 font-sans">
                    {(ITEM_NAMES as Record<string, string>)[id] ?? id}
                  </td>
                  <td
                    className={`text-right px-2 py-1.5 ${
                      r == null
                        ? 'text-[var(--color-text-disabled)]'
                        : r < 0
                          ? 'text-[var(--color-accent-pink)]'
                          : r >= 0.15
                            ? 'text-[var(--color-accent-gold)]'
                            : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {r == null ? '—' : r.toFixed(3)}
                  </td>
                  {versions.map((v) => (
                    <td
                      key={v.id}
                      className={`text-right px-2 py-1.5 ${
                        (v.weights?.[id] ?? 0) === 0 ? 'text-[var(--color-text-disabled)]' : ''
                      }`}
                    >
                      {fmtW(v.weights?.[id])}
                    </td>
                  ))}
                  {v1 && compareVer && (
                    <td
                      className={`text-right px-2 py-1.5 ${
                        delta > 0
                          ? 'text-[var(--color-success)]'
                          : delta < 0
                            ? 'text-[var(--color-accent-pink)]'
                            : 'text-[var(--color-text-disabled)]'
                      } ${bigDiff ? 'font-bold' : ''}`}
                    >
                      {delta === 0 ? '·' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[var(--color-text-disabled)] leading-relaxed">
        ρ = 항목 점수와 실제 착순의 상관(클수록 예측력↑, 음수=역효과). 최근 학습 기준.
        Δ = 활성 버전 가중치 − v1. ±3 이상 굵게.
        <br />
        승격/롤백은 로컬에서: <span className="font-mono-num">npm run promote -- --version &lt;id&gt;</span>
        (v1로 롤백 = id 1). 화면에선 직접 변경하지 않습니다.
      </p>
    </div>
  );
}
