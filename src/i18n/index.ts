import { en, type MsgKey } from './en';

export type { MsgKey };
type Params = Record<string, string | number>;

/** Translate with {param} interpolation. Missing params stay visible so they are noticed in tests. */
export function t(key: MsgKey, params?: Params): string {
  const s: string = en[key];
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}
export const has = (key: string): key is MsgKey => key in en;
