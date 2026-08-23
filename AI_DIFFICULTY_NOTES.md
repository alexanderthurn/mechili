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
