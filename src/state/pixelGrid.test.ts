import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND, PixelGrid } from './pixelGrid'
import type { PixelUpdate } from '../types'

const update = (i: number, c: number, k: number, w: number): PixelUpdate => ({
  i,
  c,
  k,
  w,
  s: 'session-1',
})

describe('PixelGrid', () => {
  it('starts as a white canvas', () => {
    const grid = new PixelGrid(4, 4)
    expect(grid.colors[0]).toBe(DEFAULT_BACKGROUND)
    expect(grid.clocks[0]).toBe(0)
  })

  it('replicates local writes onto other grids', () => {
    const a = new PixelGrid(10, 10)
    const b = new PixelGrid(10, 10)
    const u = a.setLocal(5, 0x112233, 42, 'session-1')
    expect(b.apply(u)).toBe(true)
    expect(b.colors[5]).toBe(0x112233)
    expect(a.colors[5]).toBe(b.colors[5])
  })

  it('converges regardless of delivery order (concurrent writes)', () => {
    const w1 = update(3, 0xff0000, 4, 111)
    const w2 = update(3, 0x00ff00, 4, 222)
    const a = new PixelGrid(4, 4)
    const b = new PixelGrid(4, 4)
    a.apply(w1)
    a.apply(w2)
    b.apply(w2)
    b.apply(w1)
    expect(a.colors[3]).toBe(b.colors[3])
    expect(a.colors[3]).toBe(0x00ff00) // higher writer hash wins the tie
  })

  it('lets newer clocks win and older clocks lose', () => {
    const grid = new PixelGrid(4, 4)
    grid.apply(update(0, 0x111111, 5, 1))
    expect(grid.apply(update(0, 0x222222, 4, 9))).toBe(false)
    expect(grid.colors[0]).toBe(0x111111)
    expect(grid.apply(update(0, 0x333333, 6, 1))).toBe(true)
    expect(grid.colors[0]).toBe(0x333333)
  })

  it('rejects out-of-range or malformed indices', () => {
    const grid = new PixelGrid(4, 4)
    expect(grid.apply(update(16, 0x111111, 1, 1))).toBe(false)
    expect(grid.apply(update(-1, 0x111111, 1, 1))).toBe(false)
    expect(grid.apply(update(1.5, 0x111111, 1, 1))).toBe(false)
  })

  it('keeps its Lamport counter ahead of everything seen', () => {
    const grid = new PixelGrid(4, 4)
    grid.apply(update(0, 0x111111, 7, 1))
    const u = grid.setLocal(1, 0x222222, 2, 'session-1')
    expect(u.k).toBe(8)
  })

  it('snapshot roundtrips losslessly', () => {
    const a = new PixelGrid(10, 10)
    a.setLocal(0, 0xabcdef, 1, 'session-1')
    a.apply(update(7, 0x123456, 9, 77))
    a.apply(update(99, 0x654321, 3, 12))

    const b = new PixelGrid(10, 10)
    b.loadBytes(a.toBytes())
    expect(Array.from(b.colors)).toEqual(Array.from(a.colors))
    expect(Array.from(b.clocks)).toEqual(Array.from(a.clocks))
    expect(Array.from(b.writers)).toEqual(Array.from(a.writers))
    expect(b.lamport).toBe(9)
  })

  it('rejects snapshots of the wrong size', () => {
    const grid = new PixelGrid(4, 4)
    expect(() => grid.loadBytes(new Uint8Array(10))).toThrow(/expected/)
  })

  it('maps coordinates to indices with bounds checking', () => {
    const grid = new PixelGrid(10, 5)
    expect(grid.indexOf(0, 0)).toBe(0)
    expect(grid.indexOf(9, 4)).toBe(49)
    expect(grid.indexOf(10, 0)).toBe(-1)
    expect(grid.indexOf(0, 5)).toBe(-1)
    expect(grid.indexOf(-1, 0)).toBe(-1)
  })
})
