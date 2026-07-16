import {
    Box3,
    BoxGeometry,
    Color,
    CylinderGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
    Vector3,
} from 'three';
import { THEME } from '../theme';
import { teamColors } from './colors';
import { CELL, groundSupportAt, type Cell } from './map';
import { cloneUnitModel, hasUnitModel, loadUnitModels } from './unitModels';
import { cloneAnimatedModel, hasAnimatedModel, loadAnimatedModels } from './unitAnimated';

export type Team = 'player' | 'enemy';

export interface GridExtent {
    cols: number;
    rows: number;
}

/** a purchasable upgrade for a unit type — pure stat multipliers */
export interface TechDef {
    id: string;
    name: string;
    cost: number;
    /** multipliers applied to the base stats (attackInterval < 1 = faster) */
    mods: Partial<{ hp: number; damage: number; range: number; speed: number; attackInterval: number }>;
    /** shown on hover; auto-derived from `mods` when omitted (see {@link techDescription}) */
    description?: string;
    /** glyph for the action tile; auto-derived from `mods` when omitted */
    icon?: string;
}

/** glyph representing a tech — its own, or one derived from its dominant mod.
 *  Emoji throughout so every action tile fills its box at a consistent size. */
export function techIcon(tech: TechDef): string {
    if (tech.icon) return tech.icon;
    const m = tech.mods;
    if (m.damage !== undefined && m.damage !== 1) return '⚔️';
    if (m.hp !== undefined && m.hp !== 1) return '🛡️';
    if (m.range !== undefined && m.range !== 1) return '🎯';
    if (m.speed !== undefined && m.speed !== 1) return '💨';
    if (m.attackInterval !== undefined && m.attackInterval !== 1) return '🔄';
    return '✨';
}

/** human-readable summary of what a tech does — its own text, or built from its mods */
export function techDescription(tech: TechDef): string {
    if (tech.description) return tech.description;
    const parts: string[] = [];
    const pct = (mult: number) => `${mult >= 1 ? '+' : '−'}${Math.round(Math.abs(mult - 1) * 100)}%`;
    const { hp, damage, range, speed, attackInterval } = tech.mods;
    if (hp !== undefined && hp !== 1) parts.push(`${pct(hp)} HP`);
    if (damage !== undefined && damage !== 1) parts.push(`${pct(damage)} damage`);
    if (range !== undefined && range !== 1) parts.push(`${pct(range)} range`);
    if (speed !== undefined && speed !== 1) parts.push(`${pct(speed)} move speed`);
    // a lower attack interval means faster firing (rate = 1 / interval)
    if (attackInterval !== undefined && attackInterval !== 1) {
        parts.push(`${pct(1 / attackInterval)} attack speed`);
    }
    return parts.length ? parts.join(', ') : tech.name;
}

/** ground-hugging altitude for flyers during deployment (full height comes at battle start) */
export const DEPLOY_AIR_Y = 1.25;

export interface UnitType {
    id: string;
    name: string;
    cost: number;
    /** tiles this unit occupies on the grid (width x depth) */
    footprint: GridExtent;
    /** how many individual mechs stand inside the footprint (width x depth) */
    formation: GridExtent;
    /** uniform scale applied to each mech mesh */
    meshScale: number;
    /** structures don't bob and never rotate to face anything (but are valid facing targets) */
    structure?: boolean;
    /**
     * board extras (shield, rocket): bought like units but never targeted or
     * damaged by ordinary fire, exempt from the deploy limit and recruiting
     */
    extra?: boolean;
    /** shield extra: a dome that absorbs enemy projectiles crossing INTO it */
    shield?: { radius: number; height: number };
    /** rocket extra: waits armed, then homes onto the first enemy in range */
    rocket?: { range: number; speed: number; damage: number; splash: number };
    /** flight altitude in world units — air units collide with nothing on the ground */
    flying?: number;
    /** the can-attack matrix: which layers this unit's weapon can hit */
    targets: { ground: boolean; air: boolean };
    /** ground-plane collision circle per mech, in world units — nothing walks through it */
    collisionRadius: number;
    /**
     * simplified 3D hit volumes for bullets: spheres on the mech's local y
     * axis (rotation-proof), offsets and radii scaled by meshScale at use
     */
    colliders: { y: number; r: number }[];
    /** ranged mechs fire visible projectiles at this speed (world units/s); melee when absent */
    projectileSpeed?: number;
    /**
     * visual for the flying shot — does not affect sim hit radius.
     * `bolt` = energy bead (default); `arrow` / `largeArrow` = fletched shafts;
     * `stone` = hurled rock (catapult).
     */
    projectileStyle?: 'bolt' | 'arrow' | 'largeArrow' | 'stone';
    /**
     * spawn height above the unit's altitude (world units). When set, overrides
     * the default collider-mid muzzle for that shot.
     */
    projectileLaunchHeight?: number;
    /**
     * lobbed shot: aims upward and falls under gravity so long-range bolts arc.
     * `projectileSpeed` is the horizontal speed toward the target.
     */
    projectileBallistic?: boolean;
    /** homing shots re-aim mid-flight and hit ONLY their victim — a guaranteed hit (shields still block) */
    homing?: boolean;
    /**
     * area damage: a projectile impact hurts EVERY valid target within this
     * range (world units), not just what it hit. Absent = single target.
     */
    splashRadius?: number;
    /** combat stats, per individual mech */
    hp: number;
    damage: number;
    range: number;
    /** seconds between shots */
    attackInterval: number;
    speed: number;
    /** purchasable upgrades, applying to ALL packs of this type of the buyer — 4 per type at most */
    techs: TechDef[];
    /** builds ONE mech's meshes around the origin in world units, facing -z (toward the enemy) */
    build: (parts: PartFactory) => void;
}


