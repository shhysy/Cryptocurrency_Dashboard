import process from "node:process";

function maskEmail(value) {
  const [name, domain] = String(value).split("@");
  if (!name || !domain) return "(地址未配置)";
  return `${name.length <= 2 ? name[0] : name.slice(0, 2)}***@${domain}`;
}

const required = ["SMTP_USER", "SMTP_PASS"];
const missing = required.filter((key) => !String(process.env[key] ?? "").trim());
if (missing.length) {
  console.error(`SMTP真实投递测试未执行：缺少配置 ${missing.join(", ")}。`);
  console.error("请在项目根目录 .env.local 中填写配置；不要把授权码提交到Git。");
  process.exit(1);
}

const to = String(process.env.MAIL_TO || process.env.SMTP_USER).trim();
const from = String(process.env.MAIL_FROM || process.env.SMTP_USER).trim();
if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(to) ||
    !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(from)) {
  console.error("SMTP真实投递测试未执行：MAIL_FROM 或 MAIL_TO 邮箱地址格式无效。");
  process.exit(1);
}

try {
  // 复用项目正式邮件发送入口，不启动Trader，也不调用Binance接口。
  const { sendSmtpTextMail } = await import("../lib/mail-notify.ts");
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  await sendSmtpTextMail(
    "【自动交易系统】SMTP真实投递测试",
    [
      "这是一封由项目内置测试命令发送的真实SMTP测试邮件。",
      "",
      "用途：验证QQ邮箱SMTP账号、授权码、SSL连接和收件地址配置。",
      "本邮件不代表任何买入或卖出信号，也不会触发交易。",
      `发送时间：${now}`,
      "",
      "如果你收到这封邮件，说明邮件已到达该邮箱。",
    ].join("\\n"),
  );
  console.log("SMTP服务器已接受测试邮件（收到服务器成功响应）。");
  console.log(`发件地址：${maskEmail(from)}`);
  console.log(`收件地址：${maskEmail(to)}`);
  console.log("请再检查收件箱和垃圾邮件箱，确认最终送达。");
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.SMTP_PASS, process.env.SMTP_USER]) {
    if (secret) message = message.split(secret).join("[已隐藏]");
  }
  console.error("SMTP真实投递测试失败：", message);
  process.exit(1);
}
