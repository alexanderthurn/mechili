# Progression plan — loadouts, rewards, matchmaking, MMR

Plan for the meta layer around the match: what the player chooses before
a match (**tech loadouts**), what they earn from every match (**rewards**),
how they find an opponent (**matchmaking**), and how skill is tracked
(**MMR / ladder**).

Written 2026-08-23 after a code survey of `horde` (level with `melodan`),
`backend/*.php`, and `steam-electron-build`. Read ARCHITECTURE.md and
TEAM_MODES_PLAN.md first — the action log, determinism rules, seat model
and star netcode described there shape every decision below.

## 0. Locked design decisions

These were settled in the planning session and are not open for
re-litigation without a reason.

1. **Rewards are cosmetics + convenience only. Never combat power.**
   The full talent catalog is available to every player from the first
   match. A loadout is a *choice*, never an *unlock*. Selling extra
   loadout preset **slots** is fine; selling a talent is not.
   *Why:* talents change combat stats. Grind-gating them would make MMR
   measure playtime instead of skill, make matchmaking pair unequal
   toolkits, and read as pay-to-win on the store page regardless of
   intent.
2. **Production is Steam-only. There is no game server.**
   `backend/*.php` is a **development convenience for the browser build
   only** — it is not deployed, not depended on, and its password/auth
   path is already unused. Every production feature in this document
   must work with Steam alone (lobbies, P2P, Cloud, stats, achievements,
   leaderboards) or not ship. Its planned reshape into a reusable
   per-game backend lives in BACKEND_PLAN.md.
3. **No seasons yet.** Permanent account level plus rotating monthly
   challenge chapters. Season resets can come later, once there is a
   ladder population thick enough that a reset is a fresh start rather
   than a deletion.
4. **The PHP path stays alive as a dev-only transport adapter.**
   Not for production — for iteration speed. Testing Steam P2P needs two
   Steam accounts on two machines; the browser path tests in two tabs.
   Matchmaking logic is fiddly and needs many runs, so the policy layer
   is written platform-agnostic and testable in a browser (§3).

## 1. Tech loadouts

**Status: this is the piece being implemented first.** The data model is
already ~70% present — this is mostly wiring plus a picker.

### 1a. What already exists

`src/game/techCatalog.ts` already has the whole catalog and the shape of
the feature:

- `TECHS` — every talent, with cost/mods/icon/fire/produce/onKill/cleave.
- `UNIT_TECH_ALLOWLIST` — which talent ids each unit type may take.
- `UNIT_TECH_SLOTS` — per-unit slot caps (`dwarf: 2`, `archer: 3`,
  `wizard: 2`, `crowRider: 3`, `ballista: 12` — since cut to `4`, see
  §1g), defaulting to `DEFAULT_UNIT_TECH_SLOTS = 4`.
- `selectedTechIds(typeId, maxSlots)` — the stub. Its own comment says
  *"Pregame picker will replace this; for now: first N allowed ids."*

So the missing parts are: a real per-player selection, getting that
selection to every peer, and a UI to make it.

### 1b. The core refactor — selection becomes per-seat

`selectedTechIds()` is currently a **global pure function**: every seat
in a match resolves the same talents for the same unit type. That is
exactly the constraint a loadout has to break.

This is the same refactor already landed on `TechTree` (commit
`fba8b39`, TEAM_MODES_PLAN.md §8): a `Record<Team, …>` global became
seat-keyed, and `seat` had to be threaded through `fire.ts`'s fire-profile
resolution and `sim.ts`'s aura checks. Same shape, same pitfalls, already
precedented — follow that commit as the template.

Call sites to convert (all of them):

| File | Line | Note |
|---|---|---|
| `game.ts` | 1558, 2944, 9801 | pack stats, battle prep, HUD slot list |
| `ai.ts` | 311 | **sim-side — must stay deterministic** |
| `fire.ts` | 194 | **sim-side — same as the `fba8b39` fire threading** |
| `actions.ts` | 759 | `buyTech` validity check |
| `homepage/main.ts` | 195 | showcase page — no seat; uses the default |

### 1c. Data model

```ts
interface Loadout {
    /** talent picks, keyed by unit type id */
    techs: Record<string, string[]>;
}
```

