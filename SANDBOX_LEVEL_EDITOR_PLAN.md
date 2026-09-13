# Scenario Editor & Campaign — Design Document (Review Draft v3)

Plan for a **Single Player scenario editor** that authors board setups, tests
them, and saves them as playable **scenarios**. The same `ScenarioDef` format
is the atom of a future **Campaign** (one scenario after another).

**Status:** phase 0 (content preparation, §17) is implemented; the editor
itself (phases 1–6, §13) is not started.

**Read first:** [ARCHITECTURE.md](ARCHITECTURE.md) (action log, determinism),
[TEAM_MODES_PLAN.md](TEAM_MODES_PLAN.md) (seats), [PROGRESSION_PLAN.md](PROGRESSION_PLAN.md)
(loadouts = the player's own choice, never an unlock; scenarios keep it by default).

**v2 changes (review of v1 against the engine):** v1 assumed dead enemies stay
dead (the engine revives every unit each round), a shared fixed-HP path that is
actually symmetric, a commander force that would spawn a starter army into the
scene, an AI freeze that would never lock in, and per-unit techs the engine
cannot represent. v2 fixes those and replaces the pile of special flags with
one rules object. See §14.

**v3 changes (after phase 0 shipped):** a scenario is now a **level package**
(board + rules in `scenario.jsonc`, next to any content overrides) that rides
`settings.level`, so loading, caching, hand-over in multiplayer, rejoin and
spectating come from §17. Base buildings are generic per building type,
commanders act through `effects`, talents are a unit's `talents`, and
validation runs against the match's registry. See §14.2.

---

## 0. Locked design decisions

1. **One format for editor, play and campaign: `ScenarioDef`.** A cheat-only
   sandbox would be throwaway work.

2. **A scenario is a level package; the match names it in `GameSettings`.**
   The package is a level (§17.5) whose `scenario.jsonc` holds the
   `ScenarioDef` (board + rules), next to any content overrides (units,
   buildings, models…). A match plays it through `settings.level` (id +
   content hash) plus `settings.scenario = { mode }`. Settings already travel
   with every replay, resume and retry, and levels are cached and handed to
   peers (§17.7 step 8, §17.9), so replay, resume, retry-last-round, replay
   verification, rejoin and spectating work without a separate save shape.
   While authoring, the draft is not a package yet: `settings.scenario.draft`
   carries the `ScenarioDef` directly (SP only); saving packs it into a level.

3. **One boot path, three modes.** `mode: 'author' | 'play' | 'test'`. Author
   mode is a scenario with editor tools attached. There is no hot remount:
   every heavy edit (map size, Test Battle, Reset) restarts the `Game` from the
   draft.

4. **Match behaviour is described by one `MatchRules` object**, resolved once
   from settings. Core code reads rules (`rules.hordeWaves`,
   `rules.flanksOpenFromRound`, …) instead of asking “is this a scenario?”.
   Normal matches resolve to today's behaviour.

5. **Play = a normal build phase against an authored board.** The player gets
   the scenario's income, slots, unlocks and talent rules and builds as usual.

6. **Board editing = `MapSize` + presets.** No cell painting, no height
   sculpting, no blockers.

7. **Side HP is authored per side** and may be asymmetric. Chip damage stays
   the existing `applyBattleResult` + `hpWithdrawOf` rule.

8. **Win condition v1 = normal match end.** Objectives are schema-reserved.

9. **Editor tools are SP-only** and never part of the multiplayer protocol.
   A saved scenario is ordinary level content, so it may travel like any level
   (§17.7 step 8); an editor draft never does.

10. **Strict separation.** Scenario pipeline in `src/game/scenario/`, editor
    in `src/game/editor/` + `src/ui/editor/`. Core files gain **generic
    primitives** (useful to any caller) and **rule reads**, never editor
    branches. See §12.

11. **Requirement — behaviour comes from attributes, not ids, and every file
    is replaceable.** Core does not branch on specific unit, building, spell or
    commander ids; definitions are plain data under `assets/data/`; every file
    the game loads goes through one resolver so a level can replace it by path.
    **Done** — see §17. The format below follows the same rule: nothing in a
    `ScenarioDef` names a base building by a fixed field.

12. **Scenarios arrive with the game context, never through a file picker.**
    A scenario list, a campaign, a joined room or a mod supplies the package;
    the Steam game has no picker. Web builds may load a zip for testing.

---

## 1. Goals and non-goals

### 1.1 Goals

| Goal | Why |
|------|-----|
| Place **player, enemy and horde** packs, buildings and Black Brood freely | Balance tests (“1 archer vs 1 ogre”), campaign set pieces |
| Toggle every talent in a type's `talents` list on and off per side | Normal matches only buy selected loadout talents |
| Raise and lower pack and building levels freely | Fast iteration |
| Equip runes on packs | Rune tests (Bulwark, Berserk, …) |
| Board size via presets + numeric knobs | Tiny duel boards, large set pieces |
| Save, share and play scenarios | Campaign pipeline, shareable tests |
| Capture a live situation as a scenario | Bug repro, “play that fight again” |
| Scenario regression tests | Balance and determinism guard rails |

### 1.2 Non-goals (this pass)

- Campaign map UI, chapter select, rewards
- Objective evaluation (schema only)
- Cell-painted zones, blockers, height editing, irregular boards
- Multiplayer editor, Steam Workshop
- 2v2 and co-op scenarios (v1 is single player: 1v1 + horde)
- A multiplayer room that offers scenarios (the level hand-over already works)
- Campaign mode itself (menu, progress, next level) — after the editor
- Where scenarios are listed (scenario list, campaign, mods) — undecided

### 1.3 Success criteria

- Author stages a 1v1 matchup on a tiny board, toggles talents, runs Test
  Battle, returns to the editor unchanged, saves, and plays it as a scenario.
- A played scenario can be resumed after a reload and replayed from its
  replay export with the ✓ verification result.
- Asymmetric side HP behaves as described in §6.2.
- Corrupt or unknown-version scenarios fail with a clear message.
- No editor data (tools, draft, undo stack) ever appears in the multiplayer
  protocol; a saved scenario travels only as level content.

---

## 2. Product surfaces

### 2.1 Menu

Under **Single Player**:

1. **Editor** — opens the last draft (or an empty board).
2. **Scenarios** — the scenarios this client has (bundled, saved from the
   editor, received from a host, kept in the scenario cache) → **Play**.
   Import from a share code or, in web builds only, a zip.

A future **Campaign** entry loads bundled scenarios in order through the same
play path.

### 2.2 Modes

```text
          ┌──── settings.level (package) + settings.scenario = { mode } ─────┐
          │                                                                   │
  mode: 'author'                    mode: 'test'                     mode: 'play'
  editor tools on                   restart from draft,              normal HUD,
  god placement                     both sides auto lock-in,         player builds,
  draft autosave                    battle, result strip,            opponents lock in,
          │                         “Back to editor” restarts        normal match end
          │ Test Battle ───────────► 'author' from the same draft
          │ Play ───────────────────────────────────────────────────►
```

All three construct a `Game` the same way; only `mode` and the resolved
`MatchRules` differ. Author and test boot from the in-memory draft
(`settings.scenario.draft`); play boots from a saved package.

### 2.3 Relationship to existing modes

| Mode | After scenarios ship |
|------|---------------------|
| Practice | Unchanged |
| Campaign (climb) | Keeps working; can later become an ordered scenario list |
| Tutorial | Stays scripted; can later become scenarios + a script layer |
| SP cheats (Shift+U, …) | Stay as dev shortcuts |

---

## 3. Engine facts this design relies on

Verified against the code (2026-09-13, re-checked after phase 0).

| Fact | Where | Consequence for scenarios |
|------|-------|---------------------------|
| Every unit **revives** each round (`resetFormation()` sets `destroyed = false`) | `units.ts` | Authored armies come back every round, like a real match. No “stays dead” default |
| Talent ownership is **per seat and type**, not per pack | `TechTree` (`tech.ts`), `add` / `remove` exist | Scenario talents are a side-level map (§4.1) |
| A type's pickable talents are its `talents` / `talentSlots`; lookups go through the match's `TypeRegistry` | `techCatalog.ts`, `content/typeRegistry.ts` | The inspector and validation use the registry, so a level's own talents work |
| `placement.spawn(...)` does no zone validation; `free` skips economy | `placement.ts` | Editor placement needs no new placement flag |
| Unit ids come from a per-seat counter in spawn order | `placement.ts` | Scene apply must use a fixed order |
| `chooseCard` spawns the card's starter army, sets the seat's commander (id + speciality), HP, spells | `actions.ts` | Commander handling is an explicit rule (§6.4) |
| What a commander does is its `effects` (income, round-1 supply, recruit level, gift units, stat bonuses, unlock discount, flank multiplier) | `cards.ts`, `game.ts` | No commander → no effects; a scenario needs no extra rule for them |
| AI build = `runBuildActions()` then `endDeployment` | `ai.ts` | An opponent can skip buying but must still lock in |
| Fixed HP in climb/tutorial is one shared number | `settings.ts` (`sideHp: number`) | Per-side HP needs a small new path |
| `startBuildPhase` runs log-free per-round systems: atmosphere rotation, flank/neutral unlock, horde wave, income, credit debt, commander effects | `game.ts` | Each non-commander system is a `MatchRules` field (§5) |
| Atmosphere (season/weather/time) rotates per round via `weather.onRound` | `weather.ts` | Rule: start atmosphere + rotate on/off |
| Relief height is seeded and read by the sim (`simGroundHeightAt`) | `map.ts`, `sim.ts` | Map size change = new relief; part of the deterministic start |
| Replay verification compares result / rounds / HP | `game.ts` (`replayVerify`, `replayExpected`) | Basis for scenario regression tests (§9.3) |
| Base buildings are placed from `BASE_ANCHORS` fractions of the zone | `map.ts`, `game.ts` | Minimum board size is derived from anchor radii (§7.2) |
| The match plays `settings.level`: `startGame` runs `prepareLevel`, the Game takes `activeLevel().types` and refuses a mismatch; levels are cached by hash and handed to guests, rejoiners and spectators | `level.ts`, `levelSync.ts`, `main.ts` | A scenario package needs no loader, cache or transfer of its own |
| Garrison posts (`garrison { slots, unitTypeId, priceStep }`) are an attribute of the building type | `units.ts` | Scene buildings set a manned-post count for any garrisoned building |

---

## 4. Data model

### 4.1 `ScenarioDef` (version 1)

```ts
type Team3 = 'player' | 'enemy' | 'horde';

/** Reserved for Campaign; not evaluated in v1. */
type ScenarioObjective =
  | { kind: 'destroySide' }
  | { kind: 'surviveRounds'; rounds: number }
  | { kind: 'killTagged'; tag: string }
  | { kind: 'protectTagged'; tag: string };

interface SceneUnit {
  typeId: string;
  team: Team3;
  /** grid anchor (same convention as placement) — or world position for gridless packs */
  at: { col: number; row: number; rotated?: boolean } | { x: number; z: number };
  level: number;
  items?: string[];          // runes on this pack
  tags?: string[];           // for objectives
}

/**
 * A base building, keyed by building type id (the pack's `buildings` list):
 * omitted = normal level 1; false = not on the board. `garrison` = manned posts
 * for a type with a `garrison` attribute (0..its slot count).
 */
type SceneBuilding = { level: number; destroyed?: boolean; garrison?: number } | false;

/** building type id → state; ids a pack doesn't have are validation errors */
type SceneBuildings = Record<string, SceneBuilding>;

interface ScenarioDef {
  version: 1;
  gameVersion: string;       // GAME_VERSION at save time (for migrations)
  id: string;                // stable uuid
  name: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  seed: number;

  map: MapSize;
  rules: ScenarioRules;      // §5

  scene: {
    units: SceneUnit[];
    /** side-level owned talents per type (innates are implicit) */
    techs: { player: Record<string, string[]>; enemy: Record<string, string[]> };
    buildings: { player: SceneBuildings; enemy: SceneBuildings };
  };

  objectives?: ScenarioObjective[];
}
```

Why side-level talents: the engine applies a talent to every pack of that type
on that seat. Per-unit talents would let the format describe states the game
cannot play (two enemy archers, one with a talent and one without).

**The package.** A scenario on disk, in the cache or on the wire is a level
(§17.5):

```text
<scenario>/
  scenario.jsonc          ScenarioDef (this section) — required
  data/…                  optional content overrides (units, buildings, spells…)
  models/… textures/…     optional media overrides
```

`loadLevel` validates the content as for any level; `scenario.jsonc` is
validated by its own generated schema plus `normalizeScenario` (§4.3). The
package's content hash identifies the scenario everywhere (settings, saves,
replays, multiplayer).

