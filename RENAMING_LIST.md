# Mechili Name Customization Sheet

Edit the text in the **"Your Chosen Name"** column below. When you're happy with your choices, save this file and tell me in chat!

---

## 0. System category names (player-facing)

Code still uses `item` / `tech` internally. Display strings live in `src/game/displayNames.ts`.

| System | Old display name | Current display name |
| :--- | :--- | :--- |
| Pack equippables (`items.ts`) | Items | **Runes** |
| Unit research (`techCatalog.ts`) | Techs | **Talents** |
| Castable orders (`tactics.ts`) | Tactics | **Spells** |

---

## 1. Items / Runes (`src/game/items.ts`)

Player-facing category: **Runes**. Icon craft (carved medallion + internal glow): see `misc/icons/STYLE.md` and `misc/concepts/runes/README.md`.

| Internal ID | Current Name | Suggested Fantasy Name | Your Chosen Name |
| :--- | :--- | :--- | :--- |
| `addi` | Valor | Valor | |
| `power` | Carnage | Carnage | |
| `vigor` | Giant Blood | Giant Blood | |
| `colossus` | Mithril Cuirass | Mithril Cuirass | |
| `wrath` | Berserk | Berserk | |
| `golden` | Sunstone | Sunstone | |

---

## 2. Specialists / Commanders (`src/game/cards.ts`)

| Internal ID | Current Title | Suggested Fantasy Title | Your Chosen Name |
| :--- | :--- | :--- | :--- |
| `air` | Air Specialist | Sky Sorcerer | |
| `cost` | Cost Control Specialist | Greedy Prince | |
| `elite` | Elite Specialist | Elite Prince | |
| `archer` | Archer Specialist | Archer Specialist | |
| `addi` | Addi Specialist | Relic Keeper | |
| `flanky` | Flanky Specialist | Flanky Shadow | |

---

## 3. Building Abilities (`src/game/buildingAbilities.ts` & `src/game/settings.ts`)

| Feature | Current Name | Suggested Fantasy Name | Your Chosen Name |
| :--- | :--- | :--- | :--- |
| Vanguard Unlock | Unlock Selling | Selling | |
| Vanguard ATK | Army attack boost | Attack Boost | |
| Vanguard HP | Army HP boost | HP Boost | |
| Vanguard Rally | Buy Rally Route | Rally Route | |
| Garrison L2 | Recruit at Level 2 | Veteran Training | |
| Garrison Deploy | +1 Deployment | +1 Deployment | |
| Garrison Range | Range Boost | Range Boost | |
| Garrison Speed | Speed Boost | Speed Boost | |
| Garrison Credit | Credit | Loan | |
