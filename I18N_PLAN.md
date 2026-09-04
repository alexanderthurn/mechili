# Melodan — i18n & fonts handoff

Updated 2026-09-04: language owns the typeface (no separate font picker).

## Current state

### Language → font (done)

Settings **Language** control (not UI font). Three shipped languages:

| Language | Pref id | Font | Notes |
|----------|---------|------|--------|
| English | `en` | **Marcellus** | Brand Latin serif |
| Russian | `ru` | **Exo 2** | Cyrillic |
| Chinese | `zh` | **Noto Serif SC Regular** | Full SC (~11.6 MB OTF), lazy-loaded on first zh select |

- Pref: `language` in `prefs.ts` (replaces `uiFont`). First-run default = device language if shipped, else `en`.
- Fonts: `applyLanguageFont()` in `theme.ts`. Marcellus + Exo 2 always registered; Noto SC injected on demand.
- Assets: `assets/fonts/Marcellus-Regular.ttf`, `Exo2-Variable.ttf`, `NotoSerifSC-Regular.otf` (+ OFL texts).

### i18n (scaffolded)

- Dep: `i18next` (no react-i18next).
- Runtime: `src/i18n/` — `initI18n`, `t`, `setLanguage`, `getLanguage`, detect helpers.
- Catalogs: `locales/{en,ru,zh}/common.json` + `settings.json` (Settings chrome proven live).
- Boot: `await initI18n(prefs().language)` early in `main.ts`.

## Agreed architecture

```
src/
  i18n/
    index.ts          # initI18n, t, setLanguage, getLanguage
    languages.ts      # LanguageId, native names
    detect.ts         # navigator → shipped lang
    format.ts         # unitName(id), cardTitle(id), term('rune'), … (later)
locales/
  en/
    common.json
    settings.json
    menu.json         # later
    hud.json
    units.json
    cards.json
    items.json
    tech.json
    tactics.json
  ru/ …
  zh/ …
  de/ …               # later
  es/ …
```

- Keys = existing game **ids** (`units:dwarf.name`).
- **Never translate** action kinds, net fields, unit ids, seats, telemetry.
- `displayNames.ts` (`DISPLAY`) → `common.json` terms (`term.rune`, etc.).
- Short-term: keep English `name`/`description` on defs as fallback; UI calls helpers like `unitName(id, fallback)`.

### Migration order

1. ~~Add i18next + `src/i18n/` + locale stubs + language Settings control + fonts.~~ **done**
2. Prove switch on more chrome (menu labels) as strings move.
3. Move `displayNames` → locale terms.
4. Units / cards / items / tactics names + descriptions.
5. Harvest HUD / menu strings (`hud.ts`, `main.ts` — large).
6. Add `de` / `es` / … (Latin → Marcellus) once English catalog is stable.
7. Optional: glyph-subset Noto SC if install size hurts; ja/ko would need JP/KR cuts.

## CJK size note

- **Full SC Regular:** ~11.6 MB OTF (what we ship now).
- **Glyph subset:** only chars in `zh` strings — much smaller, rebuild when copy changes.
- en/ru never download SC (lazy `@font-face`).

## Related Melodan context

- Vite + TypeScript, Three.js + Pixi/DOM HUD, `steam-electron-build`.
- Terminology map today: `src/game/displayNames.ts`.
- Prefs: `src/game/prefs.ts` (`language`).
- Architecture: `ARCHITECTURE.md`.

Diception reference (do not copy wholesale):  
`/Users/alexanderthurn/Documents/projects/diception/dev/src/core/i18n.js`  
`/Users/alexanderthurn/Documents/projects/diception/dev/src/locales/{en,de,es}.json`
