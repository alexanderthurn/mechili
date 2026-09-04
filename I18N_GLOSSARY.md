# Melodan — i18n glossary & MT polish notes

Draft for joint review. **German (`de`) howlers + `du` are being applied in catalogs; other languages still need a pass using the checklist below.**

## Glossary (proposed — lock together)

Game / brand terms. Prefer these over literal MT. Keep brands untranslated.

| English (source sense) | Proposed DE | Do **not** use | Notes |
|---|---|---|---|
| Pack (unit group on the field) | **Pack** / **Packs** | Paket, Packung | Loanword; neuter-ish *ein Pack* is fine in UI |
| Steam (platform) | **Steam** | Dampf, Vapor, Stoom, … | Brand — every language |
| Discord (platform) | **Discord** | Zwietracht, Discordia, Discorde, … | Brand — every language |
| GitHub | **GitHub** | — | Brand |
| Feuerware | **Feuerware** | — | Brand |
| MELODAN | **MELODAN** | — | Brand |
| Commander | **Kommandant** | — | masc.; *einen Kommandant* / *deinen Kommandanten* |
| Spell (tactic strip ability) | **Zauber** | Fluch (curse) | Plural often also *Zauber* in UI |
| Rune (item) | **Rune** / **Runen** | — | |
| Talent (tech) | **Talent** / **Talente** | — | |
| Stronghold | **Hochburg** | — | Already used in unit catalog |
| Vanguard (building / tower) | **Vorhut** | leave mixed *Vanguard* in notes | Align settings notes with building name |
| charge (one use on spell strip) | **Aufladung** | Ladung (cargo) | “grants one charge” |
| supply / supplies | **Vorrat** / **Vorräte** | Lieferung | Refund / economy |
| Matchmaking | **Spielersuche** | Partnervermittlung, Matchmaking | Locked for DE |
| Ward dome | **Schutzkuppel** | Kuppel des Ward | Locked |
| Ward Stone | **Schutzstein** | Ward Stone | Locked with Schutzkuppel |
| Webweaver | **Netzweber** | Webweaver | DE gag/name pass |
| Flanky Shadow | **Flankenschatten** | Flanky Shadow | |
| Lady Lecture | **Frau Vortrag** | Lady Lecture | |
| Lord Hitzkopf | **Fürst Hitzkopf** | Lord Hitzkopf | |
| Mechabellum | **Mechabellum** | Mechabelum | Double **l** — brand spelling |
| room (lobby) | **Raum** | Zimmer | |
| unit shop | **Shop** / **Einheiten-Shop** | Werkstatt | Screenshot blurb |
| round card | **Rundenkarte** | runde Karte | Not “round-shaped” |
| Wishlist | **Wunschliste** | — | CTA *Jetzt auf die Wunschliste* is OK |
| Imprint | **Impressum** | — | |
| Data privacy | **Datenschutz** | — | |
| Deployment | **Einsatz** / **Einsatzphase** | Bereitstellung (often too long) | Prefer consistent *Einsatz* |
| Middle-mouse drag | **Mittlere Maustaste ziehen** | Mittlerer Zug | |
| Level (verb, upgrade packs) | **aufwerten** / **Level** | Nivellierung | |
| made by (indie credit) | **entwickelt von** / **von … gemacht** | hergestellt | |
| Move Pack | **Bewegungs-Pack** | Umzugs-Pack | *Umzug* = moving house |
| Rally Route | **Rally-Route** | Rallye-Strecke | *Rallye* = motorsport |
| range (attack) | **Reichweite** | Spanne, Bereich | |
| Pitch Bolts | **Pechbolzen** | Pitch-Bolzen | *Pitch* = tar |
| Cancel (UI) | **Abbrechen** | Stornieren | |
| Menu (pause) | **Menü** | Speisekarte | |
| Draw (tie) | **UNENTSCHIEDEN** | Ziehen | |
| Defeat | **NIEDERLAGE** | Verlust | |
| Look (settings) | **Aussehen** | Suchen | |
| Controls | **Steuerung** | Bedienelemente | |
| Pan (camera) | **Schwenken** | Pfanne | frying pan |
| Custom | **Benutzerdefiniert** | Brauch | |
| Native (resolution) | **Nativ** | Einheimisch | |
| About | **Über** | Um | |
| Bug / Balance / Feature (suggest cats.) | **Bug** / **Balance** / **Feature** | Insekt / Gleichgewicht / Besonderheit | |
| Shop | **Shop** | Geschäft, Werkstatt | |
| supply | **Vorrat** / **Vorräte** | Lieferung, Versorgung, Angebot | |

Tone: **du** everywhere in German player UI (not *Sie*, not mixing *ihr* on marketing lines unless intentional plural address).

---

## Cross-language checklist (where MT already failed)

Use these **keys** when spot-checking `fr`, `es`, `it`, `pl`, … Same English sense → same class of error.