/** Shared materials per team so all units batch nicely. */
const materialCache = new Map<string, MeshStandardMaterial>();

function material(key: string, make: () => MeshStandardMaterial): MeshStandardMaterial {
    let m = materialCache.get(key);
    if (!m) {
        m = make();
        materialCache.set(key, m);
    }
    return m;
}

function hullMaterial(): MeshStandardMaterial {
    return material('hull', () => new MeshStandardMaterial({ color: THEME.hull, roughness: 0.65, metalness: 0.3 }));
}

function darkMaterial(): MeshStandardMaterial {
    return material('dark', () => new MeshStandardMaterial({ color: THEME.dark, roughness: 0.85, metalness: 0.2 }));
}

function lightMaterial(): MeshStandardMaterial {
    return material('light', () => new MeshStandardMaterial({ color: THEME.light, roughness: 0.5, metalness: 0.12 }));
}

function accentMaterial(team: Team): MeshStandardMaterial {
    const c = teamColors[team].hex;
    return material(`accent-${team}-${c}`, () => {
        return new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: THEME.accentEmissive, roughness: 0.4 });
    });
}

/** Small helper handed to unit builders: adds primitives with shadows enabled. */
class PartFactory {
    constructor(
        private readonly group: Group,
        private readonly team: Team,
        /** icon/thumbnail renders skip oversized parts like the shield dome */
        readonly preview = false,
    ) {}

    private add(mesh: Mesh): Mesh {
        mesh.castShadow = true;
        this.group.add(mesh);
        return mesh;
    }

    box(w: number, h: number, d: number, x: number, y: number, z: number, kind: 'hull' | 'dark' | 'light' | 'accent' = 'hull'): Mesh {
        const mesh = new Mesh(new BoxGeometry(w, h, d), this.pick(kind));
        mesh.position.set(x, y, z);
        return this.add(mesh);
    }

    cylinder(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, kind: 'hull' | 'dark' | 'light' | 'accent' = 'hull'): Mesh {
        const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, h, 12), this.pick(kind));
        mesh.position.set(x, y, z);
        return this.add(mesh);
    }

    sphere(r: number, x: number, y: number, z: number, kind: 'hull' | 'dark' | 'light' | 'accent' = 'hull'): Mesh {
        const mesh = new Mesh(new SphereGeometry(r, 12, 10), this.pick(kind));
        mesh.position.set(x, y, z);
        return this.add(mesh);
    }

    /** translucent energy dome (shield extra) — casts no shadow */
    dome(r: number, heightScale: number): Mesh {
        const mesh = new Mesh(
            new SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
            material('shield-dome', () =>
                new MeshStandardMaterial({
                    color: 0x58c8ff,
                    emissive: 0x2888cc,
                    emissiveIntensity: 0.35,
                    transparent: true,
                    opacity: 0.16,
                    roughness: 0.3,
                    side: DoubleSide,
                    depthWrite: false,
                }),
            ),
        );
        mesh.scale.y = heightScale;
        this.group.add(mesh);
        return mesh;
    }

    private pick(kind: 'hull' | 'dark' | 'light' | 'accent'): MeshStandardMaterial {
        if (kind === 'accent') return accentMaterial(this.team);
        if (kind === 'light') return lightMaterial();
        return kind === 'dark' ? darkMaterial() : hullMaterial();
    }
}

function buildDwarf(parts: PartFactory): void {
    // one small fighter of the pack
    parts.sphere(0.42, 0, 0.35, 0, 'hull');
    parts.sphere(0.16, 0, 0.62, -0.25, 'accent');
    parts.box(1.0, 0.12, 0.5, 0, 0.12, 0, 'dark'); // leg plate
}

