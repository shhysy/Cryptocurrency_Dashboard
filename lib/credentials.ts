/**
 * 浏览器端 Binance 凭证入口。
 *
 * 注意：浏览器直连必须在客户端签名，因此 NEXT_PUBLIC_* 值会进入浏览器运行环境，
 * 不能视为秘密。只可使用专用、IP 白名单限制、无提现权限的 API Key。
 * 不要把真实凭证写入源码或提交到 Git。
 */
export const FALLBACK_BINANCE_API_KEY = "";
export const FALLBACK_BINANCE_API_SECRET = "";
