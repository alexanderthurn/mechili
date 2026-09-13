# Scenario Editor & Campaign — Design Document (Review Draft v2)

Plan for a **Single Player scenario editor** that authors board setups, tests
them, and saves them as playable **scenarios**. The same `ScenarioDef` format
is the atom of a future **Campaign** (one scenario after another).

**Status:** design only — not implemented.

**Read first:** [ARCHITECTURE.md](ARCHITECTURE.md) (action log, determinism),
[TEAM_MODES_PLAN.md](TEAM_MODES_PLAN.md) (seats), [PROGRESSION_PLAN.md](PROGRESSION_PLAN.md)
(loadouts = choice, not unlock).

**v2 changes (review of v1 against the engine):** v1 assumed dead enemies stay
dead (the engine revives every unit each round), a shared fixed-HP path that is
actually symmetric, a commander force that would spawn a starter army into the
scene, an AI freeze that would never lock in, and per-unit techs the engine
cannot represent. v2 fixes those and replaces the pile of special flags with
one rules object. See §14.

---

## 0. Locked design decisions

1. **One format for editor, play and campaign: `ScenarioDef`.** A cheat-only
   sandbox would be throwaway work.

2. **The scenario lives inside `GameSettings`.** `settings.scenario = { def, mode }`.
   Settings already travel with every replay, resume and retry
   (`Game.exportReplay()` stores them), so applying a scenario is part of the
   deterministic starting state. Replay, resume, retry-last-round and replay
   verification work for scenarios without a separate save shape.

3. **One boot path, three modes.** `mode: 'author' | 'play' | 'test'`. Author
   mode is a scenario with editor tools attached. There is no hot remount:
   every heavy edit (map size, Test Battle, Reset) restarts the `Game` from the
   draft.

4. **Match behaviour is described by one `MatchRules` object**, resolved once
   from settings. Core code reads rules (`rules.hordeWaves`,
   `rules.flanksOpenFromRound`, …) instead of asking “is this a scenario?”.
   Normal matches resolve to today's behaviour.

5. **Play = a normal build phase against an authored board.** The player gets
   the scenario's income, slots, unlocks and tech allowlist and builds as usual.

6. **Board editing = `MapSize` + presets.** No cell painting, no height
   sculpting, no blockers.

7. **Side HP is authored per side** and may be asymmetric. Chip damage stays
   the existing `applyBattleResult` + `hpWithdrawOf` rule.

8. **Win condition v1 = normal match end.** Objectives are schema-reserved.

9. **Editor tools are SP-only** and never part of the multiplayer protocol.

10. **Strict separation.** Scenario pipeline in `src/game/scenario/`, editor
    in `src/game/editor/` + `src/ui/editor/`. Core files gain **generic
    primitives** (useful to any caller) and **rule reads**, never editor
    branches. See §12.

11. **Requirement — behaviour comes from attributes, not ids.** Before the
    editor is built, core stops branching on specific unit or building types
    (`type === STRONGHOLD`, `id === 'ballista'`). Every such behaviour becomes
    an attribute on the type, and unit/building definitions become plain data
    that can later be loaded from JSON content packs. See §17.

---

## 1. Goals and non-goals

### 1.1 Goals

| Goal | Why |
|------|-----|
| Place **player, enemy and horde** packs, buildings and Black Brood freely | Balance tests (“1 archer vs 1 ogre”), campaign set pieces |
| Toggle every tech in a type's allowlist on and off per side | Normal matches only buy selected loadout techs |
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
- 2v2 scenarios (v1 is 1v1 + horde)

### 1.3 Success criteria

- Author stages a 1v1 matchup on a tiny board, toggles techs, runs Test
  Battle, returns to the editor unchanged, saves, and plays it as a scenario.
- A played scenario can be resumed after a reload and replayed from its
  replay export with the ✓ verification result.
- Asymmetric side HP behaves as described in §6.2.
- Corrupt or unknown-version scenarios fail with a clear message.
- No scenario or editor data ever appears in the multiplayer protocol.

---

## 2. Product surfaces

### 2.1 Menu

Under **Single Player**:

1. **Editor** — opens the last draft (or an empty board).
2. **Scenarios** — library of saved scenarios, Import (file / share code) → **Play**.

A future **Campaign** entry loads bundled scenarios in order through the same
play path.

### 2.2 Modes

