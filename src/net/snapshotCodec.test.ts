import { describe, expect, it } from 'vitest'
import { deflate, inflate } from './compress'
import { decodeSnapshot, encodeSnapshot } from './snapshotCodec'

describe('snapshot codec', () => {
  it('roundtrips a header and body', () => {
    const header = { sessionId: 'abc123', createdAt: 1234, width: 10, height: 10 }
    const body = new Uint8Array([1, 2, 3, 250, 251, 252])
    const decoded = decodeSnapshot(encodeSnapshot(header, body))
    expect(decoded).not.toBeNull()
    expect(decoded!.header).toEqual(header)
    expect(Array.from(decoded!.body)).toEqual(Array.from(body))
  })

  it('roundtrips the "no session" response', () => {
    const decoded = decodeSnapshot(encodeSnapshot({ sessionId: null }, new Uint8Array(0)))
    expect(decoded).not.toBeNull()
    expect(decoded!.header.sessionId).toBeNull()
    expect(decoded!.body.byteLength).toBe(0)
  })

  it('rejects garbage and truncated input', () => {
    expect(decodeSnapshot(new Uint8Array(0))).toBeNull()
    expect(decodeSnapshot(new Uint8Array([255, 255, 255, 255, 1, 2]))).toBeNull()
    expect(decodeSnapshot(new TextEncoder().encode('not a snapshot'))).toBeNull()
  })

  it('survives views at a non-zero byte offset', () => {
    const encoded = encodeSnapshot({ sessionId: null }, new Uint8Array([9]))
    const padded = new Uint8Array(encoded.byteLength + 3)
    padded.set(encoded, 3)
    const view = padded.subarray(3)
    expect(decodeSnapshot(view)).not.toBeNull()
  })
})

describe('compress', () => {
  it('roundtrips bytes through deflate/inflate', async () => {
    const data = new Uint8Array(50_000)
    for (let i = 0; i < 200; i++) data[i * 137] = i % 256
    const packed = await deflate(data)
    expect(packed.byteLength).toBeLessThan(data.byteLength / 10) // mostly zeros
    const restored = await inflate(packed)
    expect(Array.from(restored)).toEqual(Array.from(data))
  })
})
