import type { Session } from '../state/session'
import type { SyncStatus } from '../types'

const STATUS_LABEL: Record<SyncStatus, string> = {
  searching: 'looking for peers…',
  syncing: 'downloading drawing…',
  live: 'live',
}

const SWATCHES = [
  '#000000', '#ffffff', '#d32f2f', '#f57c00',
  '#fbc02d', '#388e3c', '#1976d2', '#7b1fa2',
]

/** Thin binding layer over the static HTML chrome around the canvas. */
export class Hud {
  private readonly statusDot = must('status-dot')
  private readonly statusText = must('status-text')
  private readonly sessionEl = must('session-id')
  private readonly peersEl = must('peer-count')
  private readonly cooldownEl = must('cooldown-text')
  private readonly toastEl = must('toast')
  private readonly colorInput = must<HTMLInputElement>('color-input')
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const swatches = must('swatches')
    for (const hex of SWATCHES) {
      const button = document.createElement('button')
      button.className = 'swatch'
      button.style.background = hex
      button.title = hex
      button.addEventListener('click', () => (this.colorInput.value = hex))
      swatches.append(button)
    }
  }

  /** Currently selected color as 0xRRGGBB. */
  get color(): number {
    return Number.parseInt(this.colorInput.value.slice(1), 16) & 0xffffff
  }

  setStatus(status: SyncStatus, detail?: string): void {
    this.statusDot.className = `dot ${status}`
    this.statusText.textContent = detail ? `${STATUS_LABEL[status]} ${detail}` : STATUS_LABEL[status]
  }

  setSession(session: Session): void {
    this.sessionEl.textContent = session.id.slice(0, 8)
    this.sessionEl.title = `created ${new Date(session.createdAt).toLocaleString()}`
  }

  setPeerCount(count: number): void {
    this.peersEl.textContent = String(count)
  }

  setCooldown(msRemaining: number): void {
    this.cooldownEl.textContent =
      msRemaining <= 0
        ? 'Ready — click a pixel to paint it'
        : `Next pixel in ${formatMs(msRemaining)}`
  }

  toast(message: string): void {
    this.toastEl.textContent = message
    this.toastEl.hidden = false
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), 4_000)
  }
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}
