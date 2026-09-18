import { describe, it, expect } from 'vitest';
import { getShadowModelVersions } from './modelVersion.js';

function fakeClient(rows: Record<string, unknown>[]) {
  const q = {
    filters: [] as Array<[string, unknown]>,
    select() { return q; },
    eq(c: string, v: unknown) { q.filters.push([c, v]); return q; },
    order() { return q; },
    then(res: (v: { data: unknown; error: null }) => unknown) {
      const data = rows.filter((r) => q.filters.every(([c, v]) => r[c] === v))
        .sort((a, b) => (a.id as number) - (b.id as number));
      return Promise.resolve(res({ data, error: null }));
    },
  };
  return { from: () => q } as never;
}

describe('getShadowModelVersions', () => {
  it('is_shadow=true 버전만 id 오름차순으로, train_until 포함해 돌려준다', async () => {
    const sb = fakeClient([
      { id: 9, label: 'v9-pl3', model_type: 'pl-top3', weights: {}, artifact: { features: [] }, is_shadow: true, train_until: 20260630 },
      { id: 7, label: 'v7-shape', model_type: 'logistic', weights: {}, artifact: { features: [] }, is_shadow: false, train_until: null },
      { id: 8, label: 'v8-l2', model_type: 'logistic', weights: {}, artifact: { features: [] }, is_shadow: true, train_until: 20260630 },
    ]);
    const vs = await getShadowModelVersions(sb);
    expect(vs.map((v) => v.id)).toEqual([8, 9]);
    expect(vs[1]!.model_type).toBe('pl-top3');
    expect(vs[0]!.train_until).toBe(20260630);
  });

  it('실험 버전이 없으면 빈 배열', async () => {
    expect(await getShadowModelVersions(fakeClient([]))).toEqual([]);
  });
});