function buildArcher(parts: PartFactory): void {
    for (const side of [-1, 1]) {
        parts.cylinder(0.09, 0.13, 1.0, side * 0.5, 0.5, 0.15, 'dark'); // legs
    }
    parts.box(0.9, 0.7, 0.7, 0, 1.15, 0, 'hull'); // torso
    parts.sphere(0.24, 0, 1.6, -0.15, 'accent'); // hooded head
    const barrel = parts.cylinder(0.07, 0.07, 1.9, 0, 1.25, -1.0, 'dark');
    barrel.rotation.x = Math.PI / 2; // aim down -z
    parts.box(0.18, 0.18, 0.3, 0, 1.25, -1.95, 'accent'); // bow tip
}

function buildBallista(parts: PartFactory): void {
    for (const side of [-1, 1]) {
        parts.box(0.6, 0.55, 2.6, side * 1.35, 0.35, 0, 'dark'); // wheels
    }
    parts.box(2.2, 0.7, 2.4, 0, 0.75, 0, 'hull'); // chassis
    parts.cylinder(0.85, 0.95, 0.45, 0, 1.3, 0.1, 'dark'); // turntable
    parts.cylinder(0.6, 0.7, 0.5, 0, 1.65, 0.1, 'hull'); // cradle
    const cannon = parts.cylinder(0.13, 0.13, 2.2, 0, 1.65, -1.1, 'dark');
    cannon.rotation.x = Math.PI / 2;
    parts.box(0.32, 0.32, 0.4, 0, 1.65, -2.15, 'accent'); // bolt tip
    parts.box(2.0, 0.18, 0.2, 0, 0.55, 1.25, 'accent'); // rear brace
}

function buildCrowRider(parts: PartFactory): void {
    parts.sphere(0.5, 0, 0, 0, 'light'); // body
    parts.box(0.3, 0.2, 0.9, 0, 0.05, -0.5, 'light'); // beak boom
    parts.sphere(0.16, 0, 0.1, -0.85, 'accent'); // beak tip
    const rotor = parts.cylinder(0.7, 0.7, 0.06, 0, 0.5, 0, 'light'); // wing disc
    rotor.scale.y = 0.6;
    parts.box(0.12, 0.35, 0.12, 0, 0.35, 0, 'light'); // rider mast
    parts.box(0.9, 0.1, 0.25, 0, -0.25, 0.15, 'accent'); // belly strip
}

function buildShield(parts: PartFactory): void {
    parts.cylinder(1.0, 1.3, 0.5, 0, 0.25, 0, 'dark'); // emitter base
    parts.cylinder(0.35, 0.5, 1.6, 0, 1.3, 0, 'hull'); // pylon
    parts.sphere(0.55, 0, 2.4, 0, 'accent'); // projector orb
    if (!parts.preview) parts.dome(SHIELD_RADIUS, SHIELD_HEIGHT / SHIELD_RADIUS);
}

function buildRocket(parts: PartFactory): void {
    // a small missile hovering far above the air layer, lying level with its
    // nose toward -z — the facing rule points it straight at the enemy
    const lieFlat = (mesh: Mesh) => (mesh.rotation.x = -Math.PI / 2);
    lieFlat(parts.cylinder(0.28, 0.36, 2.4, 0, 0, 0.2, 'light')); // body
    lieFlat(parts.cylinder(0.02, 0.28, 0.9, 0, 0, -1.45, 'accent')); // warhead tip
    lieFlat(parts.cylinder(0.24, 0.16, 0.5, 0, 0, 1.65, 'accent')); // exhaust glow
    parts.box(1.5, 0.08, 0.7, 0, 0, 1.2, 'hull'); // horizontal tail fins
    parts.box(0.08, 1.5, 0.7, 0, 0, 1.2, 'hull'); // vertical tail fins
}

function buildTower(parts: PartFactory): void {
    parts.cylinder(1.5, 1.8, 0.8, 0, 0.4, 0, 'dark'); // base
    parts.box(1.6, 2.2, 1.6, 0, 1.9, 0, 'hull'); // core
    parts.cylinder(0.9, 1.1, 0.7, 0, 3.35, 0, 'dark'); // cap
    parts.sphere(0.55, 0, 4.0, 0, 'accent'); // beacon
    parts.cylinder(0.06, 0.06, 2.0, 0.9, 4.0, 0.9, 'dark'); // antenna
}

/** each side's two command towers — not buyable, so not part of UNIT_TYPES */
/**
 * The two base buildings share stats and mesh but are independent types:
 * each carries its own role (and upgrade level). The Command Tower hosts the
 * recruit-level switch; the Research Center's role is still open.
 */
