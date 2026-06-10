import { joinRoom, selfId } from 'trystero/nostr'
import type { AppConfig } from '../config'
import { RemoteRateValidator } from '../rateLimit'
import type { PixelGrid } from '../state/pixelGrid'
import { newSession, preferredSession, type Session } from '../state/session'
import type { PixelUpdate, SessionMeta, SyncStatus } from '../types'
import { fnv1a } from '../util'
import { deflate, inflate } from './compress'
import { decodeSnapshot, encodeSnapshot } from './snapshotCodec'

export interface SyncEvents {
  onStatus(status: SyncStatus, detail?: string): void
  onSession(session: Session, isNew: boolean): void
  /** A remote update that won its LWW merge; the grid is already updated. */
  onRemotePixel(update: PixelUpdate): void
  /** The whole grid was replaced; repaint everything. */
  onSnapshotLoaded(): void
  onPeerCount(count: number): void
  onNotice(message: string): void
}

/** Min gap between session announcements to the same peer (anti ping-pong). */
const META_THROTTLE_MS = 3_000

/**
 * Owns the Trystero room, the CRDT replication and the session lifecycle.
 *
 * Joining works like this:
 *  1. Look for peers for `peerWaitMs`.
 *  2. Ask discovered peers — one at a time — for a snapshot of the drawing.
 *  3. If someone delivers one, adopt their session. If the search times out
 *     and nobody had anything, start a brand-new session: the previous
 *     drawing ceased to exist when its last holder went offline.
 *
 * If two live sessions ever meet (two tabs started fresh simultaneously, or
 * previously partitioned groups reconnect), peers exchange `meta` messages
 * and everyone converges on `preferredSession` by fetching its snapshot.
 */
export class SyncEngine {
  /** Hash of our peer id, stamped on every pixel we place. */
  readonly writerId: number

  private readonly room: ReturnType<typeof joinRoom>
  private readonly validator: RemoteRateValidator
  private readonly peers = new Set<string>()
  private session: Session | null = null
  private stopped = false

  // Bootstrap bookkeeping: peers we still want to ask for a snapshot.
  private candidates: string[] = []
  private askLoopRunning = false
  private adopting = false
  private searchTimedOut = false
  private searchTimer: ReturnType<typeof setTimeout> | null = null
  private readonly lastMetaSentAt = new Map<string, number>()

  private readonly pixelAction
  private readonly metaAction
  private readonly stateAction

  constructor(
    private readonly grid: PixelGrid,
    private readonly cfg: AppConfig,
    private readonly events: SyncEvents,
  ) {
    this.writerId = fnv1a(selfId)
    this.validator = new RemoteRateValidator(cfg.cooldownMs, cfg.remoteRateTolerance)

    this.room = joinRoom({ appId: cfg.appId }, cfg.roomName, {
      onJoinError: details => console.warn('[sync] join error', details),
    })

    this.pixelAction = this.room.makeAction<PixelUpdate>('pixel', {
      onMessage: (data, { peerId }) => this.handlePixel(data, peerId),
    })

    this.metaAction = this.room.makeAction<SessionMeta>('meta', {
      onMessage: (data, { peerId }) => this.handleMeta(data, peerId),
    })

    this.stateAction = this.room.makeAction<null, Uint8Array>('state', {
      kind: 'request',
      onRequest: () => this.buildSnapshotResponse(),
    })

    this.room.onPeerJoin = peerId => this.handlePeerJoin(peerId)
    this.room.onPeerLeave = peerId => this.handlePeerLeave(peerId)
  }

  start(): void {
    this.events.onStatus('searching')
    this.searchTimer = setTimeout(() => {
      this.searchTimedOut = true
      void this.runAskLoop()
    }, this.cfg.peerWaitMs)
  }

  stop(): void {
    this.stopped = true
    if (this.searchTimer) clearTimeout(this.searchTimer)
    void this.room.leave()
  }

  get currentSession(): Session | null {
    return this.session
  }

