import {
    BoxGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
    type Vector3,
} from 'three';
import { THEME } from '../theme';
import { CELL, type Cell } from './map';

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
}

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
    /** combat stats, per individual mech */
    hp: number;
    damage: number;
    range: number;
    attackInterval: number;
    speed: number;
    /** purchasable upgrades, applying to ALL packs of this type of the buyer */
    techs: TechDef[];
    /** builds ONE mech's meshes around the origin in world units, facing -z (toward the enemy) */
    build: (parts: PartFactory) => void;
}

const TEAM_ACCENT: Record<Team, number> = {
    player: THEME.player,
    enemy: THEME.enemy,
};

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
    return material(`accent-${team}`, () => {
        const c = TEAM_ACCENT[team];
        return new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: THEME.accentEmissive, roughness: 0.4 });
    });
}

/** Small helper handed to unit builders: adds primitives with shadows enabled. */
class PartFactory {
    constructor(
        private readonly group: Group,
        private readonly team: Team,
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

    private pick(kind: 'hull' | 'dark' | 'light' | 'accent'): MeshStandardMaterial {
        if (kind === 'accent') return accentMaterial(this.team);
        if (kind === 'light') return lightMaterial();
        return kind === 'dark' ? darkMaterial() : hullMaterial();
    }
}

function buildCrawler(parts: PartFactory): void {
    // one small bug of the swarm
    parts.sphere(0.42, 0, 0.35, 0, 'hull');
    parts.sphere(0.16, 0, 0.62, -0.25, 'accent');
    parts.box(1.0, 0.12, 0.5, 0, 0.12, 0, 'dark'); // leg plate
}

function buildMarksman(parts: PartFactory): void {
    for (const side of [-1, 1]) {
        parts.cylinder(0.09, 0.13, 1.0, side * 0.5, 0.5, 0.15, 'dark'); // legs
    }
    parts.box(0.9, 0.7, 0.7, 0, 1.15, 0, 'hull'); // torso
    parts.sphere(0.24, 0, 1.6, -0.15, 'accent'); // sensor head
    const barrel = parts.cylinder(0.07, 0.07, 1.9, 0, 1.25, -1.0, 'dark');
    barrel.rotation.x = Math.PI / 2; // aim down -z
    parts.box(0.18, 0.18, 0.3, 0, 1.25, -1.95, 'accent'); // muzzle
}

function buildFortress(parts: PartFactory): void {
    for (const side of [-1, 1]) {
        parts.box(0.6, 0.55, 2.6, side * 1.35, 0.35, 0, 'dark'); // treads
    }
    parts.box(2.2, 0.7, 2.4, 0, 0.75, 0, 'hull'); // chassis
    parts.cylinder(0.85, 0.95, 0.45, 0, 1.3, 0.1, 'dark'); // turret ring
    parts.cylinder(0.6, 0.7, 0.5, 0, 1.65, 0.1, 'hull'); // turret
    const cannon = parts.cylinder(0.13, 0.13, 2.2, 0, 1.65, -1.1, 'dark');
    cannon.rotation.x = Math.PI / 2;
    parts.box(0.32, 0.32, 0.4, 0, 1.65, -2.15, 'accent'); // muzzle
    parts.box(2.0, 0.18, 0.2, 0, 0.55, 1.25, 'accent'); // rear glow strip
}

function buildWasp(parts: PartFactory): void {
    parts.sphere(0.5, 0, 0, 0, 'light'); // hull
    parts.box(0.3, 0.2, 0.9, 0, 0.05, -0.5, 'light'); // nose boom
    parts.sphere(0.16, 0, 0.1, -0.85, 'accent'); // sensor tip
    const rotor = parts.cylinder(0.7, 0.7, 0.06, 0, 0.5, 0, 'light'); // rotor disc
    rotor.scale.y = 0.6;
    parts.box(0.12, 0.35, 0.12, 0, 0.35, 0, 'light'); // rotor mast
    parts.box(0.9, 0.1, 0.25, 0, -0.25, 0.15, 'accent'); // belly glow strip
}

function buildTower(parts: PartFactory): void {
    parts.cylinder(1.5, 1.8, 0.8, 0, 0.4, 0, 'dark'); // base
    parts.box(1.6, 2.2, 1.6, 0, 1.9, 0, 'hull'); // core
    parts.cylinder(0.9, 1.1, 0.7, 0, 3.35, 0, 'dark'); // cap
    parts.sphere(0.55, 0, 4.0, 0, 'accent'); // beacon
    parts.cylinder(0.06, 0.06, 2.0, 0.9, 4.0, 0.9, 'dark'); // antenna
}

/** each side's two command towers — not buyable, so not part of UNIT_TYPES */
export const TOWER_TYPE: UnitType = {
    id: 'tower',
    name: 'Command Tower',
    cost: 0,
    // collision on the grid is 2x2; the mesh is a bit bigger and overlaps it visually
    footprint: { cols: 2, rows: 2 },
    formation: { cols: 1, rows: 1 },
    meshScale: 2.4,
    structure: true,
    targets: { ground: false, air: false }, // towers don't shoot
    collisionRadius: 4.5,
    colliders: [
        { y: 0.5, r: 1.6 },
        { y: 1.9, r: 1.1 },
        { y: 3.5, r: 0.8 },
    ],
    hp: 800,
    damage: 0,
    range: 0,
    attackInterval: 1,
    speed: 0,
    techs: [],
    build: buildTower,
};

export const UNIT_TYPES: UnitType[] = [
    {
        id: 'crawler',
        name: 'Crawler',
        cost: 100,
        footprint: { cols: 5, rows: 2 },
        formation: { cols: 8, rows: 3 }, // a swarm of 24 bugs
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
            { id: 'legs', name: 'Overclocked Legs', cost: 150, mods: { speed: 1.35 } },
            { id: 'carapace', name: 'Carapace', cost: 200, mods: { hp: 1.5 } },
        ],
        build: buildCrawler,
    },
    {
        id: 'marksman',
        name: 'Marksman',
        cost: 100,
        footprint: { cols: 2, rows: 2 },
        formation: { cols: 1, rows: 1 },
        meshScale: 2.2,
        targets: { ground: true, air: true }, // snipes anything
        collisionRadius: 1.0,
        colliders: [{ y: 1.1, r: 0.75 }],
        projectileSpeed: 80,
        hp: 130,
        damage: 65,
        range: 45,
        attackInterval: 2.2,
        speed: 3.5,
        techs: [
            { id: 'barrel', name: 'Long Barrel', cost: 200, mods: { range: 1.3 } },
            { id: 'ap', name: 'AP Rounds', cost: 250, mods: { damage: 1.4 } },
        ],
        build: buildMarksman,
    },
    {
        id: 'wasp',
        name: 'Wasp',
        cost: 100,
        footprint: { cols: 2, rows: 2 },
        formation: { cols: 2, rows: 2 }, // a flight of 4 drones
        meshScale: 1.6,
        flying: 9,
        targets: { ground: true, air: true },
        collisionRadius: 0.9,
        colliders: [{ y: 0.1, r: 0.75 }],
        projectileSpeed: 70,
        hp: 90,
        damage: 18,
        range: 12,
        attackInterval: 1.1,
        speed: 8,
        techs: [
            { id: 'engines', name: 'Swarm Engines', cost: 150, mods: { speed: 1.3 } },
            { id: 'stingers', name: 'Stingers', cost: 200, mods: { damage: 1.4 } },
        ],
        build: buildWasp,
    },
    {
        id: 'fortress',
        name: 'Fortress',
        cost: 400,
        footprint: { cols: 4, rows: 4 },
        formation: { cols: 1, rows: 1 },
        meshScale: 3.2,
        targets: { ground: true, air: false }, // cannon can't elevate
        collisionRadius: 2.8,
        colliders: [{ y: 0.9, r: 1.1 }],
        projectileSpeed: 50,
        hp: 900,
        damage: 130,
        range: 28,
        attackInterval: 2.8,
        speed: 2.2,
        techs: [
            { id: 'armor', name: 'Reactive Armor', cost: 300, mods: { hp: 1.5 } },
            { id: 'autoloader', name: 'Autoloader', cost: 300, mods: { attackInterval: 0.7 } },
        ],
        build: buildFortress,
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
    /** round this unit was deployed in — only units from the current round may be moved */
    deployedRound = 0;
    /** veterancy, persists across rounds: kills grant XP, levels multiply hp & damage */
    level = 1;
    xp = 0;
    /** rotation around y the unit currently faces (0 = toward -z / the enemy edge) */
    facing: number;
    /** individual mechs; `home` is each one's formation slot (local offset from the unit center) */
    readonly members: { mesh: Group; phase: number; home: Vector3 }[] = [];

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
                type.build(new PartFactory(mesh, team));
                mesh.scale.setScalar(type.meshScale);
                mesh.position.set(
                    (i - (formation.cols - 1) / 2) * spacingX,
                    0,
                    (j - (formation.rows - 1) / 2) * spacingZ,
                );
                this.view.add(mesh);
                this.members.push({ mesh, phase: Math.random() * Math.PI * 2, home: mesh.position.clone() });
            }
        }
        // default facing until a target is known: straight at the opposing edge
        this.facing = team === 'enemy' ? Math.PI : 0;
        if (!type.structure) {
            for (const m of this.members) m.mesh.rotation.y = this.facing;
        }
        this.view.position.copy(this.world);
    }

    /** Repositions the whole pack (build phase only — occupancy is the caller's job). */
    moveTo(cell: Cell, world: Vector3): void {
        this.cell = cell;
        this.world.copy(world);
        this.view.position.copy(world);
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
     * Puts every mech back on its formation slot, alive and visible — the
     * battle phase is a simulation; deployments persist between rounds.
     * Destroyed towers are rebuilt too: rubble stands back up.
     */
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

    resetFormation(): void {
        for (const m of this.members) {
            m.mesh.position.copy(m.home);
            m.mesh.position.y = this.type.flying ?? 0;
            m.mesh.visible = true;
            if (!this.type.structure) m.mesh.rotation.y = this.facing;
            m.mesh.rotation.z = 0; // stand wrecks back up
            m.mesh.scale.setScalar(this.type.meshScale); // un-squash tower rubble
            m.mesh.userData.dead = false;
        }
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
        if (this.type.structure || targets.length === 0) return;
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
        if (this.type.structure) return;
        // idle bob per mech (wrecks lie still); flyers hover at altitude
        const base = this.type.flying ?? 0.05;
        const amplitude = this.type.flying ? 0.35 : 0.04;
        for (const m of this.members) {
            if (m.mesh.userData.dead) continue;
            m.mesh.position.y = base + Math.sin(timeSeconds * 2 + m.phase) * amplitude;
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

/** type lookup by id — actions and replays store unit types as strings */
export function unitTypeById(id: string): UnitType | null {
    if (id === TOWER_TYPE.id) return TOWER_TYPE;
    return UNIT_TYPES.find((t) => t.id === id) ?? null;
}
