# Melodan icon style lock

**Style name:** `stamped-relief-strong`  
**Locked:** 2026-07-28  
**Reference sheet:** `misc/concepts/icon-styles/style-d-stamped-relief-strong.png`  
**Shipped atlas:** `assets/icons/icons.webp` + `icons.json`  
**Source masters:** `misc/icons/src/<id>.png` (128×128)  
**Unused / pick-from:** `misc/icons/bank/` (not packed)  
**Draft output:** write new gens straight into `src/` or `bank/` (old `sheets/` / `singles/` dumps removed)

## Exact generation prompt (copy this)

Use with Gemini image gen (`threejs-image-generator`). Prefer a **single good icon** as `--input-image` (e.g. `misc/icons/src/tactic-dragon.png`) — the multi-icon style sheet often makes Gemini regurgitate a whole grid. Fall back to `misc/concepts/icon-styles/style-d-stamped-relief-strong.png` only if needed.

```text
Create a SINGLE game UI icon on a SOLID flat magenta #FF00FF background.
Match EXACTLY the stamped-relief-strong Melodan style from the reference:
warm BROWN aged bronze / brass rounded square tile (NOT green, NOT sage, NOT olive-green),
DEEP carved emboss (recessed glyph), bright bevel highlights on top-left edges,
dark carved shadows on bottom-right, tactile stamped metal look, matte not shiny chrome,
readable at 64px. Color = brown-bronze like the reference — never leaf-green.

Subject: [SUBJECT — glyph only, no words]

STRICT RULES:
- NO text, NO letters, NO digits, NO numbers, NO "+5", NO "2", NO labels
- NO checkerboard, NO gray transparency grid
- Magenta #FF00FF fills ALL empty space outside the tile
- Exactly ONE icon only, centered, orthographic flat GUI
- NOT a sheet, NOT a grid, NOT multiple variants
```

For multi-icon sheets (faster drafts only — prefer singles for finals):

```text
Create a [COLS]x[ROWS] game UI icon sheet on SOLID flat magenta #FF00FF.
Same stamped-relief-strong style as the reference (deep emboss, olive/bronze tiles).
One icon per cell, evenly spaced, clear magenta gutters between cells.
Icons left-to-right, top-to-bottom: (1) … (2) … 
STRICT: NO text, NO letters, NO digits on any icon. NO checkerboard.
```

Then: `npm run icons:split` → `npm run icons:pack`

## CLI examples

Single icon (preferred for new icons in 2 weeks):

```bash
uv run ~/.claude/skills/threejs-image-generator/scripts/generate_image.py \
  --input-image misc/concepts/icon-styles/style-d-stamped-relief-strong.png \
  --prompt "$(cat <<'EOF'
Create a SINGLE game UI icon on a SOLID flat magenta #FF00FF background.
Match EXACTLY the stamped-relief-strong Melodan style from the reference:
warm BROWN aged bronze / brass rounded square tile (NOT green, NOT sage, NOT olive-green),
DEEP carved emboss (recessed glyph), bright bevel highlights on top-left edges,
dark carved shadows on bottom-right, tactile stamped metal look, matte not shiny chrome,
readable at 64px. Color = brown-bronze like the reference — never leaf-green.

Subject: winged boot for movement speed — glyph only

STRICT RULES:
- NO text, NO letters, NO digits, NO numbers, NO "+5", NO "2", NO labels
- NO checkerboard, NO gray transparency grid
- Magenta #FF00FF fills ALL empty space outside the tile
- One icon only, centered, orthographic flat GUI
EOF
)" \
  --filename misc/icons/sheets/_tmp-ui-speed.png \
  --resolution 1K
```

After keying/splitting into `misc/icons/src/<id>.png`, pack:

```bash
npm run icons:pack
```

## Why duplicates happen

Gemini sheet prompts often invent **extra variants** of the same subject (two hammers, two flames) instead of four distinct icons. Our splitter still maps cell 1→id1, cell 2→id2, so wrong or duplicate art can land on a different id. Prefer **one icon per generate call** for final masters; use sheets only for bulk drafts.

## Numbers policy

HUD shows costs/levels as real text. Icons must never contain numerals.

---

## Icon families (2026-07-29)

Melodan uses **four** visual families in one atlas (`misc/icons/src/<id>.png` → `npm run icons:pack`):

| Family | IDs | Look |
|--------|-----|------|
| **glyph-white** | `tech-*`, `ability-*`, `tactic-*`, `ui-*` | Whitish flat vector glyphs, bold black outline, no frame |
| **token-rune** | `item-*` | Carved circular medallions with internal glow (see below) |
| **sticker-emote** | `emote-*` | Simple freeform pictograms — one bold symbol, readable at 26px, no character portraits |
| **portrait-spec** | `spec-*` | Fantasy character bust stickers for specialist cards |

### Pack runes (`item-*`) — token-rune family

Player-facing name: **Runes** (`src/game/displayNames.ts`). Code id prefix stays `item-`.

**Craft lock (2026-07-31):** every rune is a **circular carved stone/metal medallion** — weathered pits, bas-relief depth, **internal luminous energy leaking through cracks/channels**. Same family as `item-wrath` / `item-vigor`. Distinct **motif + glow color** per rune so they stay readable next to each other.

| Do | Don't |
|----|-------|
| One disc only, fills most of frame | Soft candy gems / glass beads / flat stickers |
| Motif carved INTO the stone | Soft painterly “illustration on a circle” |
| Glow from *inside* cracks | Neon chrome / sci-fi UI |
| Unique silhouette at 64px | Tiny glyph in a fat empty rim |
| Magenta `#FF00FF` outside | Second disc, stacks, sheets, grids |
| No text / digits / plus signs (unless the motif *is* that symbol) | Checkerboard / transparency grid |