```text
          ┌──────────────── settings.scenario = { def, mode } ────────────────┐
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
`MatchRules` differ.

### 2.3 Relationship to existing modes

| Mode | After scenarios ship |
|------|---------------------|
| Practice | Unchanged |
| Campaign (climb) | Keeps working; can later become an ordered scenario list |
| Tutorial | Stays scripted; can later become scenarios + a script layer |
| SP cheats (Shift+U, …) | Stay as dev shortcuts |

---

## 3. Engine facts this design relies on

Verified against the code (2026-09-13).

| Fact | Where | Consequence for scenarios |
|------|-------|---------------------------|
| Every unit **revives** each round (`resetFormation()` sets `destroyed = false`) | `units.ts` | Authored armies come back every round, like a real match. No “stays dead” default |
| Tech ownership is **per seat and type**, not per pack | `TechTree` (`tech.ts`), `add` / `remove` exist | Scenario techs are a side-level map (§4.1) |
| `placement.spawn(...)` does no zone validation; `free` skips economy | `placement.ts` | Editor placement needs no new placement flag |
| Unit ids come from a per-seat counter in spawn order | `placement.ts` | Scene apply must use a fixed order |
| `chooseCard` spawns the card's starter army and sets speciality, HP, spells | `actions.ts` | Commander handling is an explicit rule (§6.4) |
| AI build = `runBuildActions()` then `endDeployment` | `ai.ts` | An opponent can skip buying but must still lock in |
| Fixed HP in climb/tutorial is one shared number | `settings.ts` (`sideHp: number`) | Per-side HP needs a small new path |
| `startBuildPhase` runs log-free per-round systems: atmosphere rotation, flank/neutral unlock, horde wave, income, credit debt, commander income and gifts, Cursed spider, free archer | `game.ts` | Each is a `MatchRules` field (§5) |
| Atmosphere (season/weather/time) rotates per round via `weather.onRound` | `weather.ts` | Rule: start atmosphere + rotate on/off |
| Relief height is seeded and read by the sim (`simGroundHeightAt`) | `map.ts`, `sim.ts` | Map size change = new relief; part of the deterministic start |
| Replay verification compares result / rounds / HP | `game.ts` (`replayVerify`, `replayExpected`) | Basis for scenario regression tests (§9.3) |
| Base buildings are placed from `BASE_ANCHORS` fractions of the zone | `map.ts`, `game.ts` | Minimum board size is derived from anchor radii (§7.2) |

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

/** a base building: omitted = normal level 1; false = not on the board */
type SceneBuilding = { level: number; destroyed?: boolean } | false;

interface SceneBuildings {
  stronghold?: SceneBuilding;
  strongholdArchers?: number;          // 0..5 battlement posts manned
  commandTower?: SceneBuilding;
  researchCenter?: SceneBuilding;
}

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
    /** side-level researched techs per type (innates are implicit) */
    techs: { player: Record<string, string[]>; enemy: Record<string, string[]> };
    buildings: { player: SceneBuildings; enemy: SceneBuildings };
  };

  objectives?: ScenarioObjective[];
}
```

Why side-level techs: the engine applies a tech to every pack of that type on
that seat. Per-unit techs would let the format describe states the game cannot
play (two enemy archers, one with a tech and one without).

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
- Errors: unknown `version`, `MapSize` below the minimum (§7.2), unknown unit
  type, unit outside the board, side HP < 1.
- Warnings: tech not in the type's allowlist (dropped), rune id unknown
  (dropped), empty enemy side, no unlocked units for the player.
- `gameVersion` older than current → run the id migration table
  (e.g. renamed unit ids) before validating.

### 4.4 Storage and sharing

| Store | Form |
|-------|------|
| Library | `localStorage` `mechili-scenarios` |
| Editor draft | `localStorage` `mechili-scenario-draft` (autosave) |
| File | `*.scenario.json` download / file import |
| Share code | deflate + base64url string (clipboard) |
| Campaign | bundled JSON in the build |

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

  /** human seat: shop unlocks (omit = normal) and researchable techs per type (omit = full allowlist) */
  unlockedUnits?: string[];
  techAllowlist?: Record<string, string[]>;
}
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

Commander income, gifts and the Cursed spider need no rule: with
`commander.mode === 'none'` there is no speciality, so they do nothing.

**Migration path, not a big-bang refactor:** introduce `resolveMatchRules`
returning today's behaviour, then convert each decision above as the scenario
work needs it. Climb and tutorial can move onto the same object later, which
removes branches from core instead of adding a third special case.

---

## 6. Scenario semantics

### 6.1 Start of a scenario match

1. `Game` is constructed with `settings.scenario` (map from `def.map`, seed from `def.seed`).
2. Bases are built from anchors, then adjusted by `scene.buildings`
   (remove, set levels, man archer posts). `destroyed: true` is the state of a
   building destroyed in an earlier round — rubble, with its normal effects.
   `rules.strongholdMode` decides what a Stronghold is worth;
   `scene.buildings` only decides whether one stands.
