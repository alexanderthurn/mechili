#!/usr/bin/env python3
"""Fill misc/sfx/bank/ with ElevenLabs SFX takes (pcm_48000 -> WAV). Resumable: existing takes are skipped.

Run from the repo root with ELEVENLABS_API_KEY set:  python3 misc/sfx/bank/gen_bank.py [group ...]
"""
import concurrent.futures as cf, json, os, subprocess, sys, time, urllib.request

BANK = os.path.dirname(os.path.abspath(__file__))
KEY = os.environ['ELEVENLABS_API_KEY']
SFX = ', fantasy medieval strategy game sound effect, clean, no music, no voice'
AMB = ', natural outdoor ambience, seamless loop, no music, no voice'

# (name, prompt, seconds, loop, takes)
GROUPS = {
    'amb': [
        ('amb_rain_light', 'Gentle light rain falling on grass and leaves in a quiet meadow, soft steady drizzle, no thunder' + AMB, 20, True, 4),
        ('amb_rain_heavy', 'Heavy steady rain pouring on a meadow and forest, dense rainfall, water running, no thunder' + AMB, 20, True, 4),
        ('amb_rain_water', 'Rain falling on the surface of a calm lake, many small droplets splashing on water' + AMB, 20, True, 4),
        ('amb_thunder', 'Single deep rolling thunder in the distance over a valley, long rumble fading out, no rain' + ', natural sound, no music, no voice', 8, False, 6),
        ('amb_snow_wind', 'Soft cold winter wind over a snowy field, quiet hush of snowfall, gentle gusts' + AMB, 20, True, 4),
        ('amb_winter_howl', 'Strong howling winter wind in the mountains, blizzard gusts whistling, cold and harsh' + AMB, 20, True, 4),
        ('amb_spring_birds', 'Spring morning in a meadow beside a forest, many cheerful songbirds chirping, light breeze' + AMB, 20, True, 4),
        ('amb_summer_insects', 'Hot summer noon meadow, buzzing insects, grasshoppers and cicadas, distant bird, warm still air' + AMB, 20, True, 4),
        ('amb_night', 'Calm summer night in a meadow near a forest, crickets chirping, an occasional distant owl hoot' + AMB, 20, True, 4),
        ('amb_autumn_wind', 'Cool autumn wind blowing through trees, dry leaves rustling and tumbling on the ground' + AMB, 20, True, 4),
        ('amb_lake', 'Small waves gently lapping on a pebble lake shore, calm water ambience' + AMB, 20, True, 4),
        ('amb_forest', 'Quiet forest ambience, leaves rustling softly in the wind, creaking branches, distant birds' + AMB, 20, True, 4),
        ('amb_crows', 'A few crows cawing in the distance over a field, sparse calls with pauses' + ', natural outdoor sound, no music, no voice', 8, False, 6),
        ('amb_battlefield', 'Distant medieval battle heard from afar, muffled clashing and shouting armies, war drums far away' + AMB, 20, True, 4),
        ('amb_campfire', 'Crackling campfire, wood popping and burning steadily' + AMB, 15, True, 4),
        ('amb_creek', 'Small creek babbling over stones, flowing water' + AMB, 20, True, 4),
        ('amb_mountain_wind', 'High mountain wind, airy whistling across rocky peaks, vast and lonely' + AMB, 20, True, 4),
        ('amb_village', 'Peaceful medieval village in the distance, faint hammer on anvil, a cart, chickens, distant chatter without words' + AMB, 20, True, 4),
    ],
    'var': [
        ('var_arrow_shot', 'Wooden longbow string release and arrow whoosh, short and crisp' + SFX, 1.0, False, 8),
        ('var_melee_hit', 'Sword hitting a shield and armour, metallic clang impact, short' + SFX, 1.0, False, 8),
        ('var_melee_swing', 'Heavy weapon swing whoosh through the air, short' + SFX, 0.8, False, 8),
        ('var_impact_flesh', 'Blunt weapon hit on a body, thick dull thud, short, no voice' + SFX, 0.8, False, 8),
        ('var_impact_ground', 'Projectile slamming into dirt ground, thump with soil scatter, short' + SFX, 1.0, False, 8),
        ('var_impact_stone', 'Rock projectile smashing against a stone wall, crack and debris, short' + SFX, 1.2, False, 8),
        ('var_explosion_small', 'Small magical fire explosion, quick burst and crackle, short' + SFX, 1.5, False, 8),
        ('var_bolt_shot', 'Crossbow or ballista bolt fired, heavy twang and whoosh, short' + SFX, 1.0, False, 8),
        ('var_arrow_hit_wood', 'Arrow thudding into a wooden shield or post, short' + SFX, 0.7, False, 8),
        ('var_death_small', 'Small creature collapsing to the ground with armour rattle, body fall, no voice' + SFX, 1.2, False, 8),
        ('var_death_big', 'Huge heavy creature crashing to the ground, deep thud and rumble, no voice' + SFX, 2.0, False, 8),
        ('var_magic_zap', 'Short magical energy bolt fired, bright sparkling zap' + SFX, 1.0, False, 8),
    ],
    'move': [
        ('move_march_light', 'Small group of soldiers marching on grass and dirt, light footsteps and leather, rhythmic' + SFX, 4, True, 6),
        ('move_march_heavy', 'Heavily armoured soldiers marching, metal armour clanking with heavy footsteps, rhythmic' + SFX, 4, True, 6),
        ('move_ogre_stomp', 'Single giant ogre footstep stomp, ground thud' + SFX, 1.0, False, 8),
        ('move_wings', 'Large bird wings flapping, a few powerful wing beats' + SFX, 2.0, False, 8),
        ('move_siege_creak', 'Wooden siege engine on wheels rolling, creaking timber and rumbling wheels' + SFX, 4, True, 6),
        ('move_scurry', 'Small goblins scurrying quickly over dirt, light pattering feet' + SFX, 2.0, False, 8),
        ('move_armour_clank', 'Armour and chainmail rattling as a knight moves, short' + SFX, 1.2, False, 8),
        ('move_hooves', 'Single horse trotting on dirt road, hooves' + SFX, 3.0, True, 6),
        ('move_crawl', 'Giant spider legs skittering and clicking on ground' + SFX, 2.0, False, 8),
        ('move_shamble', 'Zombie shambling footsteps dragging on dirt, no voice' + SFX, 2.0, False, 8),
    ],
    'eco': [
        ('eco_coin', 'Single gold coin dropped on a wooden table, bright clink' + SFX, 0.6, False, 8),
        ('eco_coins_pile', 'Handful of gold coins poured into a pile, jingling' + SFX, 1.5, False, 8),
        ('eco_spend', 'Coins paid out of a leather purse, quick jingle, purchase confirmation' + SFX, 1.0, False, 8),
        ('eco_equip', 'Equipping an item, leather strap and metal buckle click' + SFX, 0.8, False, 8),
        ('eco_upgrade', 'Magical upgrade shimmer, rising sparkly chime, level up feeling' + SFX, 1.5, False, 8),
        ('eco_sell', 'Selling an item, coins sliding across a counter' + SFX, 1.0, False, 8),
        ('eco_reroll', 'Shuffling and rerolling cards, quick paper riffle with magical whoosh' + SFX, 1.0, False, 8),
        ('eco_card_flip', 'Single parchment card flipped over on a table' + SFX, 0.5, False, 8),
        ('eco_deck_shuffle', 'Deck of thick cards being shuffled' + SFX, 1.5, False, 8),
        ('eco_reward', 'Treasure chest opening with a magical golden reward chime' + SFX, 2.0, False, 8),
    ],
    'bld': [
        ('bld_construct', 'Medieval construction, hammers on wood and stone, a short building burst' + SFX, 2.5, False, 8),
        ('bld_place', 'Heavy wooden building set down on the ground, solid thump and settle' + SFX, 1.2, False, 8),
        ('bld_creak', 'Wooden tower creaking under strain, timber groan' + SFX, 2.0, False, 8),
        ('bld_gate', 'Heavy wooden castle gate opening, creaking hinges and chains' + SFX, 3.0, False, 6),
        ('bld_bell', 'Single tower bell toll, medieval bronze bell ringing out' + SFX, 4.0, False, 6),
        ('bld_banner', 'Cloth banner flapping in strong wind' + SFX, 4.0, True, 6),
        ('bld_burning', 'Wooden building burning, roaring fire with crackling and collapsing beams' + SFX, 8.0, True, 4),
        ('bld_rubble', 'Rubble and stones settling after a collapse, debris trickling' + SFX, 2.5, False, 8),
    ],
    'match': [
        ('match_found', 'Match found alert, heroic short horn fanfare with a drum hit' + SFX, 2.0, False, 8),
        ('match_join', 'Player joined notification, soft bright magical chime' + SFX, 0.8, False, 8),
        ('match_leave', 'Player left notification, soft descending muted chime' + SFX, 0.8, False, 8),
        ('match_ready', 'Ready check confirmation, warm two-tone bell' + SFX, 1.0, False, 8),
        ('match_tick', 'Countdown tick, a single short wooden drum knock' + SFX, 0.5, False, 8),
        ('match_final_round', 'Final round warning, dramatic war drums roll with a deep horn' + SFX, 3.0, False, 6),
        ('match_chat', 'Chat message ping, small soft pluck' + SFX, 0.5, False, 8),
        ('match_emote', 'Emote pop, playful light bubble pop' + SFX, 0.5, False, 8),
        ('match_achievement', 'Achievement unlocked, triumphant magical chime with sparkle' + SFX, 2.5, False, 8),
        ('match_rank_up', 'Rank up, rising heroic brass fanfare, short' + SFX, 3.0, False, 6),
        ('match_rank_down', 'Rank down, short descending low brass sting, gentle' + SFX, 2.0, False, 6),
        ('match_reconnect', 'Connection restored, soft rising magical whoosh' + SFX, 1.0, False, 8),
    ],
    'fac': [
        ('fac_war_horn', 'Orc war horn blast, deep rough and menacing' + SFX, 3.0, False, 6),
        ('fac_orc_shot', 'Crude orc bow shot, heavy twang and arrow whoosh' + SFX, 1.0, False, 8),
        ('fac_orc_hit', 'Brutal crude axe hit on armour, heavy crunch' + SFX, 1.0, False, 8),
        ('fac_bone_rattle', 'Skeleton bones rattling and clattering' + SFX, 1.5, False, 8),
        ('fac_cackle', 'Goblin creature cackle, mischievous creature sound, no words' + ', fantasy game creature sound, no music', 1.5, False, 8),
        ('fac_shaman', 'Dark shaman magic chant swelling into a spell, eerie, no words' + ', fantasy game sound effect, no music', 3.0, False, 6),
        ('fac_growl_small', 'Small beast growl, wolf-like snarl' + ', fantasy game creature sound, no music', 1.2, False, 8),
        ('fac_growl_big', 'Large monster roar, deep and powerful' + ', fantasy game creature sound, no music', 2.0, False, 8),
        ('fac_growl_beast', 'Bear-like beast grunt and growl' + ', fantasy game creature sound, no music', 1.5, False, 8),
        ('fac_necro', 'Necromantic dark magic whoosh with ghostly whispers, no words' + SFX, 2.0, False, 8),
        ('fac_drum', 'Tribal war drums, short heavy rhythm' + SFX, 3.0, False, 6),
        ('fac_summon_undead', 'Undead rising from the ground, earth cracking and bones creaking' + SFX, 2.5, False, 8),
    ],
    'spell': [
        ('spell_freeze', 'Ice spell freezing a target, crystallising crackle' + SFX, 1.5, False, 8),
        ('spell_shatter', 'Ice shattering into shards' + SFX, 1.2, False, 8),
        ('spell_heal', 'Healing magic, warm gentle chime with soft glow' + SFX, 1.5, False, 8),
        ('spell_shield_up', 'Magic shield activating, rising resonant hum' + SFX, 1.2, False, 8),
        ('spell_shield_down', 'Magic shield breaking, glassy crack and fading hum' + SFX, 1.2, False, 8),
        ('spell_buff', 'Power buff applied, bright rising magical swell' + SFX, 1.2, False, 8),
        ('spell_debuff', 'Curse applied, dark descending magical tone' + SFX, 1.2, False, 8),
        ('spell_teleport', 'Teleport, quick magical whoosh and pop' + SFX, 1.0, False, 8),
        ('spell_portal', 'Summoning portal opening, swirling magical energy hum' + SFX, 3.0, False, 6),
        ('spell_earthquake', 'Earthquake, deep rumble with cracking ground and rocks' + SFX, 4.0, False, 6),
        ('spell_gust', 'Magic wind gust blasting past' + SFX, 1.5, False, 8),
        ('spell_poison', 'Bubbling poison cauldron, toxic gurgle' + SFX, 2.0, False, 8),
        ('spell_holy', 'Holy light beam from the sky, angelic shimmering tone, no voice' + SFX, 2.5, False, 8),
    ],
    # shared effects for unit mechanics several units can use (complements the spell reserve)
    'mech': [
        ('mech_heal_tick', 'Small soft healing pulse on a unit, gentle warm chime, very short and subtle so it can repeat' + SFX, 0.6, False, 6),
        ('mech_heal_received', 'A unit being healed, bright rising sparkle with a soft breath of relief, no voice' + SFX, 1.0, False, 6),
        ('mech_regen_loop', 'Gentle continuous regeneration aura, soft shimmering hum with faint leaf rustle' + SFX, 4.0, True, 4),
        ('mech_root_grab', 'Roots and vines bursting from the ground and wrapping around a target, creaking wood and earth' + SFX, 1.2, False, 6),
        ('mech_root_release', 'Vines snapping and falling away, dry crackle of breaking roots' + SFX, 0.8, False, 6),
        ('mech_stun_hit', 'Stunning blow, dull heavy thud followed by a brief ringing tone' + SFX, 0.8, False, 6),
        ('mech_stun_loop', 'Dazed and stunned, small cartoonish circling chirps and faint ringing' + SFX, 3.0, True, 4),
        ('mech_charge_start', 'Charge begins, sudden rush of movement with rising whoosh and pounding steps' + SFX, 1.0, False, 6),
        ('mech_charge_impact', 'Charge slamming into an enemy line, heavy body impact with armour crash' + SFX, 1.0, False, 6),
        ('mech_stealth_enter', 'Vanishing into shadow, soft dark whoosh fading to silence' + SFX, 0.8, False, 6),
        ('mech_stealth_exit', 'Appearing from shadow, quick sharp whoosh with a faint blade glint' + SFX, 0.6, False, 6),
        ('mech_crit_hit', 'Critical hit, sharp heavy strike with a bright metallic accent' + SFX, 0.7, False, 6),
        ('mech_armor_break', 'Armour breaking, metal plates cracking and clattering apart' + SFX, 1.0, False, 6),
        ('mech_knockback', 'Unit knocked back, heavy thump and a body sliding across dirt, no voice' + SFX, 0.9, False, 6),
        ('mech_slow_applied', 'Slowing effect applied, low descending warble like time getting heavy' + SFX, 0.8, False, 6),
        ('mech_haste_applied', 'Speed boost applied, quick bright rising whoosh' + SFX, 0.7, False, 6),
        ('mech_aura_pulse', 'Aura pulse radiating from a hero, soft resonant thrum spreading outward' + SFX, 1.2, False, 6),
        ('mech_shield_absorb', 'Magic shield absorbing a hit, muffled glassy thunk with a short shimmer' + SFX, 0.6, False, 6),
        ('mech_bleed_tick', 'Small bleeding damage tick, short wet drip and faint sting, subtle' + SFX, 0.5, False, 6),
        ('mech_revive', 'A fallen unit revived, rising warm choir-like swell and a bright flare, no words' + SFX, 2.0, False, 6),
    ],
    # the 11 draft units' own sounds (attacks, movement, mechanics, deaths)
    'units': [
        ("unit_monk_heal_cast", "Monk casting a healing prayer, warm soft chime with a gentle low hum and faint whisper of cloth, no words" + SFX, 1.2, False, 6),
        ("unit_monk_heal_arrive", "Healing light landing on a wounded soldier, bright soft sparkle and warm swell" + SFX, 0.8, False, 6),
        ("unit_monk_prayer_bell", "Small handheld monastery bell rung once, clear and peaceful" + SFX, 1.5, False, 6),
        ("unit_monk_heal_beam", "Continuous gentle healing beam, soft golden hum with slow shimmer" + SFX, 4.0, True, 4),
        ("unit_druid_orb_cast", "Druid throwing a nature magic orb, leafy whoosh with a soft wooden knock" + SFX, 0.8, False, 6),
        ("unit_druid_roots_burst", "Thick roots erupting from the ground, cracking earth and creaking wood" + SFX, 1.3, False, 6),
        ("unit_druid_roots_hold", "Roots tightening around a struggling target, slow creaking and straining wood" + SFX, 4.0, True, 4),
        ("unit_druid_regrowth", "Regrowth aura, rustling leaves and a soft green shimmer" + SFX, 1.5, False, 6),
        ("unit_druid_thorn_hit", "Thorny magic striking a target, sharp prickly snap" + SFX, 0.6, False, 6),
        ("unit_paladin_shield_block", "Heavy steel shield blocking a sword, loud clang with ringing" + SFX, 0.8, False, 6),
        ("unit_paladin_sword_swing", "Heavy longsword swung with force, deep whoosh" + SFX, 0.7, False, 6),
        ("unit_paladin_shield_bash", "Shield bash into an enemy, heavy metal thump with armour rattle" + SFX, 0.8, False, 6),
        ("unit_paladin_holy_aura", "Holy protective aura, warm resonant choir-like hum without words" + SFX, 4.0, True, 4),
        ("unit_knight_gallop", "Several warhorses galloping fast on hard ground, thundering hooves and jingling tack" + SFX, 4.0, True, 4),
        ("unit_knight_lance_impact", "Cavalry lance smashing into an enemy at full gallop, splintering wood and armour crash" + SFX, 1.0, False, 6),
        ("unit_knight_horse_whinny", "Warhorse whinnying and snorting, excited" + SFX, 1.5, False, 6),
        ("unit_knight_saddle_slash", "Sword slash from horseback, fast whoosh and steel cut" + SFX, 0.6, False, 6),
        ("unit_knight_charge_horn", "Short medieval cavalry horn blast signalling the charge" + SFX, 1.8, False, 6),
        ("unit_assassin_dagger_stab", "Quick dagger stab, short sharp flesh hit" + SFX, 0.5, False, 6),
        ("unit_assassin_shadow_step", "Shadow step teleport, quick dark whoosh and soft pop" + SFX, 0.6, False, 6),
        ("unit_assassin_backstab", "Brutal backstab, heavy dagger thrust with a wet impact, no voice" + SFX, 0.7, False, 6),
        ("unit_assassin_knife_throw", "Throwing knife spinning through the air and thunking into a target" + SFX, 0.7, False, 6),
        ("unit_balloonBomber_burner", "Hot air balloon gas burner firing a loud roaring flame blast" + SFX, 1.5, False, 6),
        ("unit_balloonBomber_creak", "Hot air balloon basket and ropes creaking gently in the wind" + SFX, 5.0, True, 4),
        ("unit_balloonBomber_bomb_whistle", "Small bomb falling from the sky with a descending whistle" + SFX, 1.2, False, 6),
        ("unit_balloonBomber_bomb_explode", "Medium bomb explosion on the ground, boom with dirt and debris" + SFX, 1.5, False, 6),
        ("unit_balloonBomber_pop", "Large hot air balloon envelope tearing and deflating with a long wheezing hiss and flapping cloth" + SFX, 2.5, False, 6),
        ("unit_balloonBomber_sandbag", "Heavy sandbag dropped from a basket thudding into the ground" + SFX, 0.8, False, 6),
        ("unit_duelist_rapier_swish", "Thin rapier blade swishing fast through the air" + SFX, 0.5, False, 6),
        ("unit_duelist_thrust", "One powerful rapier thrust piercing armour, sharp steel punch" + SFX, 0.6, False, 6),
        ("unit_duelist_draw", "Rapier drawn from its scabbard with a bright ringing blade" + SFX, 0.8, False, 6),
        ("unit_duelist_parry", "Rapier parrying a blow, crisp metallic clink" + SFX, 0.5, False, 6),
        ("unit_warMammoth_trumpet", "Huge woolly mammoth trumpeting a loud deep call" + SFX, 2.0, False, 6),
        ("unit_warMammoth_stomp", "Giant mammoth heavy footstep shaking the ground" + SFX, 0.9, False, 6),
        ("unit_warMammoth_bolt_fire", "Mounted heavy bolt-thrower cranked and fired, ratchet clicks then a deep twang" + SFX, 1.2, False, 6),
        ("unit_warMammoth_trample", "Mammoth trampling small soldiers, heavy crunching stomps, no voices" + SFX, 1.2, False, 6),
        ("unit_warMammoth_collapse", "Giant mammoth collapsing to the ground with a long low groan and heavy thud" + SFX, 2.5, False, 6),
        ("unit_warMammoth_howdah", "Wooden howdah on a walking mammoth creaking with ropes and swaying" + SFX, 5.0, True, 4),
        ("unit_brazenBull_bellow", "Giant bronze bull machine bellowing through metal pipes, deep metallic roaring moo with echo" + SFX, 2.0, False, 6),
        ("unit_brazenBull_flame_loop", "Continuous powerful flamethrower stream roaring" + SFX, 4.0, True, 4),
        ("unit_brazenBull_flame_start", "Flamethrower igniting, sudden whoosh and burst of fire" + SFX, 0.8, False, 6),
        ("unit_brazenBull_flame_stop", "Flamethrower cutting off, sputtering flames and a hiss" + SFX, 0.8, False, 6),
        ("unit_brazenBull_furnace", "Furnace roaring inside a bronze machine, deep rumble of fire and creaking hot metal" + SFX, 4.0, True, 4),
        ("unit_brazenBull_bronze_hit", "Weapon hitting a huge hollow bronze body, deep resonant clang" + SFX, 0.8, False, 6),
        ("unit_brazenBull_wheels", "Heavy iron wheels of a huge machine rolling over dirt and stones" + SFX, 4.0, True, 4),
        ("unit_brazenBull_collapse", "Huge bronze machine collapsing, metal crashing and steam hissing" + SFX, 2.5, False, 6),
        ("unit_hordeKnight_sword_clash", "Two swords clashing hard, steel on steel" + SFX, 0.6, False, 6),
        ("unit_hordeKnight_march", "Armoured knights marching in step, chainmail and plate rattling" + SFX, 4.0, True, 4),
        ("unit_hordeKnight_armor_fall", "Armoured knight falling to the ground, plate armour crashing, no voice" + SFX, 1.0, False, 6),
        ("unit_hordeFarmerAlive_pitchfork", "Pitchfork stab into a target, wooden shaft knock and prongs piercing" + SFX, 0.6, False, 6),
        ("unit_hordeFarmerAlive_shuffle", "Peasants shuffling nervously on dirt with wooden clogs" + SFX, 2.0, False, 6),
        ("unit_hordeFarmerAlive_drop", "Wooden pitchfork dropped and clattering on the ground" + SFX, 0.7, False, 6),
    ],
    # orc faction reserve: a counterpart for every board unit + faction-wide sounds (no voices)
    'orc': [
        ("orc_roar_crowd", "Large horde of orcs roaring a savage battle cry together, deep guttural, no words" + SFX, 2.5, False, 6),
        ("orc_grunt_attack", "Single orc attack grunt, short guttural effort sound, no words" + SFX, 0.6, False, 6),
        ("orc_grunt_pain", "Orc pain grunt, short rough snarl, no words" + SFX, 0.6, False, 6),
        ("orc_death", "Orc dying, heavy guttural groan and body falling, no words" + SFX, 1.2, False, 6),
        ("orc_laugh", "Brutish orc laugh, deep and mocking, no words" + SFX, 1.5, False, 6),
        ("orc_drums_loop", "Orc war drums, heavy tribal rhythm on big hide drums" + SFX, 5.0, True, 4),
        ("orc_camp", "Orc war camp ambience, crackling fires, distant grunts, metal hammering, no words" + SFX, 6.0, True, 4),
        ("orc_axe_swing", "Crude heavy orc axe swung through the air, deep whoosh" + SFX, 0.7, False, 6),
        ("orc_cleaver_chop", "Rusty cleaver chopping into flesh, brutal wet hack" + SFX, 0.6, False, 6),
        ("orc_club_hit", "Spiked wooden club smashing into armour, crunchy thud" + SFX, 0.8, False, 6),
        ("orc_sword_clash", "Rusty jagged sword clashing with steel, harsh grinding clang" + SFX, 0.6, False, 6),
        ("orc_shield_bash", "Crude wooden and iron shield bashing an enemy, heavy knock" + SFX, 0.8, False, 6),
        ("orc_flail_whirl", "Heavy chain flail whirling overhead, rhythmic metal whoosh" + SFX, 3.0, True, 4),
        ("orc_spear_throw", "Heavy crude spear thrown hard, wooden shaft whooshing" + SFX, 0.8, False, 6),
        ("orc_spear_impact", "Crude spear thunking into a shield and body" + SFX, 0.6, False, 6),
        ("orc_grunt_march", "Pack of orc warriors marching, heavy boots, rattling bone and leather armour" + SFX, 4.0, True, 4),
        ("orc_brute_maul", "Orc brute slamming a giant stone maul into the ground, earth-shaking smash" + SFX, 1.2, False, 6),
        ("orc_bone_bow", "Crude bone bow released, creaky draw and rough twang" + SFX, 0.8, False, 6),
        ("orc_shaman_skull", "Shaman hurling a flaming skull, eerie whoosh with crackling fire" + SFX, 1.0, False, 6),
        ("orc_shaman_curse", "Dark curse hitting a target, sinister thump with ghostly echo" + SFX, 1.0, False, 6),
        ("orc_totem_summon", "War totem slammed into the ground and awakening, wooden thud and rising tribal hum" + SFX, 1.5, False, 6),
        ("orc_wyvern_screech", "Wyvern screeching in the sky, shrill reptilian cry" + SFX, 1.5, False, 6),
        ("orc_wyvern_wings", "Large leathery wyvern wings flapping, heavy beats" + SFX, 2.0, False, 6),
        ("orc_wyvern_bite", "Wyvern snapping its jaws on prey, sharp crunch" + SFX, 0.8, False, 6),
        ("orc_wyvern_spit", "Wyvern spitting acid, wet hiss and sizzle" + SFX, 1.0, False, 6),
        ("orc_catapult_release", "Ramshackle goblin catapult creaking and releasing, wooden thwack and rattling junk" + SFX, 1.5, False, 6),
        ("orc_junk_explode", "Explosion of scrap metal and fire, clattering debris" + SFX, 1.5, False, 6),
        ("orc_bone_ballista", "Siege crossbow made of bones and sinew cranked and fired, creaks then a deep twang" + SFX, 1.2, False, 6),
        ("orc_war_drum_boom", "Single gigantic war drum boom, deep shockwave" + SFX, 1.5, False, 6),
        ("orc_drum_ritual", "Ritual drumming with a low eerie hum building power" + SFX, 4.0, True, 4),
        ("orc_drum_shockwave", "Shockwave blasting out from a war drum, deep whump and rushing air" + SFX, 1.2, False, 6),
        ("orc_warg_gallop", "Pack of huge wolves running fast, heavy paws and panting" + SFX, 4.0, True, 4),
        ("orc_warg_howl", "Giant warg wolf howling, deep and menacing" + SFX, 2.0, False, 6),
        ("orc_warg_bite", "Warg wolf snarling and biting, vicious snap" + SFX, 0.8, False, 6),
        ("orc_boar_charge", "Giant war boar squealing and charging, pounding hooves" + SFX, 1.5, False, 6),
        ("orc_boar_grunt", "Giant war boar grunting and snorting" + SFX, 1.0, False, 6),
        ("orc_zeppelin_engine", "Ramshackle goblin zeppelin, sputtering clanky propeller engine" + SFX, 4.0, True, 4),
        ("orc_zeppelin_crash", "Patchwork zeppelin crashing and exploding, tearing cloth and blast" + SFX, 2.5, False, 6),
        ("orc_armor_fall", "Orc in crude spiked armour falling, metal and bone clatter" + SFX, 1.0, False, 6),
    ],
    # siege & defense: walls, gates, defensive structures and siege engines (complements 'bld')
    'siege': [
        ("siege_wall_build_stone", "Stone wall segment being built, masons laying heavy blocks, mortar scraping, chisel taps" + SFX, 2.5, False, 6),
        ("siege_wall_build_wood", "Wooden palisade wall being raised, logs thudding into the ground and hammering" + SFX, 2.0, False, 6),
        ("siege_wall_place", "Wall segment set into place, heavy stone thud with a short dust settle" + SFX, 1.0, False, 6),
        ("siege_wall_hit_arrow", "Arrows thudding and glancing off a stone wall" + SFX, 0.8, False, 6),
        ("siege_wall_hit_rock", "Large rock smashing into a stone castle wall, crack and falling debris" + SFX, 1.5, False, 6),
        ("siege_wall_hit_wood", "Heavy blow splintering a wooden palisade" + SFX, 1.0, False, 6),
        ("siege_wall_crack", "Stone wall cracking under strain, deep grinding fracture" + SFX, 1.2, False, 6),
        ("siege_wall_collapse", "Large section of castle wall collapsing, massive stone avalanche and dust" + SFX, 3.0, False, 6),
        ("siege_palisade_collapse", "Wooden palisade wall breaking and falling over, splintering logs" + SFX, 2.0, False, 6),
        ("siege_repair", "Masons repairing a damaged wall, hammering, chiselling and scraping trowel" + SFX, 3.0, True, 4),
        ("siege_portcullis_drop", "Iron portcullis slamming down, rattling chains and a heavy metal crash" + SFX, 2.0, False, 6),
        ("siege_drawbridge", "Drawbridge lowering on heavy chains, creaking wood and clanking links" + SFX, 3.0, False, 6),
        ("siege_ram_hit", "Battering ram striking a wooden castle gate, deep booming thud with creaking wood" + SFX, 1.2, False, 6),
        ("siege_gate_break", "Castle gate bursting open under a battering ram, splintering wood and broken iron" + SFX, 2.0, False, 6),
        ("siege_ram_roll", "Covered battering ram rolling forward on wooden wheels, creaking and rumbling" + SFX, 4.0, True, 4),
        ("siege_tower_arrow_volley", "Volley of arrows loosed from a castle tower, many bowstrings and whooshes" + SFX, 1.5, False, 6),
        ("siege_oil_pour", "Boiling oil poured from the battlements, bubbling liquid splashing and sizzling" + SFX, 2.0, False, 6),
        ("siege_spike_trap", "Spike trap springing from the ground, sharp metal snap" + SFX, 0.6, False, 6),
        ("siege_brazier", "Watchtower brazier burning, steady crackling fire" + SFX, 4.0, True, 4),
        ("siege_alarm_horn", "Defenders sounding an alarm horn from the walls, urgent repeated blasts" + SFX, 2.5, False, 6),
        ("siege_barricade", "Wooden barricade dragged and dropped into place" + SFX, 1.2, False, 6),
        ("siege_moat_splash", "Soldier or debris splashing into a castle moat" + SFX, 1.0, False, 6),
        ("siege_trebuchet_release", "Huge trebuchet releasing, counterweight dropping with a deep creak and whoosh" + SFX, 2.5, False, 6),
        ("siege_trebuchet_impact", "Trebuchet boulder slamming into a fortress, massive crash and rubble" + SFX, 2.0, False, 6),
        ("siege_trebuchet_winch", "Trebuchet being winched back, ratcheting wood and rope strain" + SFX, 3.0, True, 4),
        ("siege_tower_roll", "Tall wooden siege tower rolling towards a wall, heavy creaking and rumbling wheels" + SFX, 4.0, True, 4),
        ("siege_ladder", "Siege ladder slammed against a stone wall, wooden clatter" + SFX, 1.0, False, 6),
        ("siege_grapple", "Grappling hook thrown and catching on stone battlements, metal clink and rope" + SFX, 1.0, False, 6),
        ("siege_sapper_dig", "Sappers digging a tunnel under a wall, shovels and falling earth" + SFX, 4.0, True, 4),
        ("siege_mine_collapse", "Undermined wall foundation collapsing from below, deep rumble and crashing stone" + SFX, 2.5, False, 6),
    ],
    # production buildings ("factories"): ambience loop + unit-ready per building, shared production UI
    'prod': [
        ("prod_barracks_loop", "Medieval barracks training yard, wooden practice swords clacking, wordless shouted drill orders, marching boots" + SFX, 6.0, True, 4),
        ("prod_stables_loop", "Busy medieval stables, horses snorting and shifting, hooves on wooden floor, hay rustling" + SFX, 6.0, True, 4),
        ("prod_workshop_loop", "Siege workshop, carpenters sawing and hammering wood, ropes being tightened, creaking timber" + SFX, 6.0, True, 4),
        ("prod_magetower_loop", "Wizard tower interior, low magical hum, bubbling alchemy flasks, pages turning, faint sparkles" + SFX, 6.0, True, 4),
        ("prod_aviary_loop", "Aviary roost full of large birds, wings flapping in the rafters, crows cawing, feathers rustling" + SFX, 6.0, True, 4),
        ("prod_monastery_loop", "Peaceful monastery garden, distant wordless monk chant, soft wind chimes, birdsong" + SFX, 6.0, True, 4),
        ("prod_mine_loop", "Underground mine, pickaxes striking rock, mine cart rolling on rails, water dripping, echoing tunnels" + SFX, 6.0, True, 4),
        ("prod_goblinpit_loop", "Chaotic goblin pit, clanking scrap metal, wicked cackling without words, bubbling sludge" + SFX, 6.0, True, 4),
        ("prod_barracks_ready", "Barracks door swinging open and a squad of soldiers marching out in step" + SFX, 2.0, False, 6),
        ("prod_stables_ready", "Stable gate creaking open and a horse rider trotting out" + SFX, 2.0, False, 6),
        ("prod_workshop_ready", "Large workshop doors opening and a heavy wooden siege engine creaking out on wheels" + SFX, 2.5, False, 6),
        ("prod_magetower_ready", "Magical summoning burst, swirling energy flare as a mage appears" + SFX, 1.5, False, 6),
        ("prod_aviary_ready", "Flock of large birds taking off together, burst of wing flaps" + SFX, 1.5, False, 6),
        ("prod_monastery_ready", "Soft blessing chime with a warm glow, peaceful" + SFX, 1.5, False, 6),
        ("prod_mine_ready", "Dwarves emerging from a mine shaft, rattling cart and heavy boots climbing up" + SFX, 2.0, False, 6),
        ("prod_goblinpit_ready", "Horde of goblins scrambling out of a pit, chaotic scuttling and cackles without words" + SFX, 2.0, False, 6),
        ("prod_start", "Production started, short satisfying stamp with a small bell" + SFX, 0.6, False, 6),
        ("prod_tick", "Very subtle soft tick for a progress bar, wooden click" + SFX, 0.5, False, 6),
        ("prod_unit_ready", "Unit ready signal, clear bright two-note horn that cuts through battle noise" + SFX, 1.0, False, 6),
        ("prod_blocked", "Production blocked or paused, dull low deny thud" + SFX, 0.6, False, 6),
        ("prod_building_upgrade", "Building upgraded, quick construction burst of hammering ending in a bright shimmer" + SFX, 2.0, False, 6),
        ("prod_rally_point", "Rally flag planted into the ground, cloth flap and wooden thud" + SFX, 0.8, False, 6),
    ],
}


