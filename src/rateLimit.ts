/**
 * Client-side cooldown between local pixel placements. Persisted (when a
 * storage key is given) so reloading the tab doesn't grant a free pixel.
 */
export class Cooldown {
  private lastUsedAt = Number.MIN_SAFE_INTEGER

  constructor(
    readonly intervalMs: number,
    private readonly storageKey?: string,
  ) {
    if (storageKey && typeof localStorage !== 'undefined') {
      try {
        const stored = Number.parseInt(localStorage.getItem(storageKey) ?? '', 10)
        if (Number.isFinite(stored)) this.lastUsedAt = Math.min(stored, Date.now())
      } catch {
        // Storage unavailable (private mode etc.) — cooldown just starts fresh.
      }
    }
  }

  msRemaining(now = Date.now()): number {
    return Math.max(0, this.lastUsedAt + this.intervalMs - now)
  }

  ready(now = Date.now()): boolean {
    return this.msRemaining(now) === 0
  }

  markUsed(now = Date.now()): void {
    this.lastUsedAt = now
    if (this.storageKey && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, String(now))
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Cooperative enforcement of the shared rate limit: drop updates from peers
 * that write faster than the cooldown allows, with some tolerance for clock
 * drift and latency. There is no authority in a serverless network, so a
 * modified client can still cheat locally — but honest peers simply ignore
 * the excess instead of amplifying it.
 */
export class RemoteRateValidator {
  private readonly lastAcceptedAt = new Map<string, number>()

  constructor(
    private readonly intervalMs: number,
    private readonly tolerance: number,
  ) {}

  accept(peerId: string, now = Date.now()): boolean {
    const last = this.lastAcceptedAt.get(peerId)
    if (last !== undefined && now - last < this.intervalMs * this.tolerance) return false
    this.lastAcceptedAt.set(peerId, now)
    return true
  }

  forget(peerId: string): void {
    this.lastAcceptedAt.delete(peerId)
  }
}
