import { Vector3 } from 'three';
import { BattleSim } from './src/game/sim';
import { Unit, UNIT_TYPES } from './src/game/units';
import { DEFAULT_SETTINGS, Economy } from './src/game/settings';
import { TechTree } from './src/game/tech';

const T = (id: string) => UNIT_TYPES.find((t) => t.id === id)!;
const economy = new Economy(DEFAULT_SETTINGS.economy);
economy.setBalance('player', 1000);
economy.setBalance('enemy', 1000);
const tech = new TechTree();

const archer = T('archer');
const ok = tech.buy('player', archer, archer.techs.find((t) => t.id === 'barrel')!, economy);
console.log('bought range tech:', ok, ' supply left:', economy.balance('player'), '(expect 800)');
console.log('double-buy rejected:', !tech.buy('player', archer, archer.techs[0]!, economy));

const pStats = tech.statsFor('player', archer);
const eStats = tech.statsFor('enemy', archer);
console.log('player range:', pStats.range, '(expect 58.5) — enemy range:', eStats.range, '(expect 45)');

const config = {
    towers: DEFAULT_SETTINGS.towers,
    leveling: DEFAULT_SETTINGS.leveling,
    costOf: (t: (typeof UNIT_TYPES)[number]) => economy.costOf(t),
    statsOf: (u: Unit) => tech.statsFor(u.team, u.type),
};
const mine = new Unit(archer, { col: 0, row: 0 }, 'player', new Vector3(0, 0, 27));
const theirs = new Unit(archer, { col: 0, row: 0 }, 'enemy', new Vector3(0, 0, -27));
const sim = new BattleSim([mine, theirs], config);
sim.update(0.2);
let myShots = 0;
let theirShots = 0;
for (const e of sim.consumeEvents()) {
    if (e.kind === 'muzzle') {
        if (e.z > 0) myShots++;
        else theirShots++;
    }
}
console.log('first shots — teched side:', myShots, '(>0), unteched side:', theirShots, '(0 = still walking)');
