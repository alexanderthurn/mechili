# Melodan — Steam store asset tools

Local generators for Steamworks art. Same idea as Diception’s `scripts/steam_assets.html`.

## `steam_assets.html`

Open in a browser (from this folder so relative font/logo paths resolve):

```bash
open scripts/steam_assets.html
# or: python3 -m http.server -d . 8765  →  http://localhost:8765/scripts/steam_assets.html
```

Produces:

| Section | What |
| --- | --- |
| Store / library capsules | Exact Steam sizes, Melodan logo + menu atmosphere + clear flanks (Komtur left, big dwarf right, facing each other) |
| Section titles | One PNG per store section × language |

**Titles ZIP:** filenames use Steam’s language suffixes (`commanders_title_schinese.png`, …). English has no suffix — it is the base asset. Upload as localized versions of the same Steamworks asset.

Title copy is the Steam store section headers (EN source below). Other languages
are maintained in `gen-steam-title-strings.py`.

```bash
python3 scripts/gen-steam-title-strings.py --embed
```

Regenerates `steam_assets_titles.json` and rewrites the embedded `TITLE_SECTIONS` in the HTML.

### EN store section titles + blurbs

**ASSEMBLE MYTHICAL LEGIONS**  
You are the master tactician. Build an unstoppable army ranging from swarms of reckless goblins to stalwart dwarven infantry and towering dragons. Customize your units, set your formation on the grid, and deploy your troops. Then unleash your forces and watch the magical chaos unfold in spectacular auto-battler combat!

**OUTTHINK, DON'T OUTCLICK**  
Every decision counts. Analyze the ever-changing board, predict enemy moves, place perfect counters, and dominate opponents with your grand strategy! Victory in Melodan is determined by the sharpness of your mind, not the speed of your hand.

**MASTER YOUR MAGICAL ARMORY**  
Create a strategy that is uniquely yours. Customize your units in the deployment phase, then unlock powerful upgrades mid-battle to adapt to the enemy. Turn fragile mages into devastating area-of-effect pyromancers, or equip dwarven shieldbearers with reflective magical armor. Win the war on your own terms.

**MULTIPLE PATHS TO GLORY**  
From competitive ranked ladders to pure casual fun. Fight for supremacy in 1vs1 or 2vs2 PvP. Battle relentless waves of AI-controlled Undead in the Horde or Coop-Horde mode. With ever-changing magical modifiers, the realm always offers a new challenge.
