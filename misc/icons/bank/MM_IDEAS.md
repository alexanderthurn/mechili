# Monster Manual → Melodan bank prep

Source skim: `misc/Monster Manual (5e).pdf` (5e MM contents + faction lore).  
Goal: **out-of-the-box icon bank** for parties Melodan doesn’t have yet — not a D&D port. Fantasy names below are Melodan-facing; MM creatures are inspiration only.

Already covered-ish in bank/src: dwarves, ogres, goblins (as units), crows/bats, wizards, komtur/paladin/necromancer/witch archetypes, ~60 techs, 16 tactics.

---

## 1. Parties / factions to prepare for

Each faction = future roster + commander(s) + signature talents/tactics.

| Faction (Melodan name) | MM inspiration | Fantasy hook for auto-battler |
|------------------------|----------------|--------------------------------|
| **Orc Warband** | Orcs | Rage packs, war drums, charge / execute |
| **Hobgoblin Legion** | Hobgoblins | Discipline, formations, war machines |
| **Bugbear Raiders** | Bugbears | Ambush stealth + burst melee |
| **Gnoll Pack** | Gnolls | Rampage, devour/lifesteal, fear |
| **Kobold Warren** | Kobolds | Swarm, traps, dragon-cult buffs |
| **Drow House** | Drow | Poison, darkness, spiders, betrayal |
| **Duergar Forge** | Duergar | Enlarge, invis, slave-forged armor |
| **High / Wood Elves** | (surface elves implied) | Archery, fae step, precision |
| **Lizardfolk Marsh** | Lizardfolk | Amphibious, cold blood, craft spears |
| **Sahuagin Tide** | Sahuagin | Blood frenzy, sharks, deep raids |
| **Yuan-ti Coil** | Yuan-ti | Poison, charm, shapeshift elites |
| **Myconid Circle** | Myconids | Spore clouds, pacify, shared mind |
| **Kenku Murder** | Kenku | Mimicry, theft, flock tactics |
| **Thri-kreen Pack** | Thri-kreen | Dual wield, leap, desert endurance |
| **Giant Clans** | Giants (hill→storm) | Size tiers, throw rocks, weather |
| **Dragon Cult** | Dragons / kobolds / half-dragons | Breath weapons, fear aura, hoard |
| **Abyssal Host** | Demons | Chaos spawn, corruption, summon |
| **Infernal Cohort** | Devils | Contracts, discipline, fire/law |
| **Illithid Cabal** | Mind flayers | Charm, stun, thralls, psionics |
| **Undead Legion** | Skeletons/zombies/wights/liches | Regen-less swarm, fear, drain |
| **Construct Vault** | Golems / shield guardian | Immunities, slow tanks, golem link |
| **Fey Court** | Dryad/satyr/sprite/pixie/hag | Charm, hex, terrain, mischief |
| **Elemental Storm** | Elementals / genies / mephits | Pure damage types, summon elementals |
| **Beast Court** | Owlbear, displacer, hydra, etc. | Monstrosity bosses + beast packs |
| **Deep Horrors** | Aboleth, kuo-toa, quaggoth | Madness, slime, underdark control |
| **Aarakocra Skyhost** | Aarakocra / griffon | Air supremacy (pairs with Melodan flyers) |

---

## 2. Specs / commanders to generate (portraits)

Group by faction. Prefer **sticker bust** like `spec-archer` / `spec-elite`.

### Orc / goblinoid
- `spec-orc-warlord` — tusks, iron jaw, warpaint  
- `spec-orc-shaman` — bone fetish, green flame  
- `spec-orc-berserker` — frothing dual-axe  
- `spec-hobgoblin-legate` — crimson officer helm  
- `spec-hobgoblin-strategist` — map/scroll warlord  
- `spec-bugbear-stalker` — hulking stealth hood  
- `spec-goblin-king` — crowned runt on stolen throne  

### Gnoll / kobold / beast-raiders
- `spec-gnoll-packlord` — hyena mane, bloody snout  
- `spec-gnoll-fang` — demonic cultist gnoll  
- `spec-kobold-trapmaster` — goggles, coiled spring  
- `spec-kobold-wyrmpriest` — miniature dragon cultist  

### Elves (surface + drow)
- `spec-elf-archon` — radiant high elf general  
- `spec-elf-bladedancer` — dual curved blades  
- `spec-elf-moonsinger` — silver circlet mage  
- `spec-drow-matron` — spider crown, cruel smile  
- `spec-drow-blademaster` — dual short swords, white hair  
- `spec-drow-priestess` — Lolth-spider holy symbol (fantasy spider queen)  

### Underdark / duergar / illithid
- `spec-duergar-tyrant` — bald gray dwarf crown  
- `spec-duergar-inquisitor` — slave-brand iron mask  
- `spec-illithid-elder` — tentacle face, psychic glow  
- `spec-quaggoth-thane` — white fur underdark ape-lord  