### 4.2 Why a scene snapshot (plus settings embedding)

| Approach | Verdict |
|----------|---------|
| Action-log replay as the level format | Editor god actions are not fair play actions; no clean “fresh build for the player” |
| **Scene snapshot inside settings** | Exact board, clean challenge start, and — because it sits in settings — replay/resume still work through the normal action log |

The player's moves during play are ordinary logged actions. The scenario is
the starting state those actions apply to.

### 4.3 Normalize & validate

`normalizeScenario(raw): { def: ScenarioDef; report: Issue[] }`

- One rule for every problem: **normalize, and record an issue**
  (`warning` or `error`). Import always succeeds into the editor so the author
  can fix it; **Play refuses a scenario whose report contains errors**.
- All ids are checked against the **match's registry** — the base game plus the
  package's own content — so a scenario may use units, talents, runes and
  buildings its package adds.
- Errors: unknown `version`, `MapSize` below the minimum (§7.2), unknown unit
  or building type, unit outside the board, side HP < 1, garrison count above
  the building's slots.
- Warnings: talent not in the type's `talents` (dropped), rune id unknown
  (dropped), empty enemy side, no unlocked units for the player.
- `gameVersion` older than current → run the id migration table
  (e.g. renamed unit ids) before validating.

### 4.4 Storage and sharing

