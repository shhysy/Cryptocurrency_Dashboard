import Dashboard from "@/components/Dashboard";
import { getDashboard } from "@/lib/service";
import { buildMock } from "@/lib/mock";
import { buildDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const { scenario } = await searchParams;

  // 浏览器直连模式：服务端不调币安，直接下发一个 mock 占位，由客户端 useEffect 拉真实数据。
  if (process.env.NEXT_PUBLIC_DIRECT_BINANCE === "1") {
    const { raw, scenario: sc } = buildMock(scenario);
    const placeholder = buildDashboard(raw, { source: "mock", updatedAt: Date.now(), scenario: sc });
    return <Dashboard initial={placeholder} />;
  }

  try {
    const data = await getDashboard({ scenario });
    return <Dashboard initial={data} />;
  } catch (e) {
    console.error("[page]", e instanceof Error ? e.message : e);
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-2xl font-semibold">暂时无法获取数据</p>
        <p className="mt-3 text-sm text-mute">币安接口不可用且没有缓存。请稍后刷新，或检查网络 / 代理 / API Key 配置。</p>
      </main>
    );
  }
}
