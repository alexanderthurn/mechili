# Voices — who speaks what

Single record of every ElevenLabs voice behind the game's spoken lines. Shipped audio: `assets/audio/` (English),
`assets/audio/<de|zh|ru|es>/` (same file names). A **deleted** voice can be rebuilt as an Instant Voice Clone from its
backup in `misc/sfx/voice-backups/` (`<name>.mp3` = long passage read by the voice, `<name>_lines.mp3` = its shipped
English lines strung together, `de_*_lines.mp3` = its German lines).

Model for all lines: **Eleven v4** (`eleven_v4`, `language_code` = target language). German uses **native German
voices** where a clone of the English voice kept an English accent (archer, all commanders).

Line lists: English in the unit / commander jsonc; translations in `misc/sfx/bank/vo_de.json` + `vo_de_new.json`,
`vo_zh.json`, `vo_ru.json`, `vo_es.json`. Generator: `misc/sfx/bank/gen_languages.py`.

| Character | English | German | Chinese / Russian / Spanish | Backup |
|---|---|---|---|---|
| unit `monk` (draft) | `Xy0Kz6M7gabxyM108SlT` (live) | same voice | same voice | `voice-backups/monk.mp3` |
| unit `druid` (draft) | `yRMkhayTX38fD1eVKaEO` (live) | same voice | same voice | `voice-backups/druid.mp3` |
| unit `paladin` (draft) | `SeeVpqtIRmNc7fJY5i9q` (live) — Voice Library: Diya | same voice | same voice | `voice-backups/paladin.mp3` |
| unit `knight` (draft) | `h7JBisLFUU0coQPLr3z9` (live) | same voice | same voice | `voice-backups/knight.mp3` |
| unit `assassin` (draft) | `gj4iiKNI9KlUQJ3IqgkU` (live) | same voice | same voice | `voice-backups/assassin.mp3` |
| unit `balloonBomber` (draft) | `eogQ7JfFhYbxH7McTxra` (live) | same voice | same voice | `voice-backups/balloonBomber.mp3` |
| unit `duelist` (draft) | `Lnu5aAh5ogANoC6QniNs` (live) | same voice | same voice | `voice-backups/duelist.mp3` |
| unit `warMammoth` (draft) | `MOXu51ccTA06RJmjBTRo` (live) | same voice | same voice | `voice-backups/warMammoth.mp3` |
| unit `brazenBull` (draft) | `7xuMJ0H7PN6Tzb7nInYZ` (live) | same voice | same voice | `voice-backups/brazenBull.mp3` |
| unit `hordeKnight` (draft) | `ZdVNFytAzewU0pShsGMa` (live) | same voice | same voice | `voice-backups/hordeKnight.mp3` |
| unit `hordeFarmerAlive` (draft) | `iFisiljwgLuc44ndxtO5` (live) | same voice | same voice | `voice-backups/hordeFarmerAlive.mp3` |
| unit `ogre` | original deleted | clone `2IIXD5YtOKRJsId6pVLb` (live) | clone `2IIXD5YtOKRJsId6pVLb` (live) | `voice-backups/ogre.mp3` |
| unit `mortar` | original deleted | clone `fWcNsnRsbogI4pEuOfxU` (live) | clone `fWcNsnRsbogI4pEuOfxU` (live) | `voice-backups/mortar.mp3` |
| unit `prismCannon` | original deleted | clone `O7sPgyl7EZLYxbD355EA` (live) | clone `O7sPgyl7EZLYxbD355EA` (live) | `voice-backups/prismCannon.mp3` |
| unit `wizard` | original deleted | clone `EvXzkXSJd3JzWKDemFNv` (live) | clone `EvXzkXSJd3JzWKDemFNv` (live) | `voice-backups/wizard.mp3` |
| unit `hordeFarmerSpawn` | original deleted | clone `hqczAFuO9WHek6mQcq37` (live) | clone `hqczAFuO9WHek6mQcq37` (live) | `voice-backups/hordeFarmerSpawn.mp3` |
| unit `hordeKomtur` | original deleted | clone `sgncvok1wwyqZEvVy5F3` (live) | clone `sgncvok1wwyqZEvVy5F3` (live) | `voice-backups/hordeKomtur.mp3` |
| unit `hordeSpinne` | original deleted | clone `36r8hYdTxSzZP1purD8j` (live) | clone `36r8hYdTxSzZP1purD8j` (live) | `voice-backups/hordeSpinne.mp3` |
| unit `hordeWebweaver` | original deleted | clone `hzSrhocNekTPfZnbG1is` (live) | clone `hzSrhocNekTPfZnbG1is` (live) | `voice-backups/hordeWebweaver.mp3` |
| unit `hordeZombie` | original deleted | clone `yWGik88hjyB3G0V09Bex` (live) | clone `yWGik88hjyB3G0V09Bex` (live) | `voice-backups/hordeZombie.mp3` |
| unit `archer` | original deleted | native `wyRapSIUR5NMSp1OPdb3` (live) | clone (deleted) | `voice-backups/archer_lines.mp3` · `voice-backups/de_archer_lines.mp3` |
| unit `ballista` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/ballista_lines.mp3` |
| unit `bat` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/bat_lines.mp3` |
| unit `crowRider` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/crowRider_lines.mp3` |
| unit `dwarf` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/dwarf_lines.mp3` |
| unit `goblin` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/goblin_lines.mp3` |
| unit `hammerer` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/hammerer_lines.mp3` |
| unit `hordeFarmer` | original deleted | clone (deleted) — v4, slight accent | clone (deleted) | `voice-backups/hordeFarmer_lines.mp3` |
| unit `hordeBrutSpawn` | original deleted | — (English plays) | — (English plays) | `voice-backups/hordeBrutSpawn_lines.mp3` |
| commander `addi` | original deleted | native `IiTB4ALwTQ6CgsUMEHYU` (deleted) | clone (deleted) | `voice-backups/commander_addi_lines.mp3` · `voice-backups/de_commander_addi_lines.mp3` |
| commander `air` | original deleted | native `5jc1VEVx6UOp98zRTFgL` (deleted) | — (not yet: English plays) | `voice-backups/commander_air_lines.mp3` · `voice-backups/de_commander_air_lines.mp3` |
| commander `archer` | original deleted | native `YfFxclLWUXI1cJRlEPOm` (deleted) | — (not yet: English plays) | `voice-backups/commander_archer_lines.mp3` · `voice-backups/de_commander_archer_lines.mp3` |
| commander `cost` | original deleted | native `QPRLhHy2sbiNKLrLMbec` (deleted) | — (not yet: English plays) | `voice-backups/commander_cost_lines.mp3` · `voice-backups/de_commander_cost_lines.mp3` |
| commander `cursed` | original deleted | native `UX6peKGRsinRGSqsz8lm` (deleted) | — (not yet: English plays) | `voice-backups/commander_cursed_lines.mp3` · `voice-backups/de_commander_cursed_lines.mp3` |
| commander `elite` | original deleted | native `WcBxwSG5NyzuUADmNyDJ` (deleted) | — (not yet: English plays) | `voice-backups/commander_elite_lines.mp3` · `voice-backups/de_commander_elite_lines.mp3` |
| commander `flanky` | original deleted | native `XnLJ1qKefs4htYvLwLDm` (live) | — (not yet: English plays) | `voice-backups/commander_flanky_lines.mp3` · — |
| commander `giant` | original deleted | native `P5vsREvbVn0eqD3iXx3X` (deleted) | — (not yet: English plays) | `voice-backups/commander_giant_lines.mp3` · `voice-backups/de_commander_giant_lines.mp3` |
| commander `meteor` | original deleted | native `knPkVA2LGWzVhM3cp9mk` (deleted) | — (not yet: English plays) | `voice-backups/commander_meteor_lines.mp3` · `voice-backups/de_commander_meteor_lines.mp3` |
| commander `money` | original deleted | native `FdJUEHI1qhtOxedUDaLC` (deleted) | — (not yet: English plays) | `voice-backups/commander_money_lines.mp3` · `voice-backups/de_commander_money_lines.mp3` |
| commander `speed` | original deleted | native `iMk7znD7AgztqnnP9U3F` (deleted) | — (not yet: English plays) | `voice-backups/commander_speed_lines.mp3` · `voice-backups/de_commander_speed_lines.mp3` |
| commander `tutor` | original deleted | native `t5cDKA6B0o6orbH637AO` (deleted) | — (not yet: English plays) | `voice-backups/commander_tutor_lines.mp3` · `voice-backups/de_commander_tutor_lines.mp3` |
| narrator | original deleted | clone `6LvpN0wO2IdoFvZReYOV` (live) | same clone | `voice-backups/narrator.mp3` |

## Open

- Commanders (except Addi): Chinese, Russian and Spanish not generated yet — clone from the `_lines.mp3` backup.
- Units ballista, bat, crowRider, dwarf, goblin, hammerer, hordeFarmer: German is a v4 clone with a slight English accent;
  a native German voice (like the archer) would fix it.
- hordeBrutSpawn: no translations (its voice was deleted before this pass).
