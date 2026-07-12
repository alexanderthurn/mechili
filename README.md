# MECHILI

A 3D auto-battler in the spirit of Mechabellum: deploy mech packs in secret,
watch the round play out, adapt, repeat — until one commander runs out of HP.

Built with [three.js](https://threejs.org) for the battlefield, [PixiJS](https://pixijs.com)
for the UI overlay (HTML-in-canvas), and shipped to Steam via
[steam-electron-build](https://github.com/alexanderthurn/steam-electron-build).

## How it plays

- **Specialist pick** — before round 1 each player chooses a specialist
  card: a starting army, HP pool, and a permanent speciality.
- **Deployment phase** — buy packs, level them with banked XP, buy techs
  and tower upgrades, equip items, place shields and rockets; position
  everything on your side of the grid (flanks and the center strip unlock
  after round 1), hidden from the enemy until the fight starts. From round
  2 a card offer opens each round. Ends via button or timer.
- **Battle phase** — fully automatic: every mech walks at the closest enemy
  it can attack, packs split around obstacles, bullets fly and hit whatever
  is actually in the way. Watch at 0.25×–8×.
- Survivors damage the enemy commander by their remaining value; losing a
  command tower debuffs your army for a while. First to 0 HP loses.

**Multiplayer**: peer-to-peer (PeerJS) with quick match, a public lobby and
named rooms — deterministic lockstep with automatic desync recovery, and
reloading mid-match reconnects and resumes.

All match rules (map layout, timers, economy, tower debuffs) live in one
JSON-serializable settings object — see `src/game/settings.ts`. How the
whole thing fits together (action log, determinism rules, wire protocol,
extension checklists): see [ARCHITECTURE.md](ARCHITECTURE.md).

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
npm run dev          # browser with hot reload
npm start            # the real thing: Electron + Steam
npm run build:mac    # depot-ready build (mac | win | linux)
```

Dev URL params: `?hp=100&build=20` overrides starting HP / build timer.

## License

GPL-3.0
