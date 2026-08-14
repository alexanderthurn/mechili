# Local-only source material (not committed)

Move this folder wherever you like. Most of it is **gitignored** (photos, Tripo dumps, concepts).  
Exceptions that stay in git: `misc/icons/src/` (icon masters) and `misc/steam/` (Steam store art).

The game only needs the processed files under `assets/` (webps / glbs).

| Path | Contents |
|------|----------|
| `photos/{grass,dirt,rock}/` | Your field JPGs (input for `scripts/process-ground-photos.py`) |
| `photos/water/wsc_s.png` | Dry shore stones → `shore-stones.webp` |
| `photos/water/wsc_sw.png` | Horizontal dry→wet→water strip → `shore-strip.webp` |
| `photos/water/wsc_w.png` | Open water (right crop, seam-fixed) → `water-photo-0.webp` |
| `photos/watercoast/` | Older coast plates (optional / reference) |
| `tripo-raw/high-poly/` | **Full Tripo PBR meshes (~57MB / ~1.9M tris each)** — use these to make your own low-poly |
| `tripo-raw/{tree,bush}-*/` | Intermediate Tripo dumps (task folders, renders, JSON) |
| `concepts/` | UI / icon style brainstorms (not shipped) |
| `steam/` | Steam store/library art masters + upload sizes (`STYLE.md`, `store_center/`, `library_center/`) |
| `icons/src/` | 128×128 icon masters (TexturePacker input) |
| `icons/STYLE.md` | Locked icon generation prompt |
| `icons/sheets/` | Raw Gemini icon sheets + `_regen/` solos |
| `icons/singles/` | Review contact sheets by category |
| `icons/manifest.json` | Sheet → id map for `npm run icons:split` |
| `icons/icons.png` | TexturePacker intermediate (atlas PNG) |
| Game runtime icons | `assets/icons/icons.webp` + `icons.json` only |
| Game runtime | `assets/models/scenery/*.glb` (~17k tris mid-poly currently in use) |
