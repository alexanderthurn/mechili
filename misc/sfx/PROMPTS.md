# Audio prompts

Regen prompts for music and SFX. Voice prompts stay in unit/commander jsonc (`voice.externalIds[].prompt`).

## Music

### `music_menu_1`

```
Instrumental fantasy video game main menu theme for Melodan, a magical medieval strategy game. Warm soft strings, gentle harp arpeggios, quiet woodwinds, luminous soft choir pads, peaceful castle courtyard mood at golden hour, hopeful and inviting, medium-slow tempo ~78 BPM, beautiful and elegant, designed to loop as background music, no vocals, no lyrics, no drums heavy.
```

### `music_menu_2`

```
Instrumental fantasy video game main menu theme for Melodan, a magical medieval strategy game. Cool moonlit keep on the battlements at night: soft low strings, sparse gentle harp, quiet luminous choir pads, faint magical shimmer, nocturnal elegance, mysterious but inviting, medium-slow tempo ~74 BPM, beautiful and calm, designed to loop as background music, no vocals, no lyrics, no heavy drums.
```

### `music_menu_3`

```
Instrumental fantasy video game main menu theme for Melodan, a magical medieval strategy game. Warm indoor great-hall hearth mood: cozy cello and viola, soft lute or plucked folk guitar, gentle woodwinds, low fire-glow comfort, human and wry rather than magical, welcoming castle hall at rest, medium-slow tempo ~76 BPM, beautiful and intimate, designed to loop as background music, no vocals, no lyrics, no dance drums.
```

### `music_battle_1`

```
Instrumental fantasy video game battle underscore for Melodan, magical medieval siege strategy. Low tense strings, soft distant war drums, noble French horns, shimmering magic textures, epic but not overpowering so gameplay SFX stay clear, steady mid tempo ~100 BPM, heroic battlefield atmosphere, designed to loop as background music, no vocals, no lyrics, no modern synths.
```

### Seasonal

| Stem | Prompt |
|------|--------|
| `music_spring_morning_1` | Instrumental fantasy strategy game music for early spring dawn. Soft hopeful strings and light woodwinds, gentle morning birds feeling without literal bird samples, warm rising melody, calm but ready for battle, pastoral medieval dawn, no vocals, seamless looping bed. |
| `music_spring_rain_1` | Instrumental fantasy strategy game music for a spring rain battle. Soft rain atmosphere in the arrangement, melancholic but hopeful piano and muted strings, gentle percussion like distant drizzle rhythm, wet medieval field mood, no vocals, looping bed. |
| `music_summer_noon_1` | Instrumental fantasy strategy game music for bright summer noon. Warm sunny brass and lively strings, open sky confidence, clear weather march energy, bright medieval battlefield under blue sky, uplifting but not cheesy, no vocals, looping bed. |
| `music_summer_golden_1` | Instrumental fantasy strategy game music for golden hour summer evening. Warm amber strings, soft glowing brass, nostalgic heroic melody, sunset light over the field, bittersweet glory, no vocals, looping bed. |
| `music_summer_night_1` | Instrumental fantasy strategy game music for a clear summer night battle. Quiet nocturnal strings and soft low drones, starlit mystery, distant soft percussion, cool moonlit medieval field, serene but tense, no vocals, looping bed. |
| `music_autumn_dusk_1` | Instrumental fantasy strategy game music for autumn dusk. Amber falling-leaf mood, warm low strings and soft horns, fading daylight melancholy, harvest-end battlefield, reflective medieval tone, no vocals, looping bed. |
| `music_autumn_storm_1` | Instrumental fantasy strategy game music for a heavy autumn storm battle. Dark driving low strings, thunderous distant drums, wind-swept urgency, rain-soaked siege tension, dramatic but not chaotic noise, no vocals, looping bed. |
| `music_first_snow_1` | Instrumental fantasy strategy game music for first snowfall. Crisp cold high strings and soft choir-like pads without voices, fragile beauty, sparse percussion like snow hush, winter arrival on the battlefield, ethereal chill, no vocals, looping bed. |
| `music_deep_winter_1` | Instrumental fantasy strategy game music for deep winter night blizzard. Deep frozen drones, sparse icy strings, slow heavy drums, howling wind feeling in the arrangement, stark siege under snow, epic cold finality, no vocals, looping bed. |

## SFX

### `hp_draw`

```
exaggerated punch with box glove
```

### `impact_ward` (sci-fi on-hit)

```
sci-fi energy shield impact hit, crystalline force field pulse, bright holographic shimmer transient, magical futuristic barrier deflect, short clean game SFX, no music, no voice
```

### `forge_select` / `forge_select_rival`

```
three clear hammer strikes on a steel anvil in a row, ding ding ding, bright ringing metal blacksmith hammering steel, short game UI SFX, no fire no bellows no music no voice
```

```
dark enemy forge select sting, cold iron forge, distant harsh bellows and dull anvil, ominous furnace, short game UI SFX, no music no voice
```

### `rune_earth` / `rune_fire` / `rune_water` / `rune_wind` (hover loops)

Seamless ~3s UI beds for base rune tips. One take each.

```
soft deep subterranean earth hum loop, quiet warm soil resonance, gentle underground stone tone, smooth seamless game UI ambience loop, no gravel scrape no crackle no music no voice
```

