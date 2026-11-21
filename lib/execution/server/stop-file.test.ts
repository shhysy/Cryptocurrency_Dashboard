import { describe, expect, it, vi } from "vitest";
import { isStopFilePresent } from "./stop-file";

describe("STOP文件检查", () => {
  it("文件存在时返回停机", async () => {
    const accessFile = vi.fn(async () => undefined);
    await expect(isStopFilePresent("data/STOP", accessFile)).resolves.toBe(true);
  });

  it("仅明确ENOENT代表未创建STOP文件", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const accessFile = vi.fn(async () => { throw missing; });
    await expect(isStopFilePresent("data/STOP", accessFile)).resolves.toBe(false);
  });

  it.each(["EACCES", "EPERM", "EIO"])("遇到%s时按停机处理", async (code) => {
    const failure = Object.assign(new Error("filesystem error"), { code });
    const accessFile = vi.fn(async () => { throw failure; });
    await expect(isStopFilePresent("data/STOP", accessFile)).resolves.toBe(true);
  });
});
