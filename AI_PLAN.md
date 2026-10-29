# AI plan: one brain, difficulties and personalities

Status: plan, agreed in discussion. Nothing built yet beyond the wall pieces listed under "What exists". 2026-10-29.

Supersedes the difficulty part of `AI_DIFFICULTY_NOTES.md` (that file stays as the record of the reverted prototype and of The Year planner's measurements).

## Goal

A strong AI that plays like a good player, and easier levels made from the same AI by switching features off. Each AI seat gets two settings before a game, picked in the lobby like the army: a chip on the seat in the roster ("Standard army", and in a Siege the role), clicked to cycle through the options.

- **Difficulty:** Easy, Medium or Hard.
- **Personality:** Random, Rusher, Wide or Defender (only those that fit the mode and the seat's role, see below).

Both stay for the whole game. Each AI seat has its own, so in 2v2 the two AI seats can differ.

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

The Year planner becomes the army brain for every mode. The classic builder goes; its random pick survives only as the "poor" unit choice of Easy and Medium.

- **Siege:** the planner rebuilds the army every round, as now (a Siege rule).
- **Practice, 1v1, 2v2:** the planner keeps the army and extends it each round ("keep" mode). Packs from earlier rounds are locked, as for a player: only this round's packs can be placed freely, an older one only with a "move pack" charge. So a plan changes the army through its new packs (a Rusher's weak-side troops are new packs placed there).

Everything below sits on top of the one brain.

## Round flow (priorities)

1. **Read** the enemy: the threat map.
2. **Army:** composition and placement for the personality's plan. It gets most of the supply, including the Command Tower's extra buy and, when nearly dead, its credit (see "Extra buy and round boosts").
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
- **Race check** (Medium, Hard) sizes the extra defence:
  - **T₁:** how long its rush needs to take the enemy tower on its side.
  - **T₂:** how long its weak side holds against the threat there (walls, the tower, troops there).
  - **T₂ clearly longer than T₁:** walls are enough. The enemy tower falls first, the enemy's army is crippled by the debuff, and the weak side cleans up.
  - **T₂ shorter:** just enough troops move to the weak side to push T₂ past T₁ (plus a margin). The rest stays on the rush.
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
| Research Centre boosts | no | yes, when supply allows | yes, when worth more than a pack |
| Recruit level 2, move-pack ability | no | no | yes |
| Stronghold archers | Defender | Defender | Defender |
| Uses card charges | no | yes | yes |
| Siege packs vs enemy walls | no | no | yes |
| Sends spare supply to an ally (2v2) | no | yes | yes |
| Building upgrades | no | yes, low priority | yes, low priority |
| Walls | Defender only, all-in (~60 % of supply) | Defender ~35 % of supply; Rusher's stall and Wide's walls by threat | by personality and threat, no overbuild |
| Threat reaction | none (a Defender still builds its fortress) | one round late | immediate (threat map, race check) |

Placement and the personality's plan are the same at every level.

**Practice defaults:** Easy, Random.

**2v2:** each AI seat plays independently, its own personality in its own lane. Coordination may come later.

## Extra buy and round boosts

The Command Tower sells a **+1 buy for the running round** (`buyDeploySlot`, 50 supply, once per round: 2 packs → 3). Good players use it nearly every round, for chaff (dwarfs, goblins) or another main unit. No AI buys it today.

- **Easy:** never.
- **Medium:** whenever supply covers the slot plus a pack. The third pack is a random affordable one.
- **Hard:** whenever the extra pack helps the army more than the 50 would elsewhere (nearly always). It chooses between cheap chaff in front of its main army and another main unit, whichever scores better against the enemy's army.

**Credit (loan):** the Command Tower also lends **+200 supply now, 300 paid back at the start of the next round** (`buyCredit`, once per round). The AI takes it only when it is nearly dead, so this round decides whether it survives and next round's debt matters less than more army now:

- **Only where side HP carries over:** Practice, 1v1, 2v2, and a Siege won on HP. Never in a Siege won on rounds, where HP is restored every round.
- **"Nearly dead":** a lost battle this round could end the match, or its HP is below a threshold (one tunable value, start at 25 % of its starting HP).
- **The 200 goes straight into army.**
- **Difficulty:** Medium and Hard; Easy never borrows.

The Command Tower's other round boosts (+5 range for ranged units, 100; +3 speed for the army, 50) come later, Hard only, where they fit the plan: range with many ranged packs, speed for a Rusher's race.

## Army upgrades

Unused by every AI today. They make the army stronger, so they belong to the army priority.

- **Research Centre boosts** (`buyBoost`): permanent, army-wide; +10 % / +20 % attack and +15 % / +30 % HP, tiers at 100 and 300.
  - **Medium:** buys them at some point, when supply allows.
  - **Hard:** as soon as the boost is worth more than another pack, i.e. once its army is big enough. That comes early for an army that stays all match (Practice).
- **Recruit level 2** (`recruitLevel`): once per round, every later buy that round arrives at level 2, for a premium. Hard only, when it buys several packs of one type.
- **Stronghold archers** (`buyStrongholdArcher`): more archers on the keep's battlements. A Defender's purchase (every difficulty, within its defence share), and the Siege defender's.
- **Card charges** (Medium, Hard): the AI uses what its round cards grant ("move an old pack", "tutor", "mobilize"), or doesn't pick cards it can't use.
- **Move-pack ability** (`buyMovePackAbility`, 200, Research Centre): Hard, when a plan needs an old pack elsewhere (a Rusher's weak side under real pressure).

- **Sending supply to an ally** (`sendSupply`, 2v2): Medium and Hard send supply they can't use well this round (pack limit reached, nothing worth buying left) to their ally, human or AI. It arrives with the next round's income.

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

To come, in a session with the user's "good player" rules (e.g. dwarf beaten by hammerer). It sits on top of the battle model as hand-set bonuses for what the stats miss (range, flying, armour piercing, splash against swarms). Hard uses it to pick the army that scores best against the enemy's.

## Steps

1. **Unify the brains:** Practice on the planner in keep mode. Test that Practice still plays sensibly.
2. **Selectors:** difficulty and personality chips on the AI seats in the lobby roster, with the switches wired in.
3. **Threat map and debug readout.**
4. **Personalities:** Rusher (side, stall, race check), Defender (fortress, overbuild), Wide.
5. **Priorities:** army first (with extra buy, credit, Research Centre boosts, recruit level), defence by threat, upgrades last. `WALL_MADNESS` goes.
6. **The extras:** card charges, move-pack ability, sending supply to an ally.
7. **Counter table.**

## Open questions

Collected in the discussion; answered ones move into the sections above.

- The counter table (step 7), in its own session.