def gen(name, prompt, sec, loop, take):
    out = os.path.join(BANK, f'{name}_{take}.wav')
    if os.path.exists(out):
        return out, 0
    body = {'text': prompt, 'duration_seconds': sec, 'prompt_influence': 0.45, 'model_id': 'eleven_text_to_sound_v2'}
    if loop:
        body['loop'] = True
    req = urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_48000',
                                 data=json.dumps(body).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
            break
        except Exception as e:
            if attempt == 3:
                print('FAIL', name, take, e, flush=True)
                return out, 0
            time.sleep(5 * (attempt + 1))
    p = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', '-', out], input=raw)
    return out, sec


def main():
    wanted = sys.argv[1:] or list(GROUPS)
    jobs = [(n, p, s, l, t) for g in wanted for (n, p, s, l, k) in GROUPS[g] for t in range(1, k + 1)]
    est = sum(j[2] for j in jobs if not os.path.exists(os.path.join(BANK, f'{j[0]}_{j[4]}.wav')))
    print(f'{len(jobs)} takes, ~{est:.0f}s audio, ~{est * 11:.0f} credits', flush=True)
    done = 0
    with cf.ThreadPoolExecutor(3) as ex:
        for f in cf.as_completed([ex.submit(gen, *j) for j in jobs]):
            out, sec = f.result()
            done += 1
            if done % 20 == 0:
                print(f'{done}/{len(jobs)}', flush=True)
    with open(os.path.join(BANK, 'index.json'), 'w') as fh:
        json.dump({n: {'prompt': p, 'seconds': s, 'loop': l, 'takes': k, 'group': g}
                   for g in GROUPS for (n, p, s, l, k) in GROUPS[g]}, fh, indent=1)
    print('done', flush=True)


if __name__ == '__main__':
    main()
