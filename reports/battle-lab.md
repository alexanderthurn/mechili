# Battle lab — 2026-11-10

4850 battles in 200 s on 10 workers. Content hash `207641bb`.

Headless BattleSim, packs only: no buildings, walls, spells, techs or runes. Margins are the game's end-of-battle HP damage (dealt − taken), per 1000 supply.

## What spending on a unit is worth

Value: how much the margin moves when an army puts all its supply into this unit instead of the average mix (ridge regression over the random battles). Damage per 100 supply by level. ⚠ = more than 1.5 standard deviations above the mean (a candidate for "overpowered"); ▽ = as far below.

| unit | cost | value | dmg/100 L1 | L2 | L3 | survives | |
|---|---:|---:|---:|---:|---:|---:|---|
| ballista | 200 | 1247.2 | 822 | 799 | 700 | 53% | ⚠ |
| crowRider | 200 | 154.5 | 394 | 481 | 474 | 20% |  |
| ogre | 200 | 114.3 | 296 | 427 | 462 | 10% |  |
| goblin | 100 | 101.9 | 168 | 229 | 241 | 14% |  |
| dwarf | 100 | -52.7 | 171 | 242 | 319 | 8% |  |
| wizard | 400 | -159.7 | 0 | 0 | 0 | 34% |  |
| hammerer | 100 | -173.8 | 495 | 548 | 586 | 9% |  |
| prismCannon | 400 | -328.1 | 179 | 186 | 183 | 42% |  |
| mortar | 200 | -328.9 | 342 | 377 | 384 | 50% |  |
| archer | 100 | -574.7 | 316 | 386 | 388 | 14% |  |

## Counters (mono armies, equal supply)

Per unit: what it beats most and what beats it most (margin per 1000 supply, from both sides of the board).

| unit | beats | loses to |
|---|---|---|
| dwarf | wizard +454, prismCannon +444.8, goblin +400 | crowRider -960, ogre -960, ballista -880 |
| goblin | wizard +404, archer +369.2, ogre +158.2 | ballista -1920, mortar -960, hammerer -560 |
| hammerer | dwarf +560, goblin +560 | ballista -1920, wizard -1300, crowRider -960 |
| ogre | dwarf +960, hammerer +960, archer +960 | ballista -960, crowRider -960, goblin -158.2 |
| archer | hammerer +560, crowRider +560 | ballista -1920, wizard -1200, ogre -960 |
| wizard | prismCannon +1840, hammerer +1300, archer +1200 | ballista -1920, crowRider -960, ogre -960 |
| crowRider | dwarf +960, hammerer +960, ogre +960 | archer -560 |
| mortar | goblin +960, archer +900, wizard +890 | ballista -1920, crowRider -960, ogre -960 |
| prismCannon | hammerer +880, archer +640 | ballista -1920, wizard -1840, mortar -830 |
| ballista | goblin +1920, hammerer +1920, archer +1920 | crowRider -960 |

## Formations (same army both sides)

Row against column, both sides of the board averaged (the near side has a small edge of its own).

| row vs column | line | block | flanks | back | sorted | left | mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| line | · | -42.1 | -200.8 | -0.5 | 248.9 | -96.9 | -18.3 |
| block | 42.1 | · | -205.5 | -21.4 | 60.8 | -111.5 | -47.1 |
| flanks | 200.8 | 205.5 | · | -2.8 | -68.9 | -464.1 | -25.9 |
| back | 0.5 | 21.4 | 2.8 | · | 202.3 | -65.9 | 32.2 |
| sorted | -248.9 | -60.8 | 68.9 | -202.3 | · | 74.8 | -73.7 |
| left | 96.9 | 111.5 | 464.1 | 65.9 | -74.8 | · | 132.7 |

## Starting mixes (evolved against a fixed panel)

| budget | formation | score | mix (supply share) |
|---:|---|---:|---|
| 1000 | flanks | 834.4 | ballista 90%, goblin 10% |
| 1000 | left | 791.6 | ballista 60%, crowRider 20%, dwarf 10%, goblin 10% |
| 1000 | flanks | 665.8 | ballista 80%, goblin 10%, dwarf 10% |
| 2500 | sorted | 632 | crowRider 52%, ballista 44%, archer 4% |
| 2500 | sorted | 604.2 | ballista 36%, goblin 34%, crowRider 24%, archer 6% |
| 2500 | sorted | 566 | ballista 56%, crowRider 40%, archer 4% |
| 5000 | flanks | 608 | prismCannon 72%, ballista 28% |
| 5000 | flanks | 576 | prismCannon 63%, ballista 29%, ogre 8% |
| 5000 | flanks | 560 | prismCannon 51%, ballista 49% |
