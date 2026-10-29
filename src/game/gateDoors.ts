import { Box3, Vector3, type Object3D } from 'three';
import { actorTeam, type Actor } from './sim';
import type { Unit } from './units';

/**
 * A gate's doors (render-only): in battle its two leaves (the model's
 * `doorLeft` / `doorRight`, hung at the towers) swing outward — toward the
 * enemy — while one of its own side's walking units is near it, stay open a
 * moment after the last has passed, and swing shut with a small rebound.
 * Closed outside battle. Tweak live:
 * - angleDeg: how far a leaf opens
 * - near: world units from the gate's line a unit opens it from
 * - openS / closeS: seconds to swing open / shut
 * - holdS: seconds it stays open after the last unit
 * - bounce: the rebound when the leaves meet, × angleDeg; bounceS its length
 */
export const GATE_DOORS = {
    angleDeg: 80,
    near: 7,
    openS: 0.6,
    closeS: 1.2,
    holdS: 1,
    bounce: 0.05,
    bounceS: 0.3,
};

const LEAVES = ['doorLeft', 'doorRight'] as const;

interface GateState {
    /** 0 shut … 1 open (before easing) */
    open: number;
    /** seconds it stays open without a unit near */
    hold: number;
    /** seconds since the leaves met, while it rebounds */
    since: number;
}

const _box = new Box3();
const _a = new Vector3();
const _b = new Vector3();

export class GateDoors {
    private readonly state = new Map<Unit, GateState>();

    /** call every frame; `actors` null outside battle (the doors shut at once) */
    update(units: readonly Unit[], actors: readonly Actor[] | null, dt: number): void {
        for (const u of units) {
            if (!u.type.wall?.gate) continue;
            let s = this.state.get(u);
            if (!s) {
                s = { open: 0, hold: 0, since: Infinity };
                this.state.set(u, s);
            }
            if (!actors || u.destroyed) {
                s.open = 0;
                s.hold = 0;
                s.since = Infinity;
            } else {
                if (this.someoneNear(u, actors)) s.hold = GATE_DOORS.holdS;
                else s.hold = Math.max(0, s.hold - dt);
                const was = s.open;
                if (s.hold > 0) s.open = Math.min(1, s.open + dt / GATE_DOORS.openS);
                else s.open = Math.max(0, s.open - dt / GATE_DOORS.closeS);
                if (was > 0 && s.open === 0) s.since = 0;
                else s.since += dt;
            }
            this.pose(u, this.angle(s));
        }
        for (const u of this.state.keys()) if (!units.includes(u)) this.state.delete(u);
    }

    /** the leaves' angle (radians): eased open, eased shut, then the rebound */
    private angle(s: GateState): number {
        const max = (GATE_DOORS.angleDeg * Math.PI) / 180;
        if (s.open > 0) {
            const t = s.open;
            // in-out cubic: a heavy leaf gets going, then settles
            return max * (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
        }
        if (s.since < GATE_DOORS.bounceS) return max * GATE_DOORS.bounce * Math.sin((Math.PI * s.since) / GATE_DOORS.bounceS);
        return 0;
    }

    /** one of its side's living ground units within `near` of the gate's line, along its length */
    private someoneNear(u: Unit, actors: readonly Actor[]): boolean {
        const wall = u.type.wall!;
        const cx = u.world.x;
        const cz = u.world.z;
        for (const a of actors) {
            if (!a.alive || actorTeam(a) !== u.team || a.unit.type.structure || a.unit.type.flying) continue;
            const along = u.rotated ? a.z - cz : a.x - cx;
            const across = u.rotated ? a.x - cx : a.z - cz;
            if (Math.abs(along) <= wall.halfLength && Math.abs(across) <= GATE_DOORS.near) return true;
        }
        return false;
    }

    /** turn each member's leaves to `angle`, outward (away from the gate's back) */
    private pose(u: Unit, angle: number): void {
        // the enemy's side: against its back (see the wall posts)
        const frontX = -Math.sin(u.facing);
        const frontZ = -Math.cos(u.facing);
        for (const m of u.members) {
            for (const name of LEAVES) {
                const leaf = m.mesh.getObjectByName(name);
                if (!leaf) continue;
                const base = (leaf.userData.gateBaseY as number | undefined) ?? leaf.rotation.y;
                leaf.userData.gateBaseY = base;
                // which way is out: worked out again whenever the gate was turned since
                if (leaf.userData.gateSignFacing !== u.facing) {
                    leaf.userData.gateSign = outwardSign(leaf, base, frontX, frontZ);
                    leaf.userData.gateSignFacing = u.facing;
                }
                const sign = leaf.userData.gateSign as number;
                const y = base + sign * angle;
                if (leaf.rotation.y !== y) leaf.rotation.y = y;
            }
        }
    }
}

/** which way a leaf turns toward (frontX, frontZ): try a small turn and see where its middle goes */
function outwardSign(leaf: Object3D, base: number, frontX: number, frontZ: number): number {
    leaf.rotation.y = base;
    leaf.updateMatrixWorld(true);
    _box.setFromObject(leaf).getCenter(_a);
    leaf.rotation.y = base + 0.1;
    leaf.updateMatrixWorld(true);
    _box.setFromObject(leaf).getCenter(_b);
    leaf.rotation.y = base;
    leaf.updateMatrixWorld(true);
    return (_b.x - _a.x) * frontX + (_b.z - _a.z) * frontZ >= 0 ? 1 : -1;
}
