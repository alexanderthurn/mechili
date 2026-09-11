# Mechabellum unit notes

Reference notes on Mechabellum’s unit roster and why it exists as a counter web (rock–paper–scissors). Useful when designing / balancing MELODAN’s fantasy take.

---

## Full unit list

### Ground (standard)

1. Crawler
2. Fang
3. Arclight
4. Marksman
5. Hound
6. Void Eye
7. Vortex
8. Mustang
9. Sledgehammer
10. Sabertooth
11. Steel Ball
12. Tarantula
13. Fire Badger
14. Stormcaller
15. Rhino
16. Hacker
17. Farseer
18. Scorpion
19. Typhoon

### Ground giants

20. Vulcan
21. Melting Point
22. Fortress
23. Sandworm

### Air

24. Wasp
25. Phoenix
26. Wraith
27. Phantom Ray

### Air giants

28. Overlord
29. Raiden

### Titans

30. War Factory
31. Abyss
32. Mountain
33. Death Knell *(mainly Survival / Brawl)*

### Spawned / secondary

- Spider Mine (from Tarantula tech)
- Larva (from Sandworm tech)

~33 main units, plus two spawned types.

---

## Why all these units exist (RPS)

The roster isn’t “30 unique toys.” It’s **role coverage** so every strong strategy has a counter — and every counter can be countered.

### Core triangle

```
Chaff  →  beats  →  Single-target / glass cannons
  ↑                      ↓
  └──── Chaff-clear ←────┘
```

| Role | Job | If you skip it… |
|------|-----|-----------------|
| **Chaff** | Soak shots, stall, distract | Enemy DPS melts your big units instantly |
| **Chaff-clear** | Wipe swarms fast | Opponent’s chaff stalls forever; you lose on tempo |
| **Single-target / big damage** | Kill tanks, giants, elites | You stall forever but never kill the scary stuff |

Community shorthand: **chaff > chaff-clear > single-target > anti-air** — chaff is the backbone.

That triangle alone needs only a few units. Everything else exists to **specialize axes** of that fight so the meta doesn’t collapse into one best army.

---

## Role axes (why so many)

### 1. Chaff flavors (not one swarm)

| Unit | Niche |
|------|--------|
| **Crawler** | Fast melee meat; eats single-target DPS |
| **Fang** | Slower ranged chaff; can tech shields / scale |
| **Wasp** | Flying chaff + harassment; forces anti-air |
| **Hound** | Cheap bodies + light clear; late-game glue |

Same role, different answers: ground splash vs air AA vs speed vs shield tech.

### 2. Chaff-clear flavors

| Unit | Niche |
|------|--------|
| **Arclight** | Cheap splash vs crawlers early |
| **Sledgehammer** | Frontline clear + body |
| **Tarantula / Typhoon / Fire Badger** | Mid clear with different range/tank tradeoffs |
| **Vulcan** | Giant flamethrower — delete all small stuff in a pile |
| **Wraith** | Air AoE that multi-targets (hard to “block” with one tank) |

Without these variants, “just Arclight” or “just Vulcan” becomes mandatory forever.

### 3. Medium / midgame “glue”

| Unit | Niche |
|------|--------|
| **Mustang** | Fast all-rounder + AA option |
| **Steel Ball** | Tank that eats single big targets |
| **Rhino** | Aggressive melee breakthrough / aggro soak |
| **Hacker** | Steal big units — punishes overcommitment to elites |
| **Scorpion** | Anti-medium (balls, sledges, shields) |
| **Stormcaller** | Long-range artillery; melts slow boards if unanswered |
| **Sabertooth / Vortex / Void Eye / Marksman** | Mid DPS / poke / niche mid-range jobs |

These fill the gap between “swarm” and “giant” so games have mid-round pivots, not only early spam and late titans.

### 4. Giants = dedicated answers

| Unit | Niche |
|------|--------|
| **Fortress** | Versatile tank / AA barrage / barrier |
| **Melting Point** | Ramping laser vs high-HP giants |
| **Overlord / Raiden** | Air giants — pressure + medium delete |
| **Sandworm** | Burrow flank / sandstorm utility |
| **Phantom Ray** | Air frontline (e.g. armor vs Mustangs) |
| **Farseer** | Midgame safety blanket vs cheese (Wasps, Wraith, early Overlord) |

Each giant is strong at **one or two jobs** and soft to something else — so picking a giant commits you, and the opponent can draft the answer.

### 5. Titans = late game win conditions

**War Factory, Abyss, Mountain, Death Knell** — expensive closers. They exist so the game escalates: if both sides stall forever with chaff wars, someone eventually buys a titan and forces a decisive answer (usually Melting Point / Scorpion / storm intercept / etc.).

---

## Mini RPS examples

- **Crawlers** beat **Marksman / Melting Point** (stall the laser) → lose to **Arclight / Vulcan / Wraith**
- **Vulcan** deletes chaff → loses to **Fortress / Melting Point / Overlord / Phoenix**
- **Fortress** beats medium packs → loses to **Melting Point / Steel Ball / Stormcaller / Crawler floods**
- **Wasps** punish ground-heavy boards → lose to **Mustang / Typhoon / Fortress AA**
- **Stormcaller** melts everything if free → loses to **War Factory intercept / fast melee (Rhino/Crawler) / Overlord**

Not one triangle — **stacked triangles** (ground/air, chaff/clear/DPS, medium/giant, missile/intercept).

---

## Design reason in one line

**Many units = many distinct counters**, so you never have a permanent “best army.” Each unit plugs a hole in the web: if chaff didn’t exist, single-target wins; if clear didn’t exist, chaff wins; if giants/titans didn’t exist, mid units stall forever; if air didn’t exist, ground splash is mandatory.

---

## Techs (how units change function)

Units are not fixed roles. Each unit has a tech tree; buying a tech often **flips or splits** what the unit is for. That multiplies the counter web without adding 30 more base units.

Rules of thumb:

- Most units can take a few techs (cost rises when you already bought others).
- Techs are permanent for that unit type once researched.
- Some techs trade off hard (more splash but less ATK; more DPS but less range; AA but lose ground targeting, etc.).
- EMP / Electromagnetic Shot exists partly to **turn off** these role flips mid-fight.

### Tech categories that change roles

