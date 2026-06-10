import type { Session } from '../state/session'
import type { SyncStatus } from '../types'
import { soundEngine } from '../audio/sounds'

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
  private readonly board = must('board')
  private readonly statusDot = must('status-dot')
  private readonly statusText = must('status-text')
  private readonly sessionEl = must('session-id')
  private readonly peersEl = must('peer-count')
  private readonly cooldownEl = must('cooldown-text')
  private readonly soundToggle = must('sound-toggle')
  private readonly cooldownBar = must('cooldown-bar')
  private readonly toastEl = must('toast')
  private readonly colorInput = must<HTMLInputElement>('color-input')
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private cooldownPulseTimer: ReturnType<typeof setTimeout> | null = null
  private cooldownResetTimer: ReturnType<typeof setTimeout> | null = null
  private cooldownState: 'idle' | 'cooldown' | 'animating' = 'idle'

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

    const storedMuted = localStorage.getItem('p2p-pixels:muted') === 'true'
    soundEngine.muted = storedMuted
    this.updateSoundButton()
    this.soundToggle.addEventListener('click', () => {
      soundEngine.muted = !soundEngine.muted
      localStorage.setItem('p2p-pixels:muted', String(soundEngine.muted))
      this.updateSoundButton()
    })
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

  setCooldown(msRemaining: number, totalMs?: number): void {
    this.cooldownEl.textContent =
      msRemaining <= 0
        ? 'Ready — click a pixel to paint it'
        : `Next pixel in ${formatMs(msRemaining)}`

    const onCooldown = msRemaining > 0
    this.board.classList.toggle('on-cooldown', onCooldown)

    if (!totalMs || totalMs <= 0) return

    if (onCooldown) {
      this.clearCooldownTimers()
      this.cooldownBar.classList.remove('ready', 'pulse')
      const fraction = Math.max(0, Math.min(1, 1 - msRemaining / totalMs))
      this.cooldownBar.style.width = `${fraction * 100}%`
      this.cooldownState = 'cooldown'
      return
    }

    if (this.cooldownState === 'cooldown') {
      this.clearCooldownTimers()
      this.cooldownBar.style.width = '100%'
      this.cooldownBar.classList.add('ready')
      this.cooldownState = 'animating'
      soundEngine.playPixelReady()
      this.cooldownPulseTimer = setTimeout(() => {
        this.cooldownBar.classList.add('pulse')
        this.cooldownBar.classList.remove('ready')
      }, 50)
      this.cooldownResetTimer = setTimeout(() => {
        this.cooldownBar.style.width = '0%'
        this.cooldownBar.classList.remove('ready', 'pulse')
        this.cooldownState = 'idle'
      }, 550)
      return
    }

    if (this.cooldownState === 'idle') {
      this.cooldownBar.style.width = '0%'
      this.cooldownBar.classList.remove('ready', 'pulse')
    }
  }

  toast(message: string): void {
    this.toastEl.textContent = message
    this.toastEl.hidden = false
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), 4_000)
  }

  private updateSoundButton(): void {
    this.soundToggle.textContent = soundEngine.muted ? '🔇' : '🔊'
    this.soundToggle.classList.toggle('muted', soundEngine.muted)
  }

  private clearCooldownTimers(): void {
    if (this.cooldownPulseTimer) clearTimeout(this.cooldownPulseTimer)
    if (this.cooldownResetTimer) clearTimeout(this.cooldownResetTimer)
    this.cooldownPulseTimer = null
    this.cooldownResetTimer = null
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
