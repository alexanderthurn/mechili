# MECHILI architecture

Read this before adding features. The game is a deterministic lockstep
simulation wrapped in an action log — most bugs that matter here are not
crashes but *silent divergence between two peers*, and the rules below exist
to prevent exactly that.

## Module map

| Module | Role |
| --- | --- |
| `src/main.ts` | boot, menu, matchmaking/lobby UI, global chat, reconnect orchestration |
| `src/game/game.ts` | the match: phases, rounds, ticking, HUD wiring, net message handling, hydration |
| `src/game/actions.ts` | every game mutation as data; `ActionDispatcher` validates, applies, reverts, logs |
| `src/game/sim.ts` | the battle: fixed-step (30 Hz), deterministic, renders via interpolation |
| `src/game/placement.ts` | deployment-phase input + the board (units, occupancy grid, spawn/move/rotate) |
| `src/game/units.ts` | unit type definitions, the `Unit` (pack) class, mesh builders, battle tints |
| `src/game/map.ts` | grid math, zones/flanks, ground + overlay textures |
| `src/game/settings.ts` | one JSON-serializable object defines a match; `Economy` |
| `src/game/cards.ts` / `items.ts` / `tech.ts` | specialist cards, round cards, pack items, per-type techs |
| `src/game/ai.ts` | the built-in opponent — dispatches actions like any player |
| `src/game/net.ts` | PeerJS sessions, matchmaking endpoints, wire protocol, resume markers |
| `src/game/colors.ts` | canonical side colors (host blue, guest red, on both screens) |
| `src/ui/hud.ts` | the whole in-match UI (DOM overlay), incl. combat chat |
| `src/theme.ts` | every color and all CSS |
| `backend/*.php` | matchmaking lobby, global chat, match telemetry (plain JSON files) |
| `src/game/telemetry.ts` | fire-and-forget match upload; analysis stays in clients |

## The action system

**Every** game mutation flows through `ActionDispatcher.dispatch` — player
UI, the AI, and the network peer are just different action producers. No
other mutation channel exists. Consequences:

- `seed` + applied-action log = the complete save. Replays, single-player
  resume, and multiplayer reconnect all rebuild by re-dispatching the log
  (`Game.hydrate`), fast-forwarding battles headlessly.
- Undo = reverting a round's own actions newest-first. Every `apply` has an
  exact inverse in `revert`; log entries carry whatever the revert needs
  (`paid`, `from`, `unit`, …).
- `chooseCard`, `roundCard` and `endDeployment` are **not undoable**
  (`isUndoable`) — the card offers are gone and lock-ins are already with
  the peer.

**Adding a new action kind — checklist:**

1. Interface + union member in `actions.ts`, `apply` case (validate first,
   mutate second — return `false` rejects with zero side effects), `revert`
   case (or add it to the excluded list in `isUndoable`).
2. If it references units by id: add the case to `Game.swapPerspective`.
   **A missed case desyncs peers silently** — this is the one list that must
   stay in sync with the union.
3. Decide undoability; store revert data on the `LogEntry`.
4. Bump `GAME_VERSION` in `net.ts` (it changes game logic).

## Determinism rules (lockstep multiplayer)

Both peers hold the IDENTICAL board — the guest owns the far half and its
camera is rotated 180° (`map.ownAtFar`, `rig.setBaseHeading(π)`). Wire
translation is only: flip team + flip unit-id parity. No coordinates are
ever mirrored. The sim must then produce bit-identical results on both
clients:

- **No `Math.random()` anywhere the sim can see.** Match randomness comes
  from named, independent `mulberry32` streams: `seedFrom(seed, 'ai')`,
  `'cards-a'`, `'cards-b'`. Consuming one stream can never shift another.
  Purely visual randomness (particles, bob phases) is fine and encouraged
  to stay OUT of the streams. Local decisions that get *broadcast as
  actions* (e.g. the specialist auto-pick) may use `Math.random` — the
  result travels, the roll doesn't need to be reproducible.
- **No `Math.hypot`** — it is not IEEE-exact across engines. Use the local
  `hypot()` in `sim.ts` (plain sqrt is correctly rounded everywhere).
  Same reason: no `**` on floats in sim code.