| Tech type | What it does to the unit | Examples |
|-----------|--------------------------|----------|
| **Shield / Barrier** | Chaff or glass → durable stall / team tank | Fang Portable Shield; Fortress / Typhoon Barrier |
| **Range Enhancement** | Backline / poke; often “carry” shift | Fang, Marksman, Phoenix, Melting Point |
| **Splash / HE / Grenade** | Single-target DPS → chaff-clear | Mustang High-Explosive; Fang Grenade Launcher; Overlord HE |
| **Armor / Absorption** | Squishy → frontline | Armor Enhancement, Energy Absorption (Steel Ball, Melting Point) |
| **Anti-air unlock** | Ground-only → can contest air | Arclight Anti-Aircraft Ammo; Fortress Anti-Air Barrage |
| **Aerial / Ground specialization** | Generalist → matchup specialist | Wasp / Marksman Aerial Spec; Wasp Ground Spec |
| **Jump Drive** | Static army piece → flank / redeploy threat | Phoenix, Wasp, Overlord |
| **Production / summon** | Pure DPS → self-sufficient army | Fortress Fang Production; Melting Point Crawler Production; Overlord Mothership; War Factory Phoenix/Ball/Sledge production |
| **Missile Interceptor** | DPS unit → answer to Stormcaller / AA barrage | Mustang, War Factory |
| **Mode swap** | Literally changes identity | Marksman Assault Mode; Void Eye Aerial Mode |
| **Utility / disrupt** | Damage piece → soft counter tool | EMP Shot; Hound Fire Extinguisher; Vortex Mobile Power Station (buff aura) |
| **Suicide / on-death** | Alive threat → death threat | Crawler Acidic Explosion; Rhino Final Blitz |

### Standout role flips (by unit)

#### Chaff

| Unit | Baseline | Tech that changes it |
|------|----------|----------------------|
| **Crawler** | Melee meat | **Loose Formation** — better vs small-splash clear; **Subterranean Blitz** — tankier approach; **Acidic Explosion** — anti-giant on death; **Replicate** — snowball swarm; **Impact Drill** — actually kill stuff |
| **Fang** | Slow ranged chaff | **Portable Shield** — premium late chaff; **Range + AP/Ignite** — chaff → carry DPS; **Grenade Launcher** — splash clear but **loses air targeting** |
| **Wasp** | Air chaff / harass | **Jump Drive** — flank every round; **Energy Shield / Range** — hard to delete; **Ground Spec** — terrifying ground DPS; **Aerial Spec** — wins air mirrors; **High-Explosive** — chaff-clear Wasps |
| **Hound** | Cheap clear + bodies | **Fire Extinguisher** — cleans acid/fire/smoke (unique utility); **Chamber Compression / Mechanical Rage** — clear → scaling carry |

#### Light / mid

| Unit | Baseline | Tech that changes it |
|------|----------|----------------------|
| **Arclight** | Cheap crawler clear | **Charged Shot + Elite Marksman** — clear → medium killer; **Anti-Aircraft Ammo** — gains AA; **EMP Shot** — tech-disabler |
| **Marksman** | Long-range sniper | **Assault Mode** — sniper → short-range splash brawler (huge identity flip); **Aerial Spec** — anti-air focus; **Shooting Squad** — brings own Fang escort |
| **Void Eye** | Cheap poke | **Aerial Mode** — becomes a flyer; **Suppression Shots** — shrinks enemy range (resets charges / hacks); **Charged Shot** — punches up |
| **Vortex** | Mid-range medium killer | **Mobile Power Station** — damage unit → aura buff totem; **Accumulator Shield** — periodic team shield; **Grid Integration** — pack DPS carry; **Emergency Armor** — temporary untargetable tank |
| **Mustang** | Fast all-rounder | **Missile Interceptor** — drops DPS role, becomes anti-Stormcaller tool; **HE Ammo** — clear focus; **Aerial Spec / AP** — AA or raw DPS |
| **Steel Ball** | Tank vs single big targets | **Energy Absorption** — lifesteal snowball; (other tank/DPS techs deepen the same role rather than flip it) |
| **Sledgehammer** | Early clear + frontline | Armor / damage techs push tank vs clearer; still mostly “medium frontliner” |
| **Stormcaller** | Artillery if unanswered | Range / payload techs amplify; role stays “punish slow boards” — answered by intercept, not by Stormcaller becoming something else |
| **Rhino** | Aggressive melee breakthrough | **Whirlwind** — better vs packs; **Final Blitz** — death nuke; **Power Armor** — slow immunity; **Combat Evolvement** — scales if it lives |
| **Hacker** | Steal / distract elites | Lives or dies on levels and board state; techs tune reliability more than invent a new job |
| **Scorpion** | Anti-medium / anti-shield | Stays specialist; techs sharpen that job |
| **Farseer** | Midgame safety / flexible mid | Support techs (shields, range aura vibes) — mid spike then falls off |
| **Tarantula / Typhoon / Fire Badger / Sabertooth** | Mid clear / mid tank flavors | Barrier (Typhoon), range, armor, spider mines, etc. — shift tank vs clear vs anti-air emphasis |

#### Giants / air giants / titans

| Unit | Baseline | Tech that changes it |
|------|----------|----------------------|
| **Fortress** | Ground giant gun | **Barrier** — team shield tank; **Anti-Air Barrage** — answers Wasps/Phoenix; **Fang Production** — self-chaff; **Launcher Overload / Doubleshot / Rocket Punch** — pure DPS platform; **Solid Shot** — longer range, less splash |
| **Melting Point** | Ramping anti-giant laser | **Energy Diffraction** — one beam → five weaker beams (giant sniper → medium clearer); **Crawler Production** — brings own chaff; **EMP Barrage** — strip shields / disable techs |
| **Vulcan** | Giant chaff delete | Incendiary / range / armor deepen clear or survive; still “delete small stuff” |
| **Sandworm** | Burrow melee giant | **Sandstorm** — protect allies (e.g. Wasps) from AA; **Replicate** — spawn Larvae; AA tech option on some patches |
| **Phoenix** | Air Marksman | **Jump Drive** — flank sniper; **Charged Shot / Overload** — burst DPS at range cost; **Energy Shield / Quantum Reassembly** — survive spells; **EMP Shot** — tech strip |
| **Phantom Ray** | Air frontline | **Armor** tech — bricks Mustangs / rapid fire; oil/fire synergies |
| **Wraith** | Multi-target air clear | Items/levels amplify; stays “unblockable multi-hit clear” |
| **Overlord** | Air giant missile boat | **Mothership** — produces Wasps; **Jump Drive** — redeploy army pressure; **Overlord Artillery** — extra ground guns; **Photon Emission** — team damage reduction + status immunity; **HE** — more splash, less single-target |
| **Raiden** | Flying medium-delete (air Scorpion) | Levels/items push “eventually kills everything”; stays specialist early |
| **War Factory** | Titan gun platform | **Production techs** — Phoenix / Steel Ball / Sledgehammer factories (identity = army printer); **Missile Interceptor** — best late anti-missile; **HE** — clearer; Armor / Photon — frontline titan |
| **Abyss / Mountain / Death Knell** | Late win conditions | Barrier / multi-beam / production-style techs (Death Knell ≈ Melting Point toolkit + Steel Ball production + huge barrier) |

### Design takeaway for MELODAN

Techs are the second layer of RPS:

1. **Base unit** answers a role hole (chaff / clear / DPS / air / giant…).
2. **Tech** lets that unit pivot into a neighboring role — or invent a utility answer (intercept, EMP, cleanse, summon).

So balance isn’t only “unit A beats unit B.” It’s “unit A **with tech X** beats B, but B **with tech Y** flips it again.” That depth is why the roster can stay ~30 units instead of 100.

---

