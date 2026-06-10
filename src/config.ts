/**
 * App configuration. A few values can be overridden per-tab via URL params,
 * which is handy during development (e.g. `?room=test&cooldown=2000`).
 *
 * width/height/cooldownMs are effectively part of the protocol: peers
 * validate each other against their own copy of these values, so all
 * clients should ship the same defaults.
 */

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)

function intParam(name: string, fallback: number): number {
  const raw = params.get(name)
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  /** Drawing dimensions in pixels. All peers must agree. */
  width: 1000,
  height: 1000,

  /** Time a user must wait between placing two pixels. Override: ?cooldown=<ms>. */
  cooldownMs: intParam('cooldown', 60_000),

  /**
   * Incoming updates are dropped when a peer sends faster than
   * cooldownMs * remoteRateTolerance. The slack absorbs clock drift and
   * network jitter without letting anyone draw meaningfully faster.
   */
  remoteRateTolerance: 0.8,

  /** Trystero namespace. Bump the suffix on breaking protocol changes. */
  appId: 'p2p-pixel-canvas-v1',

  /** Meeting room. ?room=<name> opens a separate, independent canvas. */
  roomName: params.get('room') ?? 'main',

  /** How long a fresh tab looks for peers before starting a new session. */
  peerWaitMs: intParam('peerwait', 8_000),

  /** How long to wait on one peer for a snapshot before asking the next. */
  snapshotTimeoutMs: 15_000,
} as const

export type AppConfig = typeof config
