# Melodan — i18n & fonts handoff

Updated 2026-09-04: script support for hard locales (fonts + picker); en/ru/zh fully translated.

## Current state

Language → font (lazy for heavy faces):

| ID | Font |
|---|---|
| `en` | Marcellus |
| `ru` | Exo 2 |
| `zh` | Noto Serif SC |
| `zh-Hant` | Noto Serif TC |
| `ko` | Noto Serif KR |
| `ja` | Noto Serif JP |
| `th` | Noto Serif Thai |
| `ar` | Noto Naskh Arabic (+ `dir=rtl`) |
| `el` | Noto Serif |

Translated catalogs in the client bundle: `en`, `ru`, `zh`, `zh-Hant`, `ko`, `ja`, `th`, `ar`, `el`.

### Covered (translated)

- Settings, menu, HUD, catalogs, homepage, suggest (all shipped languages above)
- Homepage language pickers (top-right + footer), shared prefs

### Next

- RTL layout polish for Arabic (direction is set; some HUD chrome may still assume LTR)
- Easier Latin locales (de/fr/…) when ready — Exo 2 / Marcellus

### Intentionally English / skipped

- Protocol seat name `'Waiting…'` (wire id; display uses `menu:rosterWaiting`)
- Combat / debug overlay logs
- Dev-only bulk-verify result payloads

## Related

- Prefs: `language`
- Helpers: `src/i18n/format.ts`
- Locale scaffold notes: `locales/README.md`
