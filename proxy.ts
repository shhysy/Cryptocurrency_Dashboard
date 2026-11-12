import { NextResponse, type NextRequest } from "next/server";

/**
 * 访问密码（HTTP Basic Auth）：用户名随意，密码 = DASHBOARD_PASSWORD。
 * 未设置密码（DASHBOARD_PASSWORD 为空）时直接放行，任何能访问到该地址的人都能看到资产。
 */
function safeEqual(a: string, b: string) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (safeEqual(pass, password)) return NextResponse.next();
    } catch {
      // 落到下面的 401
    }
  }
  return new NextResponse("需要访问密码", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Signal Dashboard", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
