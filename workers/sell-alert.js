const STATE_KEY = "active-sell-signals";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function money(value) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "暂无";
}

function quantity(value) {
  if (!Number.isFinite(Number(value))) return "暂无";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : "暂无";
}

function signalKey(signal) {
  return [signal.symbol, signal.action.kind, signal.action.label].join(":");
}

function collectSellSignals(data) {
  if (data?.source !== "binance") {
    throw new Error("看板当前不是 Binance 实时数据，跳过邮件通知");
  }
  if (data?.stale) {
    throw new Error("看板数据已标记为过期，跳过邮件通知，避免使用旧价格");
  }

  return (data.coins ?? [])
    .map((coin) => ({ ...coin.signal, price: coin.price, avgCost: coin.avgCost }))
    .filter((signal) =>
      signal?.action?.side === "sell" &&
      Number.isFinite(Number(signal.action.qty)) &&
      Number(signal.action.qty) > 0
    );
}

function renderEmail(signals, checkedAt) {
  const rows = signals.map((signal) => {
    const action = signal.action;
    const returnPct = signal.metrics?.returnPct;
    const reason = (action.notes ?? []).map(escapeHtml).join("<br>") || "策略卖出条件已触发";
    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb"><b>${escapeHtml(signal.symbol)}</b><br><span style="color:#64748b">${escapeHtml(action.label)}</span></td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb">${money(signal.price)} USDT</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb">${money(signal.avgCost)} USDT</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb">${percent(returnPct)}</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb"><b>${quantity(action.qty)}</b> (${percent(action.sellPct)})</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb">约 ${money(action.usdt)} USDT</td>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb">${reason}</td>
      </tr>`;
  }).join("");

  const text = signals.map((signal) => {
    const a = signal.action;
    return [
      `${signal.symbol} · ${a.label}`,
      `当前价格：${money(signal.price)} USDT`,
      `平均成本：${money(signal.avgCost)} USDT`,
      `当前收益：${percent(signal.metrics?.returnPct)}`,
      `建议卖出：${quantity(a.qty)} (${percent(a.sellPct)})`,
      `预估金额：${money(a.usdt)} USDT`,
      `触发原因：${(a.notes ?? []).join("；")}`,
    ].join("\n");
  }).join("\n\n");

  return {
    subject: `[卖出提醒] ${signals.map((s) => s.symbol).join("、")} 已触发卖出条件`,
    text: `长期投资信号看板卖出提醒\n检查时间：${checkedAt}\n\n${text}\n\n此邮件仅为策略提醒，不会自动下单。`,
    html: `
      <div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;max-width:1100px;margin:auto">
        <h2 style="color:#b91c1c">卖出条件已触发</h2>
        <p>检查时间：${escapeHtml(checkedAt)}</p>
        <p>以下建议来自看板现有卖出策略，请核对交易所实际持仓后再决定是否操作。</p>
        <div style="overflow-x:auto">
          <table style="border-collapse:collapse;width:100%;font-size:14px">
            <thead><tr style="background:#f1f5f9;text-align:left">
              <th style="padding:12px">币种 / 策略</th><th style="padding:12px">当前价</th>
              <th style="padding:12px">平均成本</th><th style="padding:12px">收益率</th>
              <th style="padding:12px">建议卖出数量</th><th style="padding:12px">预估金额</th>
              <th style="padding:12px">触发原因</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p style="color:#64748b;font-size:12px;margin-top:20px">本邮件仅提供策略提醒，不会自动下单或卖出。卖出数量是现有策略根据看板持仓数据计算的建议值。</p>
      </div>`,
  };
}

async function sendEmail(env, message) {
  const recipients = String(env.MAIL_TO ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || recipients.length === 0) {
    throw new Error("邮件配置缺失：请设置 RESEND_API_KEY、MAIL_FROM、MAIL_TO");
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to: recipients, ...message }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Resend 邮件发送失败（${response.status}）：${detail}`);
  }
}

async function checkAndNotify(env) {
  if (!env.DASHBOARD_API_URL) throw new Error("缺少 DASHBOARD_API_URL");
  if (!env.SELL_ALERTS) throw new Error("缺少 SELL_ALERTS KV 绑定");

  const headers = { Accept: "application/json" };
  if (env.DASHBOARD_PASSWORD) {
    headers.Authorization = `Basic ${btoa(`worker:${env.DASHBOARD_PASSWORD}`)}`;
  }

  const response = await fetch(env.DASHBOARD_API_URL, {
    headers,
    signal: AbortSignal.timeout(25000),
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!response.ok) throw new Error(`看板接口返回 HTTP ${response.status}`);

  const data = await response.json();
  const signals = collectSellSignals(data);
  const current = new Map(signals.map((signal) => [signalKey(signal), signal]));
  const previous = new Set(await env.SELL_ALERTS.get(STATE_KEY, { type: "json" }) ?? []);

  // 仅保留仍然处于触发状态的旧信号；新信号发送成功后再写入 KV。
  const nextActive = new Set([...previous].filter((key) => current.has(key)));
  const newSignals = [...current.entries()].filter(([key]) => !previous.has(key)).map(([, signal]) => signal);

  if (newSignals.length > 0) {
    const checkedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    const message = renderEmail(newSignals, checkedAt);
    await sendEmail(env, message);
    for (const signal of newSignals) nextActive.add(signalKey(signal));
  }

  await env.SELL_ALERTS.put(STATE_KEY, JSON.stringify([...nextActive]));
  return { checked: signals.length, emailed: newSignals.length };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkAndNotify(env).catch((error) => {
      console.error("[sell-alert]", error instanceof Error ? error.message : String(error));
    }));
  },

  // 手动验证用：访问 Worker 根路径会立即检查一次。建议上线后限制访问或删除此入口。
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("POST to run one sell-alert check", { status: 405 });
    }
    try {
      const result = await checkAndNotify(env);
      return Response.json({ ok: true, ...result });
    } catch (error) {
      console.error("[sell-alert]", error instanceof Error ? error.message : String(error));
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "unknown" }, { status: 502 });
    }
  },
};