## MELODAN counterparts (fantasy mapping)

Goal: same **roles** and **tech pivots** as Mechabellum, not 1:1 renames. Melodan’s tone is dark-medieval / forest fantasy (dwarves, crows, ballistae, conversion magic, black brood) — keep that, avoid generic “elf = phoenix, orc = rhino” unless it fits.

### What you already have (and the Mechabellum job it covers)

| Melodan | Closest Mechabellum job | Verdict |
|---------|-------------------------|---------|
| **Dwarf** (100, pack melee) | **Crawler** — chaff meat | Mechanically right. Theme is a bit odd (fantasy dwarves usually = tanks). Fine if you lean into “axe throng / deepkin rush,” or rename later. |
| **Archer** (100, long range, air+ground) | **Marksman** | Excellent. Keep. Tech pivots: Longbow = Range Enhancement; Piercing = AP; Fire Arrows ≈ Ignite. Missing: an **Assault Mode** analogue (close-range volley / sword-bow). |
| **Crow Rider** (200, air flock + splash) | Mix of **Wasp** + **Wraith** / light **Mustang** | Strong air piece, but it currently does *two* jobs (air chaff *and* splash clear). Later, split or tech-specialize so one tech path is “harass chaff” and another is “AoE clear.” |
| **Ballista** (400, min-range siege splash) | **Stormcaller** | Excellent. Dead zone + long splash artillery. Pitch Bolts / fire pairing is a Melodan-native twist. |
| **Wizard** (400, convert ray) | **Hacker** (steal) + a bit of **Melting Point** range | Better than a copy — conversion is a fantasy-perfect Hack. Don’t also make it the anti-giant laser; leave that for a dedicated giant. |
| **Ward Stone** | Fortress/Typhoon **Barrier** as a placeable | Good support piece; not a full unit role. |
| **Fire Bolt** | Sentry missile / nuke reinforcement | Good special, not a roster unit. |
| **Horde** (Brood, Spider, Farmer, Komtur) | Enemy-only chaff / produce / boss flavors | Keep separate from the player shop roster. |

### Gaps to fill (priority order)

Fill roles in this order so the RPS triangle actually works:

1. **Chaff-clear** (Arclight / Tarantula job) — without this, Dwarf floods win forever  
2. **Second chaff flavor** (Fang job) — so clear has more than one answer  
3. **Medium frontline** (Sledge / Steel Ball / Rhino) — midgame glue  
4. **Anti-giant** (Melting Point job) — Ballista/Wizard aren’t this  
5. **Versatile giant / AA giant** (Fortress / Overlord)  
6. **Fast AA all-rounder** (Mustang) — if Crow stays splash-clear, something else must be clean AA  
7. **Production titan** (War Factory) — late escalator  

### Proposed fantasy roster (working names)

Prefer Melodan-flavored names over Mechabellum clones. Alternatives in italics.

#### Core triangle (ship / polish first)

| Role | Proposal | Why | Tech pivots (Melodan-style) |
|------|----------|-----|------------------------------|
| Melee chaff | **Dwarf** *(or rename: Axethrong, Deepkin)* | Already shipped; packs stall snipers | Fleet Feet; Stone Hide; later: Loose Rank, Tunnel, Acid Blood, Replicate throng |
| Ranged sniper | **Archer** | Already shipped | Longbow; Piercing; Fire Arrows; later: **Close Quarters** (Assault Mode), Skyward Tips (Aerial Spec) |
| Splash clear (cheap) | **Alchemist** / *Pitch-witch* / *Censer Priest* | Fantasy Arclight — short-range vial splash deletes dwarf packs | Wider Burst; Sticky Pitch; later: **Sky Bind** vials (AA), Charged Flask (anti-medium) |
| Ranged chaff | **Spearmen** / *Levy* / *Crossbow pack* | Fantasy Fang — slow bodies, optional shields, can contest air with reach | **Aegis** (Portable Shield); Longer Pikes (range→carry); Firebrand tips; later: Grenade/oil jars (lose air) |

#### Air + mid glue

| Role | Proposal | Why | Tech pivots |
|------|----------|-----|-------------|
| Air harass / air chaff | Keep **Crow Rider** as the air swarm; *or* add **Bat Swarm** / *Harpy flock* if Crow becomes clearer | Forces AA investment | Gale Wings (Jump-ish); Aegis; Crow Talons; Ground Spec vs Aerial Spec |
| Fast AA / all-rounder | **Outriders** / *Wolf Cavalry* / *Mounted Scouts* | Fantasy Mustang — speed, chip, optional AA focus | Intercept Charms (missile intercept); Broadheads (HE/splash clear); Skyhunt (Aerial Spec) |
| Medium clear frontline | **Shieldbreakers** / *Men-at-Arms* / *Hammerers* | Fantasy Sledgehammer | Armor; Cleaving Strikes; Field Repair |
| Big-target tank | **Ogre** / *Troll* / *Iron Boar* | Fantasy Steel Ball — loves single elites, hates swarms | Lifeleech / Bloodfeast (Energy Absorption); Armor |
| Breakthrough melee | **Boar Knights** / *Berserkers* / *Ram Cavalry* | Fantasy Rhino — crash the line, soak aggro | Whirlwind cleave; Death Blow (Final Blitz); Unstoppable (slow immune) |

#### Specialists

| Role | Proposal | Why | Tech pivots |
|------|----------|-----|-------------|
| Steal / disrupt | **Wizard** (keep) | Convert = better fantasy Hacker | Sky Bind; Sky Lift; later: faster convert, AoE convert, anti-tech hex |
| Anti-medium / anti-shield | **Basilisk** / *Hexbow* / *Witch* | Fantasy Scorpion — melts mid HP + wards | Venom ramp; Wardshatter |
| Artillery | **Ballista** (keep) | Stormcaller job already | Pitch Bolts; Quick Winch; Golden Aura; Sky Bind |
| Midgame flexible answer | **Ranger Captain** / *Oracle* / *Banner-Seer* | Fantasy Farseer — short power spike, cheese insurance | Detection; Ally range aura; Anti-air volley |

#### Giants / titans (later)

| Role | Proposal | Why | Tech pivots |
|------|----------|-----|-------------|
| Anti-giant laser | **Sun Priest** / *Focus Crystal* / *Beholder Idol* | Fantasy Melting Point — ramps on one target | Diffraction (multi-ray vs mediums); Summon Levy (Crawler Production); EMP Hex |
| Versatile giant | **Walking Keep** / *Siege Golem* / *Treant Hold* | Fantasy Fortress | Ward Dome (Barrier); Flak Bolts (AA Barrage); Levy Production; Rocket Fists |
| Giant chaff delete | **Fire Drake** / *Hellmouth* / *War Chimera* | Fantasy Vulcan | Napalm trail; Wider Breath |
| Air giant | **Roc** / *Sky Tyrant* / *Bone Dragon* | Fantasy Overlord | Nest (spawn crows); Redeploy; Photon/Golden Emission |
| Production titan | **Necropolis Cart** / *Forge Titan* / *Dark Cathedral* | Fantasy War Factory | Produce Ogres / Hammerers / Crows; Missile Ward |

