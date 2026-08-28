# Backend plan — a reusable per-game PHP backend

Turn `backend/*.php` from a Melodan-specific backend into one that can be
dropped into any of the studio's games, without losing the parts that
actually earn their keep.

Written 2026-08-23 after a survey of all four endpoints. Read
PROGRESSION_PLAN.md §0.2 first: **production is Steam-only and serverless**.
This backend is a development convenience for the browser build. That is
what makes the design safe to simplify — nothing here is load-bearing for
shipped players.

**Status: planned, not built.**

## 0. The design rule

> Anything **every game has** stays a real, typed field.
> Anything **only this game has** goes in an opaque `data` blob.

An earlier draft of this plan proposed a pure key/value blob store for
everything. That was wrong, and the reason is worth keeping: MMR, display
name, avatar and win/loss are not Melodan concepts — every competitive
game has them. Demoting them to opaque JSON throws away server-side Elo,
ladder sorting and identity for no reuse benefit, because the *next* game
would need all three too and would have to rebuild them client-side.

The blob is for loadouts, unit tables, specialities — things the next
game will not recognise.

**No `app=` parameter.** One deployment per game. A shared namespace only
buys the failure mode where one game's typo writes into another's data.

## 1. What each endpoint becomes

### `player.php` — keep, add a blob (small change)

Already generic: in 757 lines the only Melodan references are two
comments. `track`, `id`, `name`, `nameKey`, `mmr`, `peakMmr`, `wins`,
`losses`, `draws`, `games`, `mpGames`, timestamps — all universal.

Changes:

1. **Add an opaque `data` field** to the player record, with its own
   `?action=data` read/write (or ride along on `claim`/`hello`). Size
   capped like the avatar. This is where a game puts loadouts, cosmetics,
   progression — anything the backend should store but never interpret.
2. **Drop the password path.** No longer used, and it is the one piece of
   genuinely security-sensitive code in the file. Identity becomes the
   session token alone.
3. Generalise the two Melodan comments and `MAX_AVATAR_CHARS`.

Explicitly **kept**, because they are universal and expensive to rebuild:
server-computed Elo, `?action=ladder` top-N sorting, result dedupe via
`players/results/{matchId}.json`, session tokens.

### `matchmaking.php` — keep, already right

Rooms already carry `name`/`peer`/`mode`/`roster`/`round` plus an opaque
`data` passthrough. The TTL sweep, the ownership-token check
(`ownsEntry`, `hash_equals`) and `validRosterShape` are all game-agnostic.

Only change worth making: `mode` is currently a hardcoded `1v1|2v2`
whitelist. Either widen it to an arbitrary short string or move it into
`data`.

### `stats.php` — this is where the blob belongs

The one endpoint carrying genuinely game-specific fields — but fewer of
them than a first read suggests. `handleGrouped` projects `id`, `ts`,
`side`, `source`, `mode`, `gameVersion`, `result`, `rounds`, `playerHp`,
`enemyHp`, `verifiedCount`, `lastVerifiedAt`, `names`, `roster`,
`hasReplay`. Everything in that list must stay typed or the server-side
match list breaks — which is the whole reason this file stays smart.

Split it:

- **Envelope stays typed** — the `handleGrouped` set above. Note that
  `rounds` / `playerHp` / `enemyHp` are *score and match length*, and
  `roster` is a seat list: semi-universal, not Melodan concepts. They
  belong in the envelope on merit, not just because grouping needs them.
- **`speciality`, `units`, and the replay payload's internals move into
  `data`** — opaque, never interpreted. These are the only truly
  game-specific fields. Analysis over them becomes the client's job.

`handleGrouped`, `handleStripReplay` and the verify dedupe all survive.
They are the reason this file is worth keeping smart: without grouping,
listing matches means downloading every record, replay stubs included.

### `suggest.php` — already generic

A feedback box. `id`, `ts`, `category`, `message`, `source`. Nothing to do.

## 2. What this preserves

The pure-blob draft would have cost all of these. The typed/blob split
keeps every one:

