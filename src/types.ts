/**
 * Wire-format types. These are type aliases (not interfaces) on purpose so
 * they satisfy Trystero's JSON-payload constraint.
 */

/** A single pixel write as it travels between peers. */
export type PixelUpdate = {
  /** Pixel index: y * width + x. */
  i: number
  /** Color, 0xRRGGBB. */
  c: number
  /** Lamport clock of the write. */
  k: number
  /** 32-bit hash of the writer's peer id; tie-break for concurrent writes. */
  w: number
  /** Session id the write belongs to. */
  s: string
}

/** Session announcement. `sessionId: null` means "I have no drawing either". */
export type SessionMeta = {
  sessionId: string | null
  createdAt: number | null
}

/** Metadata attached to a (binary) snapshot transfer. */
export type SnapshotMeta = {
  sessionId: string
  createdAt: number
  width: number
  height: number
}

export type SyncStatus = 'searching' | 'syncing' | 'live'
