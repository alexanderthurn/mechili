/**
 * The automatic battle camera: a small director that films the battle in
 * shots — for replays and the films taken from them (replayFilm.ts).
 *
 * Purely visual: it only reads the sim's actors (hp, position, alive) and
 * moves the camera. It never touches sim state or the sim's random numbers
 * (its own seeded generator picks the angles, so a preview and its export
 * get the same shots), so it can't change a battle or desync anything.
 *
 * Heat: every actor that loses hp (or dies) gains heat, weighted by how big
 * the unit is; it fades with a half-life of HEAT_HALF_LIFE seconds of game
 * time. A group is the heat within GROUP_RADIUS of a point.
 *
 * Shots:
 *  - wide: high above, the whole battle — the opening, a lull, and the end
 *    (one side down to its last units).
 *  - medium: one fight, from an angle of its own (heading off the viewer's,
 *    a pitch of its own). It sticks to its fight for the whole shot — it
 *    follows that fight as it moves, it never ping-pongs to another — and
 *    only ends early when its fight dies down.
 *  - close: one unit in the thick of it, low and near, the camera slowly
 *    circling it.
 * Order: wide → medium → (close or another medium) → medium → …; every
 * move between them glides (critically damped springs on pan, zoom,
 * heading and pitch).
 *
 * The viewer can still take the camera: a pan, zoom or turn of their own
 * hands it to them for MANUAL_HOLD seconds, then it eases back.
 */
import type { CameraRig, RigState } from '../engine/cameraRig';
import { actorTeam, type Actor } from './sim';

// ---- the feel: tune these ----

/** heat halves every this many seconds of game time */
const HEAT_HALF_LIFE = 1.2;
/** heat for losing a whole unit's worth of hp */
const HEAT_PER_HP_LOST = 3;
/** extra heat for dying */
const HEAT_DEATH = 2.5;
/** a group: everything this close (metres) to a point */
const GROUP_RADIUS = 22;
/** below this, a fight is not worth a shot */
const MIN_GROUP_HEAT = 0.4;
/** a close shot's unit needs at least this much heat around it */
const MIN_CLOSE_HEAT = 1.2;

const DEG = Math.PI / 180;
/** the shots: how long (seconds, min…max), pitch (degrees), heading off the viewer's (± degrees) */
const WIDE = { seconds: [3.5, 5], pitch: 68, heading: 0 } as const;
const MEDIUM = { seconds: [6, 9], minSeconds: 3, pitch: [42, 58], heading: [8, 35] } as const;
const CLOSE = { seconds: [4, 6], pitch: [28, 38], heading: [10, 45], zoom: [28, 38], orbitDegPerSec: 6 } as const;
/** after a medium shot, the chance the next is a close one (when a unit is worth it) */
const CLOSE_CHANCE = 0.5;
/** seconds without a fight before the camera goes wide */
const LULL_SECONDS = 2.5;
/** the end: a side down to this share of its units (or MIN_UNITS_LEFT) — the camera stays wide */
const END_SHARE = 0.15;
const MIN_UNITS_LEFT = 2;

/** spring times (seconds to mostly arrive) */
const PAN_SMOOTH = 1.6;
const ZOOM_SMOOTH = 2.4;
const ANGLE_SMOOTH = 2.6;
/** top pan speed, metres per second */
const PAN_MAX_SPEED = 22;
/** zoom ranges (orbit distance) */
const MEDIUM_ZOOM: readonly [number, number] = [50, 140];
const WIDE_ZOOM: readonly [number, number] = [90, 230];
/** air around the framed group, metres */
const FRAME_MARGIN = 10;
/** orbit distance per metre of half-extent to fit (fov 50°, pitch ~55°) */
const ZOOM_PER_METRE = 2.1;
/** where in the picture the group sits, 0 top … 1 bottom: a bit above the middle reads as centred */
const FOCUS_SCREEN_Y = 0.42;
/** seconds the camera is the viewer's after they pan, zoom or turn */
const MANUAL_HOLD = 4;
/** how many hot units are grouped (the hottest) — bounds the work in a big horde */
const MAX_HOT = 64;

interface Spring {
    value: number;
    velocity: number;
}

