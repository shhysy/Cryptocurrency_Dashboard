import Dashboard from "@/components/Dashboard";
import { getDashboard } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const { scenario } = await searchParams;
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
