/** Keep periodic native requests from overlapping or retrying every screen tick. */
export class RequestGate {
  private pending = false;
  private lastAttemptAt: number | null = null;

  constructor(private readonly intervalMs: number, private readonly now = () => Date.now()) {}

  async run(work: () => Promise<void>): Promise<void> {
    const now = this.now();
    if (this.pending || (this.lastAttemptAt !== null && now >= this.lastAttemptAt
      && now - this.lastAttemptAt < this.intervalMs)) return;

    this.pending = true;
    this.lastAttemptAt = now;
    try { await work(); }
    finally { this.pending = false; }
  }
}