### Marsh / sea / serpent
- `spec-lizard-king` — crowned saurian  
- `spec-sahuagin-baron` — shark-tooth crown  
- `spec-yuan-ti-abomination` — serpent torso noble  
- `spec-yuan-ti-pureblood` — humanlike snake eyes  

### Giant / dragon / elemental
- `spec-hill-giant-chief` — brutish oversized head  
- `spec-storm-giant-thane` — lightning-eyed noble giant  
- `spec-dragon-speaker` — half-dragon cult speaker  
- `spec-efreeti-sultan` — fire genie lord  
- `spec-djinni-caliph` — air genie lord  

### Undead / fiend / construct / fey
- `spec-death-knight` — burning-eye fallen paladin  
- `spec-lich-archmage` — phylactery glow  
- `spec-vampire-count` — pale noble  
- `spec-pit-fiend` — armored devil commander  
- `spec-balor-rage` — winged demon warlord  
- `spec-golem-wright` — already have golemancer — alt: `spec-iron-golem-face`  
- `spec-hag-coven` — green hag crone  
- `spec-archfey` — antlered fey monarch  
- `spec-myconid-sovereign` — mushroom crown  

### Oddballs (great for Melodan flavor)
- `spec-kenku-murder-chief` — beaked thief  
- `spec-thri-kreen-pack-leader` — mantis warrior  
- `spec-aarakocra-sky-captain` — birdfolk (pairs sky-admiral)  
- `spec-medusa-queen` — snake-hair gaze  
- `spec-minotaur-labyrinth-king` — horned labyrinth lord  
- `spec-sphinx-riddle` — winged lion face  
- `spec-treant-elder` — bark-face forest lord  

**Rough portrait count:** ~45–55 new `spec-*`

---

## 3. Unit-icon ideas (optional later — or reuse unit portraits)

Not required for bank now, but useful if Melodan gets per-unit faces:

Orc: grunt, eye, claw, hand of gruumsh-analogue  
Goblinoid: goblin skirmisher, hobgoblin phalanx, bugbear ambusher  
Gnoll: pack hunter, witherling, flind  
Kobold: wingless, winged, sorcerer  
Drow: elite warrior, arachnomancer, house guard  
Elf: longbow lodge, blade singer, tree warden  
Giant: hill, stone, frost, fire, cloud, storm (six icons)  
Undead: skeleton archer, zombie mound, wight captain, deathlock  
Fiend: dretch swarm, bearded devil, bone devil, erinyes  
Monstrosity: owlbear, displacer, hydra heads, chimera  

---

## 4. Techs (glyph-white) — new fantasy kits

### Orc / rage
- War Drums, Blood Frenzy, Tusks, Relentless End, Savage Leap, Warband Link  

### Legion / hobgoblin
- Iron Discipline, Phalanx Lock, War Horn, Siege Ladder, Captive Levy, Rank Advance  

### Bugbear / ambush
- Ambush Mark, Silent Stride, Surprise Strike, Trophy Rack  

### Gnoll / devour
- Rampage, Carrion Howl, Flesh Feast (distinct from Bloodfeast), Fear Pack, Yeenoghu’s Mark (rename: **Abyss Howl**)  

### Kobold / traps / dragon
- Trap Nest, Dragon Idol, Pack Scurry, Egg Guard, Wyrm Blessing, Tunnel Collapse  

### Drow / spider / dark
- Darkness Veil, Poison Kiss, Spider Climb Form, Lolth’s Favor → **Web Matron**, Betrayal Blade, Faerie Fire Mark → **Glow Hex**  

### Duergar
- Enlarge Form, Gray Invisibility, Slave Chain, Stone Endurance, Underdark March  

### Elf
- Leaf Step, Perfect Volley, Moonward, Feyblink, Ancient Aim  

### Lizardfolk / sahuagin / yuan-ti
- Hold Breath, Cold Blood, Shark Call, Blood Frenzy Tide, Serpent Charm, Molting Armor, Constrict  

### Myconid / spores
- Pacifying Spores, Rapport Spores, Hallucination Cloud, Fungal Bloom  

### Illithid
- Mind Blast, Thrall Link, Extract Insight, Psionic Shield, Tadpole Infest  

### Giant
- Rock Throw, Sweeping Club, Weather Call, Size Advantage  

### Dragon cult
- Breath Reservoir, Frightful Presence, Wing Buffet, Hoard Shield, Draconic Resilience  

### Demon / devil
- Chaos Spawn, Corruption Aura, Infernal Contract, Hellfire Chain, Lawful Torment  

### Undead
- Unholy Fortitude, Life Drain Aura, Bone Swarm, Grave Rise, Phylactery Bind  

### Construct
- Immutable Form, Magic Resistance Shell, Slam Protocol, Guardian Bond  

### Fey / hag
- Misty Escape, Coven Link, Hex Curse, Babble Charm, Nightmare Steed  

### Elemental / genie
- Fire Form, Water Walk, Earth Glide, Whirlwind Body, Wish Spark (careful — joke icon only)  

