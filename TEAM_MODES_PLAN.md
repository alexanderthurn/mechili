# Team modes plan — Horde PvPvE, 2v2, and an N-player foundation

Plan for adding team modes to Melodan:

- **Horde** — players are mutual enemies plus a neutral AI horde in the
  map center; fight your rival or farm the horde, last side standing wins.
  (Replaces the earlier "2vE co-op" concept — see §4 for why.)
- **2v2** — four humans, two per side.
- built on an **N-player seat model** (§2, §2b) so later modes — 5v5,
  uneven teams, eventually free-for-all — are mode definitions, not
  refactors.

Written after a code survey on 2026-07-19; updated the same day after the
**wire-fog change landed** (GAME_VERSION 14: build `action`/`undo` are
buffered on the sender until the receiving peer locks in, with a
`deployCaughtUp` gate before battle; spectators got per-connection vision
policies). Revised 2026-07-20 after a design session settled four things:
**mesh of equal peers instead of a host star** (§3 — sender-side fog
survives N players intact, no listen-server trust hole), **AI derived
deterministically on every client** instead of run-on-host (§2d), **shared
seeds derived from the deployment log** so nobody can precompute
randomness (§2d), and **horde PvPvE replacing co-op 2vE** (§4). Read
ARCHITECTURE.md first; every constraint there (action log, determinism,
fog) shapes this plan.

**Status as of 2026-07-21 — horde and duo-vs-AI are built and confirmed
working; 2v2 online is built, self-audited, and awaiting its first live
multi-client test.** One deliberate design change from what's written
below: §3's mesh was the right call theoretically, but building it
required N-way peer connection plumbing nobody had exercised before.
Given the choice between shipping something testable now versus a
theoretically cleaner design later, **actual implementation uses a host
star** (reusing the already-proven `SpectatorHub` relay pattern) instead
of the mesh — a deliberate, discussed tradeoff, not an oversight. §3 below
is kept as the target design; see the new §3b for what actually shipped
and why, and §8 for phase-by-phase status. Classic 1v1 is untouched
throughout — every star-mode code path is additive and gated.

---

## 1. What the codebase already gives us (survey results)

The good news is that the *battle* layer needs almost nothing:

- **The sim is two-SIDED, not two-player.** `sim.ts` only ever asks
  "is `a.team !== b.team`" — hostility, tower debuffs (`lostTowers`,
  `debuffUntil`), fire profiles, rally routes are all per *side*. Two players
  contributing units to the same side Just Works in battle.
- **Match HP is already per side** (`playerHp` / `enemyHp`) — matches
  Mechabellum 2v2, where a team shares one HP pool. No change needed.
- **`RosterEntry.team` is a plain string** — the comment in `net.ts` says
  explicitly it was shaped so multi-seat modes don't change it.
- **`SIDE_COLORS` already has 4 entries** (blue/red + green/orange marked
  "future 2v2").
- **The AI is a pure action producer** (`AiOpponent` dispatches through the
  same `ActionDispatcher` as everyone else, off its own seeded rng stream —
  no wall-clock anywhere in its decisions). That purity is what lets AI and
  horde decisions be **derived deterministically on every client** from a
  shared seed at a synchronized point (§2d, §4): no runner machine, no
  relay, zero network traffic for AI.
- **`SpectatorHub` proves the multi-connection pattern** — one Peer
  accepting N connections, with roster broadcast. Since the fog change,
  `relayBuild` already implements **per-recipient build buffers with a
  vision filter** — the same vocabulary the mesh's sender-side fog uses
  per enemy recipient (§3), already written and battle-tested against
  spectators. Spectator serving stays a single-hub chore (§3 coordinator).
