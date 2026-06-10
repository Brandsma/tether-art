import { describe, expect, it } from 'vitest'
import { newSession, preferredSession } from './session'

describe('session', () => {
  it('creates unique ids with a creation timestamp', () => {
    const a = newSession()
    const b = newSession()
    expect(a.id).toHaveLength(16)
    expect(a.id).not.toBe(b.id)
    expect(Math.abs(Date.now() - a.createdAt)).toBeLessThan(5_000)
  })

  it('prefers the older session', () => {
    const older = { id: 'zzz', createdAt: 100 }
    const newer = { id: 'aaa', createdAt: 200 }
    expect(preferredSession(older, newer)).toBe(older)
    expect(preferredSession(newer, older)).toBe(older)
  })

  it('breaks creation-time ties by id, symmetrically', () => {
    const a = { id: 'aaa', createdAt: 100 }
    const b = { id: 'bbb', createdAt: 100 }
    expect(preferredSession(a, b).id).toBe('aaa')
    expect(preferredSession(b, a).id).toBe('aaa')
  })
})
