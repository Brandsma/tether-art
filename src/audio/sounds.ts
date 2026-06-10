type AudioContextWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext
}

export class SoundEngine {
  muted = false

  private context: AudioContext | null = null
  private initAttempted = false
  private noiseBuffer: AudioBuffer | null = null

  playPixelPlace(color: number): void {
    this.safely(context => {
      const now = context.currentTime
      const hue = colorToHue(color)
      const pitch = 540 + (hue / 360) * 160
      const duration = 0.08

      const output = context.createGain()
      output.gain.setValueAtTime(0.18, now)
      output.connect(context.destination)

      const noiseSource = context.createBufferSource()
      noiseSource.buffer = this.getNoiseBuffer(context)

      const noiseFilter = context.createBiquadFilter()
      noiseFilter.type = 'bandpass'
      noiseFilter.frequency.setValueAtTime(900 + (hue / 360) * 900, now)
      noiseFilter.Q.setValueAtTime(4, now)

      const noiseGain = context.createGain()
      noiseGain.gain.setValueAtTime(0.0001, now)
      noiseGain.gain.linearRampToValueAtTime(0.55, now + 0.008)
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

      noiseSource.connect(noiseFilter)
      noiseFilter.connect(noiseGain)
      noiseGain.connect(output)

      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(pitch * 1.4, now)
      osc.frequency.exponentialRampToValueAtTime(pitch, now + 0.02)
      osc.frequency.exponentialRampToValueAtTime(Math.max(220, pitch * 0.72), now + duration)

      const oscGain = context.createGain()
      oscGain.gain.setValueAtTime(0.0001, now)
      oscGain.gain.exponentialRampToValueAtTime(0.45, now + 0.004)
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

      osc.connect(oscGain)
      oscGain.connect(output)

      noiseSource.start(now)
      noiseSource.stop(now + duration)
      osc.start(now)
      osc.stop(now + duration)

      disconnectOnEnd(noiseSource, noiseFilter, noiseGain)
      disconnectOnEnd(osc, oscGain, output)
    })
  }

  playPixelReady(): void {
    this.safely(context => {
      const now = context.currentTime
      this.playTone(context, 880, now, 0.12, 0.12)
      this.playTone(context, 1100, now + 0.11, 0.12, 0.12)
    })
  }

  playPeerJoin(): void {
    this.safely(context => {
      const now = context.currentTime
      this.playTone(context, 200, now, 0.07, 0.09)
      this.playTone(context, 300, now + 0.07, 0.08, 0.09)
    })
  }

  playPeerLeave(): void {
    this.safely(context => {
      const now = context.currentTime
      this.playTone(context, 300, now, 0.07, 0.09)
      this.playTone(context, 200, now + 0.07, 0.08, 0.09)
    })
  }

  playCooldownBlocked(): void {
    this.safely(context => {
      const now = context.currentTime
      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(80, now)
      osc.frequency.exponentialRampToValueAtTime(62, now + 0.12)

      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)

      osc.connect(gain)
      gain.connect(context.destination)

      osc.start(now)
      osc.stop(now + 0.12)
      disconnectOnEnd(osc, gain)
    })
  }

  private safely(play: (context: AudioContext) => void): void {
    if (this.muted) return

    try {
      const context = this.getContext()
      if (!context) return
      play(context)
    } catch {}
  }

  private getContext(): AudioContext | null {
    if (this.context) {
      void this.context.resume().catch(() => {})
      return this.context
    }

    if (this.initAttempted) return null
    this.initAttempted = true

    try {
      const AudioContextCtor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
      if (!AudioContextCtor) return null

      this.context = new AudioContextCtor()
      void this.context.resume().catch(() => {})
      return this.context
    } catch {
      return null
    }
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer?.sampleRate === context.sampleRate) return this.noiseBuffer

    const frameCount = Math.max(1, Math.floor(context.sampleRate * 0.08))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const data = buffer.getChannelData(0)

    for (let i = 0; i < frameCount; i += 1) {
      data[i] = Math.random() * 2 - 1
    }

    this.noiseBuffer = buffer
    return buffer
  }

  private playTone(
    context: AudioContext,
    frequency: number,
    startTime: number,
    duration: number,
    peakGain: number,
  ): void {
    const osc = context.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, startTime)

    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    osc.connect(gain)
    gain.connect(context.destination)

    osc.start(startTime)
    osc.stop(startTime + duration)
    disconnectOnEnd(osc, gain)
  }
}

function disconnectOnEnd(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) {
      node.disconnect()
    }
    source.disconnect()
  }
}

function colorToHue(color: number): number {
  const r = ((color >> 16) & 0xff) / 255
  const g = ((color >> 8) & 0xff) / 255
  const b = (color & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  if (delta === 0) return 0

  let hue = 0
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4

  return ((hue * 60) + 360) % 360
}

export const soundEngine = new SoundEngine()