function makeTower(id: string, name: string, tiles = 3, meshScale = 3.6, hp = 800): UnitType {
    return {
        id,
        name,
        cost: 0,
        // grid collision footprint; the mesh is a bit bigger and overlaps it visually
        footprint: { cols: tiles, rows: tiles },
        formation: { cols: 1, rows: 1 },
        meshScale,
        structure: true,
        targets: { ground: false, air: false }, // towers don't shoot
        collisionRadius: tiles * CELL * 0.57,
        colliders: [
            { y: 0.5, r: 1.6 },
            { y: 1.9, r: 1.1 },
            { y: 3.5, r: 0.8 },
        ],
        hp,
        damage: 0,
        range: 0,
        attackInterval: 1,
        speed: 0,
        techs: [],
        build: buildTower,
    };
}

export const COMMAND_TOWER = makeTower('command-tower', 'Command Tower');
export const RESEARCH_CENTER = makeTower('research-center', 'Research Center');
/** each side's main castle at the back of its territory — bigger and sturdier */
export const STRONGHOLD = makeTower('stronghold', 'Stronghold', 5, 4.2, 1600);

/** shield dome coverage, world units — the top stays below the air layer (18) */
export const SHIELD_RADIUS = 20;
export const SHIELD_HEIGHT = 17;

export const UNIT_TYPES: UnitType[] = [
    {
        id: 'dwarf',
        name: 'Dwarf',
        cost: 100,
        footprint: { cols: 5, rows: 2 },
        formation: { cols: 8, rows: 3 }, // a pack of 24 fighters
        meshScale: 1,
        targets: { ground: true, air: false }, // can't reach the sky
        collisionRadius: 0.5,
        colliders: [{ y: 0.35, r: 0.55 }],
        hp: 40,
        damage: 8,
        range: 2,
        attackInterval: 0.7,
        speed: 9,
        techs: [
            { id: 'legs', name: 'Fleet Feet', cost: 150, mods: { speed: 1.35 } },
            { id: 'carapace', name: 'Stone Hide', cost: 200, mods: { hp: 1.5 } },
        ],
        build: buildDwarf,
    },
    {
        id: 'archer',
        name: 'Archer',
        cost: 100,
        footprint: { cols: 2, rows: 2 },
        formation: { cols: 1, rows: 1 },
        meshScale: 2.2,
        targets: { ground: true, air: true }, // picks off anything
        collisionRadius: 1.0,
        colliders: [{ y: 1.1, r: 0.75 }],
        projectileSpeed: 100,
        projectileStyle: 'arrow',
        projectileBallistic: true, // bow lob — lead-aimed so moving targets still get clipped
        hp: 130,
        damage: 65,
        range: 45,
        attackInterval: 1.4,
        speed: 3.5,
        techs: [
            { id: 'barrel', name: 'Longbow', cost: 200, mods: { range: 1.3 } },
            { id: 'ap', name: 'Piercing Arrows', cost: 250, mods: { damage: 1.4 } },
        ],
        build: buildArcher,
    },
    {
        id: 'crowRider',
        name: 'Crow Rider',
        cost: 200,
        footprint: { cols: 5, rows: 2 }, // same pack size as dwarves
        formation: { cols: 4, rows: 1 }, // a flock of 12 riders, two wide rows
        meshScale: 4.35, // slightly smaller so the tighter columns don't touch
        flying: 18,
        targets: { ground: true, air: true },
        collisionRadius: 0.75,
        colliders: [{ y: 0.1, r: 0.75 }],
        projectileSpeed: 70,
        projectileStyle: 'stone',
        // wide blast vs packed dwarves (3× the ballista's old splash radius of 3)
        splashRadius: 9,
        hp: 45,
        damage: 18,
        range: 12,
        attackInterval: 1.1,
        speed: 8,
        techs: [
            { id: 'engines', name: 'Gale Wings', cost: 150, mods: { speed: 1.3 } },
            { id: 'stingers', name: 'Crow Talons', cost: 200, mods: { damage: 1.4 } },
        ],
        build: buildCrowRider,
    },
    {
        id: 'ballista',
        name: 'Ballista',
        cost: 400,
        footprint: { cols: 4, rows: 4 },
        formation: { cols: 1, rows: 1 },
        meshScale: 3.2,
        targets: { ground: true, air: false }, // bolts can't elevate
        collisionRadius: 2.8,
        colliders: [{ y: 0.9, r: 1.1 }],
        projectileSpeed: 50,
        projectileStyle: 'largeArrow',
        // cradle sits high on the siege frame — not at the chassis collider mid
        projectileLaunchHeight: 5.8,
        projectileBallistic: true,
        splashRadius: 3, // bolts shatter — everything near the impact takes the hit
        hp: 500,
        damage: 500,
        range: 84,
        attackInterval: 2.8,
        speed: 2.2,
        techs: [
            { id: 'armor', name: 'Iron Plating', cost: 300, mods: { hp: 1.5 } },
            { id: 'autoloader', name: 'Quick Winch', cost: 300, mods: { attackInterval: 0.7 } },
            {
                id: 'golden',
                name: 'Golden Aura',
                cost: 50,
                mods: {},
                icon: '✨',
                description: 'Nearby allies resist tower debuffs and take 30% less damage for 30s.',
            },
        ],
        build: buildBallista,
    },
    {
        id: 'shield',
        name: 'Ward Stone',
        cost: 100,
        footprint: { cols: 2, rows: 2 },
        formation: { cols: 1, rows: 1 },
        meshScale: 1,
        structure: true,
        extra: true,
        shield: { radius: SHIELD_RADIUS, height: SHIELD_HEIGHT },
        targets: { ground: false, air: false },
        collisionRadius: 1.3, // only the emitter pylon blocks walking
        colliders: [], // nothing can shoot it — it only absorbs crossings
        hp: 30000, // the absorb pool; refills between rounds if it survives
        damage: 0,
        range: 0,
        attackInterval: 1,
        speed: 0,
        techs: [],
        build: buildShield,
    },
    {
        id: 'rocket',
        name: 'Fire Bolt',
        cost: 50,
        footprint: { cols: 1, rows: 1 },
        formation: { cols: 1, rows: 1 },
        meshScale: 1,
        structure: true,
        extra: true,
        flying: 36, // hovers at twice the air layer, waiting
        rocket: { range: 35, speed: 30, damage: 5000, splash: 8 }, // wipes a close-packed swarm
        splashRadius: 8, // display only — the blast itself comes from `rocket.splash`
        targets: { ground: true, air: true }, // what it may home onto / hurt
        collisionRadius: 0.8,
        colliders: [],
        hp: 100,
        damage: 5000,
        range: 35,
        attackInterval: 1,
        speed: 0,
        techs: [],
        build: buildRocket,
    },
];

