/**
 * In-world player flags on each Stronghold: a shared pole with one cloth per
 * seat on that side (avatar face + seat color). Mast sits on the GLB `Flag`
 * empty when present. Visual-only.
 *
 * Flip {@link STRONGHOLD_FLAGS_ENABLED} when shipping this feature.
 */
import {
    CanvasTexture,
    Color,
    CylinderGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    ShaderMaterial,
    SRGBColorSpace,
    Vector3,
    type Scene,
    type Texture,
} from 'three';
import { colorForBattleTeam } from './colors';
import { worldHeightAt } from './map';
import { seatIdsOf, type SeatDef, type SeatId } from './seats';
import {
    attackNodeWorld,
    getUnitFlagNodeLocal,
    getUnitVisualHeight,
} from './unitModels';
import { STRONGHOLD, type Team, type Unit } from './units';
import type { WindInfo } from './weather';

/** Compile-time on/off for rooftop stronghold flags (off until we ship them). */
export const STRONGHOLD_FLAGS_ENABLED = false;

const POLE_HEIGHT = 7.5;
const POLE_RADIUS = 0.12;
const FLAG_W = 4;
const FLAG_H = 2.5;
const FLAG_SEGS_X = 12;
const FLAG_SEGS_Y = 10;
/** where the swallowtail V begins (0–1 along cloth width) — higher = shallower V */
const SWALLOW_START = 0.72;
const TEX_SIZE = 256;
/** margin around the crest inside the uncut body (fraction of tex size) */
const CREST_PAD = 0.08;
/** default when weather is off */
const DEFAULT_WIND: WindInfo = { yaw: 0.55, strength: 0.2 };

const _flagWorld = new Vector3();

