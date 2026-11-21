import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("遗留Spot市价下单路由", () => {
  it("无论请求内容如何都返回410，不再触达Binance下单适配器", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("LIMIT GTC"),
    });
  });
});
