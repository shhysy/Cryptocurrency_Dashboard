import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("遗留Testnet市价下单路由", () => {
  it("永久拒绝旧市价下单请求", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("LIMIT GTC"),
    });
  });
});
