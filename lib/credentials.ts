/**
 * 币安只读 API 凭证（后备值）。
 *
 * 读取顺序：环境变量 BINANCE_API_KEY / BINANCE_API_SECRET 优先，没有才用这里的值。
 * 所以以后想改用 Cloudflare Secret，只要在控制台里设置同名变量，不需要再改代码。
 *
 * 注意：这个文件包含密钥，已随代码提交到 Git。该 Key 仅有「读取」权限，不能交易、不能提现。
 * 如果泄露：到币安 API 管理删除这个 Key，新建后把新值填到这里或环境变量里。
 */
export const FALLBACK_BINANCE_API_KEY = "aQOusZlcUFBEYCgEEjcWQSXP3OltrfMg1eKTe8begoUBGICD6dErbUxi0oTsphS6";
export const FALLBACK_BINANCE_API_SECRET = "I5qEveBqRguNKjvXuxO6EVeSNQVEoblACPRSw1U7J7QUMSm24iOsZ6nThgR0rrYV";