/**
 * A placed unit: one or more real 3D mech meshes standing in formation
 * across the unit's footprint. `cell` is the top-left anchor tile and
 * `world` the center of the footprint rectangle.
 */
export class Unit {
    /** stable per-match id, assigned at spawn — actions reference units by this */
    id = 0;
    readonly view = new Group();
    /**
     * false while the owner is still in a build phase: opponents can't see the
     * unit yet, and it is ignored when other units pick a facing target.
     */
    revealed = true;
    /** towers: down for the rest of the CURRENT battle — no longer a target, debuffs its owner's side */
    destroyed = false;
    /** board extras: used up this battle (shield broken, rocket fired) — removed at the round reset */
    consumed = false;
    /** the pack's equipped item (at most ONE) — permanent once its deployment ended */
    readonly items: string[] = [];
    /** flank spawn already happened once for this pack */
    flankSpawnDone = false;
    /** lifetime EFFECTIVE damage dealt (capped at each victim's remaining hp) */
    damageDealt = 0;
    /** lifetime individual mechs killed (a wiped 24-dwarf pack counts 24) */
    kills = 0;
    /** round this unit was deployed in — only units from the current round may be moved */
    deployedRound = 0;
    /** veterancy, persists across rounds: kills grant XP, levels multiply hp & damage */
    level = 1;
    xp = 0;
    /** rotation around y the unit currently faces (0 = toward -z / the enemy edge) */
    facing: number;
    /** individual mechs; `home` is each one's formation slot (local offset from the unit center) */
    readonly members: { mesh: Group; phase: number; home: Vector3 }[] = [];
    /** 0 on the ground in deployment, animates to 1 at full combat altitude */
    flightLift = 0;
    inDeployment = true;

    constructor(
        readonly type: UnitType,
        /** top-left anchor tile of the footprint */
        public cell: Cell,
        readonly team: Team,
        readonly world: Vector3,
        /** placement rotated 90°: footprint and formation use swapped cols/rows */
        public rotated = false,
    ) {
        const footprint = rotated ? swapExtent(type.footprint) : type.footprint;
        const formation = rotated ? swapExtent(type.formation) : type.formation;
        const spacingX = (footprint.cols * CELL) / formation.cols;
        const spacingZ = (footprint.rows * CELL) / formation.rows;
        for (let i = 0; i < formation.cols; i++) {
            for (let j = 0; j < formation.rows; j++) {
                const mesh = new Group();
                // rigged/animated FBX first, then static GLB, else procedural
                // primitives. Models are pre-normalized to the procedural LOCAL
                // size, so meshScale below (and wreck/reset scaling) is uniform.
                const animated = hasAnimatedModel(type.id) ? cloneAnimatedModel(type.id, team) : null;
                const model = animated ?? (hasUnitModel(type.id) ? cloneUnitModel(type.id, team) : null);
                if (animated) mesh.userData.animated = true;
                if (model) mesh.add(model);
                else type.build(new PartFactory(mesh, team));
                mesh.scale.setScalar(type.meshScale);
                const ox = (i - (formation.cols - 1) / 2) * spacingX;
                const oz = (j - (formation.rows - 1) / 2) * spacingZ;
                mesh.position.set(ox, 0, oz);
                this.view.add(mesh);
                this.members.push({ mesh, phase: Math.random() * Math.PI * 2, home: new Vector3(ox, 0, oz) });
            }
        }
        // default facing until a target is known: straight at the opposing
        // edge — structures too (a castle's gate looks at the enemy), they
        // just never turn again afterwards
        this.facing = team === 'enemy' ? Math.PI : 0;
        for (const m of this.members) m.mesh.rotation.y = this.facing;
        this.view.position.copy(this.world);
        this.seatMembers();
    }