- **Canonical ordering.** Unit ids are per-team counters with parity
  (`id = ++counter*2 + (player ? 0 : 1)`; the HOST's units are even *on the
  host's screen*). The sim sorts actors host-side-first by spawn order and
  keeps every neighborhood query (`nearby`) sorted — float accumulation
  order is part of the contract.
- **Fixed step, exact stop.** 30 Hz steps; rendering interpolates
  (`prevX/prevZ` → `rx/rz` with `alpha`). The update loop breaks *exactly*
  at the deciding step (`sim.finished`) — overshooting by one step is a
  desync.
- **Verification.** At every battle start both peers exchange a state hash
  (`Game.stateHash`, canonical host-first ordering). On mismatch the guest
  reloads and rebuilds from the host's log; a sessionStorage guard stops
  reload loops.
- Anything spawned OUTSIDE the action log (tower spawns, the archer
  specialist's free unit) must run identically during live play **and**
  hydration — it consumes unit ids, so skipping it in one path shifts every
  later id.

## Multiplayer flow

1. Matchmaking (`backend/matchmaking.php`) or direct room (`mechili-room-
   <name>`); host sends `setup` {version, seed, settings, names}.
2. Actions stream live as they happen. Hiding the opponent's deployment is
   purely local rendering until your own lock-in (`hiddenPlacements`,
   `revealAll`). Undos mirror via an `undo` message. Received events queue
   (`remoteQueue`) and apply once our game reaches their round.
3. Battle starts when BOTH sides sent `endDeployment`; battle speed is
   synced (`speed` message).
4. Reconnect: both sides keep a sessionStorage `ResumeMarker`. The reloader
   re-opens its peer, sends `resume`; the survivor answers `state`
   {seed, settings, actions, battleElapsed} and the reloader hydrates —
   a live battle only up to the peer's clock.

`GAME_VERSION` gates all of this: bump it on ANY change to game logic,
hydration behavior, or the wire format.

## Match telemetry

On `finishMatch` the host (and single-player) POSTs a MatchRecord to
`backend/stats.php` — one JSON file per match under `stats/matches/`,
atomic write, content-hash dedupe. Failures are ignored. Bulk download
(`?action=bulk`) feeds client-side analysis (`backend/stats.html`). Bump
`BALANCE_PATCH_ID` in `telemetry.ts` when tuning costs/stats for patches.
The FTP deploy excludes `backend/stats/` so collected matches survive releases.

## Adding a unit type — checklist

1. Entry in `UNIT_TYPES` (`units.ts`): stats, footprint/formation,
   `targets` (can-attack matrix), `collisionRadius` + `colliders` (bullet
   hit spheres), techs, and a `build(parts)` mesh function. Flags:
   `flying` (altitude), `structure`, `extra` (+`shield`/`rocket`),
   `projectileSpeed`/`homing`/`splashRadius`.
2. Price in `DEFAULT_SETTINGS.economy.unitCosts` (falls back to `cost`).
3. If shop-buyable: add to `SHOP_UNIT_IDS` + `UNIT_UNLOCK_COST` in
   `cards.ts`; consider starter cards / `SPECIALITY_UNLOCK`.
4. Nothing else — sim, placement, HUD, icons (`unitIcons.ts` renders
   thumbnails from the same builders) all read the type definition.
5. Bump `GAME_VERSION`.

Items (`items.ts`), techs (on the type), and cards (`cards.ts`) are pure
data — multipliers resolve in `TechTree.statsFor` → `Game.resolvedStats` →
sim `statsOf`; level scaling stays inside the sim (`levelMult`).

## Known quirks (deliberate or accepted)

- The AI doesn't use items, selling, board extras, boosts, or flank
  deploys (it avoids flanks on purpose — it doesn't understand the spawn
  tax).
- A homing projectile whose victim dies mid-flight continues as a dumb
  bullet and may hit someone else.
- `damageByType` (post-battle report) records raw damage; `unit.damageDealt`
  is capped at the victim's remaining hp. Both on purpose.
- `roundCard` dispatch does not verify the card was in the drawn offer —
  the log stays valid even if offer computation ever changes.
- Shared material cache (`units.ts`) survives `disposeScene`; three.js
  re-uploads disposed materials on next use, so match restarts are fine.