const flagVertexShader = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform float uWind;
varying vec2 vUv;
void main() {
    vUv = uv;
    vec3 pos = position;
    float along = clamp(uv.x, 0.0, 1.0);
    float along2 = along * along;
    float wind = clamp(uWind, 0.0, 1.0);

    // calm = almost still; storm = stronger flutter (no limp droop)
    float wave = sin(uTime * (1.4 + wind * 2.4) + along * 4.2 + uPhase) * along2;
    float ripple = sin(uTime * (2.2 + wind * 3.2) + uv.y * 5.5 + uPhase * 0.8) * along2;
    float amp = 0.04 + wind * 0.55;
    pos.z += (wave * 0.35 + ripple * 0.14) * amp;
    pos.y += wave * 0.05 * (uv.y - 0.5) * wind;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const flagFragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
    // sharp swallowtail: two straight edges into a V (no mesh warp)
    float fromMid = abs(vUv.y - 0.5) * 2.0;
    float limit = mix(${SWALLOW_START.toFixed(3)}, 1.0, fromMid);
    if (vUv.x > limit) discard;

    vec4 tex = texture2D(uMap, vUv);
    // texture already carries team color + crest; tint is a soft fallback
    vec3 col = tex.a > 0.5 ? tex.rgb : uTint;
    gl_FragColor = vec4(col, 1.0);
}
`;

type FlagSlot = {
    mesh: Mesh;
    material: ShaderMaterial;
    seat: SeatId;
    avatarKey: string;
};

type Stand = {
    root: Group;
    unitId: number;
    team: Team;
    flags: FlagSlot[];
};

function avatarKeyOf(def: SeatDef | undefined): string {
    return def?.avatar?.startsWith('data:image/') ? def.avatar : '';
}

/**
 * Plain cloth plane — swallowtail V is cut in the fragment shader so the
 * notch stays two sharp straight lines (mesh deformation made it look round).
 */
function makeFlagGeometry(): PlaneGeometry {
    const geo = new PlaneGeometry(FLAG_W, FLAG_H, FLAG_SEGS_X, FLAG_SEGS_Y);
    geo.translate(FLAG_W * 0.5, 0, 0);
    return geo;
}

/** Shared pole / cloth geometries — one allocation for the whole match. */
const poleGeo = new CylinderGeometry(POLE_RADIUS * 0.85, POLE_RADIUS, POLE_HEIGHT, 8);
const flagGeo = makeFlagGeometry();

function paintFlagCanvas(
    canvas: HTMLCanvasElement,
    borderHex: number,
    avatarUrl: string | null,
): void {
    const ctx = canvas.getContext('2d')!;
    const s = TEX_SIZE;
    ctx.clearRect(0, 0, s, s);

    const r = ((borderHex >> 16) & 255);
    const g = ((borderHex >> 8) & 255);
    const b = borderHex & 255;

    // full cloth in player / seat color (including swallowtail tips)
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, s, s);

    // crest only in the uncut rectangular body, with a margin of team color
    const pad = Math.round(s * CREST_PAD);
    const bodyRight = Math.floor(s * SWALLOW_START) - pad;
    const bx = pad;
    const by = pad;
    const bw = Math.max(8, bodyRight - bx);
    const bh = Math.max(8, s - pad * 2);

    const finish = () => {
        // thin darker rim around the crest panel
        ctx.strokeStyle = `rgb(${Math.max(0, r - 50)}, ${Math.max(0, g - 50)}, ${Math.max(0, b - 50)})`;
        ctx.lineWidth = Math.max(2, Math.round(s * 0.012));
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        const tex = (canvas as HTMLCanvasElement & { __tex?: CanvasTexture }).__tex;
        if (tex) tex.needsUpdate = true;
    };

    if (avatarUrl) {
        const img = new Image();
        img.onload = () => {
            // cover-crop into the body panel only
            const scale = Math.max(bw / img.width, bh / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(bx, by, bw, bh);
            ctx.clip();
            ctx.drawImage(img, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
            ctx.restore();
            finish();
        };
        img.src = avatarUrl;
    } else {
        // diamond crest fallback inside the body panel
        ctx.fillStyle = `rgb(${Math.min(255, r + 70)}, ${Math.min(255, g + 70)}, ${Math.min(255, b + 70)})`;
        const cx = bx + bw / 2;
        const cy = by + bh / 2;
        const rad = Math.min(bw, bh) * 0.32;
        ctx.beginPath();
        ctx.moveTo(cx, cy - rad);
        ctx.lineTo(cx + rad, cy);
        ctx.lineTo(cx, cy + rad);
        ctx.lineTo(cx - rad, cy);
        ctx.closePath();
        ctx.fill();
        finish();
    }
}

function makeFlagTexture(borderHex: number, avatarUrl: string | null): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    paintFlagCanvas(canvas, borderHex, avatarUrl);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    (canvas as HTMLCanvasElement & { __tex?: CanvasTexture }).__tex = tex;
    return tex;
}

/** Prefer the live GLB `Flag` empty; fall back to baked local + roof top. */
function flagAnchorWorld(unit: Unit): { x: number; y: number; z: number } {
    const member = unit.members[0];
    if (member && !member.mesh.userData.dead) {
        member.mesh.updateWorldMatrix(true, false);
        const live = member.mesh.getObjectByName('Flag');
        if (live) {
            live.getWorldPosition(_flagWorld);
            return { x: _flagWorld.x, y: _flagWorld.y, z: _flagWorld.z };
        }
    }

    const local = getUnitFlagNodeLocal(STRONGHOLD.id);
    if (local) {
        const footY = worldHeightAt(unit.world.x, unit.world.z) + unit.memberBaseY();
        return attackNodeWorld(
            local,
            unit.world.x,
            footY,
            unit.world.z,
            unit.facing,
            unit.visualMeshScale(),
        );
    }

    const meshTop = getUnitVisualHeight(STRONGHOLD.id) * unit.visualMeshScale();
    return {
        x: unit.world.x,
        y: worldHeightAt(unit.world.x, unit.world.z) + unit.memberBaseY() + meshTop,
        z: unit.world.z,
    };
}

export class StrongholdFlags {
    private readonly stands = new Map<number, Stand>();
    private readonly poleMat: MeshStandardMaterial;
    private readonly textureCache = new Map<string, CanvasTexture>();

    constructor() {
        this.poleMat = new MeshStandardMaterial({
            // warm timber — close to the keep roof planks
            color: new Color(0x7a4a2e),
            roughness: 0.92,
            metalness: 0.02,
        });
    }

    /** Lazy-bind like ForgeFx — Game constructs FX before the scene is ready. */
    ensure(_scene: Scene): void {
        /* scene passed at createStand time */
    }

    update(
        timeSeconds: number,
        strongholds: readonly Unit[],
        seats: readonly SeatDef[],
        scene: Scene,
        visible = true,
        wind: WindInfo = DEFAULT_WIND,
    ): void {
        if (!STRONGHOLD_FLAGS_ENABLED) {
            if (this.stands.size > 0) {
                for (const stand of this.stands.values()) this.disposeStand(stand);
                this.stands.clear();
            }
            return;
        }
        this.ensure(scene);
        if (!visible) {
            for (const stand of this.stands.values()) stand.root.visible = false;
            return;
        }
        const seen = new Set<number>();
        const strength = Math.min(1, Math.max(0, wind.strength));

        for (const unit of strongholds) {
            if (unit.type !== STRONGHOLD || unit.destroyed || unit.team === 'horde') continue;
            seen.add(unit.id);
            const team: Team = unit.team;
            let stand = this.stands.get(unit.id);
            if (!stand) {
                stand = this.createStand(unit.id, team, scene);
                this.stands.set(unit.id, stand);
            }
            stand.root.visible = true;
            this.syncFlags(stand, seats, team);
            this.placeStand(stand, unit, wind.yaw);
            for (const flag of stand.flags) {
                const u = flag.material.uniforms;
                u.uTime!.value = timeSeconds;
                if (!u.uWind) u.uWind = { value: strength };
                else u.uWind.value = strength;
            }
        }

        for (const [id, stand] of this.stands) {
            if (seen.has(id)) continue;
            this.disposeStand(stand);
            this.stands.delete(id);
        }
    }

    dispose(): void {
        for (const stand of this.stands.values()) this.disposeStand(stand);
        this.stands.clear();
        for (const tex of this.textureCache.values()) tex.dispose();
        this.textureCache.clear();
        this.poleMat.dispose();
    }

    private createStand(unitId: number, team: Team, scene: Scene): Stand {
        const root = new Group();
        root.name = `stronghold-flag-${unitId}`;

        const pole = new Mesh(poleGeo, this.poleMat);
        pole.position.y = POLE_HEIGHT * 0.5;
        pole.castShadow = true;
        root.add(pole);

        scene.add(root);
        return { root, unitId, team, flags: [] };
    }

    private syncFlags(stand: Stand, seats: readonly SeatDef[], team: Team): void {
        const seatIds = seatIdsOf(seats, team);
        const wanted = seatIds.slice(0, 2); // one shared stand, up to two cloths

        // drop extras / rebuild when roster, avatar, or facing layout changes
        const same =
            stand.flags.length === wanted.length &&
            stand.flags.every((f, i) => {
                const seat = wanted[i]!;
                return (
                    f.seat === seat &&
                    f.avatarKey === avatarKeyOf(seats[seat]) &&
                    f.mesh.rotation.y === 0 &&
                    !!f.material.uniforms.uWind
                );
            });
        if (same) return;

        for (const f of stand.flags) this.disposeFlag(f);
        stand.flags = [];

        const n = wanted.length;
        for (let i = 0; i < n; i++) {
            const seat = wanted[i]!;
            const def = seats[seat]!;
            // shared keep → both cloths use the SIDE color (blue/red), not the
            // secondary green/orange used to tell duo armies apart on HP bars
            const col = colorForBattleTeam(team);
            const avatar = avatarKeyOf(def);
            const tex = this.textureFor(col.hex, avatar);
            const material = new ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPhase: { value: seat * 1.7 + i * 2.3 },
                    uWind: { value: DEFAULT_WIND.strength },
                    uMap: { value: tex },
                    uTint: { value: new Color(col.hex) },
                },
                vertexShader: flagVertexShader,
                fragmentShader: flagFragmentShader,
                transparent: false,
                depthWrite: true,
                side: DoubleSide,
                fog: false,
            });
            const mesh = new Mesh(flagGeo, material);
            mesh.renderOrder = 2;
            mesh.frustumCulled = false;
            // both cloths face the same wind; stagger height + slight lateral offset
            const y =
                n === 1
                    ? POLE_HEIGHT - FLAG_H * 0.5
                    : POLE_HEIGHT - FLAG_H * (0.5 + i * 1.05);
            mesh.position.set(0, y, (i === 0 ? 0.12 : -0.12) * (n > 1 ? 1 : 0));
            stand.root.add(mesh);
            stand.flags.push({ mesh, material, seat, avatarKey: avatar });
        }
    }

    private placeStand(stand: Stand, unit: Unit, windYaw: number): void {
        const anchor = flagAnchorWorld(unit);
        stand.root.position.set(anchor.x, anchor.y, anchor.z);
        // every flag on the board shares the same wind yaw
        stand.root.rotation.y = windYaw;
    }

    private textureFor(borderHex: number, avatarUrl: string): Texture {
        const key = `side-crest|${borderHex}|${avatarUrl || 'none'}`;
        let tex = this.textureCache.get(key);
        if (!tex) {
            tex = makeFlagTexture(borderHex, avatarUrl || null);
            this.textureCache.set(key, tex);
        }
        return tex;
    }

    private disposeFlag(flag: FlagSlot): void {
        flag.mesh.removeFromParent();
        flag.material.dispose();
        // textures live in the shared cache — don't dispose here
    }

    private disposeStand(stand: Stand): void {
        for (const f of stand.flags) this.disposeFlag(f);
        stand.flags = [];
        stand.root.removeFromParent();
        // pole shares module geo + poleMat; only detach children
        while (stand.root.children.length) stand.root.remove(stand.root.children[0]!);
    }
}
