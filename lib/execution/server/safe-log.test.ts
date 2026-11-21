import { describe, expect, it } from "vitest";
import { redactSecrets } from "./safe-log";

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
});
