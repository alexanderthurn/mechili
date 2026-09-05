# Melodan — i18n & fonts handoff

Updated 2026-09-04: checklist polish through Arabic; RTL chrome uses logical CSS.

## Current state

Language → font (Marcellus by default; override only when glyphs are missing):

| ID | Font |
|---|---|
| Most languages (incl. `en`, `de`, `fr`, …) | **Marcellus** (+ Exo 2 glyph fallback) |
| `ru`, `bg`, `uk`, `vi` | Exo 2 (Cyrillic / Vietnamese) |
| `zh` | Noto Serif SC |
| `zh-Hant` | Noto Serif TC |
| `ko` | Noto Serif KR |
| `ja` | Noto Serif JP |
| `th` | Noto Serif Thai |
| `ar` | Noto Naskh Arabic (+ `dir=rtl`; menu/settings/homepage chrome mirrored) |
| `el` | Noto Serif |

Translated catalogs in the client bundle: all IDs above (MT seed + glossary checklist pass).

### Covered

- Settings, menu, HUD, catalogs, homepage, suggest
- Homepage language pickers (top-right + footer), shared prefs
- Device language detection for regional tags (`zh-Hant`, `es-419`, `pt-BR`, `nb`, …)
- Glossary howler pass for all shipped languages including Arabic
- Arabic RTL: `dir` + logical CSS for menu/settings/homepage/loadout chrome (game-spatial shop/fightbar stay physical)

### Deferred

- Feuerware privacy / imprint pages (external; translate outside Melodan)
- Optional native-speaker editorial (AI catalog deep pass done 2026-09-04)
- Optional deeper Arabic HUD tip positioning (playtest)
- Deeper `es`↔`es-419` regionalization beyond **coste/costo** (catalogs still mostly shared)

### Regional notes

- `es` vs `es-419`: shared catalogs; LATAM uses **costo** (Spain **coste**)
- `pt` vs `pt-BR`: BR kept as shared MT seed; **pt** lightly Europeanized (Definições, utilizador, ecrã, ficheiro, género)

### Intentionally English / skipped

- Protocol seat name `'Waiting…'` (wire id; display uses `menu:rosterWaiting`)
- Combat / debug overlay logs
- Dev-only bulk-verify result payloads
- Commander gag titles outside `de` keep English flavor (DE has locked translations)

## Related

- Prefs: `language`
- Helpers: `src/i18n/format.ts`
- Locale notes: `locales/README.md`
- **Glossary + MT pitfall checklist (review together):** `I18N_GLOSSARY.md`
