# Locales

Loaded eagerly via `import.meta.glob` in `src/i18n/index.ts`.

Shipped languages (see `src/i18n/languages.ts`):

`en`, `de`, `fr`, `it`, `ko`, `es`, `es-419`, `zh`, `zh-Hant`, `ru`, `th`, `ja`, `pt`, `pl`, `da`, `nl`, `fi`, `nb`, `sv`, `hu`, `cs`, `ro`, `tr`, `ar`, `pt-BR`, `bg`, `el`, `uk`, `vi`, `id`, `ms`

Heavy script fonts (CJK / Thai / Arabic / Greek) load lazily when selected.
Latin / Cyrillic / Vietnamese use Exo 2; English uses Marcellus.

Glossary + MT pitfall checklist (joint review): see `I18N_GLOSSARY.md`.