| Store | Form |
|-------|------|
| Saved scenarios | level packages in the scenario cache (IndexedDB, by content hash — `levelCache.ts`), plus an index of names |
| Editor draft | `localStorage` `mechili-scenario-draft` (autosave of the `ScenarioDef`; content overrides are not edited in v1) |
| Multiplayer | the level hand-over (`levelOffer` / chunks) — nothing scenario-specific |
| Share code | deflate + base64url of a package without media (clipboard); packages with media are shared as levels |
| Web testing | zip import (Custom Game "Scenario (test)" row, and the Scenarios screen) |
| Campaign / bundled | packages in the build |

---

## 5. `MatchRules`

One object that answers every “what does this match do each round?” question.
`resolveMatchRules(settings)` builds it: normal matches reproduce today's
behaviour exactly; a scenario supplies its own `ScenarioRules`, which map 1:1.

```ts
interface ScenarioRules {
  /** round N grants round1 + (N-1) × growth (× settings.moneyFactor) — the normal economy */
  income: { round1: number; growth: number };
  deploy: { unitsPerRound: number; extrasBudgetPerRound: number };

  /** 'commander' = normal card HP; numbers = fixed per side, card HP ignored */
  sideHp: 'commander' | { player: number; enemy: number };
  commander: { mode: 'pick' } | { mode: 'fixed'; id: string; starterArmy: boolean } | { mode: 'none' };

  roundCards: string;               // roundCardPreset id or 'off'
  hordeWaves: string;               // hordePreset id or 'off' (authored horde units work either way)
  flanksOpenFromRound: number | null;   // normal: 2; null = never
  neutralOpenFromRound: number | null;  // normal: 2

  atmosphere: { season: Season; weather?: string; time?: string; rotate: boolean };
  strongholdMode: StrongholdMode;

  /** what non-human seats do in the build phase (they always lock in) */
  opponents: 'build' | 'lockInOnly';
  /** fog on enemy deployment intel */
  enemyIntel: 'fogged' | 'visible';

  /** human seat: shop unlocks (omit = normal) */
  unlockedUnits?: string[];
  /** how the human seat's talent loadout applies (omit = the player's own loadout, normal rules) */
  loadout?: LoadoutRule;
}

/**
 * The player's loadout (their pregame talent picks, loadouts.ts) is ALWAYS the
 * default. A scenario only adjusts it when it wants to be stricter or looser.
 */
type LoadoutRule =
  | { mode: 'player' }                                          // default: own loadout, own slots
  | { mode: 'restrict'; allow: Record<string, string[]> }       // own picks, but only these talents per type count
  | { mode: 'fixed'; techs: Record<string, string[]> }          // the scenario sets the picks (e.g. a lesson)
  | { mode: 'open' };                                           // every talent in the type's list, no slot limit
```

Rule-by-rule mapping onto today's code:

| Rule | Today's code it replaces a hard-coded decision in |
|------|---------------------------------------------------|
| `income` | `EconomySettings` / `grantClimbAwareRoundIncome` |
| `sideHp` | `chooseCard` HP grant, `climbSideHp` |
| `commander` | card offer + `chooseCard` starter army |
| `roundCards`, `hordeWaves` | existing presets |
| `flanksOpenFromRound`, `neutralOpenFromRound` | `startBuildPhase` `round >= 2` / tutorial checks |
| `atmosphere` | `weather.onRound` |
| `opponents` | `AiOpponent.onBuildPhase` (skip `runBuildActions`, keep `endDeployment`) |

Commander effects (income, round-1 supply, gift units, the Cursed spider, …)
need no rule: they come from the chosen commander's `effects`, so with
`commander.mode === 'none'` there are none. A scenario that wants one effect
without a commander is a later rule, not a special case.

**Migration path, not a big-bang refactor:** introduce `resolveMatchRules`
returning today's behaviour, then convert each decision above as the scenario
work needs it. Climb and tutorial can move onto the same object later, which
removes branches from core instead of adding a third special case.

---

## 6. Scenario semantics

### 6.1 Start of a scenario match

0. `startGame` runs `prepareLevel(settings.level)`: the package's content and
   files become active (from the scenario cache, or handed over by a host).
1. `Game` is constructed with `settings.scenario` (map from `def.map`, seed from
   `def.seed`); its registry is the package's (`activeLevel().types`).
2. Bases are built from anchors, then adjusted by `scene.buildings`
   (remove, set levels, man garrison posts). `destroyed: true` is the state of a
   building destroyed in an earlier round — rubble, with its normal effects.
   `rules.strongholdMode` decides what a Stronghold is worth;
   `scene.buildings` only decides whether one stands.