  get peerCount(): number {
    return this.peers.size
  }

  /** Place a local pixel and broadcast it. Returns null before a session exists. */
  placePixel(index: number, color: number): PixelUpdate | null {
    if (!this.session) return null
    const update = this.grid.setLocal(index, color, this.writerId, this.session.id)
    this.pixelAction.send(update).catch(err => console.warn('[sync] pixel send failed', err))
    return update
  }

  // ----- peer membership -------------------------------------------------

  private handlePeerJoin(peerId: string): void {
    this.peers.add(peerId)
    this.events.onPeerCount(this.peers.size)
    if (this.session) {
      // Tell newcomers which session is running so divergent groups converge.
      this.sendMetaTo(peerId)
    } else {
      this.candidates.push(peerId)
      void this.runAskLoop()
    }
  }

  private handlePeerLeave(peerId: string): void {
    this.peers.delete(peerId)
    this.validator.forget(peerId)
    this.lastMetaSentAt.delete(peerId)
    this.candidates = this.candidates.filter(id => id !== peerId)
    this.events.onPeerCount(this.peers.size)
  }

  // ----- bootstrap: find the current drawing or start a new one ----------

  /**
   * Sequentially ask candidate peers for a snapshot. When every candidate
   * has been tried and the initial wait has passed, conclude that no drawing
   * survives and start a fresh session.
   */
  private async runAskLoop(): Promise<void> {
    if (this.askLoopRunning || this.session || this.stopped) return
    this.askLoopRunning = true
    try {
      while (!this.stopped && !this.session) {
        const peerId = this.candidates.shift()
        if (peerId === undefined) {
          if (this.searchTimedOut) this.startFreshSession()
          else this.events.onStatus('searching')
          return
        }
        if (!this.peers.has(peerId)) continue
        this.events.onStatus('syncing', `(asking ${shortId(peerId)})`)
        try {
          const response = await this.stateAction.request(null, {
            target: peerId,
            timeoutMs: this.cfg.snapshotTimeoutMs,
            onProgress: progress => {
              if (!this.session) this.events.onStatus('syncing', `${Math.round(progress * 100)}%`)
            },
          })
          await this.acceptSnapshot(response)
        } catch (err) {
          console.warn(`[sync] snapshot from ${peerId} failed`, err)
        }
      }
    } finally {
      this.askLoopRunning = false
    }
  }

  private startFreshSession(): void {
    if (this.session || this.stopped) return
    const session = newSession()
    this.session = session
    this.events.onSession(session, true)
    this.events.onStatus('live')
    this.events.onNotice(`No drawing found — started a new one (session ${shortId(session.id)})`)
    // Announce, so peers that started fresh at the same moment converge.
    this.metaAction.send(this.metaPayload()).catch(() => {})
  }

  // ----- incoming protocol messages ---------------------------------------

  private handlePixel(data: unknown, peerId: string): void {
    if (!isPixelUpdate(data, this.grid.size)) return
    if (!this.session) {
      // They clearly have a running session we don't know about yet — ask.
      this.candidates.unshift(peerId)
      void this.runAskLoop()
      return
    }
    if (data.s !== this.session.id) {
      this.sendMetaTo(peerId) // trigger session arbitration
      return
    }
    if (!this.validator.accept(peerId)) {
      console.warn(`[sync] dropped pixel from ${shortId(peerId)}: faster than the shared rate limit`)
      return
    }
    if (this.grid.apply(data)) this.events.onRemotePixel(data)
  }

  private handleMeta(data: unknown, peerId: string): void {
    if (!isSessionMeta(data) || data.sessionId === null) return
    const theirs: Session = { id: data.sessionId, createdAt: data.createdAt ?? 0 }
    if (!this.session) {
      this.candidates.unshift(peerId)
      void this.runAskLoop()
      return
    }
    if (theirs.id === this.session.id) return
    if (preferredSession(this.session, theirs).id === theirs.id) {
      void this.requestAdoption(peerId)
    } else {
      this.sendMetaTo(peerId) // ours wins — let them know and they'll adopt
    }
  }