### Brands (already forced to English in catalogs once; re-check if regenerating MT)

| Key | EN | Bad MT examples seen |
|---|---|---|
| `homepage:footer.steam` | Steam | Dampf, Vapeur, Vapor, Stoom, Para, Buhar, Hơi nước, … |
| `homepage:contribute.discord` | Discord | Zwietracht, Discorde, Discordia, Disharmoni, Негода, … |
| `menu:transportSteam` | Steam | same vapor words as above |

### Pack = unit group (not parcel)

| Key examples | EN sense | Bad MT |
|---|---|---|
| Many `hud:*`, `settings:controlsMouse.select`, `tactics:sellUnit` / `moveUnit`, `buildings:move_pack`, `homepage:runes.sub`, `homepage:showcase.sub` | pack / packs | Paket/Pakete, paquete, paquet, pakket, pakiet, pacote, Packung |
| `settings:sheet.strongholdLifelineNote` | pack | DE still had **Packung** before polish |

### Address / grammar

| Key examples | Issue |
|---|---|
| `homepage:commanders.sub` | *eine {{commander}}* + lowercased *kommandant* (gender + `.toLowerCase()`); fixed in DE + `midTerm()` |
| `homepage:commanders.select`, `runes.select`, `tactics.select`, many `hud:*` | formal **Sie** vs informal **du** mix |
| `homepage:lead` | plural *eure* vs *du* elsewhere |

### Howlers (fix in DE; verify same keys elsewhere)

| Key | EN | Bad DE (before fix) | Likely other-lang failure mode |
|---|---|---|---|
| `menu:matchmaking` | Matchmaking | Partnervermittlung | dating-agency / “pairing” calques |
| `menu:inviteFailed` | hosting a room | Zimmer | hotel “room” |
| `settings:controlsKeys.middleDrag` | Middle drag | Mittlerer Zug | “train” / “move” for mouse drag |
| `homepage:roundCards.select` | round card | runde Karte | “circular” card |
| `homepage:about.lead` | made by | hergestellt | “manufactured” |
| `hud:forgeCancelRefund` | supply back | Lieferung | shipment/delivery |
| `settings:sheet.levelCostNote` | leveling is a purchase | Nivellierung / Anschaffung | surveying / acquisition jargon |
| `buildings:move_pack.description` (and similar) | once per match | Einmal pro Spielzug | “per turn” ≠ per match |
| `homepage:shot.2` | unit shop | Werkstatt | workshop |
| `homepage:flag.flying` | Flying | Fliegen | verb instead of adjective |
| `homepage:flag.attacksGround` | Attacks ground | Angriffe am Boden | wrong parse |
| `homepage:flag.shield` / ward dome | Ward dome | Kuppel des Ward | awkward English leftover |
| `hud:levelAll` | Level All | Level Alle | calque word order |
| `menu:waitingForFriend` | Waiting for… | Du wartest… | narrative “you are waiting” |
| `tactics:oilSpill.name` | Oil Spill | Ölpest | disaster headline |
| `tactics:acidSpill.name` | Acid Spill | Säureunfall | accident headline |
| `tactics:storm.name` | Storm Call | Sturmwarnung | weather warning |
| `tactics:fireSpill.name` | Fire Spill | Feuer ausgelaufen | spilled fire |

### English source nits (all langs)

| Key | Issue |
|---|---|
| `homepage:about.inspired` | Typo **Mechabelum** → fixed to **Mechabellum** (all locales) |

---

## German polish status

- [x] Brands Steam / Discord (earlier)
- [x] Pack loanword sweep (earlier; Packung leftovers in howler pass)
- [x] Unify **du** (no remaining formal *Sie* in `locales/de`)
- [x] Fix howlers listed above (+ Matchmaking/Raum sweep in `menu.json`)
- [ ] Full line-by-line DE pass (human)
- [ ] Confirm glossary table with you (this file)

## Checklist polish status (all shipped langs)

Applied glossary howler pass (not full native line-by-line):

- [x] `fr` … `tr` (#1–#10)
- [x] `uk` … `el` (#11–#21)
- [x] `ar` (#22) — strings mostly clean; Pack loanword + suggest cats; RTL chrome

Also done in the follow-up pass:

- [x] Arabic RTL logical CSS (menu / settings / homepage / loadout); game-spatial shop & fightbar unchanged
- [x] Pack parcel leftover sweep in high-vis files (`cs`/`hu`/`ro`/`tr`/`id`/`ms`/`uk`/`bg`/`vi`/…)
- [x] Commander gag titles outside `de` restored to English flavor names

Still deferred: full human tone/catalog pass on long unit/item blurbs; Feuerware imprint pages.

## Related

- Catalogs: `locales/{lang}/`
- Tone helper: `midTerm()` in `src/i18n/format.ts` (no mid-sentence lowercasing except `en`)
- Plan: `I18N_PLAN.md`