3. `scene.techs` (talents) are added to each side's `TechTree`.
4. Scene units are spawned **in canonical order** (player, enemy, horde; then
   list order) with `free = true`, levels and runes applied.
5. Rules take effect — the player keeps their own loadout unless `rules.loadout`
   adjusts it; round 1 build phase starts.

Steps 2–4 run in the constructor path, before the first state hash and before
any action is replayed, so resume and replay reproduce the same board with the
same unit ids.

### 6.2 Side HP and rounds

- Fixed side HP replaces the commander grant; HP bars show authored values.
- Each battle, surviving units chip the other side by their withdraw values.
- All units revive for the next round (engine behaviour), so an authored enemy
  army fights again every round.

| Preset | player | enemy | Plays like |
|--------|--------|-------|-----------|
| Sudden | 1 | 1 | one decisive battle |
| Standard | 5000 | 5000 | a normal-length match |
| Siege | 3000 | 20000 | the player must out-build a fixed fortress over many rounds |

Editor hint (one line): “HP is chipped by surviving units each battle; units
revive every round.”

A future `units.reviveBetweenRounds: false` rule (true attrition) is a new
mechanic and is listed in §11, not assumed.

### 6.3 Economy, deploy, unlocks, techs

- Income is the normal round grant driven by `rules.income` — no separate
  “starting balance” rule.
- `unlockedUnits` replaces the human seat's unlock list at start.
- **Loadout:** the player plays with their own saved loadout, exactly as in a
  normal match, unless `rules.loadout` says otherwise:
  - `restrict` keeps the player's picks but drops talents not in `allow`
    (stricter: “no Aegis in this level”);
  - `fixed` replaces the picks with the scenario's (a lesson, a set-piece);
  - `open` offers every talent in the type's `talents` without the slot limit (looser:
    sandbox-style experiments).
  Talents are still bought with supply at normal costs in every mode.
- Enemy talents come only from `scene.techs`; enemies do not research in play
  when `opponents: 'lockInOnly'`.

### 6.4 Commander

| `commander.mode` | Card offer | Starter army | Effects |
|------------------|-----------|--------------|---------|
| `pick` | normal | yes | yes |
| `fixed` | skipped | `starterArmy` decides | yes |
| `none` | skipped | no | no |

Authored scenarios default to `none`. Campaign levels that want a commander
identity without extra units use `fixed` + `starterArmy: false`. `fixed` may
name a commander the package adds (`data/commanders`).

### 6.5 Player units in the scene

Authored player units are real player packs: they can be moved, levelled and
sold like any pack deployed in an earlier round. They are **not** in the
action log, so Undo never removes them (Undo only reverts this round's
actions, same as today).

### 6.6 Horde

Authored horde units spawn as gridless packs (seat −1) like wave packs.
`hordeWaves` independently decides whether preset waves also arrive.

### 6.7 Objectives

Parsed and stored; not evaluated in v1. `tags` on scene units are the hook.

---

## 7. Map

### 7.1 Presets

| Preset | Intent |
|--------|--------|
| `tiny` | one to two packs per side |
| `compact` | small skirmish |
| `standard` | `STANDARD_MAP` |
| `wide` | more flank play |
| `deep` | longer approach |

UI: preset buttons, an advanced disclosure with the five `MapSize` numbers,
and a live readout of the full grid (`cols × rows`) and world size.

### 7.2 Minimum size

Computed, not guessed: the smallest `zoneCols` / `zoneRows` where every
building that is **on the board** fits its `BASE_ANCHORS` spot (with its
radius — Stronghold r = 14, towers r = 9). Buildings set to `false` in
`scene.buildings` don't count, so a board with no buildings can be as small as
a few packs. Validation reports an error below the minimum.

### 7.3 Changing size in the editor

Restart from the draft with the new `MapSize`. Units outside the new board are
listed in a toast and removed from the draft (undoable in the editor).

---

## 8. Editor (author mode)

### 8.1 Tools

| Tool | Behaviour |
|------|-----------|
| Select | click a pack or building; drag to move |
| Place | palette of every unit **and building** type the match has (base game + package), incl. horde; team brush Player / Enemy / Horde |
| Erase | click to remove |
| Copy / paste | selection or box selection |
| Mirror | copy one side onto the other (mirrored rows) |
| Clear side | remove all units of one team |

Placement uses `placement.spawn(..., free)` for grid packs and
`spawnAtWorld` for gridless ones — no zone checks, no slots, no cost.

