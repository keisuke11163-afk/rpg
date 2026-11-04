// @ts-check
import tseslint from "typescript-eslint";

/** core が参照してはいけないもの（開発環境構築計画 3.1） */
const coreForbiddenImports = [
  { name: "phaser", message: "core は Phaser を参照できない（開発環境構築計画 3.1）" },
  { name: "@stella/game", message: "core は game を参照できない" },
  { name: "@stella/content", message: "core は content を参照できない" },
  { name: "@stella/sim", message: "core は sim を参照できない" },
];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "coverage/**", "artifacts/**"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: coreForbiddenImports,
          patterns: [{ group: ["phaser/*"], message: "core は Phaser を参照できない" }],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "シード付きの乱数を使う（開発環境構築計画 5章）",
        },
        {
          object: "Date",
          property: "now",
          message: "実時間を使わない。時間は固定の時間刻みで受け取る",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "実時間を使わない。時間は固定の時間刻みで受け取る",
        },
      ],
    },
  },
  {
    files: ["packages/content/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "phaser",
              message: "content は Phaser を参照できない（データとスキーマの読み込みだけ）",
            },
            { name: "@stella/game", message: "content は game を参照できない" },
          ],
        },
      ],
    },
  },
);
