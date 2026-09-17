# Mechabellum → Melodan tech gap overview

Source: [wiki.mbxmas.com](https://wiki.mbxmas.com/units/) unit tech pages (current patch values may drift; names/effects are what matter for design). Melodan side: `assets/data/talents/*.jsonc` + unit talent lists.

**Goal:** inventory every Mechabellum unit tech, map to Melodan talents/runes/innate systems, and show what is missing.

Melodan renames: code `tech` → player **Talent**; code `item` → player **Rune**.

---

## 1. Melodan talent inventory (what exists today)

| Melodan ID | Display name | Effect (summary) | Closest Mechabellum tech(s) |
|---|---|---|---|
| `barrel` | Longbow | +20 flat range | **Range Enhancement** |
| `ap` | Piercing Arrows | ×1.4 damage | **Armor-Piercing Bullets** |
| `fireArrows` | Fire Arrows | burn + ground fire on hit | **Ignite** (+ partial Incendiary) |
| `autoloader` | Quick Winch | ×0.7 attack interval | **Quick Reload** / **Launcher Overload** (speed half only) |
| `legs` | Fleet Feet | ×1.35 speed | part of **Mechanical Rage** (speed) |
| `engines` | Gale Wings | ×1.3 speed | part of **Jump Drive** / Mechanical Rage (speed) |
| `bloodRage` | Blood Rage | ×1.3 speed + ×0.75 interval | **Mechanical Rage** |
| `carapace` | Stone Hide | ×1.5 HP | soft **Armor Enhancement** (HP only) |
| `armor` | Iron Plating | ×1.5 HP | soft **Armor Enhancement** (HP only) |
| `aegis` | Aegis | personal shield = max HP | **Portable Shield** / **Energy Shield** |
| `stingers` | Crow Talons | ×1.4 damage | Armor-Piercing / raw ATK |
| `wideBlast` | Wide Blast | ×3 splash radius | **High-Explosive Ammo** |
| `pitchBolts` | Pitch Bolts | oil splash on impact | **Sticky Oil Bomb** |
| `skyBind` | Sky Bind | targets ground + air | **Anti-Aircraft Ammunition** (AA unlock) |
| `skyLift` | Sky Lift | become flyer | **Aerial Mode** (Void Eye) |
| `earthbound` | Earthbound | force ground | **Land Cruiser** (Wraith) inverse |
| `golden` | Golden Aura | ally DR + status resist aura | **Photon Emission** / **Photon Coating** (aura-ish) |
| `whirlwind` | Whirlwind | large cleave | **Whirlwind** (Rhino) |
| `spiderMother` | Mother of Spiders | produce spawn | **Crawler/Fang Production**, Replicate family |
| `darkHarvest` | Dark Harvest | on-kill raise spawn | soft **Wreckage Recycling** / Replicate |

**Catalog-only (defined, not on any unit pick list):** `wideBlast`, `earthbound`.

**Not talents but related systems:**
| Melodan system | Closest Mechabellum |
|---|---|
| Ward Stone dome (`shield` unit) | **Barrier** (placeable) |
| Fire Bolt rocket | Vulcan/Phantom oil+fire payloads |
| Wizard convert ray | **Hacker** control (fantasy steal) |
| Rune `bulwark` | Energy Shield-ish |
| Rune `golden` (Sunstone) | Photon / debuff immune |
| Building range/speed boosts | Farseer Scanning Radar (partial) |
| Innate splash / cleave / corrode | base weapons, not purchasable techs |

---

## 2. Unique Mechabellum tech taxonomy × Melodan coverage

Deduplicated by **mechanic**, not by every unit copy. Status:

- **Have** — shipped as talent/system with same job
- **Partial** — related effect exists but weaker / different shape / not purchasable tech
- **Missing** — no Melodan analogue yet

| Mechabellum tech / family | What it does | Melodan status | Melodan analogue |
|---|---|---|---|
| **Range Enhancement** | +40 range | **Have** | Longbow (`barrel`) — flatter/smaller |
| **Armor-Piercing Bullets** / HEAT / Scorching Fire | big ATK up (often +interval) | **Have** | Piercing Arrows / Crow Talons |
| **Mechanical Rage** | +speed + attack speed | **Have** | Blood Rage (+ Fleet Feet / Gale Wings split) |
| **Ignite** | %HP burn DoT | **Have** | Fire Arrows |
| **Portable / Energy Shield** | personal 2nd HP bar | **Have** | Aegis |
| **High-Explosive Ammo** | more splash, less ATK | **Partial** | Wide Blast (catalog-only; no ATK tradeoff) |
| **Sticky Oil Bomb** | slow oil puddle | **Have** | Pitch Bolts |
| **Anti-Aircraft Ammo** | unlock AA | **Have** | Sky Bind |
| **Aerial Mode / Land Cruiser** | change flight layer | **Have** | Sky Lift / Earthbound |
| **Whirlwind** | multi-target melee cleave | **Have** | Whirlwind |
| **Photon Coating / Emission** | timed DR + status immunity | **Partial** | Golden Aura / Sunstone rune |
| **Barrier** (team dome) | ally shield dome | **Partial** | Ward Stone unit (not a unit talent) |
| **Production / Replicate / Mothership / Dark Companion / Shooting Squad / Best Partner** | spawn units | **Partial** | spiderMother, darkHarvest (horde-only) |
| **Quick Reload** | faster shots, less per-hit | **Partial** | Quick Winch (no damage cut) |
| **Launcher Overload** | −interval −range (+sometimes speed) | **Partial** | Quick Winch (no range trade) |
| **Armor Enhancement** | HP + flat damage block per rank | **Partial** | Stone Hide / Iron Plating (HP only, no flat block) |
| **Field Maintenance** | regen on damage / %HP/s | **Missing** | — |
| **Damage Sharing** | link adjacent, share damage | **Missing** | — |
| Electromagnetic Shot / Explosion / Barrage / Interference / Cloud / Armor | disable enemy techs + slow | **Partial** | Hex Arrows (`empArrows`) on Archer — on-hit tech disable + −40% speed; Golden immune |
| **Charged Shot** | huge ATK, worse cadence/range | **Missing** | — |
| **Elite Marksman** | per-rank range + ATK scale | **Missing** | — |
| **Doubleshot / Burst Mode / Fork** | multi-projectile volley | **Missing** | — |
| **Jump Drive** | free redeploy every round + speed | **Missing** | Gale Wings is speed only |
| **Missile Interceptor** | shoot down missiles | **Missing** | (no missile HP layer yet?) |
| **Aerial / Ground Specialization** | matchup ATK + range vs air/ground | **Missing** | — |
| **Assault Mode / Siege Mode / Field Entrenchment** | identity mode swap | **Missing** | — |
| **Energy Absorption** | lifesteal + HP | **Missing** | — |
| **Energy Diffraction** | 1 beam → many weak beams | **Missing** | — |
| **Wreckage Recycling** | heal = kill HP (+ATK) | **Missing** | darkHarvest is spawn, not heal |
| **Final Blitz / Acidic Explosion / Scorching Charge / Wreckage Detonation** | death / on-kill AoE | **Missing** | — |
| **Acid Attack / Acidic Explosion** | acid puddle (%HP + vuln) | **Partial** | horde `corrodeOnHit` innate only |
| **Incendiary Bomb / Napalm** | periodic / on-hit ground fire | **Partial** | Fire Arrows ground fire; no periodic barrage talent |
| **Subterranean Blitz / Burrow / Sandstorm** | burrow DR / range shrink aura | **Missing** | — |
| **Loose Formation** | spacing vs splash | **Missing** | — |
| **Impact Drill / Chamber Compression / Combat Evolvement / Kinetic Charge** | ramp / charge DPS | **Missing** | — |
| **Power Armor** | slow immunity | **Missing** | — |
| **Reactive Armor / Emergency Armor / Quantum Reassembly / Field Reassembly** | survive burst / revive | **Missing** | — |
| **Enhanced Control / Multi Control** | hack strength / multi-hack | **Partial** | Wizard convert exists; no control techs |
| **Scanning Radar / Mobile Power Station / Maintenance Array** | ally range / ATK / heal auras | **Partial** | Golden Aura only |
| **Suppression Shots / Degeneration Beam / Air Defense Mark / Smoke Bomb / Disintegration** | enemy range/ATK/HP% debuffs | **Missing** | — |
| **Stealth Cloak** | untargetable until attack | **Missing** | — |
| **Spider Mine** | periodic suicide mines | **Missing** | — |
| **Anti-Air Barrage / Overlord Artillery / Secondary Armament / Gun-launched Missile / Rocket Punch / Swarm Missiles** | secondary weapon systems | **Missing** | — |
| **Solid Shot / Extended Range Ammo / Convergent Fire / Vertical Sweep / Ground Targeting** | range↔splash↔damage shape flips | **Missing** | — |
| **Culling Rounds** | execute low HP | **Missing** | — |
| **Fortified Target Lock** | prioritize highest HP | **Missing** | — |
| **Ionization / Chain** | %current HP / jump lightning | **Missing** | — |
| **Fire Extinguisher** | cleanse fire/acid/smoke | **Missing** | — |
| **Efficient Maintenance** (Abyss older patches) | upkeep cut | **Missing** | N/A if no upkeep |

---

## 3. Per-unit Mechabellum tech extraction

For each unit: every tech, short effect, Melodan coverage for that *mechanic* (not necessarily on the fantasy counterpart unit).

### Light / chaff

#### Crawler
| Tech | Effect | Melodan |
|---|---|---|
| Mechanical Rage | +speed, −interval | **Have** — Blood Rage |
| Replicate | spawn crawlers from kills | **Partial** — darkHarvest / spiderMother |
| Subterranean Blitz | +speed, burrow DR | **Missing** |
| Acidic Explosion | death acid puddle | **Missing** (corrode innate ≠ this) |
| Impact Drill | +ATK | **Have** — Piercing / Talons |
| Loose Formation | −HP, looser spacing | **Missing** |

#### Fang
| Tech | Effect | Melodan |
|---|---|---|
| Ignite | %HP burn | **Have** — Fire Arrows |
| Range Enhancement | +range | **Have** — Longbow |
| Mechanical Rage | +speed −interval | **Have** — Blood Rage |
| Portable Shield | personal shield | **Have** — Aegis |
| Armor-Piercing Bullets | +ATK | **Have** — Piercing |
| Grenade Launcher | splash, lose AA | **Partial** — Wide Blast; no “lose air” flip |

#### Hound
| Tech | Effect | Melodan |
|---|---|---|
| Mechanical Rage | +speed −interval | **Have** |
| Range Enhancement | +range | **Have** |
| Fire Extinguisher | cleanse fire/acid/smoke | **Missing** |
| Incendiary Bomb | periodic ground fire | **Missing** as talent |
| Armor Enhancement | HP + flat block | **Partial** |
| Chamber Compression | ramp ATK while fighting | **Missing** |

#### Wasp
| Tech | Effect | Melodan |
|---|---|---|
| Energy Shield | personal shield | **Have** — Aegis (Crow) |
| Range Enhancement | +range | **Have** |
| Jump Drive | redeploy + speed | **Missing** (Gale Wings = speed only) |
| Ground Specialization | +ATK vs ground | **Missing** |
| Elite Marksman | scale per rank | **Missing** |
| Ignite | burn | **Have** |
| Electromagnetic Shot | disable techs | **Missing** |
| High-Explosive Ammo | splash trade | **Partial** — Wide Blast |
| Armor-Piercing Bullets | +ATK | **Have** |
| Aerial Specialization | +ATK/range vs air | **Missing** |

---

### Light / mid DPS & clear

#### Marksman
| Tech | Effect | Melodan |
|---|---|---|
| Doubleshot | 2 shots, +reload | **Missing** |
| Range Enhancement | +range | **Have** — Archer Longbow |
| Quick Reload | −interval −ATK | **Partial** — Quick Winch |
| Electromagnetic Shot | EMP | **Missing** |
| Elite Marksman | per-rank scale | **Missing** |
| Shooting Squad | summon Fangs | **Partial** — produce talents |
| Assault Mode | short-range splash tank flip | **Missing** |
| Aerial Specialization | anti-air focus | **Missing** |

#### Arclight
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Electromagnetic Shot | EMP | **Missing** |
| Charged Shot | +ATK +interval | **Missing** |
| Armor Enhancement | HP + block | **Partial** |
| Anti-Aircraft Ammunition | unlock AA | **Have** — Sky Bind |
| Elite Marksman | per-rank scale | **Missing** |
| Shockwave | near-target AoE pulse | **Missing** |

#### Void Eye
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Energy Shield | shield | **Have** |
| Charged Shot | +ATK +interval | **Missing** |
| Aerial Mode | become flyer | **Have** — Sky Lift |
| Energy Absorption | lifesteal | **Missing** |
| Suppression Shots | cut enemy range | **Missing** |
| Electromagnetic Armor | EMP attackers | **Missing** |

#### Vortex
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Mobile Power Station | ally ATK aura | **Partial** — Golden Aura (DR not ATK) |
| Electromagnetic Cloud | splash EMP | **Missing** |
| Electromagnetic Twin | spawn mirage | **Missing** |
| Accumulator Shield | periodic team shield | **Partial** — Ward Stone |
| Grid Integration | link ATK stacking | **Missing** |
| Emergency Armor | brief untargetable | **Missing** |
| Field Maintenance | regen | **Missing** |

---

### Medium tanks / brawlers

#### Sledgehammer
| Tech | Effect | Melodan |
|---|---|---|
| Field Maintenance | +HP + regen | **Missing** |
| Damage Sharing | link share damage | **Missing** |
| Mechanical Rage | +speed −interval | **Have** |
| Range Enhancement | +range | **Have** |
| Electromagnetic Shot | EMP | **Missing** |
| Armor-Piercing Bullets | +ATK +interval | **Have** |
| Armor Enhancement | HP + block | **Partial** |

#### Steel Ball
| Tech | Effect | Melodan |
|---|---|---|
| Energy Absorption | lifesteal | **Missing** |
| Damage Sharing | link | **Missing** |
| Range Enhancement | +range | **Have** |
| Mechanical Division | death → crawlers | **Partial** — produce/onKill |
| Armor Enhancement | HP + block | **Partial** |
| Fortified Target Lock | prioritize max HP | **Missing** |
| Kinetic Charge | move → bonus range | **Missing** |

#### Rhino
| Tech | Effect | Melodan |
|---|---|---|
| Whirlwind | multi cleave | **Have** — Ogre Whirlwind |
| Photon Coating | timed DR + immunity | **Partial** — Golden |
| Field Maintenance | regen | **Missing** |
| Final Blitz | death nuke | **Missing** |
| Mechanical Rage | +speed −interval | **Have** |
| Wreckage Recycling | heal on kill | **Missing** |
| Power Armor | slow immune | **Missing** |
| Armor Enhancement | HP + block | **Partial** |
| Combat Evolvement | ramp HP/ATK over time | **Missing** |

#### Tarantula
| Tech | Effect | Melodan |
|---|---|---|
| Spider Mine | periodic mines | **Missing** |
| Range Enhancement | +range | **Have** |
| Mechanical Rage | +speed −interval | **Have** |
| Armor-Piercing Bullets | +ATK | **Have** |
| Field Maintenance | regen | **Missing** |
| Armor Enhancement | HP + block | **Partial** |
| Anti-Aircraft Ammunition | unlock AA | **Have** |
| High-Explosive Ammo | splash trade | **Partial** |

#### Fire Badger
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Napalm | ground fire zone | **Partial** — Fire Arrows |
| Ignite | burn | **Have** |
| Field Maintenance | regen | **Missing** |
| Scorching Fire | +ATK | **Have** |
| Scorching Charge | low-HP suicide charge | **Missing** |
| Counter-Fire | damaged → huge range | **Missing** |

#### Sabertooth
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Field Maintenance | regen | **Missing** |
| Missile Interceptor | intercept | **Missing** |
| Doubleshot | 2 shells | **Missing** |
| Secondary Armament | side guns | **Missing** |
| Field Entrenchment | garrison mode | **Missing** |

#### Mustang
| Tech | Effect | Melodan |
|---|---|---|
| Missile Interceptor | intercept | **Missing** |
| Range Enhancement | +range | **Have** |
| High-Explosive Ammo | splash trade | **Partial** |
| Aerial Specialization | AA focus | **Missing** |
| Armor-Piercing Bullets | +ATK | **Have** |
| Culling Rounds | execute low HP | **Missing** |

#### Stormcaller
| Tech | Effect | Melodan |
|---|---|---|
| Incendiary Bomb | ground fire, −range | **Partial** |
| Range Enhancement | +range | **Have** — Ballista Longbow |
| Launcher Overload | −interval −range +speed | **Partial** — Quick Winch |
| High-Explosive Ammo | splash trade | **Partial** — Wide Blast |
| Electromagnetic Explosion | EMP splash | **Missing** |
| High Explosive Anti-tank Shells | +ATK +interval | **Have** — Piercing |

#### Hacker
| Tech | Effect | Melodan |
|---|---|---|
| Multi Control | multi weaker beams | **Missing** |
| Barrier | team dome | **Partial** — Ward Stone |
| Range Enhancement | +range | **Have** |
| Enhanced Control | hacked unit full HP | **Missing** |
| Electromagnetic Interference | EMP | **Missing** |

*(Melodan Wizard already covers “steal”; lacks hack-tuning techs.)*

#### Scorpion
| Tech | Effect | Melodan |
|---|---|---|
| Acid Attack | acid puddle | **Partial** — corrode innate |
| Siege Mode | huge range, min-range deadzone, −ATK | **Missing** |
| Range Enhancement | +range | **Have** |
| Doubleshot | 2 shells | **Missing** |
| Field Maintenance | regen | **Missing** |
| Armor Enhancement | HP + block | **Partial** |
| Convergent Fire | +range −splash −interval | **Missing** |

#### Typhoon *(wiki tech list; strategy text may lag)*
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Air Defense Mark | mark air: −range +dmg taken | **Missing** |
| Reactive Armor | block big hits N times | **Missing** |
| Maintenance Array | AoE heal pulse | **Missing** |
| Field Entrenchment | garrison | **Missing** |
| Field Reassembly | revive once | **Missing** |
| Wreckage Detonation | kills explode | **Missing** |

#### Farseer
| Tech | Effect | Melodan |
|---|---|---|
| Photon Emission | ally DR + immunity | **Partial** — Golden Aura |
| Scanning Radar | ally +range aura | **Missing** (building range boost ≠ aura) |
| Missile Interceptor | intercept | **Missing** |
| Electromagnetic Explosion | EMP | **Missing** |
| Range Enhancement | +range | **Have** |
| Burst Mode | many missiles, long reload | **Missing** |
| Aerial Specialization | AA focus | **Missing** |

---

### Air mid / giants

#### Phoenix
| Tech | Effect | Melodan |
|---|---|---|
| Quantum Reassembly | revive once near ally | **Missing** |
| Range Enhancement | +range | **Have** |
| Launcher Overload | −interval −range | **Partial** |
| Energy Shield | shield | **Have** |
| Jump Drive | redeploy | **Missing** |
| Electromagnetic Shot | EMP | **Missing** |
| Elite Marksman | per-rank scale | **Missing** |
| Charged Shot | +ATK −range | **Missing** |

#### Phantom Ray
| Tech | Effect | Melodan |
|---|---|---|
| Burst Mode | many missiles | **Missing** |
| Range Enhancement | +range | **Have** |
| Armor Enhancement | HP + block | **Partial** |
| Sticky Oil Bomb | oil | **Have** — Pitch Bolts |
| Stealth Cloak | cloaked until attack | **Missing** |
| High-Explosive Ammo | splash trade | **Partial** |
| Energy Shield | shield | **Have** |
| Ground Targeting | +range vs ground | **Missing** |

#### Wraith
| Tech | Effect | Melodan |
|---|---|---|
| Floating Artillery Array | more cannons | **Missing** |
| Range Enhancement | +range | **Have** |
| Armor Enhancement | HP + block | **Partial** |
| Degeneration Beam | slow + −ATK + vuln | **Missing** |
| Field Maintenance | regen | **Missing** |
| High-Explosive Ammo | splash trade | **Partial** |
| Land Cruiser | become ground, lose AA | **Have** — Earthbound-ish |

#### Raiden
| Tech | Effect | Melodan |
|---|---|---|
| Fork | more bolts, −range | **Missing** |
| Chain | jump bolts | **Missing** |
| Ionization | % current HP dmg | **Missing** |
| Range Enhancement | +range | **Have** |
| Electromagnetic Shot | EMP | **Missing** |
| Energy Shield | shield | **Have** |

#### Overlord
| Tech | Effect | Melodan |
|---|---|---|
| Overlord Artillery | ground cannons | **Missing** |
| Launcher Overload | −interval −range | **Partial** |
| Mothership | produce Wasps | **Partial** — produce talents |
| Jump Drive | redeploy | **Missing** |
| Photon Emission | ally coating | **Partial** — Golden |
| Range Enhancement | +range | **Have** |
| Armor Enhancement | HP + block | **Partial** |
| Field Maintenance | regen | **Missing** |
| High-Explosive Ammo | splash trade | **Partial** |

---

### Ground giants / titans

#### Fortress
| Tech | Effect | Melodan |
|---|---|---|
| Barrier | team dome | **Partial** — Ward Stone |
| Range Enhancement | +range | **Have** |
| Anti-Air Barrage | periodic AA missiles | **Missing** |
| Fang Production | spawn fangs | **Partial** |
| Launcher Overload | −interval −range | **Partial** |
| Elite Marksman | per-rank scale | **Missing** |
| Doubleshot | 2 shells | **Missing** |
| Armor Enhancement | HP + block | **Partial** |
| Rocket Punch | threshold fist nukes | **Missing** |
| Solid Shot | +range −splash +interval | **Missing** |

#### Vulcan
| Tech | Effect | Melodan |
|---|---|---|
| Ignite | burn | **Have** |
| Range Enhancement | +range | **Have** |
| Incendiary Bomb | periodic fire | **Missing** as talent |
| Scorching Fire | +ATK | **Have** |
| Best Partner | summon Marksman | **Partial** — produce |
| Sticky Oil Bomb | oil | **Have** — Pitch Bolts |
| Armor Enhancement | HP + block | **Partial** |

#### Melting Point
| Tech | Effect | Melodan |
|---|---|---|
| Energy Absorption | lifesteal | **Missing** |
| Range Enhancement | +range | **Have** |
| Energy Diffraction | multi weaker beams | **Missing** |
| Electromagnetic Barrage | EMP barrage | **Missing** |
| Crawler Production | spawn crawlers | **Partial** |
| Armor Enhancement | HP + block | **Partial** |

#### Sandworm
| Tech | Effect | Melodan |
|---|---|---|
| Mechanical Rage | +speed −interval | **Have** |
| Armor Enhancement | HP + block | **Partial** |
| Mechanical Division | death → larvae | **Partial** |
| Anti-Aerial | unlock AA + range | **Have** — Sky Bind |
| Burrow Maintenance | burrow regen | **Missing** |
| Replicate | emerge → larva | **Partial** |
| Sandstorm | emerge aura: −enemy range, DR | **Missing** |
| Strike *(wiki unnamed; strategy name)* | faster emerge, stronger first hit | **Missing** |

#### War Factory
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Phoenix / Steel Ball / Sledgehammer Production | army printer | **Partial** — produce |
| Missile Interceptor | intercept | **Missing** |
| Launcher Overload | −interval −range | **Partial** |
| Photon Coating | timed DR + immunity | **Partial** |
| Armor Enhancement | HP + block | **Partial** |
| High-Explosive Ammo | splash trade | **Partial** |

#### Abyss
| Tech | Effect | Melodan |
|---|---|---|
| Range Enhancement | +range | **Have** |
| Dark Companion | summon Wraith | **Partial** — produce |
| Photon Coating | DR + immunity | **Partial** |
| Disintegration | %HP AoE pulse + slow | **Missing** |
| Swarm Missiles | periodic missile carpet | **Missing** |
| Wreckage Recycling | heal on kill | **Missing** |
| Vertical Sweep | +ATK, vertical beam | **Missing** |

#### Mountain
| Tech | Effect | Melodan |
|---|---|---|
| Gun-launched Missile | periodic AoE rocket | **Missing** |
| Mountain Plating | huge flat block | **Missing** |
| Saturation Bombardment | many shells, +splash, +interval | **Missing** |
| Extended Range Ammo | +huge range −ATK | **Missing** |
| Smoke Bomb | −enemy range cloud | **Missing** |
| Photon Loop | periodic photon | **Partial** — Golden |
| Anti-Aircraft Ammunition | unlock AA (−ATK) | **Have** |
| Range Enhancement | +range | **Have** |

#### Death Knell
| Tech | Effect | Melodan |
|---|---|---|
| Energy Diffraction | many weak rays | **Missing** |
| Range Enhancement | +range | **Have** |
| Steel Ball Production | produce | **Partial** |
| Barrier | huge team dome | **Partial** — Ward Stone |
| Energy Absorption | lifesteal | **Missing** |
| Electromagnetic Bomb | EMP barrage | **Missing** |

---

## 4. Gap summary — what Melodan still needs

### Already covered (keep / reuse)

Core stat pivots exist: **range, AP/damage, attack speed, move speed, HP, personal shield, AA unlock, flight layer swap, ignite, oil, splash widen (catalog), whirlwind, produce/on-kill (horde), photon-ish aura**.

### Highest-priority missing tech *families* (design RPS)

These are the Mechabellum pivots that most often flip unit roles or answer other pivots:

| Priority | Family | Why it matters | Fantasy sketch (from `unit_notes.md`) |
|---|---|---|---|
| 1 | **EMP / tech disable** | Answers “I bought the broken pivot” | Hex / Silence / Magebane shot |
| 2 | **Charged Shot** | Clear unit → medium killer | Charged Flask / Power Draw |
| 3 | **Elite Marksman** (level-scaling) | Late carry on snipers/clear | Veteran Aim / Heroic Rank |
| 4 | **Assault / Siege / Entrench modes** | Identity flip without new units | Close Quarters Archer; Bastion stance |
| 5 | **Jump Drive / redeploy** | Flank pressure every round | Gale Gate / Shadow Step |
| 6 | **Field Maintenance + Damage Sharing** | Mid tank identity | Field Repair; Blood Pact link |
| 7 | **Energy Absorption** | Anti-elite snowball | Bloodfeast / Lifeleech |
| 8 | **High-Explosive tradeoff** (assign Wide Blast + ATK cut) | Clear specialization | Wide Blast on clear units |
| 9 | **Aerial / Ground Spec** | Air mirror answers | Skyhunt / Ground Spec |
| 10 | **Death nuke / acid death / mines** | Chaff & breakthrough answers | Acid Blood; Death Blow; Spider Mines |
| 11 | **Missile Interceptor** | Only if Melodan keeps interceptable projectiles | Ward Charms / Intercept Runes |
| 12 | **Ally range / ATK auras** (Scanning Radar, Mobile Power) | Support mid spike | Banner / Oracle aura |
| 13 | **Energy Diffraction** | Giant sniper → medium clearer | Prism / Split Ray |
| 14 | **Production on player units** | Self-chaff / printers | Levy Production; Nest; Forge spawn |
| 15 | **Flat damage block (true Armor Enhancement)** | Beats low-DPS spam | Iron Plating + block tier |

### Melodan units that are under-teched vs Mechabellum counterparts

| Melodan unit | Closest MB unit | Current talents | Notable missing pivots |
|---|---|---|---|
| Archer | Marksman | Longbow, Piercing, Fire Arrows | Assault Mode, Doubleshot, Elite Marksman, EMP, Aerial Spec, Shooting Squad |
| Dwarf | Crawler | Fleet Feet, Stone Hide | Replicate, Burrow, Acid death, Loose Formation, Impact Drill |
| Crow Rider | Wasp(+Wraith) | Gale Wings, Crow Talons, Aegis | Jump Drive, Ground/Aerial Spec, HE, EMP, Elite Marksman |
| Ballista | Stormcaller | many (range/AP/fire/oil/AA/armor/winch/golden…) | EMP Explosion, true Overload range trade, Incendiary barrage |
| Wizard | Hacker | Sky Bind, Sky Lift | Enhanced Control, Multi Control, EMP, Barrier talent |
| Ogre | Rhino/Steel Ball mix | Whirlwind, Blood Rage, Stone Hide | Final Blitz, Energy Absorption, Photon, Power Armor |
| Mortar / Hammerer / Goblin | niche | mostly Longbow / AP / Winch | almost entire mid-clear toolkit |
| Horde units | — | bloodRage/carapace/barrel… | treated as enemy content; ok for now |

### Catalog cleanup

- Assign **`wideBlast`** to a clear unit (and consider −ATK like HE Ammo).
- Assign **`earthbound`** if any flyer should have a grounded pivot (Wraith Land Cruiser).
- Consider splitting **Mechanical Rage** consistently (Blood Rage already packages both halves).

---

## 5. Quick reference — Mechabellum tech name → Melodan?

| Mechabellum name | In Melodan? |
|---|---|
| Range Enhancement | Yes — Longbow |
| Armor-Piercing Bullets | Yes — Piercing Arrows / Crow Talons |
| Mechanical Rage | Yes — Blood Rage |
| Ignite | Yes — Fire Arrows |
| Portable Shield / Energy Shield | Yes — Aegis |
| High-Explosive Ammo | Partial — Wide Blast (unused) |
| Sticky Oil Bomb | Yes — Pitch Bolts |
| Anti-Aircraft Ammunition | Yes — Sky Bind |
| Whirlwind | Yes — Whirlwind |
| Charged Shot | **No** |
| Electromagnetic Shot / Explosion / Barrage | **Partial** — Hex Arrows on Archer |
| Elite Marksman | **No** |
| Doubleshot / Burst Mode | **No** |
| Jump Drive | **No** |
| Field Maintenance | **No** |
| Damage Sharing | **No** |
| Energy Absorption | **No** |
| Energy Diffraction | **No** |
| Assault Mode / Siege Mode | **No** |
| Missile Interceptor | **No** |
| Aerial / Ground Specialization | **No** |
| Photon Coating / Emission | Partial — Golden Aura |
| Barrier | Partial — Ward Stone building/unit |
| Production / Replicate / Mothership | Partial — horde produce/onKill only |
| Final Blitz / Acidic Explosion | **No** |
| Fire Extinguisher | **No** |
| Stealth Cloak | **No** |
| Scanning Radar | **No** |

---

*Generated for design planning. Re-check wiki.mbxmas.com if balancing numbers; this file cares about tech **identities** and Melodan coverage, not exact costs.*
