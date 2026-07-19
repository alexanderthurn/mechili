# Team modes plan — 2v2, 2vE, and an N-player foundation

Plan for adding team modes to Melodan:

- **2vE** — two humans on one side, the built-in AI running the other side.
- **2v2** — four humans, two per side.
- built on an **N-player seat model** (§2, §2b) so later modes — 3vE with a
  kill-score winner, 5v5, uneven teams, eventually free-for-all — are mode
  definitions, not refactors.

Written after a code survey on 2026-07-19. Read ARCHITECTURE.md first; every
constraint there (action log, determinism, perspective) shapes this plan.

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
  same `ActionDispatcher` as everyone else, off its own seeded rng stream).
  A co-op AI is "the same class, driven on the host, its actions relayed" —
  no new AI work needed for a first version.
- **`SpectatorHub` proves the multi-connection pattern** — a host-side Peer
  accepting N connections, with roster broadcast. The 2v2 host link is the
  same shape.
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
| `net.ts` | `NetSession` is one 1:1 link; `setup` names exactly host+guest; `swapPerspective` translates by flipping team + unit-id *parity* — a strictly 2-perspective trick |
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

With that, the existing model scales as-is: actions stream live, apply in
arrival order, and all interleavings converge. `stateHash` at every battle
start remains the safety net.

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
**This tier is what Phases 0–3 ship, and it is where "3 players vs enemies,
most kills wins" lives** — 3 human seats + 3 AI seats on two sides, with a
`score` victory rule (§2c). No new architecture.

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
star netcode, victory rules); the map/camera/placement layer is the new
project.

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
- **"3 players vs enemies, most kills wins"** is then literally:
  `seats: [3 humans on side 0, 3 AI on side 1]`,
  `victory: { rule:'score', metric:'kills', endAt:{ sideEliminated:true }, scope:'seat' }`,
  plus a co-op difficulty preset. It rides the 2vE phase's plumbing with no
  new systems — a good Phase-2 stretch goal to prove the rule module.

---

## 3. Network topology: host star

Keep PeerJS. The host becomes a hub (pattern already proven by
`SpectatorHub`):

- **Host** holds one `NetSession` per remote human (1 for 2vE, up to 3 for
  2v2). Guests hold exactly one link (to the host) — guest code barely
  changes.
