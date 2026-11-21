/** 连续异常熔断：达到阈值后由调用方写入 data/STOP。 */
export class ConsecutiveFailureBreaker {
  private failures = 0;
  constructor(private readonly threshold: number) {
    if (!Number.isSafeInteger(threshold) || threshold < 1) {
      throw new Error("熔断阈值必须是正整数");
    }
  }
  recordSuccess(): void {
    this.failures = 0;
  }
  recordFailure(): boolean {
    this.failures += 1;
    // 只在首次跨过阈值时触发熔断；后续失败不重复执行熔断副作用。
    return this.failures === this.threshold;
  }
  get count(): number {
    return this.failures;
  }
}