    /** current hover base for idle bob (deployment keeps flyers near the ground) */
    memberBaseY(): number {
        if (!this.type.flying) return 0.05;
        return DEPLOY_AIR_Y + (this.type.flying - DEPLOY_AIR_Y) * this.flightLift;
    }

    /**
     * Stick every member to the terrain at the pack origin:
     * `y = groundSupportAt + memberBaseY()` (flyers = ground + altitude).
     * Defaults to the current view xz so drag previews follow the hills.
     */
    seatMembers(originX = this.view.position.x, originZ = this.view.position.z): void {
        const base = this.memberBaseY();
        const r = this.type.collisionRadius * 0.65;
        for (const m of this.members) {
            if (m.mesh.userData.dead) continue;
            m.mesh.position.y =
                groundSupportAt(originX + m.home.x, originZ + m.home.z, r) + base;
        }
    }

    setDeployment(deploy: boolean): void {
        this.inDeployment = deploy;
        if (deploy) this.flightLift = 0;
    }

    /** ramps flyers up (battle) or down (deployment) */
    tickFlight(dtSeconds: number): void {
        if (!this.type.flying) return;
        const target = this.inDeployment ? 0 : 1;
        const rate = 8;
        if (this.flightLift < target) this.flightLift = Math.min(1, this.flightLift + dtSeconds * rate);
        else if (this.flightLift > target) this.flightLift = Math.max(0, this.flightLift - dtSeconds * rate);
    }

    /** Repositions the whole pack (build phase only — occupancy is the caller's job). */
    moveTo(cell: Cell, world: Vector3): void {
        this.cell = cell;
        this.world.copy(world);
        this.view.position.copy(world);
        // structures get no per-frame update, so this is their main chance;
        // everyone (including flyers) reseats on the new relief
        this.seatMembers(world.x, world.z);
    }

    /** Re-arranges the formation for the new orientation, in place. */
    setRotated(rotated: boolean): void {
        this.rotated = rotated;
        const footprint = rotated ? swapExtent(this.type.footprint) : this.type.footprint;
        const formation = rotated ? swapExtent(this.type.formation) : this.type.formation;
        const spacingX = (footprint.cols * CELL) / formation.cols;
        const spacingZ = (footprint.rows * CELL) / formation.rows;
        let k = 0;
        for (let i = 0; i < formation.cols; i++) {
            for (let j = 0; j < formation.rows; j++) {
                const m = this.members[k++]!;
                m.home.set(
                    (i - (formation.cols - 1) / 2) * spacingX,
                    0,
                    (j - (formation.rows - 1) / 2) * spacingZ,
                );
                m.mesh.position.copy(m.home);
            }
        }
        this.seatMembers();
    }

    /** Collapses the meshes into rubble until the next round reset. */
    markDestroyed(): void {
        this.destroyed = true;
        for (const m of this.members) {
            m.mesh.scale.y *= 0.3;
            m.mesh.rotation.z = 0.12;
        }
    }

    /**
     * Rebuilds the rank insignia on every mech of the pack: a small totem of
     * glowing studs above the hull, one per level above 1 (up to 8). Call
     * after every level change.
     */
    refreshLevelBadge(): void {
        const topY = Math.max(...this.type.colliders.map((c) => c.y + c.r), 1) + 0.35;
        for (const m of this.members) {
            const old = m.mesh.getObjectByName('level-badge');
            if (old) m.mesh.remove(old);
            if (this.level <= 1) continue;
            const badge = new Group();
            badge.name = 'level-badge';
            for (let i = 0; i < this.level - 1; i++) {
                const stud = new Mesh(levelStudGeometry(), levelStudMaterial(i));
                stud.position.y = topY + i * 0.16;
                badge.add(stud);
            }
            m.mesh.add(badge);
        }
    }

