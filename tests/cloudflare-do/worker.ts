import { ExecutionAccountDO } from "../../lib/execution/execution-account-do";

export { ExecutionAccountDO };

interface TestEnv {
  EXECUTION_ACCOUNT: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    const id = env.EXECUTION_ACCOUNT.idFromName("cloudflare-sqlite-integration");
    const stub = env.EXECUTION_ACCOUNT.get(id);
    return stub.fetch(new Request(`https://execution.internal${url.pathname}${url.search}`, request));
  },
};
