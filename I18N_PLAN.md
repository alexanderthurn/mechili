# Melodan — i18n & fonts handoff

Updated 2026-09-04: full player-facing pass (en / ru / zh).

## Current state

Language → font: en Marcellus / ru Exo 2 / zh Noto Serif SC (lazy).

Namespaces: `common`, `settings`, `menu`, `hud`, `suggest`, `homepage`, `units`, `items`, `tactics`, `tech`, `commanders`, `roundCards`, `buildings`.

### Covered

- Settings (incl. graphics presets / advanced) + controls help
- Menu chrome + friends + chat + emotes
- Profile / username dialog
- Suggest / feedback modal
- Lobby roster display (protocol `Waiting…` id unchanged) + status strings
- Match-settings detail sheet (`describeGameSettings` / `settings:sheet.*`)
- Content catalogs (units, runes, spells, talents, commanders, round cards, buildings)
- Tactic numeric stats (`formatTacticStats`)
- Forge / Stronghold spell names & descriptions (via helpers, not raw defs)
- Building / pack detail pane labels (`HP`, `If destroyed`, `Splash`, `LVL`, …)
- Pace / horde / round-card select blurbs
- HUD pause, game-over, shop tabs, action tiles, loadout, inventory tips
- Replay controls + load/verify status
- Round-card face extras (`Free`, flank half-time)
- Cinema atmosphere scene labels
- Homepage marketing entry (`web.html` → own `initI18n`)

### Intentionally English / skipped

- Protocol seat name `'Waiting…'` (wire id; display uses `menu:rosterWaiting`)
- Combat / debug overlay logs
- Dev-only bulk-verify result payloads

## Related

- Prefs: `language`
- Helpers: `src/i18n/format.ts`
