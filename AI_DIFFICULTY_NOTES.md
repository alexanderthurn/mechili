# AI difficulty — design notes

Saved before reverting the Easy / Medium / Hard prototype. One difficulty level (legacy random AI) stays in the game for now.

## Goal

Give single-player and custom games three opponent strengths without changing multiplayer human-vs-human rules. Difficulty should live in `AiOpponent` deploy logic and flow through `GameSettings`, SP menu, and custom lobby config.

## Difficulty tiers

### Easy — legacy random AI (default)

Keep today’s behaviour unchanged so existing balance and saves feel the same.

- One random shop unlock per round (~85% chance when affordable).
- Fill deploy slots with random affordable unit types.
- Random reposition (~75% of movable packs).
- Items, tactics (max 2), unit techs + pack levels.
- No counter picks, no anti-air logic, no third deploy slot, no rune/tower spending loop.

### Medium — structured deploy

Same “smart” pipeline as Hard, but without counter scoring, formation bias, early-round unit cap, or tower upgrades.

Deploy order each round:

1. **Anti-air** — if enemy has flyers and we have no archer on field, unlock `archer` (once per round gate).
2. **Army buys** — fill slots; unit pick is random among affordable types (after anti-air priority).
3. **Third slot** — if supply ≥ `extraSlotCost + cheapest army cost`, buy deploy slot then one unit.
4. **Reposition** — ~90% of movable packs (`skipChance` 0.1).
5. Items, tactics.
6. **Leftover supply** — random runes until broke → unit techs + levels → tower attack/hp boosts (no `upgradeTower`).

### Hard — counters + formation + economy

Everything in Medium, plus:

| Rule | Detail |
|------|--------|
| Early army | Rounds 1–3: only buy units with cost ≤ 100 (dwarf, archer). |
| Counter buys | Score affordable types with `counterScore`; pick from top scorers (tie-break random). |
| Formation | Once per match at first deploy: random `left` / `right` / `center-back`. |
| Counter placement | Counter units prefer front rows (`preferTowardEnemy`). |
| Reposition | ~95% of packs move (`skipChance` 0.05). |
| Towers | Spend leftover on `upgradeTower` for Command Tower + Research Center. |

## Unit counter table (`unitCounters.ts`)

Rock-paper-scissors for Hard buy/placement scoring. Score += 2× enemy count per good matchup, −2× per bad.

| Unit | Good vs | Bad vs |
|------|---------|--------|
| dwarf | archer | crowRider |
| crowRider | dwarf | archer |
| archer | crowRider | dwarf |
| ballista | dwarf, archer | crowRider |

```ts
counterScore(typeId, enemyCounts) // sum of matchup weights
isCounterUnit(typeId, enemyCounts) // score > 0
```

Anti-air is separate: only **archer** counts as the answer to enemy flyers (not crow riders).

## Placement scoring (`placement.ts`)

Extend `findAiSpot(team, seat, type, rng, prefs?)` with optional `AiSpotPrefs`:

- `strategy`: `'left' | 'right' | 'center-back'` — flank or center-back bias via column/row scoring.
- `preferTowardEnemy`: extra weight on front ranks (for counter units on Hard).

Base scoring still respects short-range → front, long-range → back. Random sample of up to 4 valid anchors; highest score wins.

## Settings & UI (reverted)

- `GameSettings.aiDifficulty?: 'easy' | 'medium' | 'hard'`
- `DEFAULT_AI_DIFFICULTY = 'easy'`
- `resolveAiDifficulty(raw)` — URL, save, lobby normalization
- `formatAiDifficultyLabel()` — HUD / commander card (“Easy”, “Medium”, “Hard”)
- **SP menu:** three buttons (Easy / Medium / Hard) instead of 1v1 / 2v2 / Horde picker
- **Custom lobby:** “AI difficulty” `<select>` in host settings; synced in `CustomGameConfig`
- **Dev URL:** `?ai=easy|medium|hard`
- **`game.ts`:** pass `deploySettings` + `difficulty` into `aiCtxFor()`

## Files touched in the prototype

