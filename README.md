# MELODAN

**FANTASY AUTO·BATTLER**

Deploy armies in secret and watch the round play out. Your enemy does the same.
Adapt, repeat until one of you runs out of HP.

**Website:** [melodan.com](https://melodan.com)  
**Play now:** [play.melodan.com](https://play.melodan.com) (free in the browser · single & multiplayer)  
**Steam:** coming soon (ranked multiplayer · play with your friends)

Built with [three.js](https://threejs.org) for the battlefield, [PixiJS](https://pixijs.com)
for the UI overlay, and [steam-electron-build](https://github.com/alexanderthurn/steam-electron-build)
for the desktop / Steam client.

## Screenshots

<p align="center">
  <img src="assets/marketing/screenshots/01.webp" alt="MELODAN screenshot 1" width="480" />
  <img src="assets/marketing/screenshots/02.webp" alt="MELODAN screenshot 2" width="480" />
  <img src="assets/marketing/screenshots/03.webp" alt="MELODAN screenshot 3" width="480" />
  <img src="assets/marketing/screenshots/04.webp" alt="MELODAN screenshot 4" width="480" />
</p>

## How it plays

- **Specialists** — before round one, each player picks a specialist. It sets your starting army, HP pool, and a permanent speciality for the rest of the match.
- **Deployment** — buy packs, level them with banked XP, buy techs and building upgrades, equip items, place wards and fire bolts; position everything on your side of the grid (flanks unlock after round 1), hidden from the enemy until the fight starts.
- **Round cards** — from round two onward there is a chance to draft from a random offer. Cards grant packs, items, or tactic charges.
- **Battle** — fully automatic: units march, fight, and cast. Survivors damage the enemy commander by their remaining value; losing a command tower debuffs your army for a while. First to 0 HP loses.
- **Tactics & spells** — rallies, spills, summons, and battle spells like the dragon’s fire breath. Some arrive as round cards; others come from buildings or specialities.

**Multiplayer:** peer-to-peer (PeerJS) with quick match, a public lobby, and named rooms — deterministic lockstep with automatic desync recovery. Reloading mid-match reconnects and resumes.

Match rules (map, timers, economy, tower debuffs) live in one JSON-serializable settings object — see `src/game/settings.ts`. Architecture notes: [ARCHITECTURE.md](ARCHITECTURE.md).

## Units & buildings

Your army and buildings: dwarves, archers, crow riders, ballistae, ward stones, fire bolts, command tower, research center, stronghold — each with stats, techs, and building abilities. Browse them on [melodan.com](https://melodan.com).

## Controls

| Input | Action |
| --- | --- |
| Left click | buy / select / place |
| Right click · drag | deselect · pan |
| Middle click · drag | rotate pack · orbit camera |
| Wheel | zoom to cursor |
| WASD / edges | pan · Q/E rotate · Home reset |

## Development

```bash
npm install
npm run dev          # browser with hot reload (game: /  ·  homepage: /web.html)
npm start            # Electron + Steam
npm run build        # game + homepage into dist/
npm run build:mac    # depot-ready build (mac | win | linux)
```

Dev URL params: `?hp=100&build=20` overrides starting HP / build timer.  
Localhost matchmaking defaults to [play.melodan.com](https://play.melodan.com); use `?branch=<name>` for a branch preview backend.

## About

MELODAN is made by **Alexander Thurn** at [Feuerware](https://feuerware.com/).

Inspired by [Mechabellum](https://www.playmechabellum.com/) — thank you for the spark. MELODAN is an independent fantasy take; please support the original.

## Contribute

Let’s make this together. The browser game is **free**; the source is **GPL-3.0**. Steam (coming soon) is for optional paid / platform features, not a lock on the core game.

- **Suggest** ideas, bugs, or how to help from [melodan.com](https://melodan.com/#suggest) or the in-game Suggest button (saved server-side; admin inbox at `backend/suggest.html`).
- **Code / PRs** on this repo — fork, invent units, open pull requests.
- **3D models** — most meshes are GLB under `assets/models/`; many were made with [Tripo3D](https://www.tripo3d.ai/) (export game-ready GLB / PBR, keep polycount reasonable). Send a PR or Suggest.
- Welcome players, write guides, help with moderation later — email if you want to take that on.

For something bigger (a new setting, commercial spin-off, full rebrand), ask at [alex@feuerware.com](mailto:alex@feuerware.com).

## License

GPL-3.0 — copyright stays with Alexander Thurn / Feuerware. Feel free to fork privately, invent new units, and open pull requests. For something bigger (a new setting, a commercial spin-off, a full rebrand), feel free to ask at [alex@feuerware.com](mailto:alex@feuerware.com).