**A container, not the bare map** — deliberately, so later pregame choices
are additive rather than a migration of every value already saved in
`user.sav` and already crossing the wire. See §1h.

**Only this shape is accepted.** `normalizeLoadout` reads `techs` and
nothing else; anything in another shape degrades to defaults rather than
being migrated. Nothing has shipped, so there is no old format worth
carrying — clear storage if a stale value shows up in development.

`normalizeLoadout` itself stays, and is not about formats: it is the wire
trust boundary, capping a peer's picks to the slot limit and dropping ids
off a unit's allowlist at the host's `onJoin` and again in
`localizeRoster`. Without it a modified client's over-limit loadout would
be honoured by every other client's sim.

Always **normalized** before use and before it crosses the wire:
drop unknown talent ids, drop ids not in that type's allowlist,
de-duplicate, truncate to `techSlotLimit(typeId)`. Normalization is the
trust boundary — a peer's loadout arrives over the network and feeds the
sim, so an unnormalized loadout is a desync or an exploit, not a
cosmetic problem. Missing/absent entry falls back to today's behavior
(`allowedTechIds().slice(0, limit)`), which keeps every existing match,
replay and AI seat working unchanged.

### 1d. Wire format — one surface, already unified

Two findings from the code survey make this much smaller than expected:

- **1v1 online is already just a 2-seat star room** (`initial1v1Roster`
  in `main.ts:3068` returns `CanonicalSeatDef[]`; `net-steam.ts`: *"Every
  lobby is a star lobby regardless of layout"*). There is no separate
  classic handshake to also teach about loadouts.
- **`hello` and `setup` in the `NetMessage` union are dead types** —
  declared at `net.ts:280`/`282`, sent and received nowhere. They are
  leftovers from before the star unification. Do not extend them; they
  should be deleted in a separate cleanup.

So the entire wire change is:

1. `CanonicalSeatDef` gains `loadout?: Loadout` — exactly mirroring how
   `avatar` already rides along. It is then carried for free by
   `starSetup`, `starRoster`, and `matchCatchUp` (reconnect + spectate).
2. `starJoin` gains `loadout?: Loadout`, so a joining guest's own choice
   reaches the host — again exactly mirroring `avatar`.
3. `localizeRoster()` passes it through into the local `SeatDef`.
4. Normalize on receipt, host-side, before it enters the roster.

Every peer therefore knows every seat's loadout **before the first sim
step**, which is the requirement — talents are combat-affecting and
sim-visible.

**`GAME_VERSION` must be bumped.** Mixed-version matches would desync in
combat math, and the version check is what prevents that.

### 1e. Replay and determinism

The loadout is match *input*, like the seed and the roster — not an
action. It must be captured in the replay alongside them, or replays of
loadout matches will resolve different combat stats than the live match
did. Confirm against `Game.exportReplay()` and the replay verifier
(`main.ts` bulk-verify path) as part of the work.

### 1f. Persistence

Loadouts go in the **`mechili-user-` namespace** (`userStorage.ts`), the
one that syncs via Steam Auto-Cloud `user.sav`. Rationale: they are
profile data the player expects to follow them between machines, and —
unlike progression (§2) — they are written *rarely*, only when edited.
That keeps them clear of the Cloud conflict problem described in §2c.

### 1g. UI

Reached from the username/avatar dialog (not the main menu — it is
profile config, not a way to start a match). **Above 720px** a "Loadout"
chip also appears in the main menu, stacked above the username chip and
wearing the same `.mechili-username` styling. Under the breakpoint it is
dropped — that corner is already crowded on a phone — and the profile
dialog's own button is the route. It is CSS-gated, so
`setMenuChromeVisible` clears the inline display rather than setting one,
leaving the breakpoint in charge. **Master–detail**: a rail of
unit types on the left, one unit's full detail on the right.

**The 3D stage IS the screen**, modelled on Mechabellum's tech screen: a
full-viewport rotating model of the unit, with every panel floating over
it. Left: a `◀ name ▶` unit switcher and a linear stat list (label left,
value right). Right: a linear talent list (icon, name, supply cost) and
the chosen-slot boxes under it. Corner buttons bottom-right.

It is therefore its OWN overlay on the wrapper, not a `.m-view` inside the
menu — the menu frame's width would otherwise constrain it, and the menu
hides itself while the screen is open.

The model reuses `createShowcaseViewer` (moved from `homepage/` to `ui/`,
since it was never homepage-specific): drag to orbit, wheel to zoom,
auto-rotate resuming shortly after release. It owns a second WebGL
context, so it is created when the screen opens and disposed on Back, and
its canvas survives re-renders rather than being rebuilt per click.

Slot boxes carry the limit visually (one box per slot, filled ones clear
on click), so no "N of M filled" label is needed. Talent descriptions live
in a hover tip — at full-screen scale the list reads better as one line
per talent, matching the reference.

The tip is the game's existing `CardSpellTips` (the in-match rune/spell
hover), driven by `data-spell-tip` + `data-ttitle`/`tdesc`/`ticon`. Bound
on open and destroyed on close, because each instance registers its own
document-level listeners and two live at once would show two tips. Both
the talent rows and the slot boxes carry it — the slots especially, since
they show neither a name nor a cost of their own.

