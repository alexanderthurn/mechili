import {
    BoxGeometry,
    CylinderGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    SphereGeometry,
    type Vector3,
} from 'three';
import type { Cell } from './map';

export type Team = 'player' | 'enemy';

export interface UnitType {
    id: string;
    name: string;
    cost: number;
    /** builds the unit's meshes around the origin in world units, facing -z (toward the enemy) */
    build: (parts: PartFactory) => void;
}

const TEAM_ACCENT: Record<Team, number> = {
    player: 0x35e0ff,
    enemy: 0xff5f45,
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
    return material('hull', () => new MeshStandardMaterial({ color: 0x8b9296, roughness: 0.6, metalness: 0.35 }));
}

function darkMaterial(): MeshStandardMaterial {
    return material('dark', () => new MeshStandardMaterial({ color: 0x40464a, roughness: 0.8, metalness: 0.25 }));
}

function accentMaterial(team: Team): MeshStandardMaterial {
    return material(`accent-${team}`, () => {
        const c = TEAM_ACCENT[team];
        return new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.4 });
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

    box(w: number, h: number, d: number, x: number, y: number, z: number, kind: 'hull' | 'dark' | 'accent' = 'hull'): Mesh {
        const mesh = new Mesh(new BoxGeometry(w, h, d), this.pick(kind));
        mesh.position.set(x, y, z);
        return this.add(mesh);
    }

    cylinder(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, kind: 'hull' | 'dark' | 'accent' = 'hull'): Mesh {
        const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, h, 12), this.pick(kind));
        mesh.position.set(x, y, z);
        return this.add(mesh);
    }

    sphere(r: number, x: number, y: number, z: number, kind: 'hull' | 'dark' | 'accent' = 'hull'): Mesh {
        const mesh = new Mesh(new SphereGeometry(r, 12, 10), this.pick(kind));
        mesh.position.set(x, y, z);
        return this.add(mesh);
    }

    private pick(kind: 'hull' | 'dark' | 'accent'): MeshStandardMaterial {
        if (kind === 'accent') return accentMaterial(this.team);
        return kind === 'dark' ? darkMaterial() : hullMaterial();
    }
}

function buildCrawler(parts: PartFactory): void {
    // a small squad of three bugs
    const spots: [number, number][] = [
        [-0.9, 0.5],
        [0.9, 0.35],
        [0, -0.75],
    ];
    for (const [x, z] of spots) {
        parts.sphere(0.42, x, 0.35, z, 'hull');
        parts.sphere(0.16, x, 0.62, z - 0.25, 'accent');
        parts.box(1.0, 0.12, 0.5, x, 0.12, z, 'dark'); // leg plate
    }
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

export const UNIT_TYPES: UnitType[] = [
    { id: 'crawler', name: 'Crawler', cost: 100, build: buildCrawler },
    { id: 'marksman', name: 'Marksman', cost: 200, build: buildMarksman },
    { id: 'fortress', name: 'Fortress', cost: 400, build: buildFortress },
];

/** A placed unit: a real 3D mesh group standing on the battlefield. */
export class Unit {
    readonly view = new Group();
    private readonly bobPhase = Math.random() * Math.PI * 2;

    constructor(
        readonly type: UnitType,
        readonly cell: Cell,
        readonly team: Team,
        readonly world: Vector3,
    ) {
        this.type.build(new PartFactory(this.view, team));
        if (team === 'enemy') this.view.rotation.y = Math.PI; // face the player
        this.view.position.copy(this.world);
    }

    update(timeSeconds: number): void {
        // subtle idle bob
        this.view.position.y = 0.05 + Math.sin(timeSeconds * 2 + this.bobPhase) * 0.04;
    }
}