### On “Dwarf = Crawler, Archer = Marksman”

- **Archer → Marksman**: keep. Best mapping you have.  
- **Dwarf → Crawler**: keep *mechanically*. If the fantasy read feels wrong, options are:  
  1. Keep the name, sell the fantasy as “deepkin axe throng” (fast short melee, not fortress dwarves), or  
  2. Rename the unit later (**Axethrong / Goblin Mob / Wildlings**) and reuse the dwarf mesh as a **medium tank** (Sledge/Steel Ball job) instead — that matches classic dwarf fantasy better.

Recommendation: **don’t rename yet.** Ship the missing **splash clear** (Alchemist) and **second chaff** (Spearmen) first — those two unlock the whole triangle. Then decide whether Dwarf stays the swarm or becomes the mid tank.

### Minimal “triangle complete” set

If you only add a few units next:

1. **Alchemist** (100–200) — chaff-clear  
2. **Spearmen** (100) — ranged/slow chaff with Aegis path  
3. **Outriders** (200) — Mustang (speed + AA)  
4. **Ogre** or **Boar Knights** (200–300) — mid tank / breakthrough  

Existing **Archer / Dwarf / Crow / Ballista / Wizard** already cover sniper, melee chaff, air, artillery, and steal. That five + the four above is a playable Melodan RPS board without cloning the full Mechabellum roster.

---

## MELODAN fantasy roster brainstorm

Huge name pool only — **no Mechabellum role mapping**. Grouped the same way Mechabellum splits its list (size / mobility). Mix of shipped units and ideas. Pick, rename, merge later.

### Ground (standard)

- Dwarf *(shipped)*
- Archer *(shipped)*
- Wizard *(shipped)*
- Ballista *(shipped)*
- Spearman / Pike Levy
- Crossbowman
- Slinger
- Skirmisher
- Militia
- Peasant Mob
- Axethrong
- Berserker
- Shieldbearer
- Man-at-Arms
- Hammerer
- Halberdier
- Outrider
- Wolf Rider
- Boar Knight
- Horse Archer
- Scout
- Ranger
- Longbow Captain
- Alchemist
- Pitch-Witch
- Censer Priest
- Herbalist
- Bombardier (hand mortar)
- Sapper
- Tunnel Rat
- Goblin Mob
- Hobgoblin Brute
- Orc Raider
- Ogre (single / pair)
- Troll
- Ettin
- Stone Golem (small)
- Clay Automaton
- Iron Boar
- War Hound pack
- Dire Wolf pack
- Bear Warrior
- Cataphract
- Knight
- Black Knight
- Paladin
- Templar
- Hedge Mage
- Hexbow Witch
- Necromancer Acolyte
- Cultist
- Flagellant
- Monk
- Banner-Seer
- Oracle
- Druid
- Treant Sapling
- Dryad
- Vinebound
- Basilisk
- Cockatrice
- Giant Spider (ridable / pack)
- Webweaver (player version)
- Myrmidon
- Centaur
- Minotaur
- Satyr
- Harpy (grounded / short hop — if not air)
- Lizardman
- Naga Skirmisher
- Frost Giantkin (medium)
- Fire Imp (ground swarm)
- Plague Bearer
- Bone Levy / Skeleton Host
- Wight
- Ghoul pack
- Grave Knight
- Executioner
- Torturer
- Ballista Crew (lighter than full siege)
- Mangonel
- Onager
- Catapult
- Trebuchet (smaller field piece)
- Ram Cart
- Tower Shield Wall
- Pavise Crossbow
- Javelineer
- Netter
- Bola Thrower
- Whipmaster
- Falconer (ground handler)
- Beastmaster
- Chariot
- War Wagon
- Supply Cart (combat utility)
- Siege Engineer
- Runesmith
- Forge Guard
- Deepkin Slayer
- Mole Rider
- Cave Bat Handler
- Poisoner
- Assassin
- Duelist
- Gladiator
- Pit Fighter
- Corsair
- River Raider
- Marsh Warden
- Bog Lurker
- Swamp Hag
- Toadkin
- Mushroom Folk
- Spore Thrower
- Thornshooter
- Rootbinder
- Earthshaker (medium)
- Geomancer
- Cryomancer
- Pyromancer
- Stormcaller (mage — name free to use in fantasy)
- Lightning Rod Mage
- Mirror Mage
- Illusionist
- Puppeteer
- Golemancer
- Summoner
- Blood Mage
- Soulbinder
- Convert Initiate (lesser wizard)
- Inquisitor
- Witch Hunter
- Exorcist
- Relic Bearer
- Standard Bearer
- Drummer / War Chanter
- Hornblower
- Quartermaster
- Field Surgeon (combat support)
- Apothecary
- Oil Thrower
- Fire Pot Thrower
- Acid Flaskier
- Smoke Brewer
- Wardsmith
- Aegis Monk
- Chain Flailer
- Morningstar Knight
- Zweihander
- Greatbow
- Arbalest
- Repeating Crossbow
- Handgonne / Early Gunner
- Rocket Archer
- Firelance Troop
- Pike Square
- Schiltron
- Hedgehog Formation unit
- Lancer
- Demilancer
- Hussar (fantasy)
- Winged Hussar (fantasy)
- Camel Rider
- Elephant Guard (medium, not titan)
- Rhino Cavalry
- Elk Rider
- Stag Knight
- Unicorn Rider
- Nightmare Rider
- Death Coach (medium)
- Bone Wagon
- Coffin Bearer
- Plague Cart
- Rat Swarm Keeper
- Crow Keeper (ground)
- Raven Priest
- Owl Scout
- Foxkin
- Badgerkin
- Hedgehogkin
- Beaver Sapper
- Owlbear
- Displacer Beast (fantasy mid)
- Manticore Cub
- Chimera Spawn
- Hydra Hatchling
- Drake Hatchling (ground)
- Wyrmling
- Serpent
- Constrictor Pack
- Crocodile Pack
- Sharkkin (if map allows)
- Merrow Raider
- Kelpie Rider
- Selkie Skirmisher
- Drowned Dead
- Revenant
- Spectre (ground-bound)
- Banshee (ground scream)
- Poltergeist Swarm
- Animated Armor
- Living Statue
- Gargoyle (perched / ground)
- Clockwork Soldier
- Steam Knight
- Gear Hound
- Copper Automaton
- Brass Legionnaire
- Crystal Guardian
- Obsidian Blade
- Amber Bound
- Salt Golem
- Sand Warrior
- Desert Nomad
- Dune Archer
- Mirage Walker
- Oasis Mage
- Mountain Clan
- Avalanche Thrower
- Ice Spearman
- Snow Stalker
- Yeti (medium)
- Frost Witch
- Blizzard Chanter
- Ash Nomad
- Ember Knight
- Magma Slinger
- Cinder Imp
- Smoke Elemental (small)
- Dust Devil Bound
- Wind Monk
- Leafblade
- Spore Druid
- Blight Druid
- Rot Priest
- Carrion Guard
- Bone Archer
- Skull Catapult (crew)
- Tomb Guard
- Mummy Warrior
- Scarab Swarm
- Jackal Guard
- Sphinx Cub
- Anubite
- Canopic Construct
- Papyrus Mage
- Desert Lich Acolyte