**Touch has no hover, so a tap does the hovering**: the first tap on a
talent or slot opens its tip, the second performs the click. One delegated
capture-phase listener on the overlay root handles it — capture so it can
swallow the first tap before the button's own handler, delegated so it
survives the re-renders that rebuild both lists. Mouse and pen are
untouched (hover plus an immediate click); only touch pays the extra tap,
and only on elements that actually have a tip, so the arrows and corner
buttons stay single-tap. The alternative considered was the HUD's existing
450ms `attachLongPress`, which is the established in-game gesture but is
invisible to a player who opens this screen before ever playing a match.

**Mobile** keeps the same overlay model as desktop rather than stacking in
flow. Stacking was tried and was worse: the talent list got pushed down by
whatever sat above it and could start near the bottom of the screen. Under
860px the panels flow from the TOP — switcher and collapsed stats, then
talents and slots — while the stage stays absolutely positioned behind
them, so it never pushes anything down. Whatever height the panels leave
is at the BOTTOM, which is where the model shows through, rendered at
`NARROW_MODEL_SCALE` so it reads as a backdrop instead of fighting the
overlays for the same pixels. Corner buttons stay pinned top-right (at the
bottom they sat on the talent panel). Coarse pointers get 44px tap
targets.

**Short viewports hide nothing.** An earlier version dropped the model and
stats below ~700px tall; once the panels became an overlay rather than
sharing height with the stage, a short window costs the model no space, so
the rule only keeps the panels inside the screen (`max-height` + scroll).
The panel still disposes its renderer whenever the stage measures zero — a
display:none canvas would otherwise leave a WebGL context and a rAF loop
running for nothing — which is now a safety net rather than a live path.

**"Reset all", not "Reset"** — it rebuilds every unit's picks, while
everything else on the screen is scoped to the selected unit, so the
unqualified label read as "reset this unit".

**One stored loadout, not presets.** Named presets were built first and
then cut: with no UI to create, name or switch between them, the whole
preset array, its active-id key and the write-juggling existed to hold a
single value. Presets are worth adding when §2b actually sells extra
preset slots — as a real feature with a real UI, not as machinery waiting
for one.

**Settled:** the ballista was `12` slots against a 12-long allowlist —
no choice at all, it simply took everything. Now **4 of 12**: the widest
allowlist in the game and the most real decision, so a ballista commits
to a siege, anti-air or fire build. The allowlist itself is unchanged.

Knock-on: the DEFAULT loadout is the first N allowed ids, so a fresh
profile starts on the first four ballista entries (`skyBind`, `armor`,
`autoloader`, `golden`) — allowlist ORDER is therefore a balance lever
for the human default, not just presentation.

**Bots do NOT use that default.** Every AI seat gets a randomized loadout
(`randomLoadout`), so opponents vary between matches instead of every bot
playing array order.

**It is always TRANSFERRED, never derived.** The roll happens once, where
the seat is created — the host's AI-fill for networked matches (before
`starSetup` goes out, so the same array reaches every client), and the
`Game` constructor for purely local rosters. Every seat on a roster
therefore carries a real loadout, AI and human alike, and no client ever
recomputes one.

