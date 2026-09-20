# ElevenLabs SFX workflow (Melodan)

How we generate sound effects and how the game plays them. Read this before making more clips or wiring new cues.

## Account & commercial use

- Plan: **Creator** (paid) — commercial use OK for embedding in the game.
- Free plan is **not** commercial.
- Do **not** sell clips as a standalone SFX pack.
- Opt out of Sound Effects library sharing in the ElevenLabs UI if you don’t want gens shared.
- API key: env `ELEVENLABS_API_KEY` only — never commit it or put it in game/client code.
- Key scopes needed for this bank: **Sound Generation** only.  
  Optional later: Text to Speech, Speech to Speech, Audio Isolation.  
  `user_read` is only needed to query subscription balance; usage stats work without it.

UI and API share the **same account / credit pool**.

## Folder roles

| Path | Role |
|------|------|
| `misc/sfx/` | Local **scratch bank** (gitignored). Flat — no subfolders. Prefix by kind: `commander_…`, `music_…`, `archer_shot_…`. |
| `misc/sfx/PROMPTS.md` | Tracked music/SFX prompts. |
| `assets/audio/` | **Shipped** compressed cues (committed). Same flat + prefix rule. |
| `assets/data/commanders/*.jsonc` → `voice` | TTS lines (`lines`), provider ids (`externalIds[].id`), and voice-design prompts (`externalIds[].prompt`) for regen. |
| `src/game/audio.ts` | Web Audio bus: groups, pooling, distance, cues. |

Workflow:

1. Generate into `misc/sfx/` with a kind prefix (`commander_meteor.mp3`, `music_menu_1.mp3`, …).
2. Delete rejects by hand.
3. When ready to ship a cue, convert → flat `assets/audio/<same_stem>.ogg`, register in `audio.ts` CUES, run `npm run assets:manifest`.
4. Never load `misc/sfx/` at runtime. Never use `assets/audio/voice/` or `assets/audio/music/` subfolders.

## UI vs API (generation)

| | Playground UI | API (what we use) |
|--|---------------|-------------------|
| Variants per generate | **4** candidates (by design) | **1** clip per request |
| Best for | Quick taste tests | Batch bank fills |
| Format | Can download WAV | No WAV container — use PCM then wrap |

Each API call is a **new take**. Regenerating never restores a deleted file.

## Highest quality (verified)

| Format | Use |
|--------|-----|
| **`pcm_48000`** | **Bank masters.** Raw s16le stereo @ 48 kHz → wrap to WAV. |
| `pcm_44100` | Also works; slightly lower rate. |
| `mp3_44100_192` | Best compressed API output (not lossless). |

### Generate bank master

```bash
# from melodan repo root; requires ELEVENLABS_API_KEY
SCRIPT=~/.claude/skills/threejs-audio-generator/scripts/threejs_audio_asset.py

python3 "$SCRIPT" sfx \
  --prompt "fantasy archer bow shot … no music, no voice, game sfx" \
  --duration 0.7 \
  --prompt-influence 0.45 \
  --output-format pcm_48000 \
  --out misc/sfx/.tmp.raw

ffmpeg -y -f s16le -ar 48000 -ac 2 -i misc/sfx/.tmp.raw misc/sfx/archer_shot_1.wav
rm misc/sfx/.tmp.raw
```

### Promote to game assets

This machine’s ffmpeg has **libopus** (not libvorbis). Ship as Opus-in-Ogg:

```bash
ffmpeg -y -i misc/sfx/NAME.wav -c:a libopus -b:a 96k assets/audio/NAME.ogg
```

Then regenerate cue registry (or edit `src/game/audio.ts`), ensure literal `assetUrl('audio/….ogg')` calls exist, run `npm run assets:manifest`.

**Current ship set (2026-09-18):** all 107 bank WAVs promoted to `assets/audio/*.ogg`, registered in `CUES`, wired via `spawnFromEvents` + phase/match/hp-draw/spell hooks in `game.ts`.

## Runtime audio system (`src/game/audio.ts`)

Custom Web Audio bus (not Pixi Sound, not spritesheets):

- **Groups:** `master` ← `sfx` / `music` / `ui` (separate prefs volumes + mute).
- **Variants:** cue with multiple paths → random pick per play.
- **Pooling:** `maxVoices` per cue — extra plays dropped (hundreds of archers won’t explode).
- **Distance:** spatial cues use `PannerNode` + cull beyond `maxDistance`; listener follows camera look-at on the board.
- **Unlock:** first menu click / settings open / prefs apply (browser autoplay policy).
- **Sim:** `muzzle` events carry `unitTypeId` + `style`; audio is render-only (never inside sim).

Prefs (`prefs.ts` / Settings → Audio): `audioMuted`, `masterVolume`, `sfxVolume`, `musicVolume`, `uiVolume`.

Music: `audio.playMusic(cueId | null)` is ready; add a `group: 'music'` cue when you have a bed.

### Adding a new combat SFX

1. Bank WAV → promote OGG as above.
2. Register in `CUES` with `group: 'sfx'`, `spatial: true`, sensible `maxVoices`.
3. In `spawnFromEvents`, map the relevant `SimEvent` → `this.play('cue_id', e.x, e.z)`.

## Check spend (API)

```bash
python3 - <<'PY'
import json, os, time, urllib.request
start = int((time.time() - 2 * 86400) * 1000)
end = int(time.time() * 1000)
url = (
    "https://api.elevenlabs.io/v1/usage/character-stats"
    f"?start_unix={start}&end_unix={end}"
    "&aggregation_interval=cumulative&metric=credits&breakdown_type=request_source"
)
req = urllib.request.Request(url, headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]})
with urllib.request.urlopen(req) as r:
    d = json.load(r)
for k, v in d["usage"].items():
    print(f"{k}: {sum(v):.0f} credits")
print("TOTAL:", sum(sum(v) for v in d["usage"].values()))
PY
```

### Observed cost (Creator, short SFX)

Short ~0.7s clips ≈ **~8 credits each** via API (not the ~200/gen marketing average). Creator ≈ 121 000 credits/month.

## Unit / commander VO (TTS)

Cursor rule (always-on): `.cursor/rules/melodan-voice-over.mdc`.

- TTS model: **`eleven_v3`** only (v2 drifts character off the designed voice).
- Distinct lines OK; **no** same-line multi-takes.
- Voice Design → create one permanent voice → `externalIds[].id` in jsonc.
- Select: sparse Generals-style; death: spatial `unit_<id>_death_*`.
- UI downloads from `~/Downloads` beat a bad API take — copy + convert when the user says so.

## Agent checklist

1. Confirm `ELEVENLABS_API_KEY`.
2. Generate into `misc/sfx/` with **`pcm_48000` → WAV**.
3. Number variants; don’t overwrite keepers unless asked.
4. Promote only when asked → Opus OGG in `assets/audio/` + cue + manifest.
5. Optionally report credit delta before/after a batch.
6. For **VO/TTS**: use `eleven_v3`; one take per distinct line; see VO rule above.
