import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStartupSelfCheck } from "./startup-self-check";

describe("启动自检", () => {
  it("off 模式仅检查数据目录可写", async () => {
    const dir = await mkdtemp(join(tmpdir(), "selfcheck-"));
    const result = await runStartupSelfCheck({ mode: "off", dataDir: dir });
    expect(result.ok).toBe(true);
  });
});
