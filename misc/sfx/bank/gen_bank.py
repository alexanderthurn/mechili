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
