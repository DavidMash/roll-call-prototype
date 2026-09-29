export class DecisionTimer {
  private accumulatedMs = 0;
  private runningSince: number | null = null;
  private frozenMs: number | null = null;

  reset(now: number, blocked = false): void {
    this.accumulatedMs = 0;
    this.runningSince = blocked ? null : now;
    this.frozenMs = null;
  }

  setBlocked(blocked: boolean, now: number): void {
    if (this.frozenMs !== null) return;
    if (blocked && this.runningSince !== null) {
      this.accumulatedMs += Math.max(0, now - this.runningSince);
      this.runningSince = null;
    } else if (!blocked && this.runningSince === null) {
      this.runningSince = now;
    }
  }

  elapsed(now: number): number {
    if (this.frozenMs !== null) return this.frozenMs;
    return this.accumulatedMs + (this.runningSince === null ? 0 : Math.max(0, now - this.runningSince));
  }

  freeze(now: number): number {
    this.frozenMs = this.elapsed(now);
    this.runningSince = null;
    return this.frozenMs;
  }
}
