// Cadence of the Lab workers (TTS, Soundboard, Bonk) — ASTRA-P2-017. With local work (entries to
// hand out, ACK or settle) a tick every 150 ms, as before. With none, every empty tick doubles the
// delay up to 1 s instead of claiming from Core ~6 times a second for nothing (≈ 9 ms of HTTP + Core
// transaction each). An admission that just went through Studio wakes the loop at once, so a
// viewer's purchase is claimed without any added delay. Never two ticks at a time.

export const ACTIVE_MS = 150;
export const IDLE_MAX_MS = 1_000;

export class WorkerLoop {
  private running = false;
  private ticking = false;
  private woken = false;
  private delay = ACTIVE_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly tick: () => Promise<void>,
    /** Local work in progress (entries): keep the active cadence. */
    private readonly busy: () => boolean,
    /**
     * Last tick failed (Core unreachable, refused…): back off like an idle loop even with local work,
     * never hammer a remote Core (production transport, ASTRA-P1-019). Not set by the Lab runtimes.
     */
    private readonly failed: () => boolean = () => false,
  ) {}

  start() {
    this.running = true;
    void this.run();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** Something to claim now (an admission went through): tick at once, active cadence. */
  wake() {
    if (!this.running) return;
    this.delay = ACTIVE_MS;
    if (this.ticking) {
      this.woken = true; // right after the tick in progress
      return;
    }
    clearTimeout(this.timer);
    void this.run();
  }

  private async run() {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      await this.tick();
    } finally {
      this.ticking = false;
    }
    if (!this.running) return;
    const active = this.woken || (this.busy() && !this.failed());
    this.delay = active ? ACTIVE_MS : Math.min(IDLE_MAX_MS, this.delay * 2);
    const wait = this.woken ? 0 : this.delay;
    this.woken = false;
    this.timer = setTimeout(() => void this.run(), wait);
  }
}
