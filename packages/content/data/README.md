# data

コンテンツのデータ（JSON）を、種類ごとのフォルダに置く（開発計画書 6.2）。
データの形（スキーマ）は `packages/core/src/data/schema.ts`、ファイルをまたぐ検査は `packages/core/src/data/validate.ts` で決める。

## ファイルの形

```json
{
  "schemaVersion": 1,
  "kind": "tags",
  "entries": [{ "id": "TAG-WPN-GREATSWORD", "category": "weapon", "parents": ["TAG-WPNGRP-SWORD"] }]
}
```

| 項目 | 内容 |
|---|---|
| `schemaVersion` | データの形の版。core の `DATA_SCHEMA_VERSION` と一致しなければならない |
| `kind` | `tags`（星紋タグ）・`stats`（能力値）・`hooks`（ルールフック）・`effects`（効果） |
| `entries` | 項目の配列。種類ごとの形は schema.ts を参照 |

## 決まり

- **IDは一度決めたら変えない**（本仕様書 10.2）。英大文字とハイフンで書き、種類ごとの頭文字（`TAG-`・`STAT-`・`HOOK-`）を付ける。全ての種類をまたいで重複させない
- 表示名はデータに書かず、`text/ja.json` の `name.<ID>` に置く（全てのIDに必須）
- 仮値（バランス調整で変わる数値）を含む項目には `"provisional": true` を付け、理由を `provisionalNote` に書く。一覧は `pnpm report:provisional` で出る
- 割合は小数で書く（`0.06` ＝ 6%、乗算の `0.8` ＝ ×0.8）
- ファイルを足したら、`src/files.ts` の一覧にも足す（足し忘れはテストで見つかる）
- `pnpm validate:data` で検証する（`pnpm check` にも含まれる）

## データの版を上げるとき

互換性のない形の変更（項目の名前・意味の変更、必須の項目の追加）をしたときは、`DATA_SCHEMA_VERSION` を上げ、**同じコミットで全てのデータファイルを新しい形に直す**。
データはコードと一緒に配布するので、データの移行の処理は持たない（セーブデータの移行は U-13 で別に扱う）。