### Ground giants

- Walking Keep
- Siege Golem
- Iron Colossus
- Stone Colossus
- Clay Colossus
- Obsidian Titan (ground)
- Treant Elder
- Ancient Oak
- Worldroot Avatar
- Mountain Giant
- Frost Giant
- Fire Giant
- Storm Giant
- Hill Giant
- Cyclops
- Ettin Lord
- Two-Headed Giant
- Ogre King
- Troll Chieftain
- War Mammoth
- War Elephant
- Armored Bear Titan
- Dire Boar Behemoth
- Rhinoceros Behemoth
- Basilisk Elder
- Cockatrice Matriarch
- Hydra
- Behir
- Purple Worm
- Sandworm (fantasy)
- Cave Worm
- Land Drake
- Fire Drake (grounded)
- Wyvern (grounded perch form)
- Manticore
- Chimera
- Sphinx
- Lamassu
- Naga Queen
- Serpent Titan
- Kraken-on-Land (beached / river)
- Leviathan Spawn (ground crawl)
- Bone Colossus
- Flesh Golem
- Patchwork Horror
- Abomination
- Death Knight on Foot
- Wight King
- Lich Throne (mobile)
- Necropolis Gate (walking)
- Moving Barrow
- Siege Tower
- Rolling Fortress
- Tower on Wheels
- Battering Ram Giant
- Living Catapult
- Trebuchet Titan
- Cannon Golem
- Forge Avatar
- Anvil Spirit
- Runestone Walker
- Menhir Giant
- Dolmen Guardian
- Crystal Behemoth
- Amber Colossus
- Salt Leviathan (ground)
- Magma Elemental
- Earth Elemental Lord
- Mud Elemental
- Quicksand Horror
- Avalanche Elemental
- Glacier Walker
- Volcano Heart
- Sun Idol (walking)
- Moon Idol
- Focus Crystal Giant
- Beholder Idol
- Eye Tyrant (ground stalk)
- Mirror Colossus
- Clockwork Castle
- Steam Behemoth
- Gear Titan
- Brass Juggernaut
- Copper Leviathan
- Scrap Golem
- Plague Titan
- Blight Treant
- Rot Behemoth
- Spore Giant
- Mushroom Colossus
- Vine Leviathan
- Thorn Fortress
- Hedge Maze Walker
- Labyrinth Guardian
- Minotaur Lord
- Labrys Giant
- Centaur Khan
- Owlbear Elder
- Roc Nest on Legs (weird)
- Dragon Turtle
- Tortoise Fort
- Armadillo Titan
- Pangolin Colossus
- Scorpion Emperor
- Spider Matriarch
- Antlion Queen
- Beetle Behemoth
- Centipede Titan
- Mosquito Hive Walker
- Wasp Nest Colossus (ground)
- Locust Avatar
- Scarab Pyramid Walker
- Jackal Colossus
- Anubis Avatar
- Canopic Giant
- Mummy Pharaoh
- Tomb Colossus
- Pyramid Walker
- Obelisk Titan
- Ziggurat on Legs
- Cathedral Walker
- Chapel Golem
- Reliquary Giant
- Bell Tower Walker
- Inquisitor Engine
- Pyre Giant
- Censer Colossus
- Golden Idol
- Jade Colossus
- Ivory Behemoth
- Bone Cathedral
- Blood Golem
- Soulforge Walker
- Nightmare Engine
- Dream Eater (ground)
- Silent Hill Giant (fog)
- Mist Colossus
- Bog Behemoth
- Swamp Leviathan
- Marsh Hydra
- Kelpie Lord (shore)
- River Serpent Elder
- Bridge Troll King
- Dam Breaker
- Flood Elemental
- Drought Idol
- Harvest Golem
- Scarecrow Colossus
- Pumpkin Horror
- Corn Maze Titan
- Wicker Man
- Effigy Giant
- Straw Colossus
- Ash Walker
- Cinder Behemoth
- Ember Colossus
- Coal Golem
- Slag Titan
- Furnace Heart
- Smelter Avatar
- Foundry Walker
- Mine Cart Leviathan
- Ore Elemental
- Gemstone Giant
- Diamond Golem
- Ruby Colossus
- Sapphire Guardian
- Emerald Treant
- Amethyst Horror

### Air