An earlier draft derived AI loadouts per-client from the match seed. It
worked, but it made correctness depend on two invariants that are easy to
break later — every client agreeing on the seed, and seat INDEX being
stable across clients — for the sake of saving a few hundred bytes.
Transferring the value has one path, one source of truth, and fails
loudly rather than silently desyncing.

Two consequences of doing it at seat-creation time:

- **Solo 1v1's opponent is covered.** `canonicalClassicSeats` marks that
  seat `'human'` even though `AiOpponent` drives it, so a
  `controller === 'ai'` test would have missed it. The fill keys off "has
  no loadout" instead.
- **A bot taking over a dropped human seat inherits THAT player's
  loadout** rather than rolling a new one — the army already on the board
  was built for those talents. Preserved through takeover and reclaim
  (`{ ...def, controller }`), and mirrored into StarHub's own roster so
  the two copies cannot disagree.

### 1h. Later pregame choices (NOT built)

Two further choices are anticipated. Neither is implemented; the data
structure is shaped to accept them, and that is all.

**Spell loadout per commander.** Each `StartCard` fixes three
`forgeSpells` — a 1-, 2- and 3-rune spell. Letting a player choose them
would add `spells?: Record<commanderId, tacticId[]>`. Cheap: `forgeSpells`
is read in exactly ONE place (Game's forge-spell lookup, via
`starterCardOfSeat(seat)?.forgeSpells`), so a player override is a single
fallback there, same "absent → card default" rule techs already use.
Constraint to encode: **one spell per rune tier**, not a flat count — the
forge recipes are built on the 1/2/3 structure, and three 3-rune picks
would break the rune economy.

**Commander pool.** The starter offer is `draw(START_CARDS, 4, rng)` — 4
of 20, per-seat seeded. Restricting it means passing a filtered array to
that same call, plus a minimum pool size (the draw wants 4).

**If this is built, build it as a BAN list, not a pick list.** "4 random
of 20" is a variety mechanic — you adapt to what you are dealt. A pick
list collapses it: everyone curates down to the strongest few and
match-to-match variety goes with it. It is also *chosen* power in a way
talents are not, since a talent costs supply to research while a
commander pick is free. A ban list answers "I never want to play this
one" without answering "I always want to play this one", which is the
half worth granting.

### 1i. In-match: the shop hover window

A unit's shop tile used to carry a native `title` with a stat blurb, which
could not show the player's chosen talents. It now uses the same framed
window the shop RUNES use (`CardSpellTips`), showing **only the unit name
and its chosen talents, listed vertically with their research cost** —
same shape as the loadout screen's list. The tile already shows the unit's
cost, and stats belong in the unit details panel rather than on every
hover.

Anchored off the whole **shop column**, not the tile: a tile-relative
offset still landed inside the shop (the column is wide) and therefore
right next to the cursor. Left of the column and near the top clears both.

The **unlock picker** shows the same window — you want to see what talents
a unit would bring before paying to unlock it. Its tiles are `.shop-tile`
too but live in a centred modal rather than the shop column, so they fall
through to the default placement, which flips sides as needed. They are
built as an HTML string long after `setUnitTalents` runs, so the encoded
rows are kept on the HUD (`unitTalentRows`) rather than only on the shop
tiles' datasets. Its grid also overrides the shared `direction: rtl` —
that exists to fill the screen-edge shop from the right, and reads wrong
in a centred dialog.

Each row shows the talent's icon, name, research cost and **what it
does** — the same `techDescription()` text the loadout screen shows.

`spellInfoFrameHtml` gained an optional `rows` list (icon, label, cost,
desc), serialized onto the tile as `data-trows` via `encodeTipRows`
(`icon|cost|label|desc`, one row per line, description LAST so it may
contain pipes — icon ids, costs and talent names cannot). The HUD receives the picks
once at match setup (`setUnitTalents`) since a loadout cannot change
mid-match. Long-press shows the same window on touch, replacing the
plain-text stand-in.

