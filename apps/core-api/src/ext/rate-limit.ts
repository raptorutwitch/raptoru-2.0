// Fixed-capacity token buckets for the public viewer frontier (/v1/ext/*): one per key (viewer or IP),
// in memory. ponytail: per-process buckets — several Core instances would each allow the full rate;
// move to a shared store (Postgres / Redis) if the Core is ever scaled out.

export interface BucketRule {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerS: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private lastPrune = 0;

  constructor(
    private readonly rule: BucketRule,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when `cost` tokens were available (and taken) for `key`. */
  take(key: string, cost = 1): boolean {
    const now = this.now();
    this.prune(now);
    const b = this.buckets.get(key) ?? {
      tokens: this.rule.capacity,
      at: now,
    };
    b.tokens = Math.min(
      this.rule.capacity,
      b.tokens + ((now - b.at) / 1000) * this.rule.refillPerS,
    );
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  /** Forgets full buckets (idle keys) at most once a minute: memory stays bounded by active keys. */
  private prune(now: number) {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    const full = this.rule.capacity / this.rule.refillPerS;
    for (const [key, b] of this.buckets)
      if ((now - b.at) / 1000 >= full) this.buckets.delete(key);
  }
}