- Crow Rider *(shipped)*
- Bat Swarm
- Giant Bat
- Vampire Bat Pack
- Harpy Flock
- Harpy Matron
- Siren
- Storm Harpy
- Falconer Flight
- War Hawk
- Eagle Rider
- Owl Rider
- Raven Priest Flight
- Magpie Thief Swarm
- Pixie Swarm
- Sprite Cloud
- Will-o’-Wisp Host
- Firefly Swarm (combat)
- Mosquito Cloud
- Locust Swarm
- Wasp Swarm
- Hornet Knights
- Dragonfly Cavalry
- Moth Cult
- Butterfly Illusion Host
- Fairy Knight
- Sylph
- Zephyr Monk
- Wind Elemental (small)
- Dust Devil Rider
- Cloud Imp
- Smoke Wraith
- Ash Spirit
- Ember Sprite
- Cinder Hawk
- Phoenix Chick
- Phoenix (medium)
- Firebird
- Thunderbird
- Roc Juvenile
- Griffin
- Hippogriff
- Pegasi Knight
- Winged Unicorn
- Winged Hussar (air)
- Angel Acolyte
- Seraph Initiate
- Valkyrie
- Fallen Angel
- Imp Flight
- Gargoyle Flight
- Living Gargoyle
- Stone Wing
- Clockwork Hawk
- Brass Owl
- Copper Drakelet
- Gear Bat
- Steam Glider
- Hot-Air War Balloon
- Sky Skiff
- Glider Corps
- Hang-Glider Raiders
- Carpet Rider
- Broomstick Coven
- Witch Flight
- Hex Kite
- Paper Crane Swarm (enchanted)
- Origami Hawk
- Kite Warrior
- Banner Flight
- Flag Spirit
- Prayer Scroll Swarm
- Relic Dove
- Bone Crow
- Skeletal Gryphon
- Undead Bat
- Ghost Falcon
- Spectral Rider
- Wraith Flight
- Banshee Choir (air)
- Poltergeist Cloud
- Soul Mote Swarm
- Death Moth
- Plague Fly Cloud
- Carrion Bird Pack
- Vulture Knight
- Condor Rider
- Albatross Scout
- Storm Petrel
- Lightning Tern
- Ice Tern
- Frost Owl
- Snowy Owl Rider
- Blizzard Spirit
- Hail Sprite
- Rain Elemental (small)
- Fog Bank Bound
- Mist Wraith
- Mirage Hawk
- Sand Falcon
- Desert Djinn (lesser)
- Whirlwind Bound
- Leafwing
- Seed Glider
- Spore Cloud
- Pollen Swarm
- Thornwing
- Vine Bat
- Floral Sprite
- Blossom Hawk
- Rot Wing
- Blight Moth
- Fungal Bat
- Mushroom Floater
- Balloon Toad
- Sky Toad
- Flying Fish School (enchanted)
- Ray Rider
- Sky Ray
- Mantafolk
- Wyvern Scout
- Drake Scout
- Wyrmling Flight
- Pseudodragon
- Faerie Dragon
- Pseudowyrm
- Amphitere
- Couatl (lesser)
- Quetzalcoatl Cub
- Feathered Serpent
- Sky Serpent
- Cloud Serpent
- Lightning Snake
- Air Naga
- Flying Naga
- Sky Lamia
- Manticore Flight
- Chimera Wing
- Sphinx (air)
- Lamassu Flight
- Shedu
- Kirin
- Qilin
- Fenghuang
- Hou-ou
- Tengu
- Karasu Tengu
- Garuda Scout
- Apsara
- Peri
- Djinn Scout
- Ifrit Cub
- Marid Scout
- Houri Guard
- Starling Swarm
- Sparrow Cloud
- Pigeon Post Corps (combat)
- Messenger Dove Swarm
- Homing Hawk
- Scout Kite
- Spyglass Balloon
- Observation Basket
- Sky Lantern Swarm
- Festival Lantern Host
- Prayer Lantern
- Candle Sprite
- Lamp Genie (small)
- Bottle Imp Flight
- Mirror Shard Swarm
- Glass Bird
- Crystal Hawk
- Prism Wing
- Rainbow Serpent Cub
- Aurora Spirit
- Northern Light Bound
- Comet Sprite
- Meteor Mote
- Starling of Stars
- Constellation Bound
- Zodiac Hawk
- Moonbat
- Lunar Moth
- Eclipse Crow
- Shadow Wing
- Nightgaunt
- Dream Bat
- Nightmare Steed (air)
- Sleep Spores (air)
- Hypnos Moth
- Siren Bat
- Charm Harpy
- Lure Wisp
- Beacon Firefly
- Signal Hawk
- Flare Imp
- Tracer Bat
- Marking Crow
- Hunter Owl
- Stalking Raven
- Ambush Harpy
- Dive Bomber Gull
- Stone Dropper Crow
- Oil Dropper Bat
- Fire Pot Dropper
- Bombardier Beetle (air)
- Sky Sapper
- Aerial Alchemist
- Potion Dropper
- Acid Rain Imp
- Pitch Dropper
- Glue Nest Swarm
- Web Dropper Spider (ballooning)
- Ballooning Spider Host
- Silk Glider
- Cocoon Bomber
- Chrysalis Drop
- Hatchling Rain
- Egg Dropper Roc
- Nest Keeper Flight
- Brood Crow
- Murder of Crows (named pack)
- Unkindness of Ravens
- Parliament of Owls
- Exaltation of Larks (combat)
- Charm of Finches
- Host of Sparrows
- Cloud of Starlings
- Plague of Locusts
- Scourge of Midges
- Blessing of Doves
- Fury of Harpies
- Legion of Imps
- Choir of Angels (small)
- Flight of Valkyries (small)
- Pack of Griffins (juvenile)
- Pride of Manticores (young)
- Knot of Wyverns (scout)
- Clutch of Drakelets
- Swarm of Pseudodragons
- Raft of Sky Rays
- School of Cloud Fish
- Drift of Balloon Toads
- Flicker of Wisps
- Ghost of Kites
- Fleet of Skiffs
- Armada of Balloons (small)
- Parade of Carpets
- Coven of Brooms
- Circle of Witches (air)
- Cabal of Hexers (air)
- Order of Falconers
- Guild of Gliders
- Company of Winged Scouts
- Brotherhood of Gargoyles
- Sisterhood of Sirens
- Conclave of Tengu
- Court of Fairies
- Wild Hunt Riders (air)
- Night Ride Host
- Wild Hunt Hounds (sky)
- Spectral Hunt
- Ghost Cavalry (air)
- Phantom Lancer
- Sky Knight
- Cloud Knight
- Storm Knight
- Lightning Lancer
- Thunder Rider
- Gale Rider
- Zephyr Knight
- Tempest Scout
- Squall Wing
- Hurricane Imp
- Tornado Bound (small)
- Cyclone Sprite
- Maelstrom Mote
- Vortex Bat
- Spiral Hawk
- Helix Serpent
- Corkscrew Drake
- Dive Wyvern
- Plunge Griffin
- Stoop Falcon
- Hover Owl
- Stall Bat
- Glide Albatross
- Soar Condor
- Thermal Rider
- Updraft Monk
- Downdraft Imp
- Crosswind Scout
- Headwind Knight
- Tailwind Messenger

### Air giants

