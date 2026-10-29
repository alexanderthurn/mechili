# AI plan: one brain, difficulties and personalities

Status: plan, agreed in discussion and checked against the code (2026-10-29). Nothing built yet beyond the wall pieces listed under "What exists". 2026-10-29.

Supersedes the difficulty part of `AI_DIFFICULTY_NOTES.md` (that file stays as the record of the reverted prototype and of The Year planner's measurements).

## Goal

A strong AI that plays like a good player, and easier levels made from the same AI by switching features off. Each AI seat gets two settings before a game, picked in the lobby like the army: a chip on the seat in the roster ("Standard army", and in a Siege the role), clicked to cycle through the options.

- **Difficulty:** Easy, Medium or Hard.
- **Personality:** Random, Rusher, Wide or Defender (only those that fit the mode and the seat's role, see below).

Both stay for the whole game. Each AI seat has its own, so in 2v2 the two AI seats can differ. They show only in the lobby; in the match the AI is just an opponent.

The army is the top priority: it is what takes the enemy's HP down. Losing a tower is the one thing more dangerous, because of the debuff (see "Tower loss"), and the AI answers that with the cheapest defence that is enough.

## What exists

- **Two army brains today:**
  - **Classic** (`AiOpponent.runBuildActions`, Practice / 1v1 / 2v2): random affordable packs at random spots, melee toward the front.
  - **The Year planner** (`YearBrain`, `aiYear.ts`, Siege): a fitted battle model (`estimateBattle`, ~85 % agreement with real battles), greedy army composition against the visible army, placement in lanes opposite the enemy groups. It has a "keep" mode (the arena's player stand-in) that extends a kept army instead of rebuilding.
- **Walls** (`aiWalls.ts`):
  - A fixed fortress plan per side: front 4 + 4 joined walls with a 6-tile centre hole, one corridor piece per hole edge, 4 flank pieces per side.
  - Slots the AI's packs keep off.
  - Levels and archer posts.
  - Siege packs against the enemy's walls.
  - `WALL_MADNESS` is on for testing.
- **Building upgrades** (`AiOpponent.upgradeBuildings`): one level per building per round, with what is left after the army.

## One brain

The Year planner becomes the army brain for every mode. The classic builder goes completely (no debug option to keep it); its random pick survives only as the "poor" unit choice of Easy and Medium. The arena script's `--ai classic` / `--human classic` go with it (the stand-in becomes the planner, or the planner at Easy).

- **Siege:** the planner rebuilds the army every round, as now (a Siege rule).
- **Practice, 1v1, 2v2:** the planner keeps the army and extends it each round ("keep" mode). Packs from earlier rounds are locked, as for a player: only this round's packs can be placed freely, an older one only with a "move pack" charge. So a plan changes the army through its new packs (a Rusher's weak-side troops are new packs placed there).

Everything below sits on top of the one brain.

## Round flow (priorities)

"Army first" means the army is never starved, not that it spends first. The defence the round needs (from the threat and the personality) is sized first and set aside; the army composes with the rest; then the defence is built. The plan's wall tiles are kept free of packs, so walls can go down after the army.

1. **Read** the enemy: the threat map.
2. **Army:** composition and placement for the personality's plan. It gets most of the supply, including the Research Centre's extra buy and, when nearly dead, its credit (see "Extra buy and round boosts").
3. **Defence** where the threat calls for it (or the personality always wants it): wall segments from the fixed plan, then archer posts, then levels on those walls.
4. **Spells / tactics** (Medium, Hard): today's spell logic, unchanged by personality.
5. **Building upgrades and runes** with what is left. The exception: a Rusher's weak tower comes under defence (step 3).

## Threat map

What the AI sees of the enemy at the start of its build: the army on the board, or the enemy's last army where it is rebuilt every round.

- **Five sectors** across the side's width: left flank, left tower, centre, right tower, right flank.
- **Per sector:**
  - the enemy's army **value** (cost × level, summed);
  - how far **forward** it stands.
- **Posture** read from the distribution:
  - a) defending at home;
  - b/c) on the left / right tower;
  - d) a big flank;
  - e) mixed with a small flank poke.
