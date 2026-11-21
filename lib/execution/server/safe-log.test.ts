import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { redactSecrets, safeLog } from "./safe-log";

afterEach(() => vi.unstubAllEnvs());

describe("日志脱敏", () => {
  it("遮蔽 api key/secret/signature", () => {
    expect(redactSecrets("api_key=abcd1234 secret=xyz")).toContain("***");
    expect(redactSecrets("api_key=abcd1234")).not.toContain("abcd1234");
    expect(redactSecrets('signature="deadbeefcafebabe"')).not.toContain("deadbeef");
  });

  it("遮蔽超长十六进制串", () => {
    const hex = "a".repeat(64);
    expect(redactSecrets(`sig ${hex}`)).not.toContain(hex);
  });

  it("按UTC日期写入独立日志文件且先脱敏", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trader-log-"));
    vi.stubEnv("TRADER_LOG_DIR", directory);
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      safeLog("订单已确认", "api_key=topsecretvalue", "signature=abcdef0123456789");
      const day = new Date().toISOString().slice(0, 10);
      const log = await readFile(join(directory, `trader-${day}.log`), "utf8");
      expect(log).toContain("订单已确认");
      expect(log).toContain("api_key=***");
      expect(log).not.toContain("topsecretvalue");
      expect(log).not.toContain("abcdef0123456789");
    } finally {
      spy.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

});
