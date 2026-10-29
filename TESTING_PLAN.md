# Testing plan

How to know, without playing, that the game still works after a change. Written
2026-10-29. Nothing here is built yet.

## What exists

- **`npm run build`**: TypeScript type check plus the Vite build.
- **`npm run check:content`**: loads every data file the way the game does
  (through Vite's SSR loader), checks the schemas, and runs a set of exact
  tests: terrain grid, landscapes, the shared 2v2 forge, scenario packages,
  campaigns, level overlays, the AI counter table.
- **`npm run check:det-math`**: the deterministic math the battle sim relies on.
- **`scripts/ai-arena.mjs`**: plays The Year headless, with the real placement,
  action dispatcher, AI and BattleSim, but no renderer and no HUD. It measures
  how an AI does over many rounds.

None of these runs a match end to end the way a player does: menu → match →
build → battle → next round → result. That is the gap, and it is where most
breakage shows up (a tutorial that gets stuck, a purchase that no longer goes
through, a desync).

## Steps, cheapest first

### 1. Smoke matches (headless, extends the arena)

`scripts/smoke.mjs`, run as `npm run check:smoke`. For a fixed list of
setups (1v1, 2v2, horde, Siege attacker and defender; Easy, Medium, Hard;
Rusher, Wide, Defender), it plays a few rounds AI against AI with fixed seeds
and fails on any of these:

- an exception anywhere (dispatcher, AI, sim);
- a side that places nothing in a round it could afford to;
- a battle that doesn't end within its time limit;
- a match that doesn't reach a result;
- an action the AI sends that the dispatcher refuses — a refused action
  usually means the AI and the rules disagree (as with archers counting as
  buys).

Reuses the arena's browser stubs. Seconds per setup, so all of them stay
under a minute.

### 2. Determinism

The lockstep relies on every client computing the same battle. Two checks,
both in the smoke script:

- **Same seed, same result**: play each setup twice and compare the sim's
  state hash at every battle end.
- **Replay equals live**: record the action log of a smoke match, replay it
  through a fresh dispatcher and sim, and compare the hashes. This is exactly
  what a rejoining client or a spectator does.

A difference fails with the round and the first differing actor.

### 3. Golden replays (behaviour changes)

Keep a few recorded matches (seed plus actions, the game's replay export) in
`scripts/fixtures/replays/`, with their final hash and score. The check
replays them and reports any change. A change is either a bug or an
intended balance change; for the latter, a `--update` flag rewrites the
expected values, and the diff shows up in the commit.

### 4. Tutorials

The tutorials are the part played most often by hand, and the easiest to break
without noticing (tonight's buy limit change would have stuck lesson 2).

Two options:

- **Headless lesson bot.** Each lesson's guide already has named steps
  (`r1Archers`, `r3Recruit`, …) and a state check for when a step is done. A
  bot maps each step to the action a player would take (buy the archer, place
  it on the marked slot, end deployment) and dispatches it, then checks that
  the guide moves on. It needs the `TutorialRuntime` host without the
  renderer, which is the most work in this plan: the runtime talks to the HUD
  directly in places, and those would need stubs.
- **Browser test** (Playwright, in CI only). A dev-only `window.__melodan` hook
  exposes the guide's current step and a way to dispatch actions; the script
  plays each lesson through the real game, with WebGL in software. Slower and
  heavier, but it also catches HUD and input problems that the headless bot
  can't see.

Start with the headless bot for lesson 2 (Stronghold only, no army
placement), then extend to the others.

### 5. Performance budget

A headless benchmark of a fixed big battle (two full armies, walls, a horde
wave): milliseconds per sim step, and the AI's build time per round. It
records the numbers in a file, and the check fails when one gets more than
about 20 % worse than the recorded value. Rendering performance is left to
manual testing; a headless run can't measure it.

## Where to run it

- Locally: `npm run check` runs build, content, det-math and smoke (steps 1 and 2).
- GitHub Actions: the same on every push to `horde` and `main`, before the Steam
  workflow uploads anything. Steps 3–5 can start as local-only scripts and move
  into CI once they are stable.

## Order

1. Smoke matches and determinism (steps 1 and 2): the most value for the least work.
2. The lesson bot for tutorial 2, then the other lessons.
3. Golden replays and the performance budget.
4. The browser test, only if the HUD keeps breaking in ways the headless checks miss.