```
soft candle flame hiss loop, quiet warm fire air rush, gentle continuous zsssh, seamless game UI ambience loop, dry no crackle no liquid no music no voice
```

```
gentle water trickle and soft wet bubble loop, quiet liquid flow, seamless game UI ambience loop, no splash no music no voice
```

```
airy soft wind whoosh and light silk flutter loop, quiet breeze texture, seamless game UI ambience loop, no music no voice
```

### Mix rune hover loops (11)

Cue id = `rune_` + sorted elements joined with `_` (levels share one bed).

```
soft magma and warm stone hiss loop, quiet hot earth ember tone, gentle lava rock resonance, seamless game UI ambience loop, no boom no music no voice
```

```
soft wet clay and muddy trickle loop, quiet damp soil squelch texture, gentle earth water mix, seamless game UI ambience loop, no splash no music no voice
```

```
soft dust devil and dry sand in breeze loop, quiet earthy wind swirl, gentle sand air texture, seamless game UI ambience loop, no howl no music no voice
```

```
soft steam hiss and warm quench loop, quiet fire meeting water sizzle, gentle vapor bed, seamless game UI ambience loop, no explosion no music no voice
```

```
soft rushing torch flame in wind loop, quiet blowtorch air fire whoosh, gentle fire wind bed, seamless game UI ambience loop, dry no boom no music no voice
```

```
soft misty spray and wet breeze loop, quiet water mist in wind, gentle drizzle air texture, seamless game UI ambience loop, no storm crash no music no voice
```

```
soft hot spring mineral bubble loop, quiet warm earth water fire simmer, gentle bubbling geothermal bed, seamless game UI ambience loop, no music no voice
```

```
soft ash storm and cinder wind loop, quiet hot dust and ember breeze, gentle earth fire wind bed, seamless game UI ambience loop, no boom no music no voice
```

```
soft rain on dirt and muddy breeze loop, quiet wet earth wind drizzle, gentle monsoon mud air bed, seamless game UI ambience loop, no thunder no music no voice
```

```
soft storm steam and wet gale loop, quiet fire steam in rainy wind, gentle wet fire air bed, seamless game UI ambience loop, no boom no thunder no music no voice
```

```
soft dense elemental churn loop, quiet blended earth fire water wind texture, gentle four-element ambience bed, seamless game UI loop, no boom no music no voice
```

### Advanced rune hover loops (7)

Cue id = `rune_<catalog id>` (`addi`, `power`, `vigor`, `colossus`, `wrath`, `golden`, `bulwark`).

```
soft heroic metal chime loop, quiet bright brass ring resonance, gentle valor bell tone, seamless game UI ambience loop, no melody no music no voice
```

```
soft low blood thrum pulse loop, quiet dark power heartbeat, gentle carnage drone, seamless game UI ambience loop, no gore no scream no music no voice
```

```
soft deep thick heartbeat pulse loop, quiet giant blood thump, gentle strong vitality bed, seamless game UI ambience loop, no scream no music no voice
```

```
soft heavy mithril plate armor shift loop, quiet metal plate scrape resonance, gentle colossal armor bed, seamless game UI ambience loop, no clang crash no music no voice
```

```
soft angry tense growl-hum loop, quiet berserk tension drone, gentle wrathful hum bed, seamless game UI ambience loop, no shout no scream no music no voice
```

```
soft bright solar shimmer loop, quiet golden sunstone glint, gentle radiant sparkle bed, seamless game UI ambience loop, no melody no music no voice
```

```
soft stone shield thud-hum loop, quiet fortress barrier resonance, gentle bulwark stone bed, seamless game UI ambience loop, no crash no music no voice
```

### Meteor spells

```
meteor shard falling whoosh, hot rock streaking through air, sharp fiery fall rush, game SFX, no impact yet, no music no voice
```

```
huge flaming meteor roaring through sky, deep whoosh of massive burning rock falling, powerful air rush, loud game SFX, no impact no explosion yet, no music no voice
```

```
small meteor rock impact hit, sharp fiery stone slam, crackling fire burst on ground, short punchy game SFX, no music no voice
```

```
massive meteor crater impact, huge flaming rock slam into ground, deep earth-shaking boom with fire burst, catastrophic landing, loud game SFX, no music no voice
```

### `spell_oil_drop` (falling blug)

```
thick oil blob falling through air, wet blugging glugging liquid whoosh, heavy viscous drip falling, short game SFX, no splash landing, no music
```

### `spell_acid_drop` (hiss-drip)

```
corrosive acid droplet falling through air, thin wet hissing sizzle drip, toxic green liquid fall whoosh, short game SFX, no splash landing, no music no voice
```

### `spell_acid_rain` (droppy plip — Poison Cloud)

```
single water droplet falling through air, clear plip droppy whoosh, tiny liquid bead fall, short sharp drop sound, game SFX, no splash landing no music no voice
```

### `spell_fire_drop` (candle zsssh)

```
soft candle flame hiss whoosh, quiet zsssh of a candle being blown or leaning, gentle fire air rush, warm soft sibilant hiss, short game SFX, dry no crackle pop no liquid no oil no boom no music
```

### `prism_hum`

Copied from `stone_whistle_1.ogg` (mortar fly bed, disabled). Replace `stone_whistle_1.ogg` later without touching this cue.
