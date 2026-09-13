/**
 * Ward Stone dome visuals (custom {@link ShaderMaterial}):
 * team-colored film + runes, soft-hide where same-team domes overlap,
 * bright ripples on absorb hits.
 *
 * Domes are rediscovered each frame from unit roots (state on mesh.userData),
 * so HMR cannot leave an empty module registry.
 */
import {
    CanvasTexture,
    Color,
    DoubleSide,
    Mesh,
    type Object3D,
    RepeatWrapping,
    ShaderMaterial,
    SphereGeometry,
    SRGBColorSpace,
    Vector3,
    Vector4,
} from 'three';
import { colorForBattleTeam } from './colors';
import { mulberry32 } from './map';

type WardTeam = 'player' | 'enemy' | 'horde';

type WardImpactEvent = {
    kind: string;
    x?: number;
    y?: number;
    z?: number;
    ward?: boolean;
};

const MAX_OTHERS = 4;
const MAX_RIPPLES = 4;
const RIPPLE_LIFE = 1.35;

interface WardDomeData {
    wardDome: true;
    wardTeam: WardTeam;
    wardMat: ShaderMaterial;
    wardRipples: { x: number; y: number; z: number; t0: number }[];
    wardRadius: number;
    wardHeight: number;
}

const _world = new Vector3();
const _scale = new Vector3();
let clock = 0;
let liveDomes: Mesh[] = [];
let loggedOnce = false;

function isWorldVisible(o: Object3D): boolean {
    let cur: Object3D | null = o;
    while (cur) {
        if (!cur.visible) return false;
        cur = cur.parent;
    }
    return true;
}

function makeWardRuneTexture(filmHex: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const fr = (filmHex >> 16) & 0xff;
    const fg = (filmHex >> 8) & 0xff;
    const fb = filmHex & 0xff;
    ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, 0.22)`;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = 'rgba(255, 205, 120, 0.9)';
    ctx.lineWidth = 2.5;
    for (const y of [104, 116]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y);
        ctx.stroke();
    }
    const rng = mulberry32(4242);
    ctx.strokeStyle = 'rgba(255, 210, 130, 0.95)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
        const cx = 12 + i * 21 + rng() * 6;
        const cy = 78 + rng() * 22;
        const s = 6 + rng() * 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx, cy + s);
        const branches = 2 + Math.floor(rng() * 2);
        for (let b = 0; b < branches; b++) {
            const by = cy - s + rng() * s * 2;
            ctx.moveTo(cx, by);
            ctx.lineTo(cx + (rng() < 0.5 ? -1 : 1) * (s * 0.9), by + (rng() - 0.5) * s);
        }
        ctx.stroke();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    return texture;
}

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTeamColor;
uniform sampler2D uRuneMap;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uSelf; // this dome's base (world)
uniform float uSelfR;
uniform float uSelfH;
uniform float uOtherCount;
uniform vec4 uOthers[4]; // xyz = base, w = radius
uniform float uOtherH[4];
uniform float uRippleCount;
uniform vec4 uRipples[4]; // xyz = hit, w = t0

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec2 vUv;

// Hemisphere roof Y at xz for a dome with base/radius/height.
float roofY(vec3 base, float rr, float hh, vec2 xz) {
  float d = length(xz - base.xz);
  if (d >= rr) return base.y;
  float t = sqrt(max(1.0 - (d / rr) * (d / rr), 0.0));
  return base.y + hh * t;
}

void main() {
  vec4 rune = texture2D(uRuneMap, vec2(vUv.x * 4.0, vUv.y));
  float fres = pow(1.0 - abs(dot(normalize(vWorldNormal), normalize(vViewDir))), 2.2);

  vec3 col = mix(uTeamColor, rune.rgb, smoothstep(0.15, 0.85, rune.a));
  float alpha = uOpacity * (0.35 + fres * 0.55);
  alpha = max(alpha, rune.a * 0.85);

  // Overlap: keep only the outer roof. If another same-team dome's shell is
  // above us at this xz, we're under it — hide. Avoids mutual-fade holes and
  // the "one full sphere wins the lens" look.
  float fade = 1.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uOtherCount) break;
    vec3 ob = uOthers[i].xyz;
    float rr = uOthers[i].w;
    float hh = max(uOtherH[i], 0.01);
    float d = length(vWorldPos.xz - ob.xz);
    if (d < rr) {
      float otherRoof = roofY(ob, rr, hh, vWorldPos.xz);
      float under = otherRoof - vWorldPos.y;
      if (under > 0.02) {
        fade *= 1.0 - smoothstep(0.02, 0.35, under);
      }
    }
  }
  if (fade < 0.05) discard;
  alpha *= fade;

  // Hit ripples.
  float glow = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uRippleCount) break;
    float age = uTime - uRipples[i].w;
    if (age < 0.0 || age > 1.35) continue;
    float dist = distance(vWorldPos, uRipples[i].xyz);
    float ring = exp(-abs(dist - age * 16.0) * 2.2);
    float wave = 0.5 + 0.5 * sin(dist * 8.0 - age * 20.0);
    glow += ring * wave * exp(-age * 1.6) * 2.8;
  }
  col = mix(col, vec3(1.0), clamp(glow * 0.55, 0.0, 0.9));
  col += uTeamColor * (fres * 0.45 + glow);
  alpha = clamp(alpha + glow * 0.5, 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}
`;

