/**
 * Lab.tsx — 실험실 (판단항목 가중치 실험)
 *
 * Phase 1: predictions.item_scores 의 rawScore 를 그대로 두고
 *          가중치 벡터만 바꿔 v1(현재 적용) ↔ 실험 버전 예상순위를 비교한다.
 *          백엔드/DB 변경 없이 클라이언트에서 즉시 재계산.
 *
 * 진입점: 헤더 "개인 도구" → /lab
 */
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, RotateCcw, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useAvailableDates, useRacesByDate, usePredictionsByRace, useHorsesByRace } from '../lib/queries';
import { RaceInfoBlock } from '../components/RaceInfoBlock';
import {
  V1_WEIGHTS,
  SCORE_ITEM_IDS,
  ITEM_NAMES,
  SEALED_ITEMS,
  recomputeRanking,
  weightSum,
} from '../lib/labScoring';

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경' };

function fmtRcDate(d: number): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor((d % 10000) / 100);
  const day = d % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface CompareRow {
  hr_name: string;
  v1Rank: number;
  expRank: number;
  expScore: number;
  delta: number; // v1Rank - expRank, 양수 = 실험에서 상승
  actualOrd: number | null;
}

export function Lab() {
  const { data: availableDates } = useAvailableDates();

  const [date, setDate] = useState<number | null>(null);
  const selectedDate = date ?? availableDates?.[0] ?? null;

  const { data: races } = useRacesByDate(selectedDate ?? 0);

  const [raceKey, setRaceKey] = useState<string | null>(null); // "meet-rcNo"
  const [meet, rcNo] = useMemo(() => {
    if (!raceKey) return [null, null] as [number | null, number | null];
    const [m, r] = raceKey.split('-').map(Number);
    return [m, r];
  }, [raceKey]);

  // 실험 가중치 (초기값 = v1 기준선)
  const [weights, setWeights] = useState<Record<string, number>>({ ...V1_WEIGHTS });
  const isPristine = useMemo(
    () => SCORE_ITEM_IDS.every((id) => weights[id] === V1_WEIGHTS[id]),
    [weights]
  );

  const rcDate = selectedDate ?? 0;
  const { data: predictions, isLoading: predLoading } = usePredictionsByRace(
    rcDate,
    meet ?? 0,
    rcNo ?? 0
  );
  const { data: horses } = useHorsesByRace(rcDate, meet ?? 0, rcNo ?? 0);

  const selectedRace = useMemo(
    () => races?.find((r) => r.meet === meet && r.rc_no === rcNo) ?? null,
    [races, meet, rcNo]
  );

  // v1 = 저장된 predicted_rank, 실험 = recomputeRanking(weights)
  const rows = useMemo<CompareRow[]>(() => {
    if (!predictions || predictions.length === 0) return [];
    const expRanking = recomputeRanking(predictions, weights);
    return predictions
      .map((p) => {
        const exp = expRanking.get(p.hr_name);
        const expRank = exp?.rank ?? 0;
        return {
          hr_name: p.hr_name,
          v1Rank: p.predicted_rank,
          expRank,
          expScore: exp?.score ?? 0,
          delta: p.predicted_rank - expRank,
          actualOrd: p.actual_ord,
        };
      })
      .sort((a, b) => a.v1Rank - b.v1Rank);
  }, [predictions, weights]);

  const hasResult = rows.some((r) => r.actualOrd !== null);

  // 실제 1·2·3위 말이 각 버전에서 몇 위로 예측됐나 (per-race 인사이트)
  const actualTop3 = useMemo(() => {
    return rows
      .filter((r) => r.actualOrd !== null && r.actualOrd <= 3)
      .sort((a, b) => (a.actualOrd! - b.actualOrd!));
  }, [rows]);

  const setWeight = (id: string, v: number) =>
    setWeights((w) => ({ ...w, [id]: Math.max(0, v) }));

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-[var(--color-accent-cyan)]" />
          <h1 className="text-lg font-semibold">실험실</h1>
          <span className="text-xs text-[var(--color-text-disabled)]">
            판단항목 가중치 실험 · v1 비교
          </span>
        </div>
        <Link to="/versions" className="text-xs text-[var(--color-accent-cyan)] hover:underline">
          버전 비교 →
        </Link>
      </div>

      {/* 경주 선택 */}
      <div className="bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] flex flex-wrap items-center gap-3">
        <label className="text-xs text-[var(--color-text-secondary)]">날짜</label>
        <select
          value={selectedDate ?? ''}
          onChange={(e) => {
            setDate(Number(e.target.value));
            setRaceKey(null);
          }}
          className="bg-[var(--color-bg-elevated)] rounded px-3 py-2 text-sm font-mono-num outline-none"
        >
          {(availableDates ?? []).map((d) => (
            <option key={d} value={d}>
              {fmtRcDate(d)}
            </option>
          ))}
        </select>

        <label className="text-xs text-[var(--color-text-secondary)]">경주</label>
        <select
          value={raceKey ?? ''}
          onChange={(e) => setRaceKey(e.target.value || null)}
          className="bg-[var(--color-bg-elevated)] rounded px-3 py-2 text-sm outline-none min-w-[14rem]"
        >
          <option value="">— 경주 선택 —</option>
          {(races ?? []).map((r) => (
            <option key={`${r.meet}-${r.rc_no}`} value={`${r.meet}-${r.rc_no}`}>
              {MEET_NAMES[r.meet] ?? r.meet} {r.rc_no}R
              {r.rc_dist ? ` · ${r.rc_dist}m` : ''}
              {r.rc_name ? ` · ${r.rc_name}` : ''}
            </option>
          ))}
        </select>
      </div>

      {meet && rcNo && (
        <RaceInfoBlock rcDate={rcDate} meet={meet} rcNo={rcNo} race={selectedRace} horses={horses} />
      )}

      {meet && rcNo && (
        <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4">
          {/* 가중치 패널 */}
          <section className="bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] h-fit">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">실험 가중치</h2>
              <button
                onClick={() => setWeights({ ...V1_WEIGHTS })}
                disabled={isPristine}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black transition-colors disabled:opacity-40 disabled:hover:bg-[var(--color-bg-elevated)] disabled:hover:text-inherit"
              >
                <RotateCcw className="w-3 h-3" />
                v1 리셋
              </button>
            </div>
            <div className="text-[11px] text-[var(--color-text-disabled)] mb-3">
              합계 {weightSum(weights).toFixed(1)}
              <span className="ml-1">(v1 = {weightSum(V1_WEIGHTS).toFixed(1)})</span>
            </div>

            <div className="space-y-2.5">
              {SCORE_ITEM_IDS.map((id) => {
                const v1 = V1_WEIGHTS[id];
                const cur = weights[id] ?? 0;
                const changed = cur !== v1;
                const sealed = SEALED_ITEMS.has(id);
                return (
                  <div key={id} className="text-xs">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={sealed ? 'text-[var(--color-text-disabled)]' : ''}>
                        {ITEM_NAMES[id] ?? id}
                        {sealed && <span className="ml-1 text-[10px]">(SEALED)</span>}
                      </span>
                      <div className="flex items-center gap-1.5 font-mono-num">
                        {changed && (
                          <span className="text-[10px] text-[var(--color-text-disabled)]">
                            v1 {v1}
                          </span>
                        )}
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={cur}
                          onChange={(e) => setWeight(id, Number(e.target.value))}
                          className={`w-14 bg-[var(--color-bg-elevated)] rounded px-1.5 py-0.5 text-right outline-none ${
                            changed ? 'text-[var(--color-accent-cyan)]' : ''
                          }`}
                        />
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={0.5}
                      value={cur}
                      onChange={(e) => setWeight(id, Number(e.target.value))}
                      className="w-full accent-[var(--color-accent-cyan)] h-1"
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* 비교 결과 */}
          <section className="space-y-4">
            {predLoading && (
              <div className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
                예측 로딩 중...
              </div>
            )}

            {!predLoading && rows.length === 0 && (
              <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 text-center text-[var(--color-text-secondary)]">
                이 경주는 예측 데이터(predictions)가 없습니다.
              </div>
            )}

            {rows.length > 0 && (
              <>
                {/* 실제 결과 인사이트 요약 */}
                {hasResult && actualTop3.length > 0 && (
                  <div className="bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)]">
                    <div className="text-xs font-semibold text-[var(--color-accent-gold)] mb-2">
                      실제 1·2·3위 말의 예측 순위 (v1 → 실험)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {actualTop3.map((r) => {
                        const better = r.expRank < r.v1Rank;
                        const worse = r.expRank > r.v1Rank;
                        return (
                          <div
                            key={r.hr_name}
                            className="bg-[var(--color-bg-elevated)] rounded-lg p-2.5 text-sm"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-[var(--color-accent-gold)] font-bold">
                                {['🥇', '🥈', '🥉'][r.actualOrd! - 1]}
                              </span>
                              <span className="font-medium truncate">{r.hr_name}</span>
                            </div>
                            <div className="mt-1 font-mono-num text-xs flex items-center gap-1.5">
                              <span>{r.v1Rank}위</span>
                              <span className="text-[var(--color-text-disabled)]">→</span>
                              <span
                                className={
                                  better
                                    ? 'text-[var(--color-success)] font-bold'
                                    : worse
                                      ? 'text-[var(--color-accent-pink)]'
                                      : ''
                                }
                              >
                                {r.expRank}위
                              </span>
                              {better && <ArrowUp className="w-3 h-3 text-[var(--color-success)]" />}
                              {worse && <ArrowDown className="w-3 h-3 text-[var(--color-accent-pink)]" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 비교 표 */}
                <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[var(--color-text-secondary)] text-xs border-b border-[var(--color-bg-elevated)]">
                        <th className="text-left font-medium px-3 py-2">마명</th>
                        <th className="text-center font-medium px-2 py-2">v1 순위</th>
                        <th className="text-center font-medium px-2 py-2">실험 순위</th>
                        <th className="text-center font-medium px-2 py-2">Δ</th>
                        {hasResult && (
                          <th className="text-center font-medium px-2 py-2">실제</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="font-mono-num">
                      {rows.map((r) => {
                        const up = r.delta > 0;
                        const down = r.delta < 0;
                        const isActualTop3 = r.actualOrd !== null && r.actualOrd <= 3;
                        return (
                          <tr
                            key={r.hr_name}
                            className={`border-b border-[var(--color-bg-elevated)]/50 ${
                              isActualTop3 ? 'bg-[var(--color-accent-gold)]/5' : ''
                            }`}
                          >
                            <td className="px-3 py-2 font-sans">{r.hr_name}</td>
                            <td className="text-center px-2 py-2 text-[var(--color-text-secondary)]">
                              {r.v1Rank}
                            </td>
                            <td className="text-center px-2 py-2 font-semibold text-[var(--color-accent-cyan)]">
                              {r.expRank}
                            </td>
                            <td className="text-center px-2 py-2">
                              <span
                                className={`inline-flex items-center gap-0.5 ${
                                  up
                                    ? 'text-[var(--color-success)]'
                                    : down
                                      ? 'text-[var(--color-accent-pink)]'
                                      : 'text-[var(--color-text-disabled)]'
                                }`}
                              >
                                {up && <ArrowUp className="w-3 h-3" />}
                                {down && <ArrowDown className="w-3 h-3" />}
                                {!up && !down && <Minus className="w-3 h-3" />}
                                {r.delta !== 0 && Math.abs(r.delta)}
                              </span>
                            </td>
                            {hasResult && (
                              <td className="text-center px-2 py-2">
                                {r.actualOrd === null ? (
                                  <span className="text-[var(--color-text-disabled)]">-</span>
                                ) : (
                                  <span
                                    className={
                                      isActualTop3
                                        ? 'text-[var(--color-accent-gold)] font-bold'
                                        : 'text-[var(--color-text-secondary)]'
                                    }
                                  >
                                    {r.actualOrd}
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-[var(--color-text-disabled)]">
                  v1 순위 = 현재 적용된 예측(predicted_rank). 실험 순위 = 같은 항목 rawScore에 위
                  가중치를 적용해 재계산. Δ 양수(▲) = 실험에서 순위 상승.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
