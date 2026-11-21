import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "esbuild";

describe("本地Trader独立Node进程bundle", () => {
  it("能将策略、SQLite、Binance只读对账和Trader循环打包为Node ESM", async () => {
    const root = process.cwd();
    const result = await build({
      absWorkingDir: root,
      entryPoints: [resolve(root, "scripts", "trader.ts")],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      alias: { "@": root },
      logLevel: "silent",
    });
    expect(result.outputFiles).toHaveLength(1);
    const bundle = result.outputFiles[0]!.text;
    expect(bundle).toContain("runTraderCycle");
    expect(bundle).toContain("openLocalExecutionStore");
    expect(bundle).toContain("data/STOP");
  });
});
