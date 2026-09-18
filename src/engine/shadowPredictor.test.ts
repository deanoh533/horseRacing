import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVersions = vi.fn();
const mockGather = vi.fn();
vi.mock('./modelVersion.js', () => ({ getShadowModelVersions: (...a: unknown[]) => mockVersions(...a) }));
vi.mock('./scorePredictor.js', async (orig) => {
  const real = await orig<typeof import('./scorePredictor.js')>();
  return { ...real, gatherRaceInputs: (...a: unknown[]) => mockGather(...a) };
});

const lin = (c: number) => ({ type: 'logistic', features: ['f'], means: [0], stds: [1], coef: { f: c }, intercept: c });
const rows = [
  { hr_name: 'A', pthr_no: 1, ord: null, input: {} },
  { hr_name: 'B', pthr_no: 2, ord: null, input: {} },
];

describe('predictShadows', () => {
  beforeEach(() => { mockVersions.mockReset(); mockGather.mockReset(); });

  it('실험 버전이 없으면 입력 수집 없이 빈 배열', async () => {
    mockVersions.mockResolvedValue([]);
    const { predictShadows } = await import('./shadowPredictor.js');
    expect(await predictShadows({} as never, 20260912, 1, 1)).toEqual([]);
    expect(mockGather).not.toHaveBeenCalled();
  });

  it('버전마다 말 수만큼 행을 만들고 versionIds로 거를 수 있다', async () => {
    mockVersions.mockResolvedValue([
      { id: 8, label: 'a', model_type: 'logistic', weights: {}, artifact: lin(1), train_until: 20260630 },
      { id: 9, label: 'b', model_type: 'pl-top3', weights: {}, artifact: lin(2), train_until: 20260630 },
    ]);
    mockGather.mockResolvedValue(rows);
    const { predictShadows } = await import('./shadowPredictor.js');
    const all = await predictShadows({} as never, 20260912, 1, 1);
    expect(all).toHaveLength(4);
    expect(new Set(all.map((r) => r.model_version))).toEqual(new Set([8, 9]));
    expect(Object.keys(all[0]!).sort()).toEqual(
      ['actual_ord', 'hr_name', 'meet', 'model_version', 'p_top3', 'predicted_rank', 'race_date', 'rc_no', 'total_score'].sort());
    const only9 = await predictShadows({} as never, 20260912, 1, 1, { versionIds: [9] });
    expect(only9.every((r) => r.model_version === 9)).toBe(true);
  });

  it('forcePrecompetition 옵션을 입력 수집에 넘긴다', async () => {
    mockVersions.mockResolvedValue([{ id: 8, label: 'a', model_type: 'logistic', weights: {}, artifact: lin(1), train_until: null }]);
    mockGather.mockResolvedValue(rows);
    const { predictShadows } = await import('./shadowPredictor.js');
    await predictShadows({} as never, 20260912, 1, 1, { forcePrecompetition: true });
    expect(mockGather.mock.calls[0]![4]).toEqual({ forcePrecompetition: true });
  });

  it('versions 주입 시 DB에서 버전을 읽지 않는다', async () => {
    mockGather.mockResolvedValue(rows);
    const { predictShadows } = await import('./shadowPredictor.js');
    const out = await predictShadows({} as never, 20260912, 1, 1, {
      versions: [{ id: 5, label: 'x', model_type: 'logistic', weights: {}, artifact: lin(1) as never, train_until: 20260630 }],
    });
    expect(mockVersions).not.toHaveBeenCalled();
    expect(out.every((r) => r.model_version === 5)).toBe(true);
  });
});
