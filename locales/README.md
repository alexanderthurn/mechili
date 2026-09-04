# Locales

Loaded eagerly via `import.meta.glob` in `src/i18n/index.ts`.

Shipped languages (see `src/i18n/languages.ts`):

`en`, `de`, `fr`, `it`, `ko`, `es`, `es-419`, `zh`, `zh-Hant`, `ru`, `th`, `ja`, `pt`, `pl`, `da`, `nl`, `fi`, `nb`, `sv`, `hu`, `cs`, `ro`, `tr`, `ar`, `pt-BR`, `bg`, `el`, `uk`, `vi`, `id`, `ms`

**Font:** Marcellus by default. Exo 2 only for Cyrillic (`ru`/`bg`/`uk`) and Vietnamese (`vi`). Noto faces for CJK / Thai / Arabic / Greek (lazy-loaded).

Glossary + MT pitfall checklist (joint review): see `I18N_GLOSSARY.md`.
