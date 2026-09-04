# Melodan — i18n & fonts handoff

Updated 2026-09-04: full Steam-oriented language list wired + catalogs filled.

## Current state

Language → font (lazy for heavy faces):

| ID | Font |
|---|---|
| `en` | Marcellus |
| Latin / Cyrillic / Vietnamese / id / ms (`de`, `fr`, `it`, `es`, `es-419`, `ru`, `pt`, `pt-BR`, `pl`, `da`, `nl`, `fi`, `nb`, `sv`, `hu`, `cs`, `ro`, `tr`, `bg`, `uk`, `vi`, `id`, `ms`) | Exo 2 |
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
- Human review / regional polish of MT catalogs

### Intentionally English / skipped

- Protocol seat name `'Waiting…'` (wire id; display uses `menu:rosterWaiting`)
- Combat / debug overlay logs
- Dev-only bulk-verify result payloads

## Related

- Prefs: `language`
- Helpers: `src/i18n/format.ts`
- Locale notes: `locales/README.md`
