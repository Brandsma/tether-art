import { describe, expect, it } from 'vitest'
import { Cooldown, RemoteRateValidator } from './rateLimit'

describe('Cooldown', () => {
  it('is ready immediately after creation', () => {
    const cooldown = new Cooldown(60_000)
    expect(cooldown.ready(1_000_000)).toBe(true)
  })

  it('blocks for the configured interval after use', () => {
    const cooldown = new Cooldown(60_000)
    const t0 = 1_000_000
    cooldown.markUsed(t0)
    expect(cooldown.ready(t0 + 59_999)).toBe(false)
    expect(cooldown.msRemaining(t0 + 30_000)).toBe(30_000)
    expect(cooldown.ready(t0 + 60_000)).toBe(true)
  })
})

describe('RemoteRateValidator', () => {
  it('accepts a first update, then enforces the interval with tolerance', () => {
    const validator = new RemoteRateValidator(60_000, 0.8)
    const t0 = 1_000_000
    expect(validator.accept('peer-a', t0)).toBe(true)
    expect(validator.accept('peer-a', t0 + 47_999)).toBe(false) // < 80% of 60s
    expect(validator.accept('peer-a', t0 + 48_000)).toBe(true)
  })

  it('tracks peers independently and forgets them on leave', () => {
    const validator = new RemoteRateValidator(60_000, 0.8)
    const t0 = 1_000_000
    expect(validator.accept('peer-a', t0)).toBe(true)
    expect(validator.accept('peer-b', t0)).toBe(true)
    expect(validator.accept('peer-a', t0 + 1_000)).toBe(false)
    validator.forget('peer-a')
    expect(validator.accept('peer-a', t0 + 2_000)).toBe(true)
  })
})