- Roc
- Elder Roc
- Sky Tyrant
- Bone Dragon
- Frost Dragon
- Fire Dragon
- Storm Dragon
- Shadow Dragon
- Undead Dragon
- Wyrm Lord
- Elder Wyvern
- Dragon King
- Phoenix Elder
- Immortal Firebird
- Thunderbird Avatar
- Griffin Lord
- Hippogriff King
- Pegasi Archon
- Angel Lord
- Archangel
- Seraph
- Fallen Archangel
- Demon Prince (winged)
- Pit Lord (air)
- Balor
- Ifrit Lord
- Djinn King
- Marid Sultan
- Cloud Giant (flying)
- Storm Giant (airborne)
- Tempest Avatar
- Hurricane Elemental
- Tornado Colossus
- Living Storm
- Thunder Head
- Lightning Titan (air)
- Sky Leviathan
- Cloud Whale
- Sky Kraken
- Aerial Behemoth
- Flying Fortress
- Sky Keep
- Floating Cathedral
- Airship Titan
- Dreadnought Balloon
- Zeppelin Colossus
- Sky Barge
- Arcane Skyship
- Rune Airship
- Bone Airship
- Ghost Galleon (air)
- Flying Dutchman (sky)
- Spectral Carrack
- Sky Pyramid
- Floating Ziggurat
- Hovering Obelisk
- Orbiting Menhir
- Flying Stone Circle
- Sky Henge
- Celestial Chariot
- Sun Chariot
- Moon Barge
- Star Carriage
- Comet Throne
- Meteor Throne
- Eclipse Engine
- Void Moth
- Dream Leviathan (air)
- Nightmare Dragon
- Sleep Titan
- Hypnos Colossus
- Siren Queen
- Harpy Empress
- Tengu Daimyo
- Garuda Avatar
- Quetzalcoatl
- Feathered Serpent God
- Couatl Elder
- Rainbow Serpent
- Sky Serpent Elder
- Naga Sky Queen
- Lamia Empress (winged)
- Sphinx Elder (air)
- Lamassu Lord
- Kirin Avatar
- Fenghuang Empress
- Manticore King
- Chimera Elder (winged)
- Hydra of the Skies
- Multiheaded Roc
- Three-Winged Horror
- Clockwork Dragon
- Brass Dragon Construct
- Steam Dragon
- Gear Roc
- Iron Eagle Titan
- Copper Skyship
- Crystal Dragon
- Prism Colossus (air)
- Mirror Dragon
- Glass Leviathan
- Obsidian Wing
- Amber Roc
- Jade Dragon
- Ruby Phoenix
- Sapphire Storm
- Emerald Sylph Lord
- Amethyst Voidwing
- Bone Roc
- Flesh Roc
- Patchwork Dragon
- Abomination Wing
- Plague Dragon
- Blight Roc
- Spore Leviathan (air)
- Fungal Sky Whale
- Rot Phoenix
- Carrion Dragon
- Vulture Titan
- Condor God
- Albatross Colossus
- Owl Titan
- Crow God
- Murder Avatar
- Raven King
- Magpie Titan
- Starling Apocalypse
- Locust God
- Wasp Queen Titan
- Hornet Colossus
- Mosquito Plague Avatar
- Firefly Constellation
- Wisp King
- Will-o’-Wisp Titan
- Fairy Court Avatar
- Wild Hunt Lord
- Night King (air)
- Spectral Dragon
- Ghost Roc
- Phantom Airship
- Soul Leviathan
- Death Moth Titan
- Reaper Wings
- Scythe Angel
- Judgment Seraph
- Inquisitor Skyship
- Pyre Dragon
- Censer Angel
- Bell Tower Floater
- Cathedral of the Air
- Reliquary Skyship
- Golden Idol (flying)
- Sun Idol (air)
- Moon Idol (air)
- Focus Crystal (orbiting)
- Beholder Orbit
- Eye Tyrant (air)
- Orbital Menace
- Sky Eye
- Watcher Above
- All-Seeing Wing
- Omniscient Owl
- Oracle Roc
- Prophecy Dragon
- Fate Serpent
- Loom of the Sky
- Web of Stars
- Cosmic Spider (air)
- Celestial Centipede
- Zodiac Dragon
- Constellation Titan
- Aurora Leviathan
- Northern Light Dragon
- Southern Cross Wing
- Polar Roc
- Equatorial Storm
- Monsoon Avatar
- Typhoon King
- Cyclone God
- Maelstrom Wing
- Vortex Dragon
- Spiral Titan
- Helix Colossus
- Dive God
- Plunge Titan
- Stoop Colossus
- Hover Leviathan
- Stall God
- Glide Worldspirit
- Soar Avatar
- Thermal Titan
- Updraft God
- Downdraft Colossus
- Crosswind Leviathan
- Headwind Titan
- Tailwind God

### Titans

- Necropolis Cart
- Forge Titan
- Dark Cathedral
- Walking Cathedral
- Mobile Fortress City
- War Factory (fantasy forge)
- Barracks Leviathan
- Foundry on Legs
- Smelter Titan
- Anvil World
- Runeforge Avatar
- Soulforge Titan
- Bone Factory
- Fleshworks
- Patchwork Works
- Abomination Mill
- Plague Works
- Blight Factory
- Spore Foundry
- Mushroom Manufactory
- Vine Nursery Titan
- Thorn Factory
- Treant Nursery
- Rootworks
- Worldtree Engine
- Seed Vault Titan
- Harvest Engine
- Scarecrow Works
- Wicker Factory
- Effigy Mill
- Straw Works
- Ash Foundry
- Cinder Works
- Ember Mill
- Coal Titan Factory
- Slag Works
- Magma Foundry
- Volcano Engine
- Earthquake Works
- Glacier Factory
- Avalanche Engine
- Flood Works
- Drought Engine
- Storm Foundry
- Lightning Mill
- Thunder Works
- Cloud Factory
- Sky Dock Titan
- Airship Yard
- Balloon Works
- Carpet Loom Titan
- Broom Manufactory
- Witch Factory
- Hex Works
- Curse Mill
- Blessing Foundry
- Relic Works
- Reliquary Titan
- Cathedral Engine
- Chapel Factory
- Bell Foundry
- Inquisitor Works
- Pyre Factory
- Censer Mill
- Golden Works
- Jade Factory
- Ivory Mill
- Crystal Foundry
- Prism Works
- Mirror Factory
- Glass Mill
- Obsidian Works
- Amber Factory
- Salt Works
- Sand Foundry
- Desert Engine
- Oasis Works
- Mirage Factory
- Clockwork City
- Steam Works
- Gear Titan Factory
- Brass Manufactory
- Copper Works
- Scrap Yard Titan
- Junk Factory
- Salvage Engine
- Necromancer Throne
- Lich Factory
- Tomb Works
- Pyramid Engine
- Ziggurat Factory
- Obelisk Works
- Menhir Mill
- Henge Engine
- Stone Circle Titan
- Dolmen Factory
- Barrow Works
- Crypt Engine
- Graveyard Titan
- Ossuary Factory
- Charnal Works
- Blood Mill
- Soul Press
- Spirit Distillery
- Dream Factory
- Nightmare Works
- Sleep Mill
- Hypnos Engine
- Fate Loom
- Destiny Forge
- Prophecy Works
- Oracle Engine
- Star Factory
- Constellation Mill
- Zodiac Works
- Cosmic Forge
- Void Foundry
- Abyss Engine
- Depths Works
- Kraken Dock
- Leviathan Yard
- Whale Works
- Turtle Fort Factory
- Shell Mill
- Scale Foundry
- Hide Works
- Bone Yard Titan
- Ivory Dock
- Horn Mill
- Antler Works
- Feather Factory
- Wing Mill
- Beak Foundry
- Talon Works
- Claw Factory
- Fang Mill
- Tusk Works
- Hoof Foundry
- Horned Engine
- Antlered Titan
- Crow Works
- Raven Factory
- Murder Mill
- Nest Titan
- Rookery Engine
- Aviary Factory
- Mechshed (fantasy stables)
- Stable Titan
- Kennel Works
- Hatchery Engine
- Brood Factory
- Swarm Mill
- Hive Titan
- Nestworks
- Web Factory
- Silk Mill
- Cocoon Works
- Chrysalis Engine
- Egg Factory
- Hatchery Titan
- Nursery Colossus
- Creche Engine
- Academy Works (combat school on legs)
- Barracks City
- Arsenal Titan
- Armory Engine
- Magazine Works
- Powder Mill
- Rocket Factory
- Fireworks Titan
- Pitch Works
- Oil Refinery Titan
- Acid Distillery
- Poison Works
- Venom Mill
- Antidote Factory
- Apothecary Titan
- Hospital Engine (dark)
- Field Surgery Works
- Surgeon Titan
- Torturer Mill
- Prison Engine
- Cage Factory
- Chain Works
- Shackle Mill
- Yoke Foundry
- Collar Factory
- Branding Works
- Slave Engine (dark faction)
- Liberation Works (light faction)
- Banner Factory
- Standard Mill
- Flag Works
- Drum Foundry
- Horn Mill
- Bell Titan
- Choir Engine
- Chant Works
- Hymn Factory
- Curse Choir Titan
- Blessing Choir Engine
- War Song Mill
- Silence Works
- Echo Factory
- Resonance Titan
- Harmonic Engine
- Discord Mill
- Melodan Engine *(meta joke — maybe not)*
- Nameforge Titan
- Word Mill
- Rune Press
- Glyph Factory
- Sigil Works
- Ward Engine
- Aegis Foundry
- Barrier Mill
- Shield Factory
- Dome Works
- Bubble Titan
- Sphere Engine
- Orb Factory
- Eye Works
- Watcher Mill
- Sentinel Titan
- Guardian Engine
- Warden Factory
- Jailer Works
- Gate Titan
- Door Engine
- Portal Factory
- Gatehouse Mill
- Drawbridge Works
- Moat Engine
- Wall Factory
- Curtain Titan
- Bastion Works
- Keep Engine
- Tower Mill
- Spire Factory
- Minaret Works
- Pagoda Titan
- Stupa Engine
- Temple Factory
- Shrine Works
- Altar Mill
- Sacrifice Engine
- Offering Factory
- Tribute Works
- Tax Titan
- Coin Mint Engine
- Gold Press
- Silver Mill
- Copper Works
- Iron Foundry Titan
- Steel Engine
- Adamant Factory
- Mithril Works
- Orichalcum Mill
- Star Metal Forge
- Meteorite Works
- Comet Foundry
- Void Metal Mill
- Dream Ore Engine
- Nightmare Ingot Works
- Soul Steel Factory
- Blood Iron Mill
- Bone Steel Works
- Ash Metal Foundry
- Cinder Alloy Engine
- Frost Steel Factory
- Storm Metal Works
- Lightning Forge
- Thunder Mill
- Whisper Works
- Silence Forge
- Echo Metal Factory
- Resonance Foundry
- Harmonic Steel Mill
- Discord Ore Engine
- Final Works
- End Engine
- Apocalypse Factory
- Judgment Mill
- Mercy Works
- Redemption Titan
- Damnation Engine
- Heavenly Factory
- Infernal Works
- Purgatory Mill
- Limbo Engine
- Afterlife Dock
- Reincarnation Works
- Resurrection Factory
- Undeath Mill
- True Death Engine

