/**
 * 開発用の機能：開発版のビルドでだけ、状態を確かめるための関数を window に出す（MVP実装単位 2.1）。
 * 製品版のビルドでは何もしない。自動の動作確認（pnpm e2e）が使う。
 */
export function exposeDebug(api: Record<string, () => unknown>): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __STELLA_DEBUG__?: Record<string, () => unknown> };
  w.__STELLA_DEBUG__ = { ...(w.__STELLA_DEBUG__ ?? {}), ...api };
}