- **`GameSettings` is the mode definition** ("different game modes are just
  different settings") — a mode descriptor slots in naturally.

The hard part is everything that encodes **ownership** as the binary
`Team = 'player' | 'enemy'`:

| Where | What assumes exactly one player per side |
| --- | --- |
| `game.ts` | ~20 `Record<Team, …>` ownership tables: economy-adjacent state, `deployReady`, `recruitLevel`, `sellState`, `boostState`, `roundBoosts`, `creditUsed/Debt`, `speciality`, `flankSpawnMult`, `itemInventory`, `tacticInventory`, `unlockedUnits`, `unlockUsedThisRound`, `roundCardTaken` |
| `settings.ts` | `Economy.balances: Record<Team, number>`; `grantRoundIncome` pays both sides symmetrically |
| `actions.ts` | every `Action` carries `team: Team` as the *actor* |
| `tech.ts` | tech ownership per `(team, typeId)` |
| `cards.ts` / card streams | `rngCards` keyed `cards-a` / `cards-b` — one draw stream per side |
| `net.ts` | `NetSession` is one 1:1 link; `setup` names exactly host+guest; `swapPerspective` translates by flipping team + unit-id *parity* — a strictly 2-perspective trick; the fog buffer (`outboundBuildBuffer`, `peerDeployReady`, `deployCaughtUp`) is symmetric-peer-shaped, and `SpectatorVision.seats` uses `'a'\|'b'` chars |
| `main.ts` | lobby/quick-match produce exactly one `NetSession`, `side: 'a' \| 'b'` |
| `backend/matchmaking.php` | queue pairs exactly two peers |
| `hud.ts` | two HP bars, one supply readout, 1v1 ready states |
| `telemetry.ts` / `player.php` | MatchRecord and Elo assume two participants |

~184 `'player'`/`'enemy'` literals across `src/`. Most are *side* semantics
(rendering, camera, zones) and stay binary; the ownership subset above is
what must generalize.

---

## 2. Core design: Seats on Sides, as data

Introduce one new concept and keep the old one:

- **Side** = a battle faction (hostility, match HP, tower debuffs, hidden
  placements, colors). Ships as exactly 2 — the sim does not change — but
  side-keyed state becomes arrays/records over a `SideId`, not a two-field
  struct, so the sim layer is N-side-*shaped* even while the map only
  supports two (see §2b Tier 3).
- **Seat** = one army (human or AI). Seats are **data, not a type union** —
  the match roster lives in `GameSettings`:

  ```ts
  export type SeatId = number;            // index into the roster, canonical
  export interface SeatDef {
      side: number;                       // SideId
      controller: 'human' | 'ai';
      name: string;
  }
  // GameSettings gains: seats: SeatDef[]
  ```

  Ownership tables become `Map`/`Record` keyed by `SeatId`, built from the
  roster at match start. Nothing anywhere says "2" or "4": 1v1 is
  `[{side:0},{side:1}]`, 2v2 is four entries, 3vE is
  `[h,h,h, ai,ai,ai?]` — **mode = roster + victory rule (§2c) + settings**.
  Local convenience getters (`mySeat`, `mySide`, "is this seat an ally")
  replace the old player/enemy literals in UI code; the sim keeps a derived
  binary-style `unit.team` accessor only as sugar over `sideOf(unit.seat)`
  so the ~184 side-semantic call sites stay mechanical to convert.

`Action.team` becomes `Action.seat: SeatId` (the actor).

### Canonical everything — the wire loses its perspective swap

Today's wire trick (flip team + flip unit-id parity) hard-codes exactly two
perspectives. Generalizing the swap to N would mean N translation functions
that must all be perfect. Instead, **delete the concept**:

- **The log, the wire, and all game state use canonical seat ids.** The
  board is already canonical (ARCHITECTURE.md: "No coordinates are ever
  mirrored" — the guest's 180° view is pure camera). We finish the job:
  `swapPerspective` is removed, not extended. Rendering derives "mine /
  ally / enemy" from `mySeat` at draw time.
- **Unit ids are per-SEAT, not per-side:**
  `id = ++seatCounter * seats.length + seatId`. This must be per-seat:
  teammate actions apply in different arrival orders on different clients
  (§ commutativity below), so a shared per-side counter would hand the same
  unit different ids on different clients — a guaranteed desync. Per-seat
  counters are safe because one seat's own actions are always sequential.
  The parity trick dies with the swap; nothing mourns it.
- **Canonical ordering**: actors sort by unit id — the seat-encoded id above
  is already a total, deterministic order (replaces "host-side-first by
  spawn order"). `nearby`-query ordering and `stateHash` iterate that order;
  the hash mixes every seat's economy balance in `SeatId` order.
- **Camera**: `setBaseHeading` gets the angle from the local seat's side
  (0 or π today; a per-side angle table is FFA-ready). `ownAtFar` becomes
  derived, not stored.

This is *less* code than the 1v1 swap (one whole failure class —
"missed a case in `swapPerspective`" — is deleted, and the ARCHITECTURE.md
new-action checklist loses that step), at the cost of touching every place
that assumed "my units are team 'player'". That cost is already in the
Phase-0 budget; canonical ids change *which* edit each site gets, not how
many sites there are.

### The one genuinely new correctness problem: teammate commutativity

Today's lockstep works without a sequencer because concurrent actors touch
**disjoint state**: own half, own economy, own techs. Enemy actions apply on
arrival in any order relative to yours — order doesn't matter. Two seats on
one side break that unless we keep their state disjoint too. Rather than
adding a host sequencer (latency on your own placements, rollback machinery),
**make all same-side state seat-disjoint**, which restores commutativity:

1. **Split deployment zones.** Each seat owns a vertical half of its side's
   main zone (left/right, Mechabellum-style) plus the adjacent flank strip.
   `placement.zoneCell(seat, cell)` checks the seat's rectangle. Teammates
   can never race for a cell. (A "shared zone" variant is cheaper socially
   but reintroduces occupancy races — rejected.)
2. **Per-seat economy, techs, cards, items, tactics, boosts, unlocks** —
   already the plan (ownership re-key). No shared purse in v1.
3. **Seat-owned towers/base buildings.** Each side has 3 base buildings;
   assign building 0+1 to seat 0, building 2 to seat 1 (or mirror by map
   half — decide when placing; the invariant is *one owner per building*).
   Only the owner may `upgradeTower` it, so the cost ladder can't race.
   Debuffs on loss stay side-wide (unchanged, and good co-op tension).
4. **Audit remaining cross-seat writes** for order-independence. Known
   shared surface: the oil `HazardField` (stamps from both seats can
   overlap — verify expiry merge is a commutative max; if not, make it so),
   round-card offers (per-seat streams: extend `cards-a`/`cards-b` seeds to
   `cards-a0`, `cards-a1`, `cards-b0`, `cards-b1`), and the
   `extrasBudgetPerRound` (make per-seat). The Phase-0 checklist in
   ARCHITECTURE.md gains a line: *"new actions must only mutate state owned
   by their seat, or provably commute."*

With that, the existing model scales as-is: actions apply in arrival order
and all interleavings converge. The fog change doesn't weaken the argument —
it only changes *when* enemy actions arrive (in a burst at your lock-in
instead of live); commutativity is exactly what makes that burst safe to
apply at an arbitrary point relative to your own stream. Teammate actions
must keep flowing **live** (playing a side together means watching each
other build), which
is why the disjointness rules above are load-bearing. `stateHash` at every
battle start remains the safety net — and the `deployCaughtUp` gate the fog
change introduced guarantees the hash is only taken after every buffered
stream has landed.

### Undo across teammates

Undo stays "revert the *seat's* own actions, newest-first". Because zones
and economies are disjoint, a teammate's later actions can't sit on top of
yours — reverts stay valid. The `undo` net message gains the seat field.

---

## 2b. How far does N go? Three tiers

The seat model deliberately separates three questions that look like one
("N players"): how many *armies*, how many *factions*, and how many
*directions the map has*. They have very different price tags.

**Tier 1 — N seats on 2 sides.** Covered by everything above; the roster
just has more entries. Gives us: 2v2, 3v3, 5v5, 3vE, 1v2, "2 humans + 1 AI
ally vs 2 AI". Per-seat cost is O(roster length) everywhere already —
income loop, card streams (`cards-<seatId>`), HUD rows. The only per-N
tuning is map width (`zoneCols` is already a setting; ~+10 cols per extra
seat per side feels right, verify in playtest) and battle perf (§9).
**This tier is what Phases 0–3 ship.** The 2-player horde mode (§4) also
lives here: its horde is a *pseudo-faction* on the existing two-halves
map, deliberately not a third side (no HP pool, no zones, no economy).
No new architecture.

**Tier 2 — N sides in state.** Making side-keyed state (match HP, tower
debuff stacks, colors, hidden-placement rule, `targets` hostility) run over
a side *list* instead of a pair. The sim's hostility test
`sideOf(a) !== sideOf(b)` is already N-correct; targeting picks nearest
hostile, which is exactly FFA behavior with zero diplomacy code. This tier
is cheap-ish (arrays instead of pairs, done as part of Phase 0 where a site
is being touched anyway; a handful of genuinely pairwise spots — e.g. "the
winner is the side whose HP survived" — go through the victory-rule module
instead). It is *shipped dormant*: nothing offers a 3rd side until Tier 3
exists, but no code re-hardcodes 2.

**Tier 3 — N map directions (true FFA geometry).** The expensive one, and
the only real blocker for "5 players, everyone fights everyone":
`BattleMap` is two facing halves (near/far rows, a neutral strip, flank
columns beside the opponent's half); placement zones, base-building
anchors, flank spawn rules, scenery, and the fixed-pitch camera all assume
it. FFA needs a radial layout — N wedge-shaped deployment zones around a
contested center, per-side camera heading = wedge angle (the rig hook
already takes an arbitrary heading), flanks redefined per wedge or dropped,
`BASE_ANCHORS` per wedge. This is a new map *class* next to `BattleMap`
behind a small interface (`zoneCell(seat, cell)`, `areaCenter`, heights,
anchors) — placement and sim consume that interface today in all but name.
Also new: N-way matchmaking, N-color palette (extend `SIDE_COLORS` past 4),
and a balance pass for "getting attacked from two directions". Estimate:
comparable to the whole 2v2 effort again. **Decision: design nothing that
blocks it, build none of it now.** The honest statement for a 5-FFA: the
foundation from Phases 0–1 carries over untouched (seats, canonical log,
mesh netcode, victory rules); the map/camera/placement layer is the new
project — and **3+-player horde (§4) is its first customer** alongside
5-FFA.

## 2c. Victory rules & scoring (mode-defined winners)

Today "the match ends when a side's HP hits 0" is hard-coded at the two
sites that check `playerHp <= 0 || enemyHp <= 0`. Modes like "who killed
the most" need the winner question to be pluggable — and it must be
**deterministic, derived from logged/sim state only**, so replays,
reconnects, and all clients agree without any new messages.

```ts
// in GameSettings
victory:
    | { rule: 'elimination' }                      // last side with HP > 0 (default; today)
    | { rule: 'score'; metric: 'kills' | 'damage' | 'supplyDestroyed';
        endAt: { round: number } | { sideEliminated: true };
        scope: 'seat' | 'side' }
```

- **Score tracking is per-seat from day one:** the sim already accumulates
  `damageByType` keyed `${team}:${typeId}` — re-keying to
  `${seat}:${typeId}` is in the Phase-0 re-key anyway. Add a per-seat kill
  counter next to it (increment where `lostTowers`/death bookkeeping
  already runs). Both are sim state ⇒ deterministic ⇒ replay- and
  hash-safe (fold per-seat scores into `stateHash`).
- **`checkMatchEnd()`** replaces the two hard-coded HP checks: elimination
  keeps exact current behavior; `score` ends at the configured boundary
  (round N finished, or the AI side eliminated) and ranks seats by the
  metric. Ties break by lower `SeatId` (deterministic; announce as shared
  win in UI if that ever feels bad).
- **HUD:** elimination modes show HP bars as today; score modes add a small
  live scoreboard (per-seat metric, sorted). Post-battle report already
  becomes per-seat in §6.
- **"Most horde kills by round N wins"** (horde-mode variant, §4) is then
  literally
  `victory: { rule:'score', metric:'kills', endAt:{ round: N }, scope:'seat' }`
  with kills counted against horde units. It rides Phase 2's plumbing with
  no new systems — a good stretch goal to prove the rule module.

## 2d. Derived randomness: seeds nobody can know early

Match-start seeds have a weakness: a modified client can roll any shared
rng stream forward and precompute the whole match (today that is true of
the round-card offer stream). Fix: **re-seed shared streams every round
from the deployment log itself.**

- At the moment the last player locks in, every client hashes the round's
  full action set in canonical order — sort by `(SeatId, that seat's own
  action index)`; arrival order differs per client, the sorted set doesn't
  — and derives the round's shared seeds from it: horde spawns (§4), card
  offers, any future shared roll.
- **Nobody can compute a seed before all locks**, because under the fog
  rules no client holds the other players' actions yet — the seed's inputs
  are exactly the data the wire fog withholds. In mutually-fogged modes
  (1v1, horde, across sides in 2v2) this is airtight: by the time the seed
  exists, every player is locked and can't act on it.
- The hash doubles as a free integrity check: diverged log ⇒ diverged
  seed ⇒ diverged sim ⇒ caught by the existing `stateHash` at battle
  start (the sanctioned checkpoint — never hash mid-deployment).
- **Residual case, ally-visible modes only:** where teammates stream live
  (same side in 2v2), the *last* locker legitimately sees every input but
  his own and could grind his own actions against the seed. Bounded by the
  round clock (the window is "after the second-to-last lock, before
  force-lock") and irrelevant where the seed drives symmetric outcomes
  (both sides get the same card offer). If a future all-allies co-op mode
  ever needs an ungrindable seed, the upgrade is **commit–reveal**: each
  player commits a hash of a secret nonce at round start, reveals after
  all locks, seed = hash of all nonces — the last mover's contribution was
  fixed before he saw anything; his only cheat left is refusing to reveal,
  which is a visible rage-quit, not a silent edge. ~30 lines, two
  messages, **not built now**.

---

## 3. Network topology: mesh of equal peers

Keep PeerJS. No machine is authoritative over game state — the sim is
deterministic lockstep on every client, and every rule is enforced in
`apply()` on receipt: an illegal action from a hacked client is *rejected*
by honest clients (costs already hard-fail — `actions.ts` `economy.spend`
returning false) and surfaces as a hash mismatch on the cheater's machine.
The only in-sim cheat class left is early information, which the fog rules
below close. The 1v1 topology generalizes to a **full mesh**, not a star:

- **Every player connects directly to every other player** (2v2 = 6 links
  — trivial at this scale). There is no relay hop between players, so the
  listen-server trust problem of a star (an enemy-side hub reading your
  live build traffic) simply does not exist.
- **Fog stays on the sender — the landed 1v1 model, per recipient.** Each
  client keeps one outbound build buffer per *enemy* player and flushes it
  when that player's **whole side** has locked in (in 1v1 this degenerates
  to exactly today's rule; the whole-side condition stops a locked enemy
  from whispering to a still-deploying teammate). Ally links (same side in
  2v2) stream live from the start — allies are just recipients whose
  entitlement is "always". The invariant, worth stating because it is the
  whole trust model: **information only ever flows to players who can no
  longer act on it, and data never leaves the sender's machine until the
  recipient is entitled to it.** Zero trust required in any peer.
- **The coordinator is a chore, not an authority.** One peer (the room
  creator; deterministic fallback: lowest connected `SeatId`) holds the
  jobs *somebody* must hold: registers the room with `matchmaking.php`,
  serves the `SpectatorHub`, collects battle-gate acks, and is the sync
  source for reconnect and the tie-breaker for desync recovery. None of
  these confer a cheating ability — they are timing and bookkeeping, not
  state authority.
- **No wire translation at all** — actions travel with canonical seat ids
  and are applied verbatim (§2). A whole desync class disappears with
  `swapPerspective`.
- **`setup`/roster flow:** the coordinator assembles `GameSettings` (seat
  roster included, each entry carrying its peer id) in the lobby and sends
  it to each joiner; peers then dial each other from the roster.
  `GAME_VERSION` bump gates everything, as usual.
- **Battle gating.** When the last player locks, every client flushes all
  its buffers; each client sends one `deployCaughtUp` to the coordinator
  once its inbound backlog is applied; the coordinator broadcasts a single
  `battleStart`. Keeps the 1v1 race fix without N² pairwise gates, and the
  coordinator can't gain anything by mistiming it that it couldn't already
  get by lagging. Same shape for the next-build-phase transition.
- **Battle speed:** coordinator-announced in team matches (simplest rule
  that keeps clients together; today's per-pair sync doesn't generalize).

### Transports: PeerJS now, Steam later

Wrap the pipe in a small transport interface (`connect(peerId)`,
`send(bytes)`, `onMessage`, `onClose`) under `NetSession` **now** — this
is the one piece of Steam prep worth doing early. SteamNetworkingSockets
is shape-identical to WebRTC data channels (identity-addressed P2P,
reliable/unreliable channels, NAT traversal, wire encryption built in),
so the mesh maps 1:1 when a Steam build happens — and Steam Datagram
Relay hops are Valve infrastructure, not a player's machine, so the
sender-side fog guarantee survives Steam's relaying untouched. (Steamworks
needs a native wrapper — Electron or similar; the browser build can't
call it. That's the Steam project's concern, not this plan's.)

If a future transport ever forces a hub topology, the documented fallback
is end-to-end encryption over the relay (X25519 key agreement between
peers; the hub forwards ciphertext it cannot read). **Not built**: it
needs authenticated identities to resist a man-in-the-middle hub (Steam
auth tickets would provide them; the web build has nothing to anchor to),
and it blinds the hub for spectator serving. The mesh makes it moot.

### Reconnect

- Everyone holds the identical **completed-rounds log** (all buffers
  flush before every battle). A rejoiner redials all peers, gets the
  completed log + battle clock from the coordinator, and receives each
  seat's *current-round* actions from that seat's owner directly, under
  the normal fog rules (allies re-stream live; enemies flush at the usual
  gate). Sender-side fog survives reconnect with no redaction logic on
  any third machine — each owner "redacts" by simply not sending yet.
- **Coordinator drop:** peers keep their `ResumeMarker`s and redial for
  the grace window (coordinator reloads, re-opens its peer, rebuilds from
  its persisted log — same single-player save machinery). No chore
  migration in v1; if it doesn't return, the match ends. Mesh means match
  *state* never depended on it — migration is a lobby/spectator-hub
  problem only, which is why deferring it is safe.
- **Desync:** hashes compare at battle start as today; the coordinator's
  hash is the reference *by convention* — detection is certain, blame
  attribution is not (§9). The mismatching peer reloads and resumes.
- Keep the rule from memory: never hash-check outside battle start.

---

## 3b. What actually shipped: a host star (2026-07-21)

§3's mesh remains the *right* long-term design — this section documents
the pragmatic substitute actually implemented for 2v2, and exactly what
it costs versus the mesh above.

**The topology.** One peer (`StarHub`, host-side) accepts a connection
per remote seat-holding guest; guests never connect to each other. This
is a straight reuse of `SpectatorHub`'s already-proven pattern (per-
recipient buffer, vision-filtered relay) rather than new, unexercised
mesh-connection code — the deciding factor was confidence: the mesh
needed N-way connection establishment nobody had built or tested before,
while the star reuses machinery already running in production for
spectators. Guests keep the *exact* single-connection shape they already
have for 1v1 — zero change to guest-side connection logic.

**Fog survives, with one named exception.** Sender-side buffering still
works exactly as designed: nobody sends anything until the recipient is
entitled to it — a guest sends straight to the host (never buffers
locally), and the *host* buffers per-recipient on the way out, flushing
a recipient's backlog only once the sender's whole side has locked in.
Same guarantee, same invariant ("information only flows to players who
can no longer act on it"), just enforced at the host's relay layer
instead of at each sender directly. The cost: the host is a real
endpoint in that relay hop, so an enemy-side host **player** can read a
guest's traffic in cleartext before relaying it on — the exact
listen-server leak §3 built the mesh specifically to avoid. Accepted for
v1, matching §3's own fallback: "(a) accept for friend games." The
seatless big-screen host (§5b) still gives strict fog for anyone who
wants it, unchanged.

**Canonical seats, not translation.** `CanonicalSeatDef` (`side: 'a'|'b'`,
identical content on every client) travels once via a new `starSetup`
message; `localizeRoster()` is the *only* place a canonical seat becomes
a client's own local `SeatDef[]` (team relabeled to the viewer's
perspective, array order/index preserved). Everything downstream —
economy, zones, AI, HUD, unit ids — consumes the result exactly like the
already-built local duo roster, unaware a seat is networked. `swapPerspective`
and the id-parity trick are untouched and **still used for classic 1v1**
— a new, fully separate code path handles star mode, gated on
`settings.seats.length > 2`, so 1v1 carries zero risk from any of this.

**Gating, generalized.** Battle-start and next-round transitions are both
host-arbitrated single broadcasts (`starBattleStart`, `starNextRound`),
exactly matching §3's "coordinator broadcasts once, no N² pairwise acks"
design — just with the coordinator also being the relay, not a neutral
peer. One real bug was found and fixed during a pre-test self-audit:
relaying an action and checking "should battle start now" both need to
happen, in that exact order, every time — get it backwards even once and
the go-signal can broadcast before the data it depends on arrives.

**What's built:** host/join lobby (room-code based, not matchmaking-queue
based — see §10), seat assignment with AI-fill, the full send/relay/
receive/gating loop, AI seats running host-side and relaying like any
player, N-way battle-start hash comparison (diagnostic only — logs a
mismatch, does not auto-resync), and a minimal reconnect (any drop pauses
with a "give up" button, no redial/grace window/host migration).

**What's deferred, not silently dropped:** the mesh itself (§3, if the
listen-server tradeoff ever needs closing for real), matchmaking-queue-
based 2v2 pairing (§10), spectators for star matches, a live seat-picker
for waiting guests (they just see "waiting for host," no roster preview),
and full reconnect (resume/redial/grace window/host migration).

---

## 4. Mode: Horde (PvPvE — build first)

Replaces the earlier "2vE co-op" concept. Two humans, **mutually
enemies**, plus a neutral **horde** that spawns in the center strip of
the map and attacks everyone. Positioning is the strategic dial every
round: deploy forward against your rival, or toward the middle to farm
the horde before it farms you. When the horde is dead, the battle plays
out as pure PvP. Last side standing wins.

Why the redesign beats co-op: mutual enmity means the standard fog rules
apply between all humans — which makes the §2d derived seed *airtight*
(nobody holds anyone else's actions before all locks, so nobody can
precompute the horde; the ally-vision grinding case never arises). It is
also real PvP, so it stays ladder-eligible, and it keeps the netcode
identical to 1v1.

- **The horde is a pseudo-faction, not a seat.** No economy, cards,
  techs, base buildings, or deployment UI — just units. Configured as
  `horde: { budgetPerRound, curve, … }` in `GameSettings` (lobby-visible
  difficulty knobs), not as a roster entry. The one real sim cost — and
  the first change in this plan that touches the binary `Team` — is a
  third faction value with a single rule: *hostile to everyone, everyone
  hostile to it*. Targeting changes from "the other team" to "nearest
  unit not of my faction"; match HP, tower debuffs, and zones don't
  apply to it. Deliberately NOT a full Tier-2 side.
- **Spawning is derived, not transmitted.** Horde composition and
  positions for the round are computed on every client from the §2d seed
  at lock-complete: zero network traffic, no AI-runner machine, no relay
  machinery, and unpeekable by construction. Waves escalate per round
  from the settings curve.
- **Economy hook:** horde kills pay a per-seat bounty (rides the §2c
  kill counters) — this is what makes farm-vs-fight a real decision.
  Tune so pure farming and pure rushing both lose to a mix.
- **Match HP:** horde survivors damage each side's HP like any hostile
  survivor (start with that — it keeps the horde threatening; a "horde
  damages nobody" knob is a one-liner if playtests want it). Simultaneous
  elimination falls through to the existing tie handling.
- **Victory:** `elimination` unchanged. Variant via §2c: most horde
  kills by round N.
- **Map:** at 2 players this is the existing two-halves `BattleMap` with
  a horde spawn band in the neutral middle rows. **3+-player horde is a
  Tier-3 customer** (radial map, §2b) — the mode ships at 2 first.
- **Entry:** "Horde" menu button → room code via the existing custom-room
  plumbing + a `mode: 'horde'` lobby flag for labeling; friend joins via
  room list or URL param. No quick-match queue in v1.
- **Ranked:** unranked v1; W/L recorded with a mode tag (§7).

Why first: 2 clients, no matchmaking backend changes, no teammate
machinery at all (both humans are enemies — split zones and seat-owned
buildings move to the 2v2 phase), and it exercises the genuinely new
pieces — third faction, derived seeds, victory module — with friendly
stakes.

## 5. Mode: 2v2

Everything from the phases before it, plus the teammate machinery (split
zones, seat-owned buildings, commutativity audit — §2) and:

- **Lobby with seats.** Custom-room lobby screen becomes a 4-slot table
  (side A: seat 0/1, side B: seat 0/1) with click-to-move-seat, the
  coordinator can fill empty seats with AI (this also gives 1v2, 2v1E,
  1vE+ally variants for free — don't advertise, just don't forbid; AI
  seats derive like the horde, §2d — precomputable by a modified client,
  acceptable for casual fill-ins), start enabled when all seats filled.
  Roster broadcast reuses the `roster` message.
- **Quick match 2v2:** extend `matchmaking.php` queue entries with
  `mode: '2v2'` and `party: [peer, peer] | [peer]`; the matcher fills 4
  slots preferring parties, then solos (first-come). Coordinator = first
  party's first peer. This is the only backend change; same JSON-file
  store. v1 can even ship without solo-queue (parties of 2 only) if fill
  times look bad.
- **Hidden placements:** enemy-side build actions never leave their
  sender until your **whole side** has locked in (sender-side wire fog
  per recipient, §3); teammate placements always visible live. The local
  `hiddenPlacements` render rule stays as belt-and-suspenders and becomes
  side-of-seat based.
- **Ranked:** start unranked. If/when ranked: team Elo = average, delta
  applied to both members, host submits (existing host-submit + token
  protection pattern). Decide after the mode proves fun.
- **Spectators:** hub unchanged (it snapshots the coordinator's log —
  already seat-agnostic once the log carries seats). Roster entries
  already fit. Vision permissions and big-screen mode: §5b.
- **Chat:** `chat` message gains scope `'all' | 'team'`; team chat is
  sent directly to same-side peers only (mesh — no relay involved).
  Emote wheel unchanged.

---

## 5b. Spectators: vision permissions & big-screen host

Most of this exists. `SpectatorHub` already accepts any number of viewers on
a dedicated host-side Peer, catches them up **mid-game** (full log replay +
fast-forward, same machinery as reconnect), broadcasts the roster, and
relays their chat; `matchmaking.php` already has `spectate-register`/
`spectate-lookup` so a running match is discoverable by room name. "Invite a
friend to watch a game that's already running" works today for 1v1. What's
new is *who may see what*, and a host that watches instead of playing.

### The trust model (1v1 wire fog — landed)

Build-phase actions are **withheld on the wire** until the *receiving*
player locks in: each peer buffers outbound `action`/`undo`, flushes when
it sees the opponent's `endDeployment`, then streams live. Reconnect
`state` / spectator catch-up redact the unfinished build round the same
way. Spectators default to `vision: { mode: 'battle' }` (see backlog until
both locked); a player can grant `{ mode: 'live', seats: [...] }` for
their own seat from the pause menu (`spectateGrant` / `visionUpdate`).

Presentation intel fog remains for single-player (AI is local). Seatless
host / big-screen `vision: all` is still later (§ below). Full host-
authoritative "tournament relay" for N-player is still not required for 1v1.

### Vision policy (per spectator)

- Each spectator connection carries `vision: { mode: 'battle' } | { mode: 'live', seats: ('a'|'b')[] }`.
  `spectateAccepted` includes the field; `visionUpdate` pushes changes mid-match.
- **Granting:** pause menu "share my deploy live" — host updates hub directly;
  guest sends `spectateGrant` for seat `'b'`.
- Mode presets: 1v1 and horde spectators default to battle-only; casual
  party rooms can later default to live; big-screen host is always
  live/all.
- **Phase-0 migration:** the `'a' | 'b'` seat chars in `SpectatorVision` and
  `spectateGrant` become `SeatId[]` when the roster lands (grant rule stays
  "a client may only grant seats it controls"). Player fog then reuses the
  same vocabulary: a player is just a recipient whose vision is
  `{ live: seatsOfMySide }` — one filter for players and spectators alike
  (§3).

### Big-screen / board mode (host plays nobody)

The scenario "a PC opens the match on the TV, everyone joins from phones"
is the normal mesh plus a **seatless coordinator**: the roster simply
contains no seat controlled by the big-screen client.

- The big screen = coordinator (§3 chores: room registration, spectator
  hub, battle-gate acks) + a renderer with `vision: 'all'`. Nothing else
  about it is special — AI and horde derive on every client (§2d), so it
  is not an "AI runner", and match state never depends on it. Players
  (phones — the `touchpad` branch's mobile work is exactly this client)
  join as normal mesh peers.
- Code-wise this needs: `mySeat: SeatId | null` (build UI, card overlays,
  and lock-in prompts hidden when null), a free/overview camera (the rig
  already supports arbitrary heading; add a slow auto-pan "director" later,
  nice-to-have), and a lobby toggle "host as screen only".
- Costs nothing architecturally — it needs `mySeat: null` handling, the
  observer HUD, and a lobby toggle; every coordinator chore already runs
  on some peer anyway. The main real work is menu/lobby flow and a
  neutral "observer" layout (scoreboard + all economies visible).
- Caveat to accept: the screen going away ends the *chores* (lobby,
  spectators, gate acks) after the grace window, §3 — though never the
  match state itself. Fine for a living room.
- **Note (updated for the mesh):** with the mesh (§3), wire fog is
  already strict for every player without any neutral machine — the big
  screen is purely a display/party feature now, not a trust requirement.
  The old "tournament relay" idea is obsolete.

**Is it complicated?** No. Mid-game join and multi-viewer infrastructure
exist; vision is one render-rule filter plus one message; big-screen is
"allow null seat" plus lobby/HUD affordances. The one known gap that stays:
spectator reconnect (pre-existing limitation — a dropped viewer just
re-joins by room name, which is an acceptable answer).

---

## 6. HUD / UX changes (both modes)

- **Top bar:** two team HP bars (as now), each labeled with both member
  names + seat colors (4-color palette exists in `colors.ts`;
  `assignTeamColors` generalizes to seat→color, index 0/1 per side using
  blue/green vs red/orange).
- **Supply readout:** own seat only (teammate supply as a small secondary
  number — useful for coordinating, no reason to hide from allies).
- **Ready states:** four small lock-in indicators; "waiting for
  <name>" list instead of the 1v1 "waiting for opponent" card.
- **Zone rendering:** own seat's zone tinted as today; teammate's half
  tinted fainter in their color; drag-to-place rejects outside own rect
  with the existing invalid-cell feedback.
- **Unit tints/HP bars:** keep side color as the dominant read (battle
  legibility beats ownership); ownership shows via selection outline +
  zone position. Revisit only if playtests demand per-seat battle tints.
- **Specialist reveal / round cards:** overlay shows all four picks;
  card offers stay per-seat private until reveal (same hidden rule as
  placements).
- **Post-battle report:** `damageByType` keys become `${seat}:${typeId}`;
  report groups by side then seat.

---

## 7. Telemetry, stats, accounts

- `MatchRecord` gains `mode: '1v1' | 'horde' | '2v2'` and a seat roster
  (name or 'AI', side, seat). Bump `BALANCE_PATCH_ID`? No — bump
  `GAME_VERSION`; balance id only when tuning numbers. `stats.html`
  analysis: filter by mode so 1v1 balance data stays clean.
- `player.php`: horde W/L recorded with its mode tag (ladder-eligible
  later — it's PvP), 2v2 unranked at first — the mode tag on the result
  submission keeps records out of 1v1 Elo.

---

## 8. Phasing (each phase ships alone, 1v1 keeps working throughout)

**Actual status (2026-07-21):** Phase 0 — **done**, though via a local
LOCAL-perspective `SeatDef[]` (`team` relabeled per client) rather than
the fully canonical wire-format rewrite this phase originally specified;
canonical ids/roster exist too, but scoped to star mode only (§3b), with
classic 1v1 kept on its original `swapPerspective` path untouched instead
of migrated. Phase 1 — **done as a host star, not the mesh** (§3b).
Phase 2 (Horde) — **done and confirmed working**, including the belt/
visible-waves refinements requested after first playtest. Phase 3 (2v2)
— **mostly done**: teammate machinery, lobby, and online play all work;
the quick-match party queue and vision-permission spectator flow are the
two pieces explicitly not built (§10). Phase 4 and Future — not started.

**Phase 0 — Seat refactor (no behavior change).** Roster-driven `SeatId`
(§2); re-key the ownership tables in `game.ts` / `settings.ts` (`Economy`) /
`tech.ts` / card streams / `ai.ts` ctx; `Action.team` → `Action.seat`;
`Unit.seat` field; **canonical log + per-seat unit ids, delete
`swapPerspective` and the parity trick**; side-keyed state as lists (Tier 2
dormant); extract `checkMatchEnd()` (elimination rule only — the `score`
rule lands in Phase 2); `stateHash` mixes all seat balances + scores in
`SeatId` order; telemetry seat roster. 1v1/single-player run as a
two-entry roster and must be save/replay-compatible only with themselves
(bump `GAME_VERSION`; old resume markers die — acceptable, they already die
on every logic change). **Biggest phase; purely mechanical; gate on: full
1v1 vs AI match + full multiplayer match + reconnect + replay hydration all
green.**

**Phase 1 — Mesh netcode.** Multi-link session container behind a small
**transport interface** (§3 — PeerJS now, Steam-shaped later); generalize
the landed sender-side fog to **per-recipient buffers with the whole-side
flush rule**; the coordinator role (room registration, spectator hub,
ack collection, reconnect sync source); coordinator-owned
`deployCaughtUp` → `battleStart` gate replacing the symmetric 2-peer
gate; per-seat `deployReady`; log persistence for reload recovery; mesh
reconnect (§3). Testable entirely with 1v1 — **a mesh of two IS today's
topology**; behavior must be indistinguishable from the landed
sender-side fog there.

**Phase 2 — Horde mode (§4).** The `'horde'` pseudo-faction in the sim
(hostility predicate, targeting, match-HP damage from survivors); center
spawn band on the existing map; **§2d derived seeds** (horde waves +
per-round re-seed of the shared card stream); kill bounties; escalation
curve + difficulty knobs in `GameSettings`; lobby entry + room labeling.
No teammate machinery — both humans are enemies. **Stretch: the `score`
victory rule + the "most horde kills" preset (§2c)** — proves the rule
module. Playtest gate: full horde match with an artificial 200ms delay,
zero hash mismatches across 10 matches.

**Phase 3 — 2v2.** The teammate machinery horde mode didn't need:
seat-split zones + seat-owned buildings + the same-side commutativity
audit (oil field, extras budget). Plus: N-seat lobby with seat picker +
AI-fill; quick-match party queue in `matchmaking.php`; team chat scope;
spectator verification + **vision permissions and the mid-game "invite a
friend to watch, share my view" flow (§5b)**; unranked result recording.
Playtest gate: 4 real clients, reconnect each role (coordinator, ally,
enemy) mid-build and mid-battle.

**Phase 4 — Polish/balance + big-screen mode.** Team-HP and income tuning
for 4 armies on the standard map (the board may want `zoneCols` wider for 2
side-by-side armies — `MapSize` is already a setting; try 60 → 80 in the
mode's settings), per-seat color polish, post-battle report grouping,
stats.html mode filters, ranked decision; **seatless-host board mode
(§5b)** — phones play, the TV watches.

**Future (own project) — FFA / Tier 3.** Radial map class + observer of
everything above; see §2b. 3+-player horde rides this. Not scheduled.

---

## 9. Risk register

| Risk | Mitigation |
| --- | --- |
| Phase 0 touch surface (~50 sites) introduces subtle 1v1 regressions | mechanical re-key with no logic edits; the compiler drives it (change the key type, fix every red site); hydration replay of a recorded pre-refactor match action-log is the acceptance test |
| Hidden non-commutative same-side state discovered late | dedicated audit task in Phase 2; anything found becomes seat-owned or (last resort) host-sequenced for that action kind only |
| PeerJS host upload bandwidth with 3 guests + spectators | actions are tiny JSON; spectator hub already broadcasts fine; measure, don't pre-optimize |
| Coordinator reload with 3 peers is flaky | log persistence (single-player save machinery reused) + peers redial room id — same primitives as today, tested in Phase 1 while still 1v1; match state never lives only on the coordinator (§3) |
| Mesh links that fail NAT traversal (more pairs = more chances to fail) | PeerJS TURN fallback covers most; last resort: relay that one pair through the coordinator with a lobby warning (accepting the trust caveat for that pair only); Steam Datagram Relay makes this a non-issue on a Steam build |
| A rule enforced only in the HUD but not in `apply()` lets a hacked client smuggle an action all clients accept identically — no desync, no detection | one-time audit: every reject the UI enforces must also `return false` in `apply()` (costs already do); add the rule to the ARCHITECTURE.md new-action checklist |
| Hash mismatch detects desync but cannot prove *who* diverged | accepted for friend games: coordinator hash is the reference by convention (§3); keep logs for post-mortem |
| Third faction (horde) touches battle-sim targeting and perf | the rule is one predicate change ("nearest non-own-faction"); horde has no towers/HP/zones so the surface is small; profile a full late-round wave on a mid phone (touchpad-branch texture budget applies) |
| Canonical-log migration breaks a subtle perspective assumption (some UI site still expects "my units are 'player'") | derived `mySide`/`isAlly` helpers land first, then the compiler + a full-match replay diff (hash every round) against a pre-migration recording catches stragglers |
| Balance: 4 armies double unit count per battle → sim perf & mobile texture budget | sim is headless-fast (fast-forward already runs 0.25 s steps); profile battle with 2× packs on a mid phone in Phase 2 (touchpad-branch texture-budget rules apply) |
| Fog flush / catch-up races multiply with N clients (the 1v1 `deployCaughtUp` race was real and already needed a fix) | single coordinator-owned gate: everyone flushes at last lock, coordinator collects one ack per client, broadcasts one `battleStart` — no pairwise waits anywhere; hash-at-battle-start catches anything that slips |
| Last locker grinds a derived seed in ally-visible modes (§2d) | doesn't exist in horde/1v1/cross-side 2v2 (mutual fog withholds the seed's inputs); where allies stream live it's bounded by the round clock; commit–reveal is the documented upgrade if a future co-op mode needs it |
| Solo-queue 2v2 fill times in a small playerbase | ship parties-of-2 first; room list is the real matchmaking for now |
| Battle-start broadcast racing ahead of the action that completes it (relay and "should we start now" both reachable from multiple call paths, order-dependent) — this was a REAL bug, found and fixed via self-audit before any live test | fixed by making every dispatch path relay strictly AFTER its own local dispatch, with the battle-start check living only inside that post-relay step, never inside the dispatch callback itself |

## 10. Explicit non-goals (v1)

- Coordinator-chore migration on permanent loss (match state never
  depends on the coordinator, §3 — this is a lobby/spectator problem only).
  **As shipped:** any drop (host or guest) just pauses the match behind a
  "give up" notice — no redial, no grace window, no migration attempted.
- Shared team purse / gifting supply between teammates.
- Ranked 2v2 Elo (records tagged, ladder later). Horde ladder likewise.
  **As shipped:** 2v2 balance telemetry IS collected (tagged `'2v2'`,
  host-only submission) — only the Elo/rating report is skipped.
- Per-seat battle unit tints (side color stays dominant).
- Shipping any Tier-3 / FFA geometry (the model allows it; nothing is
  built) — this includes 3+-player horde.
- Wire-level deploy fog for 1v1 + spectator vision — **landed** (sender
  buffer until receiver lock-in; battle-default spectators).
- The mesh (§3) itself — **not built**; shipped a host star instead
  (§3b), with the listen-server trust tradeoff that implies, accepted
  and documented rather than solved.
- Commit–reveal seeding (§2d) and E2E encryption over a relay (§3) —
  designed, documented, **not built**.
- Spectator reconnect (pre-existing limitation; re-join by room name is the
  workaround). Spectators for star/2v2 matches specifically — **not
  built at all** yet (SpectatorHub only wires into the classic 1v1 path).
- 2v2 matchmaking-queue pairing (auto-match into a party) — **not built**;
  shipped room-code hosting only (a host creates a room, friends join by
  code — same discovery mechanism 1v1's Custom Room already uses).
- A live seat-picker/roster preview for a guest waiting in a 2v2 lobby —
  **not built**; a waiting guest just sees "connected, waiting for the
  host to start," with no visibility into who else has joined or which
  seat they'll get until the host actually starts the match.
