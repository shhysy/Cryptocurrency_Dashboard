const STATE_KEY = "active-sell-signals";

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
      } : {}),
    },
  });
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function number(value, digits = 8) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—";
}

function normalizeSignals(body) {
  if (!Array.isArray(body?.signals)) throw new Error("请求缺少 signals 数组");
  if (body.signals.length > 30) throw new Error("单次信号数量超出限制");

  return body.signals
    .filter((s) =>
      typeof s?.symbol === "string" &&
      s.symbol.length > 0 &&
      s.symbol.length <= 20 &&
      typeof s?.kind === "string" &&
      s.kind.length <= 40 &&
      Number.isFinite(Number(s.qty)) &&
      Number(s.qty) > 0
    )
    .map((s) => ({
      symbol: s.symbol,
      name: String(s.name ?? s.symbol).slice(0, 40),
      kind: s.kind,
      label: String(s.label ?? s.kind).slice(0, 80),
      price: Number(s.price),
      avgCost: s.avgCost == null ? null : Number(s.avgCost),
      returnPct: s.returnPct == null ? null : Number(s.returnPct),
      qty: Number(s.qty),
      sellPct: s.sellPct == null ? null : Number(s.sellPct),
      usdt: s.usdt == null ? null : Number(s.usdt),
      notes: Array.isArray(s.notes) ? s.notes.slice(0, 8).map((x) => String(x).slice(0, 240)) : [],
    }));
}

function keyOf(s) {
  return `${s.symbol}:${s.kind}:${s.label}`;
}

function emailContent(signals, checkedAt) {
  const subject = `【卖出提醒】${signals.map((s) => s.symbol).join("、")} 已触发卖出条件`;
  const lines = signals.map((s) => [
    `${s.name}（${s.symbol}）— ${s.label}`,
    `当前价格：${money(s.price)} USDT`,
    `持仓成本：${money(s.avgCost)} USDT`,
    `当前收益率：${pct(s.returnPct)}`,
    `建议卖出数量：${number(s.qty)}`,
    `建议卖出比例：${pct(s.sellPct)}`,
    `预估卖出金额：${money(s.usdt)} USDT`,
    `触发原因：${s.notes.join("；") || "策略卖出条件已触发"}`,
  ].join("\n"));

  const rows = signals.map((s) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb"><b>${safeText(s.symbol)}</b><br>${safeText(s.label)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb">${money(s.price)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb">${money(s.avgCost)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb">${pct(s.returnPct)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb"><b>${number(s.qty)}</b><br>${pct(s.sellPct)}</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb">${money(s.usdt)} USDT</td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb">${s.notes.map(safeText).join("<br>") || "策略卖出条件已触发"}</td>
    </tr>`).join("");

  return {
    subject,
    text: [
      "长期投资信号看板 — 卖出条件提醒",
      `检查时间：${checkedAt}`,
      "",
      ...lines,
      "",
      "本邮件仅为策略提醒，不会自动下单或卖出。请核对交易所实际持仓后再决定。",
    ].join("\n\n"),
    html: `
      <div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;max-width:1100px;margin:auto">
        <h2 style="color:#b91c1c">卖出条件已触发</h2>
        <p>检查时间：${safeText(checkedAt)}</p>
        <div style="overflow-x:auto">
          <table style="border-collapse:collapse;width:100%;font-size:14px">
            <thead><tr style="background:#f1f5f9;text-align:left">
              <th style="padding:12px">币种 / 策略</th><th style="padding:12px">当前价</th>
              <th style="padding:12px">持仓成本</th><th style="padding:12px">收益率</th>
              <th style="padding:12px">建议卖出数量 / 比例</th><th style="padding:12px">预估金额</th>
              <th style="padding:12px">触发原因</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p style="color:#64748b;font-size:12px;margin-top:20px">仅提醒，不会自动交易。建议卖出数量取自看板现有策略计算结果。</p>
      </div>`,
  };
}

async function sendEmail(env, message) {
  const to = String(env.MAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to.length) {
    throw new Error("邮件配置缺失：RESEND_API_KEY、MAIL_FROM、MAIL_TO");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to, ...message }),
  });
  if (!response.ok) throw new Error(`邮件发送失败：HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigin = String(env.ALLOWED_ORIGIN ?? "").replace(/\/$/, "");
    if (!allowedOrigin || origin !== allowedOrigin) {
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
        },
      });
    }
    if (request.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405, allowedOrigin);

    try {
      if (!env.SELL_ALERTS) throw new Error("未绑定 SELL_ALERTS KV");
      const body = await request.json();
      const signals = normalizeSignals(body);
      const current = new Map(signals.map((s) => [keyOf(s), s]));
      const previous = new Set(await env.SELL_ALERTS.get(STATE_KEY, { type: "json" }) ?? []);
      const next = new Set([...previous].filter((key) => current.has(key)));
      const fresh = [...current.entries()].filter(([key]) => !previous.has(key)).map(([, signal]) => signal);

      if (fresh.length) {
        const checkedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
        await sendEmail(env, emailContent(fresh, checkedAt));
        for (const signal of fresh) next.add(keyOf(signal));
      }

      await env.SELL_ALERTS.put(STATE_KEY, JSON.stringify([...next]));
      return json({ ok: true, active: signals.length, sent: fresh.length }, 200, allowedOrigin);
    } catch (error) {
      console.error("[sell-alert]", error instanceof Error ? error.message : String(error));
      return json({ ok: false, error: error instanceof Error ? error.message : "unknown" }, 502, allowedOrigin);
    }
  },
};