### Spawned / secondary

- Spider Mine analogue → **Spiderling**, **Hatchling**, **Web Trap**, **Cocoon Bomb**
- Larva analogue → **Broodling**, **Maggot**, **Grub**, **Nymph**, **Pupa**
- Production children → **Levy**, **Militia Spawn**, **Crow Nestling**, **Drake Hatch**, **Golem Shard**, **Bone Thrall**, **Spectre Mote**, **Imp Spark**, **Treant Shoot**, **Vine Whip**, **Spore Pod**, **Scarecrow Stick**, **Clockwork Bit**, **Gear Mite**, **Steam Wisp**, **Rune Spark**, **Ward Fragment**, **Shield Echo**, **Banner Scrap**, **Drum Beat** (utility), **Horn Call**, **Bell Tone**, **Prayer Slip**, **Curse Tag**, **Blessing Coin**, **Oil Puddle Walker**, **Fire Pot Imp**, **Acid Droplet**, **Poison Cloudlet**, **Smoke Puff**, **Dust Mote**, **Ash Child**, **Cinder Spark**, **Ice Shardling**, **Hail Bit**, **Fog Patch**, **Mist Child**, **Mirage Double**, **Illusion Clone**, **Puppet String**, **Familiar**, **Homunculus**, **Homunculus Scrap**, **Clay Bit**, **Stone Chip**, **Crystal Shard**, **Glass Splinter**, **Mirror Shard**, **Obsidian Flake**, **Amber Droplet**, **Salt Grain Bound**, **Sand Grain Swarm**, **Mudling**, **Rootling**, **Leafbit**, **Thorn Dart**, **Seedling**, **Sprout**, **Sapling Guard**, **Mushroom Cap**, **Spore Child**, **Fungal Mite**, **Rot Bit**, **Blight Speck**, **Carrion Mote**, **Bone Chip**, **Skull Bit**, **Rib Walker**, **Fingerling**, **Tooth Swarm**, **Nail Scrap**, **Hair Golem Bit**, **Flesh Scrap**, **Suture Bit**, **Patchwork Scrap**, **Abomination Bit**, **Plague Flea**, **Fever Mote**, **Cough Cloud**, **Wheeze Wisp**, **Death Rattle**, **Last Breath**, **Soul Spark**, **Ghost Embers**, **Memory Shard**, **Dream Mote**, **Nightmare Bit**, **Sleep Dust**, **Yawn Spirit**, **Snore Elemental** (joke), **Fate Thread**, **Destiny Knot**, **Prophecy Slip**, **Oracle Coin**, **Star Spark**, **Constellation Bit**, **Zodiac Chip**, **Cosmic Mote**, **Void Spark**, **Abyss Droplet**, **Depths Bubble**, **Kraken Ink Bit**, **Leviathan Scale**, **Whale Song**, **Turtle Hatch**, **Shell Bit**, **Scale Flake**, **Hide Scrap**, **Feather**, **Down Puff**, **Pinion**, **Talon Scrap**, **Claw Bit**, **Fang Chip**, **Tusk Tip**, **Hoof Spark**, **Horn Tip**, **Antler Bit**, **Crow Feather**, **Raven Quill**, **Owl Pellet Bound**, **Egg**, **Nest Bit**, **Twig Golem**, **Straw Bit**, **Wicker Scrap**, **Effigy Stick**, **Ash Child**, **Cinder Bit**, **Ember**, **Coal Bit**, **Slag Scrap**, **Magma Droplet**, **Lava Bit**, **Volcano Spark**, **Quake Pebble**, **Avalanche Stone**, **Flood Droplet**, **Drought Dust**, **Storm Spark**, **Lightning Bit**, **Thunder Echo**, **Cloud Puff**, **Balloon Bit**, **Carpet Fringe**, **Broom Straw**, **Witch Hat Bit**, **Hex Tag**, **Curse Knot**, **Blessing Ribbon**, **Relic Chip**, **Reliquary Bit**, **Cathedral Brick**, **Chapel Tile**, **Bell Clapper**, **Inquisitor Seal**, **Pyre Stick**, **Censer Coal**, **Gold Bit**, **Jade Chip**, **Ivory Scrap**, **Crystal Bit**, **Prism Shard**, **Mirror Bit**, **Glass Bit**, **Obsidian Bit**, **Amber Bit**, **Salt Bit**, **Sand Bit**, **Clockwork Cog**, **Steam Puff**, **Gear Tooth**, **Brass Screw**, **Copper Wire**, **Scrap Nut**, **Junk Bit**, **Salvage Rivet**

*(Existing Melodan extras that sit near this layer: Ward Stone, Fire Bolt — placeable support, not shop “units” in the same sense.)*
