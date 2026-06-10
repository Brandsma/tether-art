/**
 * Deflate helpers for snapshot transfers, using the built-in Compression
 * Streams API (browsers and Node 18+). A young 1000×1000 session is almost
 * all zero clocks and white pixels, so it shrinks from ~12 MB to a few KB.
 */

async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  // Cast: our buffers are never SharedArrayBuffer-backed, which is all the
  // stricter Blob signature guards against.
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const deflate = (bytes: Uint8Array): Promise<Uint8Array> =>
  pipe(bytes, new CompressionStream('deflate-raw'))

export const inflate = (bytes: Uint8Array): Promise<Uint8Array> =>
  pipe(bytes, new DecompressionStream('deflate-raw'))
