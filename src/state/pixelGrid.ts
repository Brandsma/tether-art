import type { PixelUpdate } from '../types'

export const DEFAULT_BACKGROUND = 0xffffff

/**
 * The drawing itself: a grid of last-writer-wins registers, which is what
 * makes the canvas a CRDT. Each pixel remembers the (clock, writer) of the
 * write that set it, and every peer resolves conflicting writes with the
 * same comparison — so all replicas converge regardless of delivery order.
 *
 * Stored as flat typed arrays (≈12 bytes/pixel) so a 1000×1000 canvas stays
 * cheap to hold, snapshot and ship.
 */
export class PixelGrid {
  readonly width: number
  readonly height: number
  readonly size: number

  /** 0xRRGGBB per pixel. */
  readonly colors: Uint32Array
  /** Lamport clock per pixel; 0 means never painted. */
  readonly clocks: Uint32Array
  /** Writer hash per pixel; tie-break between equal clocks. */
  readonly writers: Uint32Array

  /** This replica's Lamport counter (max clock ever seen). */
  lamport = 0

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.size = width * height
    this.colors = new Uint32Array(this.size).fill(DEFAULT_BACKGROUND)
    this.clocks = new Uint32Array(this.size)
    this.writers = new Uint32Array(this.size)
  }

  /** Index for (x, y), or -1 when out of bounds. */
  indexOf(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1
    return y * this.width + x
  }

  /** Record a local pixel write and return the update to broadcast. */
  setLocal(index: number, color: number, writer: number, sessionId: string): PixelUpdate {
    const update: PixelUpdate = {
      i: index,
      c: color & 0xffffff,
      k: this.lamport + 1,
      w: writer >>> 0,
      s: sessionId,
    }
    this.apply(update)
    return update
  }

  /** LWW merge of one update. Returns true when it won and changed the pixel. */
  apply(update: PixelUpdate): boolean {
    const { i, c, k, w } = update
    if (!Number.isInteger(i) || i < 0 || i >= this.size) return false
    if (k > this.lamport) this.lamport = k
    if (!this.wins(i, c, k, w)) return false
    this.colors[i] = c
    this.clocks[i] = k
    this.writers[i] = w
    return true
  }

  private wins(i: number, c: number, k: number, w: number): boolean {
    if (k !== this.clocks[i]) return k > this.clocks[i]
    if (w !== this.writers[i]) return w > this.writers[i]
    return c > this.colors[i]
  }

  /**
   * Full state as bytes: colors ++ clocks ++ writers (platform-endian u32,
   * little-endian on every realistic client). Compression happens in the
   * network layer.
   */
  toBytes(): Uint8Array {
    const bytes = new Uint8Array(this.size * 12)
    bytes.set(new Uint8Array(this.colors.buffer, this.colors.byteOffset, this.colors.byteLength), 0)
    bytes.set(new Uint8Array(this.clocks.buffer, this.clocks.byteOffset, this.clocks.byteLength), this.size * 4)
    bytes.set(new Uint8Array(this.writers.buffer, this.writers.byteOffset, this.writers.byteLength), this.size * 8)
    return bytes
  }

  /** Replace local state with a peer's snapshot. */
  loadBytes(bytes: Uint8Array): void {
    if (bytes.byteLength !== this.size * 12) {
      throw new Error(`snapshot is ${bytes.byteLength} bytes, expected ${this.size * 12}`)
    }
    const incoming = bytes.slice() // own buffer => aligned for u32 views
    this.colors.set(new Uint32Array(incoming.buffer, 0, this.size))
    this.clocks.set(new Uint32Array(incoming.buffer, this.size * 4, this.size))
    this.writers.set(new Uint32Array(incoming.buffer, this.size * 8, this.size))
    let max = 0
    for (const clock of this.clocks) if (clock > max) max = clock
    this.lamport = max
  }
}
