# Melodan — i18n & fonts handoff

Updated 2026-09-04: broad content + HUD harvest for en/ru/zh.

## Current state

### Language → font (done)

| Language | Pref id | Font |
|----------|---------|------|
| English | `en` | Marcellus |
| Russian | `ru` | Exo 2 |
| Chinese | `zh` | Noto Serif SC Regular (lazy) |

### i18n (in progress — large catalogs live)

- Dep: `i18next`
- Runtime: `src/i18n/` — `initI18n`, `t`, `setLanguage`, `onLanguageChange`, `format.ts` helpers
- Namespaces: `common`, `settings`, `menu`, `hud`, `units`, `items`, `tactics`, `tech`, `commanders`, `roundCards`, `buildings`
- `DISPLAY` terms resolve via `common:term.*`
- Content helpers: `unitName`, `itemName`/`itemDescription`, `tacticName`/`tacticDescription`, `techName`/`techBlurb`, `commander*`, `roundCard*`, `buildingAbility*`
- English on defs remains fallback via `defaultValue`

### Still English (come back later)

- Many lobby/status/`setStatus` strings in `main.ts`
- Profile / username dialog
- Suggest / feedback overlay
- Match settings detail sheet blurbs (`settings.ts` describe rows)
- Pace / horde / round-card preset option blurbs
- Emote labels
- Homepage marketing copy
- Some HUD action-tile titles/descriptions not yet on `hud:*`
- Combat/debug logs (skip)

## Migration order

1. ~~Scaffold + language→font.~~ **done**
2. ~~Menu chrome.~~ **done**
3. ~~`displayNames` → terms + content catalogs + helpers.~~ **done**
4. ~~HUD pause / game-over / shop tabs / loadout / friends / chat strip.~~ **mostly done**
5. Remaining English surfaces listed above.
6. `de` / `es` / … once catalogs stable.
7. Optional Noto SC glyph subset.

## Related

- Prefs: `language`
- Architecture: `ARCHITECTURE.md`
