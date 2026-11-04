/**
 * パッケージの依存の規則（開発環境構築計画 3.1）が、実際に検査で守られていることを確かめる。
 * 規則を破るコードを、実際の設定のリント・型の検査にかけ、失敗することを確認する。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function lintAs(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, file) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

describe("リントによる依存の規則", () => {
  it("core から phaser を参照できない", async () => {
    const rules = await lintAs("packages/core/src/index.ts", 'import "phaser";\nexport {};\n');
    expect(rules).toContain("no-restricted-imports");
  });

  it("core から game・content を参照できない", async () => {
    const rules = await lintAs(
      "packages/core/src/index.ts",
      'import "@stella/game";\nimport "@stella/content";\nexport {};\n',
    );
    expect(rules.filter((r) => r === "no-restricted-imports")).toHaveLength(2);
  });

  it("core で Math.random・Date.now を使えない", async () => {
    const rules = await lintAs(
      "packages/core/src/index.ts",
      "export const a = Math.random();\nexport const b = Date.now();\n",
    );
    expect(rules.filter((r) => r === "no-restricted-properties")).toHaveLength(2);
  });

  it("content から phaser・game を参照できない", async () => {
    const rules = await lintAs(
      "packages/content/src/index.ts",
      'import "phaser";\nimport "@stella/game";\nexport {};\n',
    );
    expect(rules.filter((r) => r === "no-restricted-imports")).toHaveLength(2);
  });

  it("game からは phaser を参照できる", async () => {
    const rules = await lintAs("packages/game/src/main.ts", 'import "phaser";\nexport {};\n');
    expect(rules).not.toContain("no-restricted-imports");
  });
});

describe("型の検査による依存の規則", () => {
  function diagnosticsFor(tsconfigPath: string, probeName: string, code: string): string[] {
    const configFile = ts.readConfigFile(tsconfigPath, (p) => ts.sys.readFile(p));
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath));
    const probe = join(dirname(tsconfigPath), "src", probeName);
    const host = ts.createCompilerHost(parsed.options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, language) =>
      fileName === probe
        ? ts.createSourceFile(fileName, code, language)
        : getSourceFile(fileName, language);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => fileName === probe || fileExists(fileName);
    const program = ts.createProgram([probe], parsed.options, host);
    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === probe)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  }

  it("core ではブラウザの機能（document・window）を使えない", () => {
    const messages = diagnosticsFor(
      join(repoRoot, "packages/core/tsconfig.json"),
      "__probe_dom__.ts",
      "export const t = document.title;\nexport const w = window.innerWidth;\n",
    );
    expect(messages.join("\n")).toMatch(/document/);
    expect(messages.join("\n")).toMatch(/window/);
  });

  it("core では Node.js の機能（process）を使えない", () => {
    const messages = diagnosticsFor(
      join(repoRoot, "packages/core/tsconfig.json"),
      "__probe_node__.ts",
      "export const e = process.env;\n",
    );
    expect(messages.join("\n")).toMatch(/process/);
  });

  it("確認に使う tsconfig が存在する", () => {
    expect(readFileSync(join(repoRoot, "packages/core/tsconfig.json"), "utf-8")).toContain('"lib"');
  });
});