    /**
     * Puts every mech back on its formation slot, alive and visible — the
     * battle phase is a simulation; deployments persist between rounds.
     * Destroyed towers are rebuilt too: rubble stands back up.
     */
    resetFormation(): void {
        for (const m of this.members) {
            clearBattleTint(m.mesh);
            m.mesh.position.copy(m.home);
            m.mesh.visible = true;
            if (!this.type.structure) m.mesh.rotation.y = this.facing;
            m.mesh.rotation.z = 0; // stand wrecks back up
            m.mesh.scale.setScalar(this.type.meshScale); // un-squash tower rubble
            m.mesh.userData.dead = false;
        }
        this.seatMembers();
        this.destroyed = false;
    }

    /** ground positions of each individual mech (targeting works per mech, not per squad) */
    memberWorldPositions(): Vector3[] {
        return this.members.map(
            (m) => this.world.clone().setY(0).add(m.mesh.position).setY(0),
        );
    }

    /**
     * Each mech pivots in place toward whichever target point is closest to
     * that mech — the formation's area on the grid stays put (structures
     * never turn). `targets` are individual enemy mech positions.
     */
    faceClosestOf(targets: readonly Vector3[]): void {
        // structures never turn — except the hovering rocket, which aims
        if ((this.type.structure && !this.type.rocket) || targets.length === 0) return;
        let squadBest = targets[0]!;
        let squadBestD = Infinity;
        for (const m of this.members) {
            const mx = this.world.x + m.mesh.position.x;
            const mz = this.world.z + m.mesh.position.z;
            let best = targets[0]!;
            let bestD = Infinity;
            for (const t of targets) {
                const d = (t.x - mx) ** 2 + (t.z - mz) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = t;
                }
            }
            m.mesh.rotation.y = Math.atan2(-(best.x - mx), -(best.z - mz));
            if (bestD < squadBestD) {
                squadBestD = bestD;
                squadBest = best;
            }
        }
        this.facing = Math.atan2(-(squadBest.x - this.world.x), -(squadBest.z - this.world.z));
    }

    update(timeSeconds: number): void {
        // battle owns per-mech Y via BattleSim — don't overwrite walkers with
        // the pack's home-slot height or they sink into (or float over) hills
        if (this.type.structure || !this.inDeployment) return;
        const base = this.memberBaseY();
        const amplitude = 0.04;
        const ox = this.view.position.x;
        const oz = this.view.position.z;
        const r = this.type.collisionRadius * 0.65;
        for (const m of this.members) {
            if (m.mesh.userData.dead) continue;
            const ground = groundSupportAt(ox + m.home.x, oz + m.home.z, r);
            m.mesh.position.y = ground + base + Math.sin(timeSeconds * 2 + m.phase) * amplitude;
        }
    }
}

function swapExtent(e: GridExtent): GridExtent {
    return { cols: e.rows, rows: e.cols };
}

let studGeometry: BoxGeometry | null = null;
function levelStudGeometry(): BoxGeometry {
    if (!studGeometry) studGeometry = new BoxGeometry(0.4, 0.09, 0.4);
    return studGeometry;
}

/** rank studs: gold for the first tier, white-hot from level 6 up */
function levelStudMaterial(index: number): MeshStandardMaterial {
    const tier = index < 4 ? 'gold' : 'elite';
    return material(`level-stud-${tier}`, () => {
        const c = tier === 'gold' ? THEME.veteran : 0xfff8f0;
        return new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.4 });
    });
}

// scratch colors for syncBattleTint — it runs per mech per frame, so it must not allocate
const TINT_GOLD = new Color(THEME.veteran);
const TINT_GREY = new Color(0x888890);
const tintScratch = new Color();

