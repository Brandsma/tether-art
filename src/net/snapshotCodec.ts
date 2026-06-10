/**
 * Wire format for snapshot responses: a little-endian u32 header length,
 * a JSON header, then the deflated grid bytes. Self-contained so it works
 * as the response payload of a single Trystero request action.
 *
 * A peer that has no session yet answers with `{ sessionId: null }` and an
 * empty body.
 */

export type SnapshotHeader =
  | { sessionId: null }
  | { sessionId: string; createdAt: number; width: number; height: number }

export function encodeSnapshot(header: SnapshotHeader, body: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(4 + headerBytes.byteLength + body.byteLength)
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, true)
  out.set(headerBytes, 4)
  out.set(body, 4 + headerBytes.byteLength)
  return out
}

export function decodeSnapshot(bytes: Uint8Array): { header: SnapshotHeader; body: Uint8Array } | null {
  if (bytes.byteLength < 4) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = view.getUint32(0, true)
  if (4 + headerLength > bytes.byteLength) return null
  let header: unknown
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)))
  } catch {
    return null
  }
  if (!isHeader(header)) return null
  return { header, body: bytes.subarray(4 + headerLength) }
}

function isHeader(value: unknown): value is SnapshotHeader {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.sessionId === null) return true
  return (
    typeof v.sessionId === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.width === 'number' &&
    typeof v.height === 'number'
  )
}