/** critically damped spring step (as Unity's SmoothDamp) */
function smoothDamp(s: Spring, target: number, smoothTime: number, dt: number, maxSpeed = Infinity): void {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = s.value - target;
    const maxChange = maxSpeed * smoothTime;
    change = Math.max(-maxChange, Math.min(maxChange, change));
    const to = s.value - change;
    const temp = (s.velocity + omega * change) * dt;
    s.velocity = (s.velocity - omega * temp) * exp;
    let next = to + (change + temp) * exp;
    // no overshoot past the target
    if (target - s.value > 0 === next > target) {
        next = target;
        s.velocity = 0;
    }
    s.value = next;
}

/** small seeded generator — the camera's own, never the sim's */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** how much a unit counts: bigger, costlier units draw the eye more */
function sizeWeight(a: Actor): number {
    const cost = a.unit.type.cost || 50;
    return Math.max(0.6, Math.min(3, Math.sqrt(cost / 100)));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Group {
    x: number;
    z: number;
    heat: number;
    /** heat-weighted spread, metres */
    radius: number;
}

type Shot =
    | { kind: 'wide'; length: number }
    | { kind: 'medium'; length: number; pitch: number; heading: number; x: number; z: number }
    | { kind: 'close'; length: number; pitch: number; heading: number; zoom: number; orbit: number; unit: number; diedAt: number | null };

export class BattleCamera {
    private heat = new Float32Array(0);
    private lastHp = new Float32Array(0);
    private wasAlive = new Uint8Array(0);
    private actorsSeen: readonly Actor[] | null = null;
    /** units per team at the battle's start (structures don't count) */
    private startCount = new Map<string, number>();

    private random = mulberry32(1);
    private shot: Shot = { kind: 'wide', length: 0 };
    private shotTime = 0;
    private battleTime = 0;
    private quietFor = 0;
    /** the viewer's heading at the battle's start: every angle is taken off it, so their side stays at the bottom */
    private baseHeading = 0;
    /** heading sides alternate from shot to shot, so the angles vary */
    private side = 1;

    private readonly px: Spring = { value: 0, velocity: 0 };
    private readonly pz: Spring = { value: 0, velocity: 0 };
    private readonly zoom: Spring = { value: 75, velocity: 0 };
    private readonly heading: Spring = { value: 0, velocity: 0 };
    private readonly pitch: Spring = { value: 0, velocity: 0 };
    private aim = { x: 0, z: 0, zoom: 75, heading: 0, pitch: 0 };
    /** the pose it set last frame — anything else means the viewer moved the camera */
    private lastSet: RigState | null = null;
    private manualFor = 0;

    /** a new battle: forget the heat, open wide, start the springs where the camera is */
    reset(rig: CameraRig, actors: readonly Actor[]): void {
        this.actorsSeen = null;
        this.manualFor = 0;
        this.lastSet = null;
        this.battleTime = 0;
        this.quietFor = 0;
        this.random = mulberry32(0x9e3779b9 ^ actors.length);
        this.side = 1;
        const p = rig.getPose();
        this.baseHeading = p.heading;
        for (const [s, v] of [
            [this.px, p.x],
            [this.pz, p.z],
            [this.zoom, p.zoom],
            [this.heading, p.heading],
            [this.pitch, p.pitch],
        ] as const) {
            s.value = v;
            s.velocity = 0;
        }
        this.aim = { x: p.x, z: p.z, zoom: p.zoom, heading: p.heading, pitch: p.pitch };
        this.startCount.clear();
        for (const a of actors) {
            if (!a.alive || a.unit.type.structure) continue;
            const team = String(actorTeam(a));
            this.startCount.set(team, (this.startCount.get(team) ?? 0) + 1);
        }
        this.startShot({ kind: 'wide', length: this.between(WIDE.seconds) });
    }

    /**
     * One frame. `dt`: real seconds (the glide); `gameDt`: battle seconds
     * (the heat — paused stays paused). `fit`: how much of the window the
     * picture shows, min(view h, view w · aspect) — a Short's narrow area
     * needs the camera further out to fit the same group.
     */
    update(dt: number, gameDt: number, actors: readonly Actor[], rig: CameraRig, fit: number): void {
        if (dt <= 0) return;
        this.readHeat(actors, gameDt);

        // the viewer took the camera: theirs for a while, then glide back from where they left it
        const pose = rig.getPose();
        if (this.lastSet) {
            const l = this.lastSet;
            const moved =
                Math.abs(pose.x - l.x) > 0.05 ||
                Math.abs(pose.z - l.z) > 0.05 ||
                Math.abs(pose.zoom - l.zoom) > 0.05 ||
                Math.abs(pose.heading - l.heading) > 0.002 ||
                Math.abs(pose.pitch - l.pitch) > 0.002;
            if (moved) this.manualFor = MANUAL_HOLD;
        }
        if (this.manualFor > 0) {
            this.manualFor -= dt;
            this.px.value = pose.x;
            this.pz.value = pose.z;
            this.zoom.value = pose.zoom;
            this.heading.value = pose.heading;
            this.pitch.value = pose.pitch;
            this.px.velocity = this.pz.velocity = this.zoom.velocity = this.heading.velocity = this.pitch.velocity = 0;
            this.lastSet = null;
            return;
        }

        this.battleTime += gameDt;
        this.shotTime += dt;
        this.direct(actors, dt, fit);

        smoothDamp(this.px, this.aim.x, PAN_SMOOTH, dt, PAN_MAX_SPEED);
        smoothDamp(this.pz, this.aim.z, PAN_SMOOTH, dt, PAN_MAX_SPEED);
        smoothDamp(this.zoom, this.aim.zoom, ZOOM_SMOOTH, dt);
        smoothDamp(this.heading, this.aim.heading, ANGLE_SMOOTH, dt);
        smoothDamp(this.pitch, this.aim.pitch, ANGLE_SMOOTH, dt);

        // set the angle and distance first, then measure where the picture's focus point
        // (FOCUS_SCREEN_Y — and a Short's area off to the side) lands, and shift so the subject sits there
        rig.setPose({ x: this.px.value, z: this.pz.value, zoom: this.zoom.value, heading: this.heading.value, pitch: this.pitch.value });
        const focus = rig.screenToGround(0.5, FOCUS_SCREEN_Y, 1, 1);
        const offX = focus ? this.px.value - focus.x : 0;
        const offZ = focus ? this.pz.value - focus.z : 0;
        rig.setPose({ x: this.px.value + offX, z: this.pz.value + offZ, zoom: this.zoom.value, heading: this.heading.value, pitch: this.pitch.value });
        this.lastSet = rig.getPose(); // after the rig's own clamps
    }

    // ---- the director ----

    private between(range: readonly [number, number] | readonly number[]): number {
        return range[0]! + (range[1]! - range[0]!) * this.random();
    }

    private startShot(shot: Shot): void {
        this.shot = shot;
        this.shotTime = 0;
    }

    /** picks the shot (when the current one is over) and sets {@link aim} for it */
    private direct(actors: readonly Actor[], dt: number, fit: number): void {
        const hot = this.hotUnits(actors);
        const best = this.hottestGroup(actors, hot);
        const fighting = best !== null && best.heat >= MIN_GROUP_HEAT;
        this.quietFor = fighting ? 0 : this.quietFor + dt;
        const ending = this.isEnding(actors);
        const shot = this.shot;

        // is this shot over?
        let over = this.shotTime >= shot.length;
        let mediumGroup: Group | null = null;
        if (shot.kind === 'medium') {
            mediumGroup = this.groupAt(actors, hot, shot.x, shot.z);
            // its fight died down: no need to sit it out
            if (this.shotTime >= MEDIUM.minSeconds && mediumGroup.heat < MIN_GROUP_HEAT * 0.5) over = true;
        } else if (shot.kind === 'close') {
            const unit = actors[shot.unit];
            if (unit && !unit.alive && shot.diedAt === null) shot.diedAt = this.shotTime;
            // stay on a fallen unit a moment — the fall is the point
            if (shot.diedAt !== null && this.shotTime - shot.diedAt > 1.2) over = true;
        } else if (shot.kind === 'wide' && ending) {
            over = false; // the end: stay wide to the last
        }
        if (ending && shot.kind !== 'wide') over = true;
        if (shot.kind !== 'wide' && this.quietFor > LULL_SECONDS) over = true;

        if (over) this.next(actors, hot, best, fighting, ending);
        this.aimAt(actors, hot, fit, mediumGroup);
    }

    private next(actors: readonly Actor[], hot: readonly number[], best: Group | null, fighting: boolean, ending: boolean): void {
        const prev = this.shot.kind;
        if (ending || !fighting || !best) {
            this.startShot({ kind: 'wide', length: this.between(WIDE.seconds) });
            return;
        }
        if (prev === 'medium' && this.random() < CLOSE_CHANCE) {
            const unit = this.closeCandidate(actors, hot);
            if (unit !== null) {
                this.side = -this.side;
                const a = actors[unit]!;
                this.startShot({
                    kind: 'close',
                    length: this.between(CLOSE.seconds),
                    pitch: this.between(CLOSE.pitch) * DEG,
                    heading: this.side * this.between(CLOSE.heading) * DEG,
                    // the camera circles toward the side it came from
                    orbit: -this.side * CLOSE.orbitDegPerSec * DEG,
                    zoom: this.between(CLOSE.zoom) * (a.unit.type.structure ? 1.6 : 0.8 + 0.2 * sizeWeight(a)),
                    unit,
                    diedAt: null,
                });
                return;
            }
        }
        this.side = -this.side;
        this.startShot({
            kind: 'medium',
            length: this.between(MEDIUM.seconds),
            pitch: this.between(MEDIUM.pitch) * DEG,
            heading: this.side * this.between(MEDIUM.heading) * DEG,
            x: best.x,
            z: best.z,
        });
    }

    private aimAt(actors: readonly Actor[], hot: readonly number[], fit: number, mediumGroup: Group | null): void {
        const shot = this.shot;
        const out = 1 / Math.max(0.2, fit);
        if (shot.kind === 'wide') {
            const all = this.wholeBattle(actors);
            if (all) {
                this.aim.x = all.x;
                this.aim.z = all.z;
                this.aim.zoom = clamp((all.radius + FRAME_MARGIN) * ZOOM_PER_METRE * out, WIDE_ZOOM[0], WIDE_ZOOM[1]);
            }
            this.aim.heading = this.baseHeading + WIDE.heading * DEG;
            this.aim.pitch = WIDE.pitch * DEG;
            return;
        }
        if (shot.kind === 'medium') {
            // follow its own fight as it moves (just started: the group it was picked for)
            const g = mediumGroup && mediumGroup.heat > 0 ? mediumGroup : this.groupAt(actors, hot, shot.x, shot.z);
            if (g.heat > 0) {
                shot.x = g.x;
                shot.z = g.z;
                this.aim.zoom = clamp((g.radius + FRAME_MARGIN) * ZOOM_PER_METRE * out, MEDIUM_ZOOM[0], MEDIUM_ZOOM[1]);
            }
            this.aim.x = shot.x;
            this.aim.z = shot.z;
            this.aim.heading = this.baseHeading + shot.heading;
            this.aim.pitch = shot.pitch;
            return;
        }
        const a = actors[shot.unit];
        if (a) {
            this.aim.x = a.rx;
            this.aim.z = a.rz;
        }
        this.aim.zoom = shot.zoom * Math.sqrt(out);
        this.aim.heading = this.baseHeading + shot.heading + shot.orbit * this.shotTime;
        this.aim.pitch = shot.pitch;
    }

    /** the unit for a close shot: alive, in the hottest spot, bigger ones first */
    private closeCandidate(actors: readonly Actor[], hot: readonly number[]): number | null {
        let best: number | null = null;
        let bestScore = 0;
        for (const i of hot) {
            const a = actors[i]!;
            if (!a.alive || a.altitude > 0) continue;
            const around = this.groupAt(actors, hot, a.rx, a.rz).heat;
            if (around < MIN_CLOSE_HEAT) continue;
            const score = around * sizeWeight(a) + this.heat[i]!;
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best;
    }

    /** one side is down to its last units */
    private isEnding(actors: readonly Actor[]): boolean {
        if (this.startCount.size < 2) return false;
        const alive = new Map<string, number>();
        for (const a of actors) {
            if (!a.alive || a.unit.type.structure) continue;
            const team = String(actorTeam(a));
            alive.set(team, (alive.get(team) ?? 0) + 1);
        }
        for (const [team, start] of this.startCount) {
            const left = alive.get(team) ?? 0;
            if (left <= Math.max(MIN_UNITS_LEFT, start * END_SHARE)) return true;
        }
        return false;
    }

    // ---- heat ----

    private readHeat(actors: readonly Actor[], gameDt: number): void {
        const n = actors.length;
        if (this.actorsSeen !== actors || this.heat.length < n) {
            const fresh = this.actorsSeen !== actors;
            const heat = new Float32Array(n);
            const lastHp = new Float32Array(n);
            const wasAlive = new Uint8Array(n);
            if (!fresh) {
                heat.set(this.heat.subarray(0, Math.min(n, this.heat.length)));
                lastHp.set(this.lastHp.subarray(0, Math.min(n, this.lastHp.length)));
                wasAlive.set(this.wasAlive.subarray(0, Math.min(n, this.wasAlive.length)));
            }
            for (let i = fresh ? 0 : this.heat.length; i < n; i++) {
                const a = actors[i]!;
                lastHp[i] = a.hp + a.shieldHp;
                wasAlive[i] = a.alive ? 1 : 0;
            }
            this.heat = heat;
            this.lastHp = lastHp;
            this.wasAlive = wasAlive;
            this.actorsSeen = actors;
        }
        const fade = gameDt > 0 ? Math.pow(0.5, gameDt / HEAT_HALF_LIFE) : 1;
        for (let i = 0; i < n; i++) {
            const a = actors[i]!;
            let h = this.heat[i]! * fade;
            const hp = a.hp + a.shieldHp;
            const lost = this.lastHp[i]! - hp;
            if (lost > 0 && a.maxHp > 0) h += (lost / a.maxHp) * HEAT_PER_HP_LOST * sizeWeight(a);
            if (this.wasAlive[i] && !a.alive) h += HEAT_DEATH * sizeWeight(a);
            this.heat[i] = h;
            this.lastHp[i] = hp;
            this.wasAlive[i] = a.alive ? 1 : 0;
        }
    }

    /** the hottest units (dead ones too: a death is worth seeing, where it fell) */
    private hotUnits(actors: readonly Actor[]): number[] {
        const hot: number[] = [];
        for (let i = 0; i < actors.length; i++) if (this.heat[i]! > 0.05) hot.push(i);
        if (hot.length > MAX_HOT) {
            hot.sort((a, b) => this.heat[b]! - this.heat[a]!);
            hot.length = MAX_HOT;
        }
        return hot;
    }

    private hottestGroup(actors: readonly Actor[], hot: readonly number[]): Group | null {
        let best: Group | null = null;
        for (const i of hot) {
            const a = actors[i]!;
            const g = this.groupAt(actors, hot, a.rx, a.rz);
            if (!best || g.heat > best.heat) best = g;
        }
        return best;
    }

    /** the heat within GROUP_RADIUS of a point: its total, centre and spread */
    private groupAt(actors: readonly Actor[], hot: readonly number[], x: number, z: number): Group {
        const r2 = GROUP_RADIUS * GROUP_RADIUS;
        let heat = 0;
        let sx = 0;
        let sz = 0;
        for (const i of hot) {
            const a = actors[i]!;
            const dx = a.rx - x;
            const dz = a.rz - z;
            if (dx * dx + dz * dz > r2) continue;
            const h = this.heat[i]!;
            heat += h;
            sx += a.rx * h;
            sz += a.rz * h;
        }
        if (heat <= 0) return { x, z, heat: 0, radius: 0 };
        const cx = sx / heat;
        const cz = sz / heat;
        let spread = 0;
        for (const i of hot) {
            const a = actors[i]!;
            if ((a.rx - x) ** 2 + (a.rz - z) ** 2 > r2) continue;
            spread += ((a.rx - cx) ** 2 + (a.rz - cz) ** 2) * this.heat[i]!;
        }
        return { x: cx, z: cz, heat, radius: Math.sqrt(spread / heat) * 1.4 };
    }

    /** the living units' centre, wide enough for all of them */
    private wholeBattle(actors: readonly Actor[]): Group | null {
        let n = 0;
        let sx = 0;
        let sz = 0;
        for (const a of actors) {
            if (!a.alive) continue;
            n++;
            sx += a.rx;
            sz += a.rz;
        }
        if (n === 0) return null;
        const cx = sx / n;
        const cz = sz / n;
        let far = 0;
        for (const a of actors) {
            if (!a.alive) continue;
            far = Math.max(far, Math.hypot(a.rx - cx, a.rz - cz));
        }
        return { x: cx, z: cz, heat: 0, radius: far * 0.8 };
    }
}
