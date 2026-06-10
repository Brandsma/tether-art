import './style.css'
import { soundEngine } from './audio/sounds'
import { config } from './config'
import { Cooldown } from './rateLimit'
import { SyncEngine } from './net/sync'
import { PixelGrid } from './state/pixelGrid'
import { CanvasView } from './ui/canvasView'
import { formatMs, Hud } from './ui/hud'
import { initInfoModal } from './ui/infoModal'

const canvas = document.querySelector<HTMLCanvasElement>('#board')
if (!canvas) throw new Error('missing #board canvas')

const grid = new PixelGrid(config.width, config.height)
const view = new CanvasView(canvas, grid)
const hud = new Hud()
const cooldown = new Cooldown(config.cooldownMs, `p2p-pixels:last-placed:${config.roomName}`)

const sync = new SyncEngine(grid, config, {
  onStatus: (status, detail) => hud.setStatus(status, detail),
  onSession: (session, isNew) => {
    hud.setSession(session)
    if (isNew) view.repaintAll()
  },
  onRemotePixel: update => view.repaintPixel(update.i),
  onSnapshotLoaded: () => view.repaintAll(),
  onPeerCount: count => hud.setPeerCount(count),
  onNotice: message => hud.toast(message),
})

view.onPixelClick = index => {
  if (!sync.currentSession) {
    hud.toast('Still looking for an existing drawing — one moment')
    return
  }
  const remaining = cooldown.msRemaining()
  if (remaining > 0) {
    hud.toast(`On cooldown — next pixel in ${formatMs(remaining)}`)
    return
  }
  sync.placePixel(index, hud.color)
  cooldown.markUsed()
  view.repaintPixel(index)
  soundEngine.playPixelPlace(hud.color)
}

setInterval(() => hud.setCooldown(cooldown.msRemaining(), config.cooldownMs), 200)
hud.setCooldown(cooldown.msRemaining(), config.cooldownMs)

window.addEventListener('beforeunload', () => sync.stop())

sync.start()
initInfoModal(config.cooldownMs)

// Dev console handle (e.g. p2p.sync.peerCount in the browser console).
Object.assign(globalThis, { p2p: { grid, view, sync, config } })