- **Last battle** (every personality): a tower that fell or took heavy damage in the last battle gets more defence next round (walls, posts; the Rusher's race check is the same reading). The threat map adds what changed since.
- A **debug readout** in the debug overlay shows the sector values and the posture read, so the reading can be checked before behaviour depends on it.

## Tower loss

Losing your own command tower or research centre debuffs your seat's units:

- **Effect:** speed × 0.1, attack × 0.1, damage taken × 2 (`towers.debuffPerLostTower`).
- **Duration:** 8 s at tower level 1, 2 s less per level, 0 at level 5 (`towers.debuffDuration`).
- **During those seconds the seat is nearly frozen.** Ignoring an attack on a tower is never an option. A tower upgrade is insurance: each level cuts 2 s.

## Personalities

| Personality | Practice | Siege attacker | Siege defender |
|---|---|---|---|
| **Random** (picks one of the others at the start, kept hidden: the chip keeps saying Random) | ✓ | ✓ | ✓ |
| **Rusher** | ✓ | ✓ | ✓ (rushes the tent) |
| **Wide** | ✓ | ✓ | – |
| **Defender** | ✓ | – | ✓ |

### Rusher

- **Side:** picks a side at random at the start (at every difficulty) and keeps it all game. It stacks its army there and goes for that tower.
- **Weak side, always a stall** (Medium, Hard; the minimum): the wall segment in front of the weak tower, plus archer posts if the threat there is mostly melee.
- **Easy** doesn't react to threats: no stall, no race check.
- **Race check** (Medium, Hard) sizes the extra defence. It reads the **last battle** instead of predicting:
  - **T₁:** when its rush took the enemy tower on its side (or how much of the tower's HP it took, if it didn't fall).
  - **T₂:** when its own weak tower fell (or how much HP it had left).
  - **Its tower fell first, or nearly:** the stall grows: more wall pieces, posts, troops on the weak side.
  - **The enemy tower fell first with a clear margin:** the stall stays as it is, or shrinks.
  - **Correction for this round:** if the enemy added a lot of value on its weak side since that battle (threat map, before and after), it adds to the stall even if the last battle went fine.
  - **First round, no battle yet:** the minimum stall.
  - **Data:** the battle already reports a fallen tower and when (`towerDebuff` event). The record must survive a resume (rebuilt from the replay or saved with the match).
- **Weak tower upgrades** (Medium, Hard): count as defence and come before other building upgrades, since every level shortens its own debuff.

### Wide

A Defender that stands further forward: the same defensive build, but its army is placed nearer the front, spread over the width, so it reaches the enemy's towers faster when the enemy's push breaks. Walls only where the threat calls for them (like the Rusher's stall), which leaves more supply for its forward army.

As the Siege attacker (no walls, must take the base), Wide spreads over the whole width and pushes everywhere.

### Defender

- **Fortress:** builds the wall plan (front, corridor, flanks) with archer posts and levels.
- **Army:** placed back, near the base. It never pushes: it holds and wins by trading well behind its walls.
- **Every difficulty builds walls:**
  - **Easy** goes all-in: up to ~60 % of its supply into walls, posts and levels until the fortress stands.
  - **Medium** up to ~35 %.
  - **Hard** eventually builds the whole fortress too, but paced by the threat: threatened segments first, never at the cost of an army that can hold.
  - The shares are one tunable value per difficulty.

## Difficulty

One AI; difficulty switches features and the quality of choices.

| | Easy | Medium | Hard |
|---|---|---|---|
| Unit choice | poor: random among affordable types | poor: random among affordable types | counter-based (battle model + counter table) |
| Spells / tactics | no | yes | yes |
| Extra buy (+1 pack per round) | no | yes, random pack | yes, chaff or main unit by score |
| Credit when nearly dead (HP modes only) | no | yes | yes |
| Army boosts (Command Tower) | no | yes, when supply allows | yes, when worth more than a pack |
| Recruit level 2, Marching Orders card | no | no | yes |
| Stronghold archers | Defender | Defender | Defender |
| Uses card charges | no | yes | yes |
| Siege packs vs enemy walls | no | no | yes |
| Sends spare supply to an ally (2v2) | no | yes | yes |
| Building upgrades | no | yes, low priority | yes, low priority |
| Walls | Defender only, all-in (~60 % of supply) | Defender ~35 % of supply; Rusher's stall and Wide's walls by threat | by personality and threat, no overbuild |
| Threat reaction | none (a Defender still builds its fortress) | one round late | immediate (threat map, race check) |

Placement and the personality's plan are the same at every level.

**Practice defaults:** Easy, Random.

**Seat takeover** (a human disconnects in multiplayer): the AI plays the lobby defaults, Easy and Random.

**Campaign and editor scenarios** with a building opponent: the scenario rules get difficulty and personality fields, default Easy and Random.

**Horde mode:** left out for now; its AI seats keep today's behaviour.

**2v2:** each AI seat plays independently, its own personality in its own lane. Coordination may come later.

## Extra buy and round boosts

The Research Centre (and the Siege attacker's Tent) sells a **+1 buy for the running round** (`buyDeploySlot`, 50 supply, once per round: 2 packs → 3). Good players use it nearly every round, for chaff (dwarfs, goblins) or another main unit. No AI buys it today. It only matters where the pack limit binds: Practice, 1v1, 2v2. The Siege AI already gets 40 packs a round (`CLIMB_AI_DEPLOY_LIMIT`).

- **Easy:** never.
- **Medium:** whenever supply covers the slot plus a pack. The third pack is a random affordable one.
- **Hard:** whenever the extra pack helps the army more than the 50 would elsewhere (nearly always). It chooses between cheap chaff in front of its main army and another main unit, whichever scores better against the enemy's army.

**Credit (loan):** the Research Centre (and the Tent) also lends **+200 supply now, 300 paid back at the start of the next round** (`buyCredit`, once per round). The AI takes it only when it is nearly dead, so this round decides whether it survives and next round's debt matters less than more army now:

- **Only where side HP carries over:** Practice, 1v1, 2v2, and a Siege won on HP. Never in a Siege won on rounds, where HP is restored every round.
- **"Nearly dead":** a lost battle this round could end the match. That is exact: a battle takes from the loser's side HP the withdraw value (`hpWithdrawOf`) of every surviving enemy unit, so the AI is nearly dead when the enemy army's total withdraw value reaches its side HP (with a margin, one tunable value). In 2v2 the side HP is shared.
- **The 200 goes straight into army.**
- **Difficulty:** Medium and Hard; Easy never borrows.

The Research Centre's other round boosts (+5 range for ranged units, 100; +3 speed for the army, 50) come later, Hard only, where they fit the plan: range with many ranged packs, speed for a Rusher's race.

## Army upgrades

Unused by every AI today. They make the army stronger, so they belong to the army priority.

- **Army boosts** (`buyBoost`, Command Tower; the Siege attacker has none): permanent, army-wide; +10 % / +20 % attack and +15 % / +30 % HP, tiers at 100 and 300.
  - **Medium:** buys them at some point, when supply allows.
  - **Hard:** as soon as the boost is worth more than another pack, i.e. once its army is big enough. That comes early for an army that stays all match (Practice).
- **Recruit level 2** (`recruitLevel`, Research Centre or Tent): once per round, every later buy that round arrives at level 2, for a premium. Hard only, when it buys several packs of one type.
- **Stronghold archers** (`buyStrongholdArcher`): more archers on the keep's battlements (5 per seat, 100 rising by 50 each). A Defender's purchase (every difficulty, within its defence share), and the Siege defender's.
- **Card charges** (Medium, Hard): the AI uses what its round cards grant ("move an old pack", "tutor", "mobilize"), or doesn't pick cards it can't use.
- **Moving an old pack:** only through the "Marching Orders" round card (no building sells it any more). Hard picks that card when a plan needs an old pack elsewhere (a Rusher's weak side under real pressure).

- **Sending supply to an ally** (`sendSupply`, Stronghold, 2v2): Medium and Hard send supply they can't use well this round (pack limit reached, nothing worth buying left) to their ally, human or AI. It arrives with the next round's income.

Not planned for now: selling packs.

## Siege packs against enemy walls

Hard only: part of good unit choice. Easy and Medium ignore the enemy's walls.

Not planned for now: marking enemy walls (`setTargetMark`). Siege packs break walls by hitting the stone in their way, and by the automatic mark on walled-in packs at battle start.

## Walls by personality

- **Defender:** the full fortress. Easy and Medium overbuild (supply share per difficulty); Hard paces it by the threat.
- **Rusher:** only the weak tower's segment, sized by the race check.
- **Wide:** only the segments where the threat calls for them.
- **Siege attacker:** none (it gets rockets and shields, not walls).

Wall segments come from the fixed plan in `aiWalls.ts`. Only the segments the AI intends to build reserve their tiles.

## Counter table

Learning from battle results (which of its units performed) is not planned for now.

To come, in a session with the user's "good player" rules (e.g. dwarf beaten by hammerer). It sits on top of the battle model as hand-set bonuses for what the stats miss (range, flying, armour piercing, splash against swarms). Hard uses it to pick the army that scores best against the enemy's.

## Rules for every level

- **Only what a player could do.** The actions don't check that the seat owns the building that sells an ability (the HUD does, by selecting it). The AI checks itself: an ability only while it has a building with it. The Siege attacker's Tent has the Research Centre's round abilities but no army boosts.
- **Deterministic from the match seed.** The Rusher's side and Random's pick come from the match seed and the seat, not from a running random stream, so resume, reconnect and a new host get the same AI.
- **Buildings by ability, not by name:**
  - **Research Centre:** +1 buy, recruit level 2, credit, range and speed boosts.
  - **Command Tower:** army boosts, selling, rally route, vanguard spells.
  - **Stronghold:** forge, sending supply, battlement archers.
  - **Tent** (Siege attacker): the Research Centre's round abilities, forge spells and rally route.

## Steps

1. **Unify the brains, and the selectors** (built together, tested together):
   - Practice on the planner in keep mode;
   - difficulty and personality chips on the AI seats in the lobby roster, with the difficulty switches wired in (unit choice, spells, building upgrades).
2. **Threat map, last-battle record and debug readout.**
3. **Personalities:** Rusher (side, stall, race check), Defender (fortress, overbuild), Wide.
4. **Priorities:** army first (with extra buy, credit, army boosts, recruit level), defence by threat, upgrades last. `WALL_MADNESS` goes.
5. **The extras:** card charges, Marching Orders, sending supply to an ally.
6. **Counter table.**

## Open questions

Collected in the discussion; answered ones move into the sections above.

- The counter table (step 6), in its own session.