### Beast / monstrosity signature
- Displacement (blur afterimage), Multihead Strike, Petrifying Gaze, Swallow Whole, Web Shot, Acid Blood  

**Rough new tech count:** ~80–100 glyphs beyond current bank  

---

## 5. Tactics / spells (glyph-white)

Faction-flavored board spells:

| id idea | fantasy subject |
|---------|-----------------|
| tactic-war-drums | drums buffing all orcs |
| tactic-darkness | already have — strengthen / variant |
| tactic-web-storm | spider webs over tiles |
| tactic-spore-cloud | mushroom spores |
| tactic-mind-blast | psychic cone |
| tactic-breath-fire / frost / lightning / acid / poison | five breath strips |
| tactic-rockslide | giant-thrown rocks |
| tactic-infernal-gate | devil portal |
| tactic-abyssal-rift | demon tear |
| tactic-raise-dead | skeleton hands from ground |
| tactic-feywild-crossing | glowing mushroom ring portal |
| tactic-tidal-surge | sahuagin wave |
| tactic-serpent-gaze | yuan-ti charm eyes |
| tactic-trap-field | kobold caltrops/spikes |
| tactic-howl-of-the-pack | gnoll fear howl |
| tactic-phalanx-order | hobgoblin formation buff |
| tactic-enlarge-ally | duergar growth |
| tactic-invisibility-field | gray dwarf cloak |
| tactic-elemental-conjure | four elemental orbs |
| tactic-dragon-fear | terror aura |
| tactic-petrify | medusa gaze |
| tactic-swallow | giant maw |
| tactic-displacement-field | afterimage shimmer |

**Rough:** ~25–35 tactics  

---

## 6. Runes (token-rune medallions)

Faction-colored runes to mint later:

- orc-blood, legion-iron, spider-silk, spore, psionic, draconic, abyssal, infernal, tidal, serpent, frost-giant, fire-giant, fey-glamour, undead-phylactery, construct-core, trap-spring, hyena-fang, kobold-egg  

---

## 7. Emotes / UI (light)

Emotes: orc grin, elf smirk, spider, mushroom, tentacle wave, dragon roar, skeleton wave, devil deal handshake  

UI: faction banner picker, underdark, feywild, abyss, hells, ocean, desert  

---

## 8. Suggested generation waves (when you say go)

| Wave | Focus | Est. icons |
|------|--------|------------|
| **W1** | Specs: Orc + Hobgoblin + Gnoll + Kobold + Drow matron/blademaster | ~12 portraits |
| **W2** | Specs: Elf archon/bladedancer + Duergar + Illithid + Lizard/Sahuagin/Yuan-ti | ~12 |
| **W3** | Specs: Giant + Dragon speaker + Death knight + Lich + Pit fiend + Hag + Myconid | ~12 |
| **W4** | Techs: Orc/Legion/Ambush/Gnoll/Kobold kits | ~30 |
| **W5** | Techs: Drow/Duergar/Elf/Serpent/Illithid kits | ~30 |
| **W6** | Techs: Dragon/Giant/Undead/Fiend/Construct/Fey | ~30 |
| **W7** | Tactics breath + faction board spells | ~25 |
| **W8** | Faction runes + oddball specs (kenku, thri-kreen, medusa, sphinx, treant) | ~25 |

**Grand total if we do all:** ~150–180 more bank icons (on top of current ~157).

---

## 9. Design notes for Melodan

- Prefer **generic fantasy names** (Web Matron, Abyss Howl) over trademark-y D&D proper nouns in final game strings; filenames can stay descriptive (`spec-drow-matron`).  
- Auto-battler fit: swarm (kobold/goblin/undead), aura (dragon fear, spores), mode-swap (duergar enlarge), death-triggers (already strong in Melodan), faction-only talents later.  
- Specs sell the fantasy — generate portraits first; techs second.  
- Keep landing in flat `misc/icons/bank/` with transparent BG + crisp sticker/glyph rules.

---

When you want to start generating, pick a wave (recommend **W1**) or say “full MM bank” and we’ll grind Cursor gens into the bank only.

---

## 10. Status — full MM bank DONE (2026-09-17)

All W1–W8 plan items landed in flat `misc/icons/bank/` (transparent BG, 128×128). Speculative only — **not packed**.

| Family | Approx count | Notes |
|--------|--------------|--------|
| `spec-*` | 68 | All §2 portraits incl. oddballs + iron golem |
| `tech-*` | 160 | §4 kits + earlier Mechabellum-gap bank |
| `tactic-*` | 42 | §5 breaths + faction board spells |
| `item-*` | 47 | §6 faction runes + earlier runes |
| `emote-*` | ~19 | §7 emotes |
| `ui-*` | ~21 | §7 banners / picker |
| `unit-*` | growing | §3 optional unit faces |

Promote into `misc/icons/src/` only when wiring factions into the game.
