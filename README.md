# P2P Pixel Canvas

One shared 1000×1000 drawing, no server. Every visitor may paint **one pixel
per minute** (configurable), r/place-style. The drawing exists only in the
browsers of the people who currently have it open:

- While at least one tab holds the drawing, anyone joining receives it from
  a peer and the session continues.
- When the last tab closes, the drawing is gone. The next visitor starts a
  brand-new session automatically.

## Quick start

Requires Node 20+.

```sh
npm install
npm run dev
```

Open the printed URL in two browser tabs (or two machines) — after a few
seconds they discover each other and share one canvas. Useful dev params:

| URL param        | Effect                                              |
| ---------------- | --------------------------------------------------- |
| `?room=test`     | Join a separate canvas instead of the default room. |
| `?cooldown=2000` | 2 s pixel cooldown for this tab (dev only — peers still validate against their own configured limit). |
| `?peerwait=3000` | Shorter initial peer search.                        |

Other scripts: `npm test` (unit tests), `npm run build` (typecheck + bundle
to `dist/`), `npm run preview`.

## How it works

### Transport & discovery — Trystero (WebRTC)

Peers meet through [Trystero](https://github.com/dmotz/trystero) using the
Nostr strategy: the WebRTC handshake is relayed through a handful of public
Nostr relays, then all application data flows directly peer-to-peer over
WebRTC data channels in a full mesh. There is no app-specific server — the
relays are public infrastructure used only for matchmaking, never for
drawing data. The strategy can be swapped (`trystero/torrent`,
`trystero/mqtt`, …) by changing one import in `src/net/sync.ts`.

### The drawing is a CRDT

`src/state/pixelGrid.ts` holds the canvas as a grid of last-writer-wins
registers in flat typed arrays (~12 bytes/pixel):

- `colors` — 0xRRGGBB per pixel
- `clocks` — Lamport clock of the write that set the pixel
- `writers` — hash of the writer's peer id

A write wins if its clock is higher; ties break by writer hash, then color.
Every peer applies the same deterministic rule, so replicas converge no
matter the order updates arrive in. No history is kept — current state only,
which is exactly what an r/place canvas needs.

### Protocol (3 Trystero actions)

| Action  | Kind      | Purpose                                                        |
| ------- | --------- | -------------------------------------------------------------- |
| `pixel` | message   | Broadcast one pixel write `{i, c, k, w, s}`.                   |
| `state` | request   | Ask a peer for a snapshot; response = JSON header + deflated grid. |
| `meta`  | message   | Announce `{sessionId, createdAt}` for session arbitration.     |

Snapshots are the three typed arrays deflated with the built-in
CompressionStream — a young canvas is a few KB, a fully painted one ~a few MB.

### Session lifecycle

1. A new tab searches for peers for `peerWaitMs` (8 s).
2. Discovered peers are asked for a snapshot one at a time (`state` request
   with timeout). The first valid response sets the local session.
3. If the search ends empty-handed, the tab mints a fresh session
   (`{id, createdAt}`) and announces it.
4. If two sessions ever meet — two tabs started fresh simultaneously, or
   separate groups merge — everyone converges on the *older* session
   (ties broken by id): peers holding the loser fetch the winner's snapshot
   and switch. Pixel updates carry the session id, so writes from a
   different session are never merged into the wrong drawing.

"Persistence" is therefore purely social: the drawing survives exactly as
long as someone keeps it open. Nothing is written to disk by design.

### Rate limiting

The 1-pixel-per-minute rule is enforced twice:

- Locally: a `Cooldown` blocks the UI (persisted in localStorage so a reload
  doesn't grant a free pixel).
- Cooperatively: every client drops incoming updates from a peer that sends
  faster than `cooldownMs × remoteRateTolerance` (default 80%, to absorb
  clock drift). There is no authority in a serverless network, so a modified
  client can cheat — honest peers just ignore the excess. Real enforcement
  (signed updates, proof-of-work per pixel) is future work.

## Deployment

The app is a static bundle — any HTTPS host works (HTTPS is required for
WebCrypto/WebRTC). [`/.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
deploys to **GitHub Pages** on every push to `main`: install → test → build
→ publish `dist/` via the official Pages actions. The workflow enables Pages
on its first run; the repo just needs Pages allowed (public repo, or any
repo on a paid plan). `vite.config.ts` uses a relative `base`, so the build
works at `https://<user>.github.io/<repo>/` and custom domains alike.

## Configuration

All knobs live in `src/config.ts`: canvas size, cooldown, Trystero `appId`,
room name, search/snapshot timeouts. Canvas size and cooldown are part of
the protocol — ship the same values to all clients.

## Project layout

```
index.html              static shell (canvas + HUD)
src/
  main.ts               wires everything together
  config.ts             tunables + URL param overrides
  types.ts              wire-format types
  rateLimit.ts          local cooldown + cooperative remote validation
  state/
    pixelGrid.ts        the LWW-register CRDT grid
    session.ts          session identity + arbitration rule
  net/
    sync.ts             Trystero room, protocol, session lifecycle
    snapshotCodec.ts    header+body wire format for snapshots
    compress.ts         CompressionStream helpers
  ui/
    canvasView.ts       rendering, pan/zoom, pixel picking
    hud.ts              status, session, peers, cooldown, color picker
```

## Known limitations / next steps

- **Mesh size**: full mesh works comfortably for tens of peers, not
  thousands. Scaling needs gossip/relay topologies.
- **Trust**: rate limiting and session arbitration are cooperative. A
  hostile client can spam pixels (peers drop them) or lie about session age.
- **Snapshot efficiency**: joiners fetch the full grid; delta sync since a
  known Lamport clock would be cheaper for reconnects.
- **Relay availability**: peer discovery depends on public Nostr relays
  being reachable (configurable via `relayConfig.urls` if needed).
- **Touch**: pan and tap work; pinch-zoom isn't implemented yet.
- Two tabs in one browser share the localStorage cooldown but count as two
  peers — handy for testing, slightly lenient for cheaters.
