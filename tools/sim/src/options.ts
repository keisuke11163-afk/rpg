/**
 * DPSシミュレーターのコマンドの引数の読み取り（テストできるように index.ts から分けた）。
 */
import { validateSeconds } from "./simulate.ts";

/** 既定のシミュレーションの時間（秒）。--seconds を指定しないときだけ使う。 */
export const DEFAULT_SECONDS = 60;

/** 引数の一覧から --name の値を取り出す。指定がなければ undefined。値がなければ例外。 */
export function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new RangeError(`--${name} に値がない`);
  }
  return value;
}

/**
 * --seconds の値を読み取る。省略したときだけ既定の60秒にする。
 * 数として読めない値・0以下・NaN・±Infinity は、既定値や0に置き換えずに RangeError にする（入力の値をメッセージに含める）。
 */
export function parseSeconds(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SECONDS;
  const text = raw.trim();
  // Number("") は 0、Number("0x10") は 16 になるので、10進の数の形と ±Infinity だけを数として読む。
  // 読めない値は NaN にし、±Infinity も含めて validateSeconds で拒否する
  const value =
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || /^[+-]?Infinity$/.test(text)
      ? Number(text)
      : Number.NaN;
  try {
    return validateSeconds(value);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new RangeError(`--seconds の値が正しくない：「${raw}」（${reason}）`, { cause: e });
  }
}