function makeWardMaterial(team: WardTeam): ShaderMaterial {
    const side = colorForBattleTeam(team);
    const runes = makeWardRuneTexture(side.hex);
    return new ShaderMaterial({
        uniforms: {
            uTeamColor: { value: new Color(side.hex) },
            uRuneMap: { value: runes },
            uOpacity: { value: 0.55 },
            uTime: { value: 0 },
            uSelf: { value: new Vector3() },
            uSelfR: { value: 1 },
            uSelfH: { value: 1 },
            uOtherCount: { value: 0 },
            uOthers: {
                value: Array.from({ length: MAX_OTHERS }, () => new Vector4()),
            },
            uOtherH: { value: [0, 0, 0, 0] },
            uRippleCount: { value: 0 },
            uRipples: {
                value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()),
            },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
    });
}

/** Build the translucent hemisphere. Caller parents it under the unit mesh. */
export function createWardDomeMesh(r: number, heightScale: number, team: WardTeam): Mesh {
    const mat = makeWardMaterial(team);
    const mesh = new Mesh(new SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    mesh.scale.y = heightScale;
    mesh.raycast = () => {};
    mesh.renderOrder = 2;

    const data: WardDomeData = {
        wardDome: true,
        wardTeam: team,
        wardMat: mat,
        wardRipples: [],
        wardRadius: r,
        wardHeight: r * heightScale,
    };
    Object.assign(mesh.userData, data);
    return mesh;
}

function domeData(mesh: Mesh): WardDomeData | null {
    const d = mesh.userData as Partial<WardDomeData>;
    return d.wardDome && d.wardMat && d.wardTeam && d.wardRipples ? (d as WardDomeData) : null;
}

function collectDomes(roots: Iterable<Object3D>): Mesh[] {
    const out: Mesh[] = [];
    const seen = new Set<Mesh>();
    for (const root of roots) {
        root.traverse((o) => {
            const mesh = o as Mesh;
            if (!mesh.isMesh || !domeData(mesh) || !isWorldVisible(mesh)) return;
            if (seen.has(mesh)) return;
            seen.add(mesh);
            out.push(mesh);
        });
    }
    return out;
}

function pushRipple(mesh: Mesh, x: number, y: number, z: number): void {
    const d = domeData(mesh);
    if (!d) return;
    if (d.wardRipples.length >= MAX_RIPPLES) d.wardRipples.shift();
    d.wardRipples.push({ x, y, z, t0: clock });
}

export function wardDomeSpawnFromEvents(events: readonly WardImpactEvent[]): void {
    if (liveDomes.length === 0) return;
    for (const e of events) {
        if (e.kind !== 'impact' || !e.ward) continue;
        if (e.x === undefined || e.y === undefined || e.z === undefined) continue;
        let best: Mesh | null = null;
        let bestD = Infinity;
        for (const mesh of liveDomes) {
            const d = domeData(mesh);
            if (!d) continue;
            mesh.getWorldPosition(_world);
            const dist = Math.hypot(e.x - _world.x, e.z - _world.z);
            const reach = Math.max(d.wardRadius * 1.5, 8);
            if (dist < bestD && dist <= reach) {
                bestD = dist;
                best = mesh;
            }
        }
        if (best) pushRipple(best, e.x, e.y, e.z);
    }
}

export function updateWardDomes(dt: number, roots: Iterable<Object3D>): void {
    clock += dt;
    liveDomes = collectDomes(roots);

    type Live = {
        mesh: Mesh;
        data: WardDomeData;
        x: number;
        y: number;
        z: number;
        radius: number;
        height: number;
    };
    const live: Live[] = [];
    for (const mesh of liveDomes) {
        const data = domeData(mesh)!;
        mesh.getWorldPosition(_world);
        mesh.getWorldScale(_scale);
        const geomR = (mesh.geometry as SphereGeometry).parameters.radius;
        const radius = Math.abs(_scale.x) * geomR;
        const height = radius * (Math.abs(_scale.y) / Math.max(Math.abs(_scale.x), 1e-6));
        data.wardRadius = radius;
        data.wardHeight = height;
        live.push({ mesh, data, x: _world.x, y: _world.y, z: _world.z, radius, height });
    }

    if (!loggedOnce && live.length > 0) {
        loggedOnce = true;
        console.info(`[wardDome] tracking ${live.length} dome(s)`);
    }

    for (const L of live) {
        const u = L.data.wardMat.uniforms;
        u.uTime!.value = clock;
        (u.uSelf!.value as Vector3).set(L.x, L.y, L.z);
        u.uSelfR!.value = L.radius;
        u.uSelfH!.value = L.height;

        let oi = 0;
        for (const O of live) {
            if (O.mesh === L.mesh || O.data.wardTeam !== L.data.wardTeam) continue;
            if (oi >= MAX_OTHERS) break;
            (u.uOthers!.value as Vector4[])[oi]!.set(O.x, O.y, O.z, O.radius);
            (u.uOtherH!.value as number[])[oi] = O.height;
            oi++;
        }
        u.uOtherCount!.value = oi;

        L.data.wardRipples = L.data.wardRipples.filter((r) => clock - r.t0 <= RIPPLE_LIFE);
        const n = Math.min(MAX_RIPPLES, L.data.wardRipples.length);
        u.uRippleCount!.value = n;
        for (let i = 0; i < n; i++) {
            const r = L.data.wardRipples[i]!;
            (u.uRipples!.value as Vector4[])[i]!.set(r.x, r.y, r.z, r.t0);
        }
    }
}

export function clearWardDomes(): void {
    liveDomes = [];
    loggedOnce = false;
}
