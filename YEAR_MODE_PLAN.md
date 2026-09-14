# The Year — round tally, multiplayer, menu

## 1. Rules

- A Year is a fixed number of rounds (9). Every round is one battle from full
  side HP (1 each); its winner is the side with more HP left, a tie goes to the
  defender.
- Nothing ends the match early: all rounds are played, each round's winner is
  recorded (attacker / defender).
- After the last round the side with more round wins wins the Year
  ("5× Defender, 4× Attacker → Defender wins"). With an odd round count there
  is no tie; an even count's tie goes to the defender.
- A forfeit / quit still ends the match at once (the side that left loses).

## 2. State

- `Game.yearRounds: ('attacker' | 'defender')[]` — the winner of each finished
  round. Derived from the battles, so a resume/replay/reconnect rebuilds it by
  replaying the log (the SP save no longer carries a win counter).
- The attacking side is canonical: `ClimbSettings.attackerSide` (0 = the
  host's side, 1 = the other) in multiplayer; single player keeps
  `humanRole`. `Game.yearAttackerTeam()` maps either to the local team label,
  so every client decides the same round the same way.
- `ClimbSettings.roundsToWin` becomes `rounds` (old saves are migrated in
  `normalizeGameSettings`).

## 3. Multiplayer

- Custom Game gets a third layout: **The Year (1v1)**, with a lobby setting
  "Attacker: host / guest". `lobbyMatchSettings` applies the Year to the
  match settings, which travel to guests in `starSetup` as today.
- Everything per seat that today assumes "the human is the local player"
  becomes per controller / per canonical side:
  - the free Sell Pack charge: every human seat;
  - round income: human seats get the Year's growth, AI seats the normal one;
  - raised deploy cap: AI seats (they rebuild each round), not "not me";
  - the round outcome and match end run in star mode and for spectators too.
- Bots in a Year room play the Year AI as in single player.

## 4. UI

- **Loading screen** (intro cover): "Round n / 9" plus a row of 9 round marks —
  won rounds filled in the attacker's or defender's colour, the coming round
  outlined, later ones empty — and the tally "Attacker 3 · 2 Defender" with
  the local side marked.
- **Between rounds**: the round splash shows who took the round and the same
  marks.
- **End screen**: big "Defender wins", the tally "5 × Defender · 4 × Attacker",
  the 9 marks in order, and Victory/Defeat for the local side; spectators see
  the neutral headline.

## 5. Menu

- Main menu: Tutorial, Single Player, Multiplayer.
- Multiplayer: Matchmaking, Custom Game, and the open lobbies list (moved from
  the main menu; the room poll runs while that view is open).
- Custom Game: 1v1, 2v2, 2 vs AI, The Year.