3. `scene.techs` are added to each side's `TechTree`.
4. Scene units are spawned **in canonical order** (player, enemy, horde; then
   list order) with `free = true`, levels and runes applied.
5. Rules take effect; round 1 build phase starts.

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
- `techAllowlist` becomes the human seat's loadout; normal costs apply.
- Enemy techs come only from `scene.techs`; enemies do not research in play
  when `opponents: 'lockInOnly'`.

### 6.4 Commander

| `commander.mode` | Card offer | Starter army | Speciality |
|------------------|-----------|--------------|------------|
| `pick` | normal | yes | yes |
| `fixed` | skipped | `starterArmy` decides | yes |
| `none` | skipped | no | no |

Authored scenarios default to `none`. Campaign levels that want a commander
identity without extra units use `fixed` + `starterArmy: false`.

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
| Place | palette of every type incl. horde; team brush Player / Enemy / Horde |
| Erase | click to remove |
| Copy / paste | selection or box selection |
| Mirror | copy one side onto the other (mirrored rows) |
| Clear side | remove all units of one team |

Placement uses `placement.spawn(..., free)` for grid packs and
`spawnAtWorld` for gridless ones — no zone checks, no slots, no cost.

### 8.2 Inspector (selection)

- Level: **− / +** buttons, hotkeys `[` `]`, mouse wheel over the field.
  (Left click stays select/place; no mouse-button overloading.)
- Runes: add / remove slots.
- Techs: the type's allowlist as toggles, innates shown locked-on, with the
  note “applies to all packs of this type on this side”.
- Tags.
- Buildings: on/off, level, destroyed, archer posts.

### 8.3 Scenario panel

1. Map preset and size
2. Rules (§5) with presets for side HP and income
3. Metadata (name, description)
4. Library: Save, Save As, Export file, Copy share code, Import

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
  win split. Uses the same restart path, no new sim code.

---

## 9. Extra features

### 9.1 Capture situation (high value)

“Save as scenario” from any SP match, spectated match or replay **at the start
of a build phase**: current board, levels, runes, side techs, buildings, side
HP and map flags become a draft (`flanksOpenFromRound` = 1 if already open).
Every “that fight was weird” and every bug report becomes reproducible.

### 9.2 Share codes

Compressed, URL-safe string of a `ScenarioDef` for chat and Discord. Import
shows the validation report before playing.

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
  levels: { scenarioId: string; carryOver?: 'none' | 'army' | 'army+supply' }[];
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

1. Scenarios → select → Play (validation must have no errors).
2. Commander step per `rules.commander`.
3. Scenario start (§6.1).
4. Normal build → lock-in → battle → HP draw → next round.
5. Victory / defeat screen → back to the library (campaign: next level).
6. Resume, retry-last-round and replay export work through the normal SP
   paths because the scenario is part of settings.

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
  normalize.ts                # normalizeScenario → { def, report }
  applyScenario.ts            # bases, techs, units onto a Game via ScenarioHost
  mapLimits.ts                # presets + minimum size from BASE_ANCHORS
  capture.ts                  # live match → ScenarioDef (§9.1)
  library.ts                  # localStorage, file, share codes

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
  setBuilding(team: Team, building: SceneBuildingKind, state: BuildingState): void;
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
| `settings.ts` | `scenario?: { def; mode }` + normalize | — |
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

0. **Content preparation (§17), before any editor work:** attributes instead of
   id checks, definitions made serializable, JSON loader for the base game
   with an equality check against the TypeScript tables.
1. **Rules + scenario play:** `matchRules.ts`, `ScenarioDef`, normalize,
   `applyScenario`, play a hand-written JSON, resume + replay verification.
2. **Capture situation** (§9.1) — immediate value, and it exercises apply.
3. **Editor core:** author mode, place / move / erase, team brush, draft
   autosave, restart on map change.
4. **Inspector:** levels, runes, side techs, buildings.
5. **Scenario panel + library:** rules UI, presets, files, share codes.
6. **Test Battle + unit lab**, then regression-test harness (§9.3).

Each phase is playable and reviewable on its own.

---

## 14. Resolved issues from v1

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

---

## 15. Review checklist

- [ ] Scenario embedded in `GameSettings` with `mode: author | play | test`
- [ ] `MatchRules` as the single place for per-round behaviour
- [ ] Units revive each round; attrition deferred
- [ ] Side-level techs; runes per pack
- [ ] Commander modes `pick | fixed(+starterArmy) | none`
- [ ] Opponents always lock in
- [ ] Restart-only editor (no hot remount)
- [ ] Minimum map size derived from base anchors
- [ ] Capture situation in phase 2
- [ ] Core changes limited to §12.3

---