  /** A session that predates ours exists: fetch its snapshot and switch over. */
  private async requestAdoption(peerId: string): Promise<void> {
    if (this.adopting || this.stopped) return
    this.adopting = true
    try {
      const response = await this.stateAction.request(null, {
        target: peerId,
        timeoutMs: this.cfg.snapshotTimeoutMs,
      })
      await this.acceptSnapshot(response)
    } catch (err) {
      console.warn('[sync] session adoption failed', err)
    } finally {
      this.adopting = false
    }
  }

  private async buildSnapshotResponse(): Promise<Uint8Array> {
    if (!this.session) return encodeSnapshot({ sessionId: null }, new Uint8Array(0))
    return encodeSnapshot(
      {
        sessionId: this.session.id,
        createdAt: this.session.createdAt,
        width: this.grid.width,
        height: this.grid.height,
      },
      await deflate(this.grid.toBytes()),
    )
  }

  /** Validate and (when it should win) load a snapshot response. */
  private async acceptSnapshot(response: Uint8Array): Promise<void> {
    const decoded = decodeSnapshot(asBytes(response))
    if (decoded === null) return
    const { header, body } = decoded
    if (header.sessionId === null) return // peer had nothing either
    if (header.width !== this.grid.width || header.height !== this.grid.height) {
      console.warn('[sync] peer uses an incompatible canvas size — ignoring its snapshot')
      return
    }
    const incoming: Session = { id: header.sessionId, createdAt: header.createdAt }
    if (this.session && preferredSession(this.session, incoming).id === this.session.id) return

    const wasAdoption = this.session !== null
    this.grid.loadBytes(await inflate(body))
    this.session = incoming
    this.clearBootstrap()
    this.events.onSession(incoming, false)
    this.events.onSnapshotLoaded()
    this.events.onStatus('live')
    this.events.onNotice(
      wasAdoption
        ? `Converged on the older session ${shortId(incoming.id)}`
        : `Joined drawing in progress (session ${shortId(incoming.id)})`,
    )
  }

  // ----- helpers ----------------------------------------------------------

  private clearBootstrap(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = null
    }
    this.candidates = []
  }

  private metaPayload(): SessionMeta {
    return this.session
      ? { sessionId: this.session.id, createdAt: this.session.createdAt }
      : { sessionId: null, createdAt: null }
  }

  private sendMetaTo(peerId: string): void {
    const now = Date.now()
    if (now - (this.lastMetaSentAt.get(peerId) ?? 0) < META_THROTTLE_MS) return
    this.lastMetaSentAt.set(peerId, now)
    this.metaAction.send(this.metaPayload(), { target: peerId }).catch(() => {})
  }
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function asBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(0)
}

function isPixelUpdate(data: unknown, gridSize: number): data is PixelUpdate {
  if (typeof data !== 'object' || data === null) return false
  const v = data as Record<string, unknown>
  return (
    typeof v.i === 'number' && Number.isInteger(v.i) && v.i >= 0 && v.i < gridSize &&
    typeof v.c === 'number' && Number.isInteger(v.c) && v.c >= 0 && v.c <= 0xffffff &&
    typeof v.k === 'number' && Number.isInteger(v.k) && v.k > 0 &&
    typeof v.w === 'number' && Number.isInteger(v.w) && v.w >= 0 &&
    typeof v.s === 'string' && v.s.length > 0 && v.s.length <= 64
  )
}

function isSessionMeta(data: unknown): data is SessionMeta {
  if (typeof data !== 'object' || data === null) return false
  const v = data as Record<string, unknown>
  const idOk = v.sessionId === null || (typeof v.sessionId === 'string' && v.sessionId.length <= 64)
  const createdOk = v.createdAt === null || typeof v.createdAt === 'number'
  return idOk && createdOk
}
