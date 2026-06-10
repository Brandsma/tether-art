/**
 * A session identifies one lifetime of the shared drawing. It lives only
 * while at least one peer holds its state in memory; when the last peer
 * leaves, the drawing is gone and the next visitor starts a fresh session.
 */
export interface Session {
  id: string
  createdAt: number
}

export function newSession(): Session {
  return { id: randomId(), createdAt: Date.now() }
}

function randomId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Deterministic rule for which of two competing sessions every peer should
 * converge on: the older one wins, ties broken by id. Competing sessions
 * happen when two tabs start fresh at the same moment, or when previously
 * partitioned groups meet.
 */
export function preferredSession(a: Session, b: Session): Session {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? a : b
  return a.id <= b.id ? a : b
}