## 16. Appendix — example scenario

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
      "player": { "stronghold": false, "commandTower": false, "researchCenter": false },
      "enemy": { "stronghold": false, "commandTower": false, "researchCenter": false }
    }
  },
  "objectives": []
}
```

---

## 17. Content packs & unit attributes (requirement)

Custom maps will need buildings and units that don't exist in the normal game
(a different Stronghold, walls that shield one side). Those must be possible
**without touching game code**, and ideally without a programmer. That needs
two things, delivered before the editor:

1. core code that reacts to **attributes** of a type, never to its identity;
2. unit and building definitions that are **plain data** and can live in JSON.

### 17.1 Attribute rules

1. **Name by effect, not by owner.** `collapseOwnArmy`, not `isStronghold`.
2. **Attribute = capability; match rules decide whether it is active.**
   `collapseOwnArmy` only fires when `strongholdMode` is `lifeline`.
3. **Group what always goes together.** `fixture: true` means “part of a
   building”: not sellable, not movable, no refund, not field army. No sets of
   booleans that must be kept in sync by hand.
4. **Relationships by reference, not by type.** A mounted archer dies with
   *its* host building, not with any building of a given type.
5. **Values in data, effects in code.** JSON switches effects on and sets
   numbers; each effect is implemented once in TypeScript.
6. **Unknown attributes are load errors.** A typo must never silently do
   nothing.
7. **Scripted content may use ids.** Tutorial lessons (“select the archer”)
   and cheats refer to specific content on purpose.

### 17.2 Current id checks → attributes

| Behaviour today | Attribute |
|---|---|
| Stronghold destroyed → own army collapses (lifeline) | `onDestroyed.collapseOwnArmy` |
| Command Tower / Research Center destroyed → seat debuff | `onDestroyed.seatDebuff` |
| Stronghold destroyed → its battlement archers die | `diesWithHost` on the mounted unit |
| Battlement archer: no sell / move / refund / field army | `fixture` |
| Buy archers onto `Unit1…5` with a climbing price | `garrison { slots, unitTypeId, price { base, step } }` on the host |
| Rune drop onto the building, forge FX, forge spells | `forge` |
| Building shop buttons (recruit level, deploy slot, boosts, credit, upgrade, archers) | `abilities: [...]` |
| Ballista golden aura | `aura { effect, requiresTech, radius, duration }` |
| Sand pad scale under buildings | `visual.sandScale` |
| Banners | driven by the model's flag nodes |

### 17.3 Definitions as data

- A type definition may contain only JSON-representable values. Code
  references (today: the procedural `build` mesh function) become **named
  references** resolved at load time (`"proceduralModel": "dwarf"`).
- Model specs (GLB path, yaw, scale, offset) move next to the type they
  belong to.
- Ids are namespaced once packs exist (`base:archer`, `fortress:wall`); a
  level pack may `extends` a base type and override fields.

### 17.4 Pack layout (units and buildings first)

```text
content/
  base/
    pack.json
    units/*.json
    buildings/*.json
    models/*.glb
  scenarios/<id>/
    scenario.json
    units/*.json        # new or extended types for this level only
    buildings/*.json
    models/*.glb
```

The base pack is bundled by Vite (no runtime fetch). Scenario packs load at
runtime. Techs, runes and commanders follow the same pattern later.

### 17.5 Determinism

- Anything the sim reads from a pack (stats, attributes, GLB-derived slots and
  heights) must be identical on every peer: the multiplayer join check compares
  a content hash of the loaded packs, and pack GLBs feed
  `modelGeometryFingerprint`.
- Every conversion step must leave a recorded replay's state hashes unchanged.

### 17.6 Order

1. Attributes replace id checks in the current TypeScript tables, one
   behaviour per commit.
2. Definitions become serializable (named procedural model refs, model specs
   on the type).
3. A one-time export writes the base pack as JSON; a loader builds the same
   objects; a check proves loaded == TypeScript tables.
4. Level packs (`extends`, new GLBs, new buildings from existing attributes).
5. Engine features that unlock new content, e.g. walls (movement + projectile
   blocking needs real pathing — today the sim only has local avoidance).

---

## Document history

| Date | Change |
|------|--------|
| 2026-09-13 | v1 review draft: sandbox + level export, MapSize boards, asymmetric side HP, strict module separation |
| 2026-09-13 | §17 requirement: attributes instead of id checks; definitions as data; JSON content packs (units/buildings first); phase 0 before the editor |
| 2026-09-13 | v2: verified against the engine. Scenario embedded in settings (replay/resume), `MatchRules`, restart-only editor, side-level techs, commander modes, opponents always lock in, revive semantics, capture situation, share codes, regression tests, campaign carry-over, resolved-issues table (§14) |