- **Relay:** every action a guest sends, the host applies and forwards to
  the other guests (tagged with the actor's canonical seat). Host's own and
  AI actions broadcast to all. Guests never talk to each other.
- **No wire translation at all** — actions travel with canonical seat ids
  and are applied verbatim (§2). Relaying is a dumb forward; a whole desync
  class disappears with `swapPerspective`.
- **`setup` message** carries the full `GameSettings` including the seat
  roster (§2) plus each client's own `SeatId` assignment. Replaces
  `hostName`/`guestName`. `GAME_VERSION` bump gates everything, as usual.
- **Battle gating:** `deployReady` per seat — battle starts when all 4 seats
  locked in (AI seats lock instantly after acting). `battleEnd`/`ready`
  become per *client* (3–4 clients), host waits for all before the next
  build phase; guests wait for the host's go signal (new tiny message
  `phase` from host, or host simply forwards everyone's `battleEnd` and each
  client waits for the full set — pick the former, it's less N²).
- **Battle speed:** host-controlled only in team matches (today's per-pair
  sync doesn't generalize; simplest rule that keeps clients together).

### Reconnect

- **Guest drop:** exactly today's flow, host is the survivor/authority —
  guest redials the host, sends `resume`, host answers `state` (full
  canonical log + `battleElapsed` + `phaseRemaining`). Other clients just
  see a "teammate reconnecting" toast; match pauses (same grace countdown UI
  as now) or — better for 4 players — *doesn't* pause during build, only
  blocks the battle-start gate. Start with full-pause (reuse machinery),
  soften later.
- **Host drop:** all guests keep their `ResumeMarker` and redial the host's
  room id for the grace window (host reloads, re-opens its peer, guests
  reattach, host rebuilds from ITS OWN sessionStorage log — note: host must
  persist its log like single-player already does). No host migration in v1;
  if the host doesn't return within grace, the match ends for everyone.
- **Desync:** guest that mismatches the HOST's hash reloads and resumes from
  the host (existing flow); host never reloads. Guest-vs-guest comparison is
  unnecessary — the host is the reference.
- Keep the rule from memory: never hash-check outside battle start.

---

## 4. Mode: 2vE (build first)

Two humans (host + one friend) on side 'a', **two AI seats** on side 'b'.
Two AI seats — not one double-income AI — so the seat model is exercised
symmetrically and income/balance knobs stay per-seat.

- **Entry:** "Co-op vs AI" menu button → host gets a room code (reuse
  `hostLobby` custom-room plumbing + a `mode: 'coop'` flag in the lobby
  entry so the room list can label it); friend joins via room list or URL
  param, lands on the second seat of side 0. No quick-match queue for v1
  (friends mode); queue can come later with the 2v2 matchmaking work.
- **AI execution:** the host runs both `AiOpponent` instances exactly as
  single-player does today (own rng streams `ai-0`, `ai-1` from the seed)
  and relays their dispatched actions to the guest as normal `action`
  messages. The guest treats AI seats as network opponents. This sidesteps
  every "would the AI act identically on both clients" timing question —
  AI actions are in the log, hydration replays them, reconnect works free.
- **Difficulty knobs** (in `GameSettings`, so they're lobby-visible):
  AI income multiplier per seat, AI unlock aggressiveness (existing rng
  thresholds), optional AI HP handicap. Default: symmetric incomes,
  2000 team HP both sides.
- **Ranked:** none. W/L only, same as today's AI games (`player.php` rule
  already exists). Telemetry MatchRecord gains the seat roster (§7).
- **Win/lose:** unchanged — side HP reaches 0.

Why first: it needs only 2 clients (smallest star), no matchmaking backend
changes, no Elo questions, and friendly stakes while the seat model and
relay shake out their desyncs.

## 5. Mode: 2v2

Everything from 2vE, plus:

- **Lobby with seats.** Custom-room lobby screen becomes a 4-slot table
  (side A: seat 0/1, side B: seat 0/1) with click-to-move-seat, host can
  fill empty seats with AI (this also gives 1v2, 2v1E, 1vE+ally variants
  for free — don't advertise, just don't forbid), start enabled when all
  seats filled. Roster broadcast reuses the `roster` message.
- **Quick match 2v2:** extend `matchmaking.php` queue entries with
  `mode: '2v2'` and `party: [peer, peer] | [peer]`; the matcher fills 4
  slots preferring parties, then solos (first-come). Host = first party's
  first peer. This is the only backend change; same JSON-file store. v1 can
  even ship without solo-queue (parties of 2 only) if fill times look bad.
- **Hidden placements:** hide enemy-*side* placements until own lock-in
  (existing rule, side-based already); teammate placements always visible
  live. `hiddenPlacements` check becomes side-of-seat based.
- **Ranked:** start unranked. If/when ranked: team Elo = average, delta
  applied to both members, host submits (existing host-submit + token
  protection pattern). Decide after the mode proves fun.
- **Spectators:** hub unchanged (it snapshots the host log — already
  seat-agnostic once the log carries seats). Roster entries already fit.
  Vision permissions and big-screen mode: §5b.
- **Chat:** `chat` message gains scope `'all' | 'team'`; host relays team
  chat only to same-side clients. Emote wheel unchanged.

---

## 5b. Spectators: vision permissions & big-screen host

Most of this exists. `SpectatorHub` already accepts any number of viewers on
a dedicated host-side Peer, catches them up **mid-game** (full log replay +
fast-forward, same machinery as reconnect), broadcasts the roster, and
relays their chat; `matchmaking.php` already has `spectate-register`/
`spectate-lookup` so a running match is discoverable by room name. "Invite a
friend to watch a game that's already running" works today for 1v1. What's
new is *who may see what*, and a host that watches instead of playing.

### The trust model, stated honestly

In this lockstep design **every client receives every action live**; hiding
the enemy's build phase is a local *rendering* rule, not withheld
information (ARCHITECTURE.md says so explicitly — and it's equally true
between the two players today). So spectator fog of war is a presentation
policy, not a security boundary: a technical spectator could read the wire.
For friends-and-living-room play that's the right trade. If it ever
matters, the host-star gives us real hardening for free later: the host can
simply **delay relaying a seat's build actions until that seat locks in** —
then nobody (player or spectator) can peek even in principle. That changes
live-stream feel and undo mirroring, so it's an opt-in "tournament relay"
setting, explicitly not v1.

### Vision policy (per spectator)

- Each spectator connection carries `vision: 'all' | SeatId[]`.
  `spectateAccepted` gains the field; a new tiny `visionUpdate` message
  changes it mid-match (hub pushes it; spectator re-applies its render
  filter — no game state involved anywhere).
- The render rule generalizes once: "hide seat X's un-locked-in build
  actions unless X ∈ my vision set" — players are just clients whose vision
  set is {own side's seats}, spectators get whatever they were granted.
  Battle phase stays public for everyone, as today.
- **Granting:** a seat can expose only *its own* build phase. Player taps
  "share my screen-side with <spectator>" in the roster panel → host updates
  that spectator's vision set. (With split zones a seat's grant reveals its
  own zone only; a teammate's half stays hidden unless they also grant.)
  Mode presets: 1v1/2v2 spectators default to `[]` until lock-in reveal
  (today's behavior), co-op vs AI defaults to `all` (nothing to hide from
  friends), big-screen host is always `all`.

### Big-screen / board mode (host plays nobody)

The scenario "a PC opens the match on the TV, everyone joins from phones"
is the star topology with a **seatless host**: the roster simply contains
no seat controlled by the host client.

- Host = authority, relay, AI runner, and renderer with `vision: 'all'` —
  a dedicated server that happens to have a screen. Guests (phones — the
  `touchpad` branch's mobile work is exactly this client) join as normal
  players.
- Code-wise this needs: `mySeat: SeatId | null` (build UI, card overlays,
  and lock-in prompts hidden when null), a free/overview camera (the rig
  already supports arbitrary heading; add a slow auto-pan "director" later,
  nice-to-have), and a lobby toggle "host as screen only".
- Costs nothing architecturally — every system already runs host-side for
  relay/AI purposes; the host just doesn't open a placement UI. The main
  real work is menu/lobby flow and making the HUD render a neutral
  "observer" layout (scoreboard + both economies visible).
- Caveat to accept: the screen is also the single point of failure (host
  drop pauses/ends the match, §3). Fine for a living room.

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

- `MatchRecord` gains `mode: '1v1' | 'coop' | '2v2'` and a seat roster
  (name or 'AI', side, seat). Bump `BALANCE_PATCH_ID`? No — bump
  `GAME_VERSION`; balance id only when tuning numbers. `stats.html`
  analysis: filter by mode so 1v1 balance data stays clean.
- `player.php`: co-op counts as AI game (W/L), 2v2 unranked at first —
  needs only a mode tag on the result submission so records aren't mixed
  into 1v1 Elo.

---

## 8. Phasing (each phase ships alone, 1v1 keeps working throughout)

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

**Phase 1 — Host star netcode.** Host multi-`NetSession` container +
dumb relay (canonical actions, no translation); per-seat `deployReady`;
host-driven phase gating; host log persistence for host-reload recovery;
multi-guest reconnect. Testable entirely with 1v1 (a star of one) before
any new mode exists.

**Phase 2 — 2vE.** Seat-split zones + seat-owned buildings (needed here
already — two humans share a side); co-op lobby entry + room labeling; AI
seats on host with relay; difficulty knobs; HUD seat rows; commutativity
audit (oil field, extras budget). Playtest gate: full co-op match with an
artificial 200ms delay on the guest link, zero hash mismatches across 10
matches. **Stretch: the `score` victory rule + a 3vE "most kills wins"
preset (§2c)** — rides the same plumbing, proves the rule module, and the
roster makes 3 seats no harder than 2.

**Phase 3 — 2v2.** N-seat lobby with seat picker + AI-fill; quick-match
party queue in `matchmaking.php`; team chat scope; spectator verification +
**vision permissions and the mid-game "invite a friend to watch, share my
view" flow (§5b)**; unranked result recording. Playtest gate: 4 real
clients, reconnect each role (host, ally guest, enemy guest) mid-build and
mid-battle.

**Phase 4 — Polish/balance + big-screen mode.** Team-HP and income tuning
for 4 armies on the standard map (the board may want `zoneCols` wider for 2
side-by-side armies — `MapSize` is already a setting; try 60 → 80 in the
mode's settings), per-seat color polish, post-battle report grouping,
stats.html mode filters, ranked decision; **seatless-host board mode
(§5b)** — phones play, the TV watches.

**Future (own project) — FFA / Tier 3.** Radial map class + observer of
everything above; see §2b. Not scheduled.

---

## 9. Risk register

| Risk | Mitigation |
| --- | --- |
| Phase 0 touch surface (~50 sites) introduces subtle 1v1 regressions | mechanical re-key with no logic edits; the compiler drives it (change the key type, fix every red site); hydration replay of a recorded pre-refactor match action-log is the acceptance test |
| Hidden non-commutative same-side state discovered late | dedicated audit task in Phase 2; anything found becomes seat-owned or (last resort) host-sequenced for that action kind only |
| PeerJS host upload bandwidth with 3 guests + spectators | actions are tiny JSON; spectator hub already broadcasts fine; measure, don't pre-optimize |
| Host reload with 3 guests is flaky | host log persistence (single-player save machinery reused) + guests redial room id — same primitives as today, tested in Phase 1 while still 1v1 |
| Canonical-log migration breaks a subtle perspective assumption (some UI site still expects "my units are 'player'") | derived `mySide`/`isAlly` helpers land first, then the compiler + a full-match replay diff (hash every round) against a pre-migration recording catches stragglers |
| Balance: 4 armies double unit count per battle → sim perf & mobile texture budget | sim is headless-fast (fast-forward already runs 0.25 s steps); profile battle with 2× packs on a mid phone in Phase 2 (touchpad-branch texture-budget rules apply) |
| Solo-queue 2v2 fill times in a small playerbase | ship parties-of-2 first; room list is the real matchmaking for now |

## 10. Explicit non-goals (v1)

- Host migration on permanent host loss.
- Shared team purse / gifting supply between teammates.
- Ranked 2v2 Elo (records tagged, ladder later).
- Per-seat battle unit tints (side color stays dominant).
- Shipping any Tier-3 / FFA geometry (the model allows it; nothing is built).
- Wire-level fog of war ("tournament relay" hardening, §5b) — presentation
  fog only in v1.
- Spectator reconnect (pre-existing limitation; re-join by room name is the
  workaround).