**Buildings as scene objects.** Besides the base buildings at their anchors,
any building type — base or added by the package (a wall piece, a farm house)
— can be placed like a unit, for player, enemy or horde. A building blocks
movement as a round obstacle (like today's buildings); a long wall is several
pieces. Horde-owned buildings have never existed, so targeting, HP bars and
destruction for them are checked (and fixed where needed) in phase 3. Cover
(stopping shots) is not planned.

### 8.2 Inspector (selection)

- Level: **− / +** buttons, hotkeys `[` `]`, mouse wheel over the field.
  (Left click stays select/place; no mouse-button overloading.)
- Runes: add / remove slots.
- Talents: the type's `talents` as toggles, innates shown locked-on, with the
  note “applies to all packs of this type on this side”.
- Tags.
- Buildings (every type in the pack's `buildings`): on/off, level, destroyed,
  garrison posts for a type with a `garrison`.

### 8.3 Scenario panel

1. Map preset and size
2. Rules (§5) with presets for side HP and income
3. Metadata (name, description)
4. Library: Save (packs the draft into a level package in the scenario cache),
   Save As, Copy share code, Import (share code; zip in web builds)

### 8.4 Draft and undo

- Every edit updates the in-memory `ScenarioDef` and autosaves the draft.
- Undo/redo is an editor-local stack of draft snapshots, separate from match
  Undo and from `ActionDispatcher`.

### 8.5 Test Battle and unit lab

- **Test Battle:** restart with `mode: 'test'` from the current draft. Both
  sides lock in automatically, the battle plays, a result strip shows winner,
  battle time, HP chipped each side and per-pack damage (the existing battle
  report). **Back to editor** restarts `mode: 'author'` from the same draft.
- **Speed:** the normal speed control; pause/step frame in test mode.
- **Win-rate run:** repeat Test Battle over N seeds at max speed and show the
  win split. Uses the same restart path, no new sim code. A local testing tool:
  results are shown, never submitted as match telemetry or stored on the
  server.

---

## 9. Extra features

### 9.1 Capture situation (high value)

“Save as scenario” from any SP match, spectated match or replay **at the start
of a build phase**: current board, levels, runes, side talents, buildings
(incl. garrison posts), side HP and map flags become a draft
(`flanksOpenFromRound` = 1 if already open). A match that played a level keeps
that level's content in the new package.
Every “that fight was weird” and every bug report becomes reproducible.

### 9.2 Share codes

Compressed, URL-safe string of a package without media (its `scenario.jsonc`
and data overrides) for chat and Discord. Import shows the validation report
before playing; the result is a normal package with a content hash.

### 9.3 Scenario regression tests

A scenario + recorded player actions + expected `{ result, rounds, playerHp,
enemyHp }` runs through the existing replay-verification path and prints ✓ or
the mismatch. A folder of these becomes a balance and determinism check that
can run before each release.

### 9.4 Campaign (later)

```ts
interface CampaignDef {
  id: string;
  name: string;
  /** scenario packages by content hash (bundled, or fetched like any level) */
  levels: { scenario: LevelRef; carryOver?: 'none' | 'army' | 'army+supply' }[];
}
```

- Next level unlocks on victory; optional star rating (HP left, rounds).
- `carryOver` is decided per level transition, not hidden inside a scenario.

### 9.5 Triggers (later)

Declarative events, e.g. `roundStart 3 → spawn group "reinforcements"`,
`tagged "boss" dies → victory`. Scripted tutorials and horde presets could
eventually become triggers.

---

## 10. Play mode flow

1. Scenarios → select → Play (validation must have no errors). The match's
   settings name the package (`settings.level`) and `scenario.mode = 'play'`.
2. Commander step per `rules.commander`.
3. Scenario start (§6.1).
4. Normal build → lock-in → battle → HP draw → next round.
5. Victory / defeat screen → back to the library (campaign: next level).
6. Resume, retry-last-round and replay export work through the normal SP
   paths because the package is named in settings and kept in the scenario
   cache.

---

## 11. Deferred ideas

- `reviveBetweenRounds: false` (true attrition — new mechanic)
- Objective evaluation + UI
- Per-side `strongholdMode`
- 2v2 scenarios
- Steam Workshop
- Triggers (§9.5)
- Per-pack techs (engine change)

---

## 12. Code architecture

### 12.1 Modules

```text
src/game/matchRules.ts        # MatchRules type + resolveMatchRules(settings) — core, all modes

src/game/scenario/            # ScenarioDef pipeline — play, test, campaign (no editor UI)
  scenarioDef.ts              # types, version, migration table
  normalize.ts                # normalizeScenario → { def, report } (against the match registry)
  applyScenario.ts            # bases, talents, units onto a Game via ScenarioHost
  mapLimits.ts                # presets + minimum size from BASE_ANCHORS
  capture.ts                  # live match → ScenarioDef (§9.1)
  package.ts                  # draft ⇄ level package (scenario.jsonc + overrides), share codes
  library.ts                  # index of saved / bundled packages over the scenario cache

src/game/editor/              # author session only
  editorController.ts         # tools, selection, draft, restart orchestration
  editorHistory.ts            # draft undo/redo
  unitLab.ts                  # test battle, win-rate runs

src/ui/editor/                # author DOM only
  toolbar.ts
  inspector.ts
  scenarioPanel.ts
  libraryPanel.ts
```

Dependencies: `scenario/` never imports `editor/` or `ui/editor/`.
Campaign and play depend on `scenario/` only.

### 12.2 Host interfaces (the only core surface)

Same pattern as `TutorialHost` (`tutorialRuntime.ts`).

```ts
interface ScenarioHost {
  readonly settings: GameSettings;
  readonly map: BattleMap;
  readonly placement: PlacementController;
  readonly techTree: TechTree;
  setSideHp(player: number, enemy: number): void;
  /** building type id from the pack's `buildings`; state incl. garrison posts */
  setBuilding(team: Team, buildingTypeId: string, state: SceneBuilding): void;
}

interface EditorHost extends ScenarioHost {
  restart(settings: GameSettings): void;      // author ⇄ test, map size change
  setUnitLevel(unit: Unit, level: number): void;
  setUnitItems(unit: Unit, items: string[]): void;
  setTool(tool: BoardTool | null): void;      // pointer events go to the tool
  setChrome(chrome: HudChrome): void;         // which match HUD parts are shown
}
```

### 12.3 Core changes (all generic)

| File | Change | Also useful for |
|------|--------|-----------------|
| `settings.ts` | `scenario?: { mode; draft? }` next to the existing `level` | — |
| `level.ts` / `levelCache.ts` | read `scenario.jsonc` from a package; list cached packages | any level with metadata |
| `matchRules.ts` (new) | rules type + resolver | climb, tutorial, custom games |
| `game.ts` | read rules in `startBuildPhase` / card flow; implement hosts; construct `applyScenario` / `EditorController` | — |
| `ai.ts` | `opponents` rule: skip buying, keep lock-in | future “passive AI” practice |
| `units.ts` | `setLevel(level)` (replaces ad-hoc `level =` + `applyLevelLook`) | cheats, tutorial |
| `placement.ts` | board tool hook: pointer events to an active tool | future spell/rally tools |
| `hud.ts` | `setChrome({ shop, topbar, … })` visibility API (cinema mode already does this ad hoc) | cinema mode, tutorials |

Not needed: placement zone flags (`spawn` already skips zones), tech
grant/revoke (`TechTree.add` / `remove` exist), new `Action` kinds.

### 12.4 Rules of thumb for review

- A change in core must be expressible without the word “editor” or
  “scenario” — a rule read, a host method, or a primitive.
- Editor tool state lives in `editor/`; editor DOM lives in `ui/editor/`.
- Nothing editor-related is logged, hashed or sent over the network.

---

## 13. Delivery phases

0. **Content preparation (§17) — done:** attributes instead of id checks;
   units, buildings, models, talents, runes, commanders, round cards and spells
   as validated data; one asset resolver with a manifest; level overlays;
   per-match registry; scenario boot through `settings.level`; level cache;
   hand-over to guests, rejoiners and spectators; content hash in handshakes.
1. **Rules + scenario play:** `matchRules.ts`, `ScenarioDef` + schema,
   normalize against the registry, `applyScenario`, play a hand-written
   package (zip in web), resume + replay verification.
2. **Capture situation** (§9.1) — immediate value, and it exercises apply.
3. **Editor core:** author mode, place / move / erase, team brush, placing
   any unit or building type for player / enemy / horde (incl. horde-owned
   buildings), draft autosave, restart on map change.
4. **Inspector:** levels, runes, side talents, buildings.
5. **Test Battle + win-rate runs** (local only) — the unit-testing use case.
6. **Scenario panel + library:** rules UI, presets, share codes.
7. **Regression-test harness** (§9.3).
8. Later: objectives (§6.7), campaign mode (§9.4).

Each phase is playable and reviewable on its own.

---

## 14. Resolved issues

### 14.1 From v1 to v2

| v1 rule | Problem | v2 |
|---------|---------|----|
| Enemy that died stays dead | Engine revives all units each round | Revive (engine behaviour); attrition deferred as a new mechanic |
| Fixed HP via climb/tutorial path | That path is one shared number | `rules.sideHp` per side |
| `forceCommanderId` / `skipCardPick` | Forced card would spawn a starter army into the scene | `rules.commander` with `starterArmy` |
| “Freeze enemy buys” | Freezing the AI stops it locking in; battle never starts | `opponents: 'lockInOnly'` |
| Per-unit `techs[]`, duplicated at export | Engine techs are side-wide; format allowed impossible states | `scene.techs` side-level map |
| `sandbox.author` and `level` as two settings fields | Two modes that must be kept exclusive by hand | `settings.scenario = { def, mode }` |
| No resume, LevelDef kept out of replays | Loses resume/retry/replay | Scenario in settings → all work |
| Hot remount vs restart left open | Two code paths | Restart only |
| Test Battle “in-place or restore” | Two code paths | `mode: 'test'` restart |
| `startingSupply` set as liquid balance *and* round income | Double grant | Only the normal income rule |
| `clearPlayerArmy` with keep-tag exceptions | Special case inside the format | Removed; campaign `carryOver` decides between levels |
| `flanksUnlockedAtStart` booleans | Separate flags beside round logic | `flanksOpenFromRound` / `neutralOpenFromRound` |
| Auto-enable horde preset when horde units exist | Hidden coupling | `hordeWaves` is explicit; authored horde works regardless |
| Unknown type: warn in editor, fail in play (two policies) | Inconsistent | One normalizer with a report; Play refuses errors |
| Left click = level up, right click = level down | Collides with select/place | −/+ buttons, `[` `]`, wheel |
| “Reject PRs over a screenful” | Size is a poor proxy | §12.4 rules of thumb |
| Scenario units spawned in any order | Unit ids depend on spawn order | Canonical apply order (§6.1) |

### 14.2 Changed in v3 (after phase 0)

| v2 | What changed in the code | v3 |
|----|--------------------------|----|
| `settings.scenario = { def, mode }`, library in localStorage, file export | Levels ride `settings.level`, are cached by hash and handed to peers | A scenario is a level package (`scenario.jsonc` + overrides); settings name it; the draft alone sits in settings while authoring |
| `SceneBuildings` with `stronghold` / `commandTower` / `researchCenter` fields and `strongholdArchers` | Buildings are data with attributes (`garrison`, `onDestroyed`, …); ids are not branched on | `buildings: Record<buildingTypeId, …>` with `garrison` posts |
| Commander income, gifts, Cursed spider tied to specialities | Commanders carry `effects` | No commander → no effects; `fixed` can name a package's commander |
| Tech allowlist per type | `talents` / `talentSlots` on the unit, registry lookups | Inspector and validation read the registry |
| Validate against the base game | Per-match `TypeRegistry` | Validate against the package's registry |
| “No scenario data in the multiplayer protocol” | Level content travels (lobby, rejoin, spectators) | Editor data never travels; a saved scenario travels as level content |
| Import files / downloads | No pickers in the Steam game | Scenarios arrive with context (list, campaign, room, mod); zip import in web builds only |

---

## 15. Review checklist

- [ ] Scenario is a level package named by `settings.level`, `scenario.mode: author | play | test`, draft only while authoring
- [ ] `MatchRules` as the single place for per-round behaviour
- [ ] Units revive each round; attrition deferred
- [ ] Side-level talents; runes per pack; buildings by type id with garrison posts
- [ ] Commander modes `pick | fixed(+starterArmy) | none`
- [ ] Opponents always lock in
- [ ] Restart-only editor (no hot remount)
- [ ] Minimum map size derived from base anchors
- [ ] Capture situation in phase 2
- [ ] Core changes limited to §12.3

---

## 16. Appendix — example scenario (`scenario.jsonc` of a package)

```json
{
  "version": 1,
  "gameVersion": "0.9.0",
  "id": "archer-vs-ogre-tiny",
  "name": "Archer vs Ogre",
  "seed": 1234,
  "map": { "zoneCols": 12, "zoneRows": 8, "neutralRows": 2, "flankCols": 0, "rimCells": 2 },
  "rules": {
    "income": { "round1": 500, "growth": 0 },
    "deploy": { "unitsPerRound": 4, "extrasBudgetPerRound": 0 },
    "sideHp": { "player": 1, "enemy": 1 },
    "commander": { "mode": "none" },
    "roundCards": "off",
    "hordeWaves": "off",
    "flanksOpenFromRound": null,
    "neutralOpenFromRound": 1,
    "atmosphere": { "season": "autumn", "rotate": false },
    "strongholdMode": "none",
    "opponents": "lockInOnly",
    "enemyIntel": "visible",
    "unlockedUnits": ["archer"]
  },
  "scene": {
    "units": [
      { "typeId": "archer", "team": "player", "at": { "col": 5, "row": 3 }, "level": 1 },
      { "typeId": "ogre", "team": "enemy", "at": { "col": 5, "row": 12 }, "level": 1 }
    ],
    "techs": { "player": {}, "enemy": { "ogre": [] } },
    "buildings": {
      "player": { "stronghold": false, "command-tower": false, "research-center": false },
      "enemy": { "stronghold": { "level": 1, "garrison": 2 }, "command-tower": false, "research-center": false }
    }
  },
  "objectives": []
}
```

---

## 17. Content, assets & overlays (requirement)

Custom levels will want things the normal game doesn't have: a different
Stronghold, walls, other trees — and later maybe a modder's whole
“starspace” look. That must be possible **without touching game code**, and
ideally without a programmer. Model: **code + assets**, where a level is an
**overlay** that replaces files by path.

### 17.1 Attribute rules

1. **Name by effect, not by owner.** `collapseOwnArmy`, not `isStronghold`.
2. **Attribute = capability; match rules decide whether it is active.**
   `collapseOwnArmy` only fires when `strongholdMode` is `lifeline`.
3. **Group what always goes together.** `fixture: true` means “part of a
   building”: not sellable, not movable, no refund, not field army.
4. **Relationships by reference, not by type.** A mounted archer dies with
   *its* host building (`hostUnitId`), not with any building of a type.
5. **Values in data, effects in code.** Data switches effects on and sets
   numbers; each effect is implemented once in TypeScript.
6. **Unknown fields are load errors**, at every depth.
7. **Scripted content may use ids.** Tutorial lessons and cheats refer to
   specific content on purpose.

### 17.2 Id checks → attributes (done)

| Behaviour | Attribute |
|---|---|
| Stronghold destroyed → own army collapses (lifeline) | `onDestroyed.collapseOwnArmy` |
| Command Tower / Research Center destroyed → seat debuff | `onDestroyed.seatDebuff` |
| Keep destroyed → its battlement archers die | `diesWithHost` + `Unit.hostUnitId` |
| Battlement archer: no sell / move / refund / field army | `fixture` |
| Posts on `Unit1…5` with a climbing price | `garrison { slots, unitTypeId, priceStep }` |
| Rune forge, building panel buttons | `abilities: [...]` |
| Golden aura | `aura { effect, requiresTech, radius, duration }` |
| Sand pad, banners | `sandPadScale`, model `Flag` node |

### 17.3 One asset tree

```text
assets/
  data/                  definitions: plain data, JSONC, schema-validated
    pack.jsonc           roster order, off-roster types, buildings
    units/*.jsonc
    buildings/*.jsonc
    models/*.jsonc       model specs (GLB path, orientation, scale)
    schema/*.schema.json generated from the TypeScript types
  models/units/*.glb     unit & building models
  models/scenery/  models/spells/  textures/  fonts/  ui/  icons/ …
```

- Definitions are data (`assets/data`); media stays media. Both are *assets*:
  everything a level could replace lives in this one tree.
- Model specs reference files by their path under `assets/`
  (`"file": "models/units/ogre.glb"`), so a data file and a media file are
  addressed the same way.
- Schemas are generated from `UnitType` / `ModelSpecData` / `PackManifest`
  (`npm run content:schema`); VS Code / Cursor get autocomplete, hover docs
  and inline errors; `npm run check:content` fails on stale schemas.

### 17.4 One resolver, one manifest

- Every file the game loads is requested by **logical path** through
  `assetUrl('models/scenery/tree-oak.glb')` — no hard-coded
  `new URL('../../assets/…')` outside the manifest.
- The **asset manifest** lists exactly the files the game ships (generated by
  `npm run assets:manifest` from the `assetUrl` calls and the model specs;
  `check:content` fails when it is stale). An exact list, not folder globs,
  so unused files never get bundled.
- Lookups happen **when a file is loaded**, not at module import, so an
  overlay set before a match applies to everything loaded for it.

### 17.5 Level overlays

```text
levels/frost-keep/
  level.jsonc                          board, rules, scene (the ScenarioDef)
  models/scenery/tree-oak.glb          replaces the base tree
  data/buildings/stronghold.jsonc      replaces the base Stronghold
  data/buildings/ice-wall.jsonc        adds a building (new id)
  models/units/ice-wall.glb
```

- **Rule:** a file at the same path as a base asset replaces it; a new path
  adds a file. Any file type — models, textures, fonts, UI images, data.
- The resolver checks the active overlay first, then the base manifest.
- Validation reports overlay files that shadow nothing *and* are not
  referenced by the level's data (usually a typo or a renamed base file).
- Field-level `extends` for data files (“archer with +20 HP” without copying
  the file) is a later convenience, not part of the rule.
- Base assets are bundled at build time; overlay files only exist at runtime
  (Electron: read from disk; browser: a zip or picker), so the resolver has a
  build-time base layer and a runtime overlay layer.

### 17.6 Content hash (multiplayer)

- **Every** file counts, not only sim-relevant ones: a replaced texture or
  tree model can hide units, which is unfair even though the sim agrees.
- The **base hash** is computed at build time over the manifest files and
  `assets/data` and embedded like `GAME_VERSION` (≈130 ms for all 171 MB on a
  dev machine; zero at runtime).
- A level's **overlay hash** is computed once when it loads (a few ms).
- The join, rejoin and spectate handshakes compare `base + overlay` next to
  `GAME_VERSION`; a mismatch refuses to join with a clear message.
- Nothing is hashed during a match; the per-round model fingerprint stays.

### 17.7 Order and status

| Step | Status |
|---|---|
| 1. Attributes replace id checks | done |
| 2. Definitions as data (JSONC, generated schemas, `npm run check:content`) | done |
| 3. One asset tree: `assets/data`, `assets/models/units` | done |
| 4. `assetUrl()` resolver + generated manifest (`npm run assets:manifest`); every game file load goes through it, lazily | done |
| 5. Build-time content hash in every multiplayer handshake (`isSameBuild`) | done |
| 6. Overlay layer: `buildAssetOverlay` / `installAssetOverlay`, report, overlay hash in `currentContentHash()`, level data validated via `loadPackWithOverlay` | done (no loading UI) |
| 7. Per-match type registry (`TypeRegistry`, `game.types`) — see 17.8 | done |
| 7b. Level switch reloads cached files and model data (`switchLevel`) — see 17.9 | done (dev console only) |
| 7c. More content as data: talents (`data/talents`, `talents`/`talentSlots` on units), runes + forge recipes (`data/runes`, `itemSlots`), commanders + round cards (`data/commanders`, `data/roundCards`, commander `effects` instead of speciality ids), spells (`data/spells`, `fx` / `strike.rect` / `marker` attributes; the five spells with own actions are core ids checked on load); all served by the match's `TypeRegistry`. Tutorials stay code, guarded by `tutorialContentProblems` | done |
| 8. Scenario boot: `settings.level` names the level, `startGame` runs `prepareLevel`, the Game plays `activeLevel().types` and refuses a mismatch; level store (`loadLevel`, known by hash, any source); zip reader; web-only Custom Game "Scenario (test)" row. No user-facing picker in Steam — scenarios arrive with the game context (joining, list, campaign) | done: base, multiplayer transfer (host → guests in lobbies), scenario cache (IndexedDB); seat reclaims mid-match and spectators fetch the scenario through a gated offer; open: real scenario sources |
| 9. Walls and other engine features that unlock new content | later |

`npm run check:content` covers steps 2–7b: manifest freshness and no
hand-built asset URLs, schema freshness, base data validation, a sample
level overlay (replace/add by path, report, hash stability and line-ending
invariance, data validation, multiplayer hash) and a level switch (reload
hooks run with the level installed, model and animation data follow, the
base game comes back, an invalid level changes nothing).

### 17.8 Per-match type registry

A level's **media** overlay applies to a match as-is: files resolve when they
load. A level's **data** (a replaced Stronghold, a new wall) needs the match
to play with its own unit and building definitions, not module constants.

Done:
- `TypeRegistry` (`src/game/content/typeRegistry.ts`) holds roster,
  off-roster, buildings, model data, the shop filter (`shopUnitIds`: roster
  types that aren't extras, structures or `buyable: false`), `byId`/`require`,
  `unlockCost` and `garrisonPostCost`.
- `BASE_TYPES` (units.ts) is the base game's registry. The old module
  constants (`UNIT_TYPES`, `STRONGHOLD`, `COMMAND_TOWER`, `unitTypeById`,
  `SHOP_UNIT_IDS`, …) are gone.
- `Game.types` is the match's registry and is handed to placement, the action
  dispatcher, AI and tutorial contexts, horde waves, the HUD and commander
  unlock pricing. Menu code (loadout picker, unit icons, homepage, spell
  labels) reads `BASE_TYPES` on purpose.

Still open:
- `Game.types` is always `BASE_TYPES`; scenario boot will build one with
  `new TypeRegistry(loadPackWithOverlay(…))` and pass it in the settings.
- Unit icons are drawn from the procedural models of `BASE_TYPES`; a level
  that adds a type has no icon for it yet.

Multiplayer is already safe for this: the overlay hash covers data files, so
peers can only play a level whose definitions match.

### 17.9 Switching levels: cached files and model data

Most files are not loaded per match but once, at boot, and kept: unit and
building models, rigged units, spells, commander figures, trees and
billboards, floor pieces, bolt / brick / rock, the soul sprite. Installing an
overlay alone would leave all of those on the base files.

`switchLevel(overlay | null)` (`src/game/level.ts`) is the entry point:
1. validates the level's data (`loadPackWithOverlay`) — an invalid level
   throws and nothing changes;
2. sets the model data (`setModelSpecData`; `ANIM_SPECS` follows) and the
   procedural heights of the level's types;
3. switches the overlay (`switchAssetOverlay`) and runs every cache's reload
   hook (`onAssetOverlaySwitch`). Each cache remembers the file URL — for unit
   models the whole spec plus height — it loaded from, waits for its own
   in-flight loads, and reloads only what now resolves differently. Replaced
   templates are disposed, and ids the level no longer has are dropped, so a
   level played earlier leaves nothing in `modelGeometryFingerprint`.

Switch between matches only. Calls are queued. Before boot has loaded
anything, a switch only changes data; the boot load then reads the level.

Loaded per match by URL, so no hook needed: ground and rock textures, acid
and conversion effect textures. **Not level-replaceable**: fonts, the icon
atlas, menu images and logos — they belong to the menu, which is up before any
level is chosen.

Dev builds: `await melodanLevel.pick()` in the console picks a folder laid out
like `assets/` and switches to it; `melodanLevel.clear()` goes back. Files and
model data apply; unit and building definitions are validated, but matches
still play `BASE_TYPES` until the scenario boot hands `activeLevel().types` to
the Game (step 8).

---

## Document history

| Date | Change |
|------|--------|
| 2026-09-13 | v3.1: phase order — Test Battle and win-rate runs (local only) right after the inspector; placing any building type for any side incl. horde; co-op and campaign mode out of this pass |
| 2026-09-13 | v3: scenarios as level packages on `settings.level`; generic buildings with garrison posts; commander `effects`; talents and validation through the registry; storage, sharing and multiplayer statements updated; phase 0 marked done |
| 2026-09-13 | v1 review draft: sandbox + level export, MapSize boards, asymmetric side HP, strict module separation |
| 2026-09-13 | §17 step 7c+: spells as data with behaviour attributes, commander effects; step 8: scenario gate for mid-match rejoins and spectators |
| 2026-09-13 | §17 step 8: multiplayer scenario transfer, scenario cache |
| 2026-09-13 | §17 step 8 base: scenario boot via settings.level, level store, zip reader, web test row |
| 2026-09-13 | §17 step 7c: talents, runes/recipes, commanders/round cards as data; tutorial content guard |
| 2026-09-13 | §17.9 level switch: cached files and model data reload per level (`switchLevel`, reload hooks, dev console helper) |
| 2026-09-13 | Rigged-unit animation clips moved into model data (`"animation"`) |
| 2026-09-13 | §17 step 7: per-match `TypeRegistry` (`game.types`); module type constants removed |
| 2026-09-13 | §17 steps 3–6 implemented; status table and the per-match type registry gap (17.8) |
| 2026-09-13 | §17 → content, assets & overlays: one `assets/` tree (data + media), `assetUrl` resolver + manifest, level overlays by path, content hash in handshakes. Loadout fixed: the player's own loadout is the default; `rules.loadout` can restrict, fix or open it |
| 2026-09-13 | §17 requirement: attributes instead of id checks; definitions as data; JSON content packs (units/buildings first); phase 0 before the editor |
| 2026-09-13 | v2: verified against the engine. Scenario embedded in settings (replay/resume), `MatchRules`, restart-only editor, side-level techs, commander modes, opponents always lock in, revive semantics, capture situation, share codes, regression tests, campaign carry-over, resolved-issues table (§14) |
