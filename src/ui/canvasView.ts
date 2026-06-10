import type { PixelGrid } from '../state/pixelGrid'

const MIN_SCALE = 0.05
const MAX_SCALE = 64
const CLICK_SLOP_PX = 4

/** 0xRRGGBB → the 0xAABBGGRR layout ImageData uses on little-endian machines. */
function toAbgr(rgb: number): number {
  return 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 0xff)
}

/**
 * Renders the grid into a full-window canvas with pan (drag), zoom (wheel)
 * and pixel picking (click). The drawing lives in an offscreen 1:1 buffer
 * that is blitted with the current view transform every dirty frame.
 */
export class CanvasView {
  /** Called with the pixel index when the user clicks (instead of drags). */
  onPixelClick: ((index: number) => void) | null = null

  private readonly ctx: CanvasRenderingContext2D
  private readonly buffer: HTMLCanvasElement
  private readonly bufferCtx: CanvasRenderingContext2D
  private readonly image: ImageData
  private readonly pixels: Uint32Array

  private scale = 1
  private offsetX = 0
  private offsetY = 0
  private hoverIndex = -1
  private bufferDirty = true
  private viewDirty = true
  private drag: {
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly grid: PixelGrid,
  ) {
    this.ctx = mustCtx(canvas)
    this.buffer = document.createElement('canvas')
    this.buffer.width = grid.width
    this.buffer.height = grid.height
    this.bufferCtx = mustCtx(this.buffer)
    this.image = new ImageData(grid.width, grid.height)
    this.pixels = new Uint32Array(this.image.data.buffer)
    this.repaintAll()

    canvas.addEventListener('wheel', e => this.handleWheel(e), { passive: false })
    canvas.addEventListener('pointerdown', e => this.handlePointerDown(e))
    canvas.addEventListener('pointermove', e => this.handlePointerMove(e))
    canvas.addEventListener('pointerup', e => this.handlePointerUp(e))
    canvas.addEventListener('pointercancel', () => (this.drag = null))
    canvas.addEventListener('pointerleave', () => this.setHover(-1))
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('resize', () => this.resize())

    this.resize()
    this.fit()
    requestAnimationFrame(this.frame)
  }

  /** Refresh every pixel from the grid (after a snapshot load). */
  repaintAll(): void {
    const { colors } = this.grid
    for (let i = 0; i < colors.length; i++) this.pixels[i] = toAbgr(colors[i])
    this.bufferDirty = true
  }

  repaintPixel(index: number): void {
    this.pixels[index] = toAbgr(this.grid.colors[index])
    this.bufferDirty = true
  }

  // ----- render loop ------------------------------------------------------

  private readonly frame = (): void => {
    if (this.bufferDirty) {
      this.bufferCtx.putImageData(this.image, 0, 0)
      this.bufferDirty = false
      this.viewDirty = true
    }
    if (this.viewDirty) {
      this.draw()
      this.viewDirty = false
    }
    requestAnimationFrame(this.frame)
  }

  private draw(): void {
    const { ctx, canvas } = this
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.offsetX, dpr * this.offsetY)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.buffer, 0, 0)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
    ctx.lineWidth = 2 / (dpr * this.scale)
    ctx.strokeRect(0, 0, this.grid.width, this.grid.height)

    if (this.hoverIndex >= 0) {
      const x = this.hoverIndex % this.grid.width
      const y = Math.floor(this.hoverIndex / this.grid.width)
      ctx.strokeStyle = 'rgba(30, 144, 255, 0.95)'
      ctx.lineWidth = 2.5 / (dpr * this.scale)
      ctx.strokeRect(x, y, 1, 1)
    }
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.viewDirty = true
  }

  /** Fit and center the whole drawing in the window. */
  private fit(): void {
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    this.scale = Math.min(cw / this.grid.width, ch / this.grid.height) * 0.92
    this.offsetX = (cw - this.grid.width * this.scale) / 2
    this.offsetY = (ch - this.grid.height * this.scale) / 2
    this.viewDirty = true
  }

  // ----- interaction ------------------------------------------------------

  private screenToIndex(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect()
    const x = Math.floor((clientX - rect.left - this.offsetX) / this.scale)
    const y = Math.floor((clientY - rect.top - this.offsetY) / this.scale)
    return this.grid.indexOf(x, y)
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const next = clamp(this.scale * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE)
    // Keep the world point under the cursor fixed while zooming.
    this.offsetX = cx - ((cx - this.offsetX) / this.scale) * next
    this.offsetY = cy - ((cy - this.offsetY) / this.scale) * next
    this.scale = next
    this.viewDirty = true
  }

  private handlePointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId)
    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    this.setHover(this.screenToIndex(e.clientX, e.clientY))
    const drag = this.drag
    if (!drag || drag.pointerId !== e.pointerId) return
    this.offsetX += e.clientX - drag.lastX
    this.offsetY += e.clientY - drag.lastY
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > CLICK_SLOP_PX) {
      drag.moved = true
    }
    this.viewDirty = true
  }

  private handlePointerUp(e: PointerEvent): void {
    const drag = this.drag
    this.drag = null
    if (!drag || drag.pointerId !== e.pointerId || drag.moved || e.button !== 0) return
    const index = this.screenToIndex(e.clientX, e.clientY)
    if (index >= 0) this.onPixelClick?.(index)
  }

  private setHover(index: number): void {
    if (index !== this.hoverIndex) {
      this.hoverIndex = index
      this.viewDirty = true
    }
  }
}

function mustCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas not supported')
  return ctx
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}