**Unaffordable tiles stay hoverable.** `.shop-tile.unaffordable` used to
carry `pointer-events: none`, which took the info frame away along with the
click — but reading a unit's talents is most useful exactly when you cannot
afford it yet. The tiles are now dimmed with `cursor: default` and the click
is refused in JS, matching the treatment the panel's locked/owned tiles
already had.

## 2. Rewards and progression

Reward **every** completed match — vs AI, loss, or win. The stated goal
is play frequency, not skill-gating.

### 2a. Earning

- A **base** grant per completed match.
- Modest multipliers for a win, for PvP over AI, and for the day's first
  few matches.
- A soft daily taper (full value for ~5 matches, reduced after) to blunt
  AFK-farming without punishing a long session.

### 2b. Spending — hooks that already exist in the codebase

- Stronghold banners — `strongholdFlags.ts`
- Emotes — `emotes.ts`
- Avatar frames, profile titles, unit color schemes
- Extra loadout preset slots (§1g)

Plus an **account level** from cumulative XP: the visible "you played, it
counted" number, shown next to the player's name in the queue browser
and lobby.

### 2c. Storage — and a specific pitfall

Progression is written after **every match**. `user.sav` today holds only
name and avatar, written rarely.

Per the known Steam Cloud conflict (Melodan `4987230`, playtest
`5115110`, and local `npm start` all share bundle id
`com.feuerware.melodan`, so all three write the same file set while sync
state is per-app), a **frequently-written file will hit conflicts far
more often than the current one does**. Therefore:

- Progression lives in its **own** Auto-Cloud file (`progress.sav`), not
  in `user.sav`. **This file does not exist yet — it is proposed here,
  and nothing is to be built until §2 is.**
- Writes are **batched** — end of match and on quit — never continuous.

**Loadouts are deliberately NOT in this file.** They are the opposite
case: written only when the player edits them, and profile data that
should follow the account. They live in `user.sav` alongside name and
avatar (§1f), which is where they already are and where they stay.

### 2d. Monthly challenge chapters, without a server

Bake the rotation into the client: a table of chapters plus a date-based
selector, so month N deterministically selects chapter N. No fetch, works
offline, and a new build simply extends the table. The only thing lost
versus a server is retuning a live challenge, which does not matter at
this scale.

### 2e. Steam achievements and stats

Currently **zero** achievements are used — `unlockAchievement`/`setStat`
are exposed by the Electron bridge and called from nowhere in the game.
This is free retention that also shows on the store page.

- ~25–40 achievements.
- A handful of Steam stats, so global-stat percentages become flavor
  ("4% of players have won a 2v2 without losing a stronghold").

## 3. Matchmaking

Requirement: work at **0 waiting players, 1, and many with a wide rank
spread** — and let players **see who is waiting**.

### 3a. The queue is the lobby list

Every waiting player owns a **public Steam lobby** carrying
`{game, version, mode, mmr, waitingSince, name, avatar, inPractice}`.
No queue server, and the same policy shape works on the dev PHP
transport.

### 3b. Pairing rule

Both peers evaluate this identically, so no arbitration is needed:

1. **Widening window.** e.g. `±(100 + 40 per 10s)`, effectively uncapped
   after ~90s. Both sides' windows are derivable from `waitingSince` in
   the lobby data, so each peer can compute the other's.
2. **Mutual acceptance.** Pair only if each is inside the *other's*
   window too. Stops a 2000 MMR player who just queued from being pulled
   into a 600's wide window.
3. **Tie-break by SteamID64.** Join the acceptable candidate with the
   lowest id; if every candidate is higher than you, keep hosting and let
   them come to you. Deterministic — kills the both-join / both-wait
   split. Handle a failed join (someone else took the slot) by
   re-scanning.
4. **Ready-check both sides, 15s.** Decline returns both to the queue;
   the decliner gets a ~60s cooldown against that same opponent.

### 3c. Zero players waiting — the one that matters at launch

**Queue in the background while playing the AI.** Press Play, the queue
starts, and instead of a spinner the player is dropped into a skirmish.
Lobby data carries `inPractice=1` so the ready-check expects a moment's
delay. This is what makes an empty queue not feel dead, and it composes
exactly with §2's "every match pays out".

### 3d. Seeing who is waiting

