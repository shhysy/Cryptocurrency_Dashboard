import type { DashboardData } from "@/lib/types";
import { num, usd } from "@/lib/format";

/** 账户余额：现货账户内全部非零资产（含稳定币现金），按折合 USDT 从大到小排列。 */
export default function Balances({ data, bare = false }: { data: DashboardData; bare?: boolean }) {
  const { assets, cashUsdt } = data.account;
  const total = data.summary.totalAssets;
  return (
    <section className={bare ? "" : "glass fade-in p-5 sm:p-8"} aria-label="账户余额">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
   <h2 className="text-lg font-semibold">账户余额</h2>
          <p className="mt-1 text-xs text-mute">现货账户全部资产（含活期理财）{data.source === "mock" ? "，示例数据" : ""}，不含合约和其他交易所</p>
 </div>
        <p className="num text-sm text-sub">
   现金（稳定币）<b className="text-fg">{usd(cashUsdt, 2)}</b>
        </p>
      </div>

      {assets.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line px-4 py-6 text-center text-sm text-mute">
          现货账户目前没有任何余额。资产在理财、资金账户、合约或其他交易所的话，这里读不到，请到「买入记录」手动导入。
 </p>
      ) : (
        <ul className="mt-5 divide-y divide-line">
   {assets.map((a) => (
            <li key={a.asset} className="flex items-center justify-between gap-4 py-3 text-sm">
       <span className="font-semibold">{a.asset}</span>
       <span className="num text-sub">{num(a.qty, a.qty >= 100 ? 2 : 6)}</span>
       <span className="num w-28 text-right text-fg">
  {a.usdt === null ? "—" : usd(a.usdt, 2)}
         {a.usdt !== null && total > 0 && <em className="ml-2 text-[11px] not-italic text-mute">{((a.usdt / total) * 100).toFixed(0)}%</em>}
       </span>
            </li>
   ))}
 </ul>
      )}
    </section>
  );
}
