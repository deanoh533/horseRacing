/**
 * de-biased feature — 항목의 raw 측정값 하나.
 * value는 raw 숫자(표준화 전). missing이면 value=0 + `<name>__missing`=1 동반.
 */
export interface Feature {
  name: string;
  value: number;
}

export type FeatureVector = Feature[];