**Style references (prefer as `--input-image`):** `misc/icons/src/item-wrath.png` or `item-vigor.png`.  
**Full-res masters + spare concepts:** `misc/concepts/runes/` (how-to checklist there).  
**Subject lines:** `misc/icons/_regen_queue.txt` (`item-*` rows).

Shipped motifs:

| Atlas id | Name | Motif | Glow |
|----------|------|-------|------|
| `item-addi` | Valor | armored fist | brass-gold |
| `item-power` | Carnage | crossed swords | crimson-orange |
| `item-vigor` | Giant Blood | life-tree heart | emerald |
| `item-colossus` | Mithril Cuirass | kite / tower shield | silver-cyan |
| `item-wrath` | Berserk | skull in flames | fire |
| `item-golden` | Sunstone | protective sun / ward rings | gold |
| `item-earth` | Earth | mountain peaks (base) | muted ochre |
| `item-fire` | Fire | simple flame (base) | ember-orange |
| `item-water` | Water | droplet + ripples (base) | cool blue |
| `item-wind` | Wind | three gust curls (base) | pale cyan |

HUD clips them round (`.inv-item:not(.tactic)`, `.item-sq`); world badges use circular sprites.

```bash
uv run ~/.claude/skills/threejs-image-generator/scripts/generate_image.py \
  --input-image misc/icons/src/item-wrath.png \
  --resolution 1K \
  --filename misc/icons/sheets/_regen/_solo-item-<id>.png \
  --prompt "$(cat <<'EOF'
Create ONE isolated game UI item RUNE on SOLID flat magenta #FF00FF background.

Match the REFERENCE craft language: circular carved stone/metal MEDALLION, bas-relief depth,
weathered pitted surface, internal luminous energy glowing through carved cracks/channels,
hard edges, epic dark-fantasy artifact — NOT soft painterly candy, NOT flat sticker art.

CRITICAL: Exactly ONE circular disc filling most of the frame. Never two. Never stacked.

Subject: [CLEAR MOTIF — e.g. clenched armored fist] with [GLOW COLOR — e.g. brass-gold]
leaking from carved cracks. Motif must read at 64px.

FORBIDDEN: text, digits, checkerboard, second disc, soft watercolor look.
Magenta outside the single circle only.
EOF
)"
```

Then chroma-key → `misc/icons/src/item-<id>.png` (128×128) → `npm run icons:pack`.  
Wire the id in `src/game/items.ts` (`ITEMS` + icon field). Update `_regen_queue.txt` and `misc/concepts/runes/README.md`.

### Specialist portraits (`spec-*`)

Shown on specialist pick cards (`StartCard.portrait` in `src/game/cards.ts`).

Current mapping (reused from first emote character batch):

| Specialist | Atlas id | Source character |
|------------|----------|------------------|
| Air | `spec-air` | war horn + arrows |
| Cost Control | `spec-cost` | robed strategist |
| Elite | `spec-elite` | horned berserker |
| Archer | `spec-archer` | hooded ranger |
| Addi | `spec-addi` | laughing dwarf |
| Flanky | `spec-flanky` | waving knight |

To add or replace a portrait, generate **one character bust** per call:

```bash
uv run ~/.claude/skills/threejs-image-generator/scripts/generate_image.py \
  --resolution 1K \
  --filename misc/icons/sheets/_regen/_solo-spec-<id>.png \
  --prompt "$(cat <<'EOF'
Create ONE isolated game UI character PORTRAIT sticker on SOLID flat magenta #FF00FF background.

Style: Melodan fantasy auto-battler — medieval meadow campaign, bust or head-and-shoulders only.
Warm earthy illustration: leather, brass, wood, cloth. Bold dark outlines, soft painterly shading.
FREEFORM silhouette — NO tile, NO square box. Character fills most of frame.

Subject: [SPECIALIST — e.g. crow-rider captain with wind-swept cloak]

FORBIDDEN: neon colors, anime chibi, sci-fi, text/letters/digits, checkerboard.
Exactly ONE portrait — never a sheet.
Magenta #FF00FF outside the character only.
EOF
)"
```

Key to 128×128, save as `misc/icons/src/spec-<id>.png`, then `npm run icons:pack`. Wire the id in `START_CARDS[].portrait`.

### Chat emotes (`emote-*`)

Simple **symbol-only** stickers — waving hand, handshake, tear, thought cloud, etc. **No full character portraits** (those belong on `spec-*`).

```bash
uv run ~/.claude/skills/threejs-image-generator/scripts/generate_image.py \
  --resolution 1K \
  --filename misc/icons/sheets/_regen/_solo-emote-<id>.png \
  --prompt "$(cat <<'EOF'
Create ONE isolated game UI emote STICKER on SOLID flat magenta #FF00FF background.

Style: Melodan fantasy — SIMPLE pictogram, one bold symbol filling 80-90% of frame.
Warm earthy colors, bold dark outlines, minimal detail, readable at 26px.
FREEFORM — NO tile, NO box. NO full character face or bust.

Subject: [SYMBOL — e.g. single waving leather gauntlet for hello]

FORBIDDEN: character portraits, busy detail, neon, text, checkerboard.
Exactly ONE symbol. Magenta outside only.
EOF
)"
```

After keying: `misc/icons/src/emote-<id>.png` → `npm run icons:pack`. Add row in `src/game/emotes.ts` if new.
