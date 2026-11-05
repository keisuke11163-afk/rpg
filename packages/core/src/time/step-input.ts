/**
 * 押した瞬間の入力を、固定の時間刻み（fixed-step.ts）に渡すための保持の仕組み。
 *
 * 描画のフレームと計算の刻みは1対1ではない。描画のフレームで読んだ「押した瞬間」の入力を、
 * そのフレームで進める刻みに直接渡すと、刻みが0のフレーム（描画が計算より速いとき）では
 * 入力がどの刻みにも届かずに消える。そこで責務を次のように分ける。
 *
 * - 取得：表示層が描画のフレームごとに入力を読み、{@link StepInputBuffer.press} で記録する
 * - 保持：記録した入力は、計算の刻みで使われるまで、描画のフレームをまたいで残る
 * - 消費：計算の刻みが {@link StepInputBuffer.take} で取り出す。取り出すと消えるので、
 *   1回の押下は1つの刻みにしか届かない（1フレームで複数の刻みを進めても二重には使われない）
 *
 * 押し続け（移動・照準など）は、毎フレーム読み直す値なので、ここでは扱わない。
 */
export class StepInputBuffer<A extends string> {
  private readonly pending = new Set<A>();

  /** 描画のフレームで読んだ「押した瞬間」の入力を、次の刻みまで保持する。 */
  press(actions: Iterable<A>): void {
    for (const action of actions) this.pending.add(action);
  }

  /** 計算の刻みで入力を取り出す。保持していれば true を返し、保持をやめる。 */
  take(action: A): boolean {
    return this.pending.delete(action);
  }

  /** 保持している（まだどの刻みにも渡していない）か。 */
  has(action: A): boolean {
    return this.pending.has(action);
  }

  /** 保持している入力をすべて捨てる（場面の切り替えなど）。 */
  clear(): void {
    this.pending.clear();
  }
}
