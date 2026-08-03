export interface RateLimiterOptions {
  /** Max burst size — tokens available with no prior consumption. */
  capacity: number;
  /** Tokens restored per second once below capacity. */
  refillPerSecond: number;
}

/** Per-connection token bucket: cheap O(1) check with no unbounded per-message history. */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly opts: RateLimiterOptions,
    now = Date.now(),
  ) {
    this.tokens = opts.capacity;
    this.lastRefill = now;
  }

  tryConsume(now = Date.now()): boolean {
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.opts.capacity,
      this.tokens + elapsedSeconds * this.opts.refillPerSecond,
    );
    this.lastRefill = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
