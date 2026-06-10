import { describe, expect, it } from 'vitest'
import { fnv1a } from './util'

describe('fnv1a', () => {
  it('returns the FNV offset basis for an empty string', () => {
    // The loop body never executes, so the only output is the initial hash.
    expect(fnv1a('')).toBe(0x811c9dc5)
  })

  it('always returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'hello world', 'peer-id-abc123', '\u{1F600}']) {
      const h = fnv1a(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
      expect(Number.isInteger(h)).toBe(true)
    }
  })

  it('is deterministic — same input always produces the same output', () => {
    const input = 'peer-id-abc123'
    expect(fnv1a(input)).toBe(fnv1a(input))
    expect(fnv1a('trystero-peer')).toBe(fnv1a('trystero-peer'))
  })

  it('produces distinct hashes for distinct inputs', () => {
    const inputs = ['peer-a', 'peer-b', 'peer-c', '', 'abc', 'abd', 'x'.repeat(100)]
    const hashes = inputs.map(fnv1a)
    expect(new Set(hashes).size).toBe(inputs.length)
  })

  it('is sensitive to character order', () => {
    expect(fnv1a('ab')).not.toBe(fnv1a('ba'))
  })
})