| File | Role |
|------|------|
| `src/game/ai.ts` | Easy vs smart paths, counter/anti-air/formation logic |
| `src/game/unitCounters.ts` | Matchup table + scoring helpers |
| `src/game/placement.ts` | `AiSpotPrefs`, `scoreAiSpot`, `findAiSpot` prefs |
| `src/game/settings.ts` | Type, defaults, normalize, labels |
| `src/game/game.ts` | `aiCtxFor` wiring |
| `src/game/net.ts` | `CustomGameConfig.aiDifficulty` |
| `src/main.ts` | SP menu, lobby select, save/load, `startLocalMatch` |
| `src/theme.ts` | Unused SP difficulty button styles (`.m-spmode-subtitle`, `.m-sp-diff-btn`) |

## Related experiment — do not reuse as-is

**Paced deploy (plan → undo → replay with delays)** was tried to hide AI buys behind deploy fog. It broke intel fog, resume, and star relay. Reverted separately. If pacing returns, it must not depend on quiet undo or deferring `revealAll()` on player lock-in.

## Re-implementation checklist

1. Restore `unitCounters.ts` and imports in `ai.ts`.
2. Restore `AiSpotPrefs` / scoring in `placement.ts`.
3. Add settings + normalize + lobby/SP UI.
4. Wire `difficulty` + `deploySettings` in `aiCtxFor`.
5. Keep Easy path identical to pre-difficulty `runBuildActions` for regression safety.
6. Test: SP each tier, custom lobby host/guest, save/resume, star 2v2 with AI seats.

---

# The Year AI (2026-09-14)

The Year's AI side is rebuilt every round with the player's wealth, so each
round is one plan. `src/game/aiYear.ts` makes it; `AiOpponent` uses it in The
Year (`brain: 'classic'` keeps the old random builder, e.g. for comparison).

## How it plans

1. **Battle estimate** (`estimateBattle`) — a group-level battle model from
   resolved stats and unit attributes only: HP/damage/interval/range/speed,
   air/ground layers, splash and cleave against the target's density,
   overkill, aim spread, conversion rays, production and on-kill spawns,
   shields, dead zones, structures behind the fight, the Stronghold
   lifeline. Its free numbers (`MODEL`) are fitted to real battles.
2. **Army** (`compose`) — greedy spending over packs and talents, each step
   the best gain per supply; scored 60/40 against the visible army and against
   that army plus the best single-type counter the player can still buy with
   their liquid supply. The round's unlock is chosen by planning with and
   without each candidate.
3. **Placement** — depth bands by role (front-liners ahead, artillery back),
   each pack in the lane of the enemy group it is best against, spread wider
   against splash, defenders leaning toward their Stronghold.
4. **Commander** — for a rebuilt side only lasting combat effects count
   (recruit level first, then stat/flying/speed bonuses, unlock discounts).
5. Afterwards the classic steps: inventory runes, spells.

Planning takes ~20–70 ms per round (arena, Node).

## The arena

`node scripts/ai-arena.mjs` plays The Year headless with the real placement,
action dispatcher, AI and BattleSim (no horde waves, round cards or strip
spells). The player side keeps its army and levels it; it is driven by a
stand-in: `--human classic` (random buyer) or `--human year` (the planner on a
kept army — a strong, counter-picking player).

- `--variant attack|defend|komtur-attack|komtur-defend|all --games N --seed S`
- `--ai year|classic`, `--planner key=value,…` (AI seat only; model keys too)
- `--komturPrice 1.3` — scale the Komtur shop's prices
- `--duels`, `--collect --cache f.json`, `--tune --cache f.json` — record real
  battles and fit `MODEL` (1175 battles: agreement 77% → 85%, r 0.64 → 0.78)

## Results (share of rounds the AI wins, 81–162 rounds each)

| variant (player's view) | old AI vs random | new AI vs random | old AI vs planner | new AI vs planner |
|---|---|---|---|---|
| attack | 12% | 53% | 3% | 29% |
| defend | 25% | 69% | 2% | 35% |
| attack as the Komtur | 2% | 64% | 0% | 46% |
| defend against the Komtur | 13% | 90% | 2% | 88% |

- Against a leveling player the AI wins early rounds and fades late: a level
  doubles a pack for half its price, the rebuilt side cannot level, and the
  wealth sync counts levels at their supply price.
- Planner knobs (talent weight, counter weight, enemy budget, spacing,
  concentration, Stronghold focus) did not beat the defaults beyond noise.
- Scoring plans by the round rule (surviving value, tie to the defender) was
  worse than the fitted HP margin — kept as `ruleScore`, off.
- Komtur prices: the AI as the Komtur wins 77% at today's prices, 48% at ×1.3,
  37% at ×1.6 — the forest roster looks ~30% underpriced for buying.
