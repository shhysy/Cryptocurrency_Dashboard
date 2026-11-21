import { describe, expect, it, vi } from "vitest";
import { verifyCloudflareAccessJwt } from "./cloudflare-access.server";

describe("Cloudflare Access verification", () => {
  it("fails closed when no Access JWT is supplied", async () => {
    const result = await verifyCloudflareAccessJwt(null, {
      teamDomain: "https://example.cloudflareaccess.com",
      audience: "test-audience",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("缺少 Cloudflare Access");
  });

  it("fails closed until issuer and audience are configured", async () => {
    const result = await verifyCloudflareAccessJwt("a.b.c", {
      teamDomain: "",
      audience: "",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("尚未配置");
  });

  it("rejects malformed JWTs without fetching public keys", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await verifyCloudflareAccessJwt("not-a-jwt", {
      teamDomain: "https://example.cloudflareaccess.com",
      audience: "test-audience",
    });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
