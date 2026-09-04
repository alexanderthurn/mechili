# Melodan — i18n & fonts handoff

Updated 2026-09-04: full Steam-oriented language list wired + catalogs filled.

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
| `ar` | Noto Naskh Arabic (+ `dir=rtl`) |
| `el` | Noto Serif |

Translated catalogs in the client bundle: all IDs above (MT seed for newly added Latin/Cyrillic locales; polish as needed).

### Covered

- Settings, menu, HUD, catalogs, homepage, suggest
- Homepage language pickers (top-right + footer), shared prefs
- Device language detection for regional tags (`zh-Hant`, `es-419`, `pt-BR`, `nb`, …)

### Deferred

- Arabic RTL layout polish (direction is set; some HUD chrome may still assume LTR)
- Feuerware privacy / imprint pages (external; translate outside Melodan)
- Full human polish of MT catalogs (DE done; checklist pass done for fr→el #1–#21; Arabic + deeper tone still open)

### Intentionally English / skipped

- Protocol seat name `'Waiting…'` (wire id; display uses `menu:rosterWaiting`)
- Combat / debug overlay logs
- Dev-only bulk-verify result payloads

## Related

- Prefs: `language`
- Helpers: `src/i18n/format.ts`
- Locale notes: `locales/README.md`
- **Glossary + MT pitfall checklist (review together):** `I18N_GLOSSARY.md`