/** tints a mech during battle — golden > debuff > spawning > normal */
export function syncBattleTint(
    mesh: Group,
    tint: 'normal' | 'golden' | 'debuff' | 'spawning',
    timeSeconds: number,
    debuffStacks = 1,
    spawnProgress = 0,
): void {
    const gold = TINT_GOLD;
    const grey = TINT_GREY;
    const goldPulse = 0.4 + Math.sin(timeSeconds * 4.5) * 0.22;
    const debuffT = timeSeconds * 7;
    const spawnGlow = tintScratch;

    mesh.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const orig = child.material;
        if (!(orig instanceof MeshStandardMaterial)) return;

        if (!child.userData.battleOrigMat) child.userData.battleOrigMat = orig;

        if (tint === 'golden') {
            let tinted = child.userData.goldenMat as MeshStandardMaterial | undefined;
            if (!tinted) {
                tinted = (child.userData.battleOrigMat as MeshStandardMaterial).clone();
                tinted.color.lerpColors((child.userData.battleOrigMat as MeshStandardMaterial).color, gold, 0.55);
                tinted.emissive.copy(gold);
                child.userData.goldenMat = tinted;
            }
            tinted.emissiveIntensity = goldPulse;
            child.material = tinted;
            return;
        }

        if (tint === 'debuff') {
            let tinted = child.userData.debuffMat as MeshStandardMaterial | undefined;
            const base = child.userData.battleOrigMat as MeshStandardMaterial;
            if (!tinted) tinted = base.clone();
            const mix = Math.min(0.85, 0.35 + debuffStacks * 0.25);
            const r = 0.55 + 0.45 * Math.sin(debuffT);
            const g = 0.2 + 0.35 * Math.sin(debuffT + 2.4);
            const b = 0.45 + 0.45 * Math.sin(debuffT + 4.8);
            const crazy = new Color(r * 0.9 + 0.1, g * 0.35, b * 0.7 + 0.15);
            tinted.color.lerpColors(base.color, crazy, mix);
            tinted.emissive.setRGB(r * 0.95, g * 0.25, b * 0.85);
            tinted.emissiveIntensity = 0.3 + debuffStacks * 0.18 + Math.sin(debuffT * 2.3) * 0.25;
            child.userData.debuffMat = tinted;
            child.material = tinted;
            return;
        }

        if (tint === 'spawning') {
            let tinted = child.userData.spawnMat as MeshStandardMaterial | undefined;
            const base = child.userData.battleOrigMat as MeshStandardMaterial;
            if (!tinted) {
                tinted = base.clone();
                child.userData.spawnMat = tinted;
            }
            const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 6.5);
            const flicker = 0.5 + 0.5 * Math.sin(timeSeconds * 11 + spawnProgress * 4);
            // overlay fades as spawn completes; pulse keeps it visibly alive throughout
            const mix = (0.55 - spawnProgress * 0.35) * (0.55 + pulse * 0.45);
            spawnGlow.lerpColors(grey, base.color, spawnProgress * 0.45 + pulse * 0.15);
            tinted.color.lerpColors(base.color, spawnGlow, mix);
            tinted.emissive.copy(spawnGlow);
            tinted.emissiveIntensity = 0.18 + pulse * 0.55 + flicker * 0.12;
            child.material = tinted;
            return;
        }

        child.material = child.userData.battleOrigMat as MeshStandardMaterial;
    });
}

/** restores default hull materials after battle — call when a round ends */
export function clearBattleTint(mesh: Group): void {
    mesh.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const orig = child.userData.battleOrigMat as MeshStandardMaterial | undefined;
        if (orig) child.material = orig;
        const golden = child.userData.goldenMat as MeshStandardMaterial | undefined;
        const debuff = child.userData.debuffMat as MeshStandardMaterial | undefined;
        const spawn = child.userData.spawnMat as MeshStandardMaterial | undefined;
        golden?.dispose();
        debuff?.dispose();
        spawn?.dispose();
        delete child.userData.battleOrigMat;
        delete child.userData.goldenMat;
        delete child.userData.debuffMat;
        delete child.userData.spawnMat;
    });
}

/**
 * Measure each modeled unit's procedural local height, then load its GLB
 * template at that size. Call once at startup before any Unit is built; units
 * without a model (or whose model fails to load) keep their procedural mesh.
 */
let visualsPromise: Promise<void> | null = null;
export function preloadUnitVisuals(): Promise<void> {
    if (visualsPromise) return visualsPromise;
    visualsPromise = (async () => {
        try {
            const heights: Record<string, number> = {};
            for (const type of [...UNIT_TYPES, COMMAND_TOWER, RESEARCH_CENTER, STRONGHOLD]) {
                const probe = new Group();
                type.build(new PartFactory(probe, 'player'));
                heights[type.id] = new Box3().setFromObject(probe).getSize(new Vector3()).y || 1;
            }
            await Promise.all([loadUnitModels(heights), loadAnimatedModels(heights)]);
        } catch (e) {
            console.error('[unitModels] preloadUnitVisuals failed', e);
        }
    })();
    return visualsPromise;
}
// kick off model loading as soon as this module is imported (belt-and-suspenders
// with main.ts's await, so it runs even if the entry module isn't re-executed)
void preloadUnitVisuals();

/** one mech mesh for UI thumbnails — same builders as in-game, preview-sized */
export function buildUnitPreviewMesh(type: UnitType, team: Team = 'player'): Group {
    const group = new Group();
    type.build(new PartFactory(group, team, true));
    group.scale.setScalar(type.meshScale);
    return group;
}

/** type lookup by id — actions and replays store unit types as strings */
export function unitTypeById(id: string): UnitType | null {
    if (id === COMMAND_TOWER.id) return COMMAND_TOWER;
    if (id === RESEARCH_CENTER.id) return RESEARCH_CENTER;
    return UNIT_TYPES.find((t) => t.id === id) ?? null;
}