Nearly free on both transports — `getLobbies()` and
`matchmaking.php?action=list` already return everything needed. Render
the queue as a **browser**: name, avatar, MMR, wait time, plus a
**Challenge** button that invites that specific player directly,
bypassing the MMR rule. Small communities need a lobby browser more than
a queue; this yields both from one data source.

### 3e. Architecture

Policy (window curve, mutual acceptance, tie-break) goes in one
platform-agnostic module — `matchmakingPolicy.ts` — with a Steam adapter
and a PHP adapter, mirroring how `multiplayerTransport.ts` already
separates transport from protocol. Pure policy is unit-testable and
browser-testable (§0.4).

Steam's near-value lobby filter
(`addRequestLobbyListNearValueFilter('mmr', …)`) is **not needed yet** —
client-side sorting of `getLobbies()` is fine at this scale and avoids a
`steam-electron-build` change. Add the filter only if lobby counts grow.

## 4. MMR and ladder, with no server

### 4a. Where MMR lives

- **Leaderboard entry = canonical.** Steam-hosted, survives reinstalls,
  readable for any user, and gives the ladder UI for free.
- **Lobby metadata = the matchmaking copy.** The pairing rule (§3b)
  reads `mmr` straight off the lobby list, so matchmaking never fetches.
- **`progress.sav` = local mirror**, for offline and instant display,
  reconciled against the leaderboard on launch.

### 4b. The tradeoff, stated plainly

Serverless means **client-reported**. A modified client can write any
MMR it likes and there is no fix for that without a server — only
mitigations:

- **Peer-agreed results.** At match end both peers exchange a result
  record over P2P; each applies MMR only if the two agree. This stops
  the trivial "claim a win against the player who beat me" case, and it
  also disambiguates genuine desync/disconnect endings, which is the more
  common real problem. Cheap to build.
- Accept the rest. Since rewards are cosmetics-only (§0.1), a spoofed
  ladder position is a cosmetic harm.

### 4c. Rating math

The current backend uses fixed `K=32` from 1000. For a small population:

- **Track uncertainty, not just rating** (Glicko-lite RD). `K≈64` for the
  first ~10 placements, decaying to ~16. This specifically lets an
  uncertain player's search window widen fast without wrecking
  established ratings.
- **Ranked is 1v1 only.** 2v2 gets a separate rating (side-average
  expected, applied per player). Horde and vs-AI are unrated.

## 5. Steam surface — what exists, what has to be added

Exposed today by `steam-electron-build`'s `native/index.js`:
lobbies (public/private, `setData`/`getLobbies`), P2P, friends list +
avatars, rich presence with Join Game, achievements, int stats,
Auto-Cloud via `user.sav`.

Present in the underlying `steamworks-ffi-node` binding but **not yet
surfaced by the package** — these are required work, not optional:

- **Leaderboards** (`LeaderboardManager`, upload score, download
  entries) — needed as MMR's canonical store (§4a).
- **Global stats** — needed for the §2e percentage flavor.
- Lobby-list filters — available, deliberately not needed yet (§3e).

Also a prerequisite: **Steamworks partner-site setup** — achievement
definitions, stat schema, leaderboard creation are all web-UI
configuration that must exist before any code can call them.

## 6. Order of work

1. **Loadouts** (§1) — most self-contained, data model already mostly
   there, and the per-seat refactor repeats one already landed
   successfully.
2. **Steamworks partner-site setup** (§5) — an hour of web UI that
   unblocks everything after it.
3. **`steam-electron-build`: leaderboards + global stats** (§5) — small
   and mechanical. Note the `npm link` state from the Steam transition
   needs resolving first.
4. **Rewards, XP, chapters, achievements** (§2) — no netcode risk, works
   entirely offline vs AI.
5. **Matchmaking policy + queue browser + practice-while-queued** (§3) —
   biggest UX win; wants #4 to exist first so an empty queue still pays
   out.
6. **MMR / ladder** (§4) — last; everything above functions without it.

## 7. Open decisions

- **Is MMR visible to players at all?** A hidden MMR with a coarse
  visible rank tier hides the §4b spoofing problem and reads better at
  low population. Undecided.