| Capability | Pure blob | Typed + blob |
|---|---|---|
| Server-authoritative MMR | lost | **kept** |
| Ladder top-N sorting | client downloads all | **kept** |
| Identity / name recovery | token only, unrecoverable | **kept** |
| Match-list grouping | client downloads all | **kept** |
| Result dedupe | needs `ifAbsent` | **kept** |
| Shape validation | moves to client | kept for typed fields |

The only thing that becomes "dumb" is the payload that genuinely varies
per game — which is the right thing to make dumb.

## 3. Blob discipline

The blob is stored and echoed, never interpreted. Two rules follow:

1. **Size-cap it server-side.** A byte count is the only judgement the
   server can make about a blob, so it has to make that one.
2. **Normalize it client-side, on read.** The server cannot validate
   shape, so whatever renders or simulates from a blob must treat it as
   untrusted. This is already the established pattern here — see
   `normalizeLoadout` (PROGRESSION_PLAN.md §1c) and `validRosterShape`'s
   own doc comment on why a verbatim-echoed roster needed checking.

## 4. Loadouts on the web track

Once `player.php` has a `data` blob, loadouts get a home there and the
web build stops being the odd one out (PROGRESSION_PLAN.md §1f: Steam
already syncs them via `user.sav`). Worth doing at the same time — it is
the first real consumer of the blob, and it makes two-browser testing
work without rebuilding a loadout per profile.

## 5. Cost

Much smaller than the pure-blob rewrite it replaces:

- `player.php`: add a `data` field + accessor, delete the password path.
- `matchmaking.php`: widen or relocate `mode`.
- `stats.php`: move `speciality` / `units` / replay internals behind
  `data`, leave the grouped envelope alone.
- Client: `account.ts` gains blob read/write; `telemetry.ts` moves its
  game-specific fields under `data`.

Roughly half a day, versus a day-plus for the rewrite.

## 6. Does this run on Steam, or is it PHP-only?

Neither, cleanly — the split is by CONCERN, not by platform, and one
endpoint is already production on both.

**Finding that qualifies §0.2:** `submitMatchTelemetry` is NOT gated by
platform. It posts to `statsUrl()` unconditionally, and the record
carries a `channel` field precisely so "balance analysis can filter by
channel (open web vs Steam Electron)". **Steam builds already talk to
`stats.php` today.** That is deliberate and worth keeping — balance data
from real Steam players is the data most worth having. So "PHP is
dev-only" is true of identity / MMR / matchmaking, and false of
telemetry.

| Concept | Web / dev | Steam (production) |
|---|---|---|
| Identity | name + session token | SteamID64 + persona |
| Avatar | player record | Steam avatar → `user.sav` |
| MMR | `player.php`, server Elo | leaderboard entry, client-computed |
| Ladder | `?action=ladder` | `downloadEntries` |
| W/L/games | player record | Steam stats |
| **Blob** | `player.php` `data` | `user.sav` / `progress.sav` |
| Rooms | `matchmaking.php` | Steam lobbies + metadata |
| **Telemetry** | `stats.php` | **`stats.php` — same, already** |

### The inversion worth remembering

**The blob ports to Steam for free; the TYPED fields are what need
adapters.** Steam Cloud *is* a blob store — an opaque file nobody
interprets, exactly like the `data` field. But MMR and W/L have to become
leaderboard entries and stat handles, which do not map 1:1 onto the PHP
schema. The part that looks dumb is the portable part; the part that
looks structured is the part that needs per-platform work.

### One interface, two adapters

Whenever this gets built, the client must have a SINGLE data-layer
interface with a PHP adapter and a Steam adapter behind it — the same
pattern `multiplayerTransport.ts` already uses for netcode, and what
PROGRESSION_PLAN.md §3e plans for matchmaking policy:

```
readProfile / writeProfile
readBlob    / writeBlob
submitResult
ladder
```

Without that seam there are two data layers that drift — which is the
exact failure mode §0.2 exists to prevent.

## 7. Open

- **Repo location.** A single `backend/` folder copied into the next
  game, versus its own repo like `steam-electron-build`. Lean: keep it
  here — PHP has no package manager in this setup, so a shared repo would
  still be copied or submoduled, and the ceremony may not pay for itself.
- **Ordering.** Worth doing before PROGRESSION_PLAN.md §3 (matchmaking),
  since that is the next work to touch this layer.
