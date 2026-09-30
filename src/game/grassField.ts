/**
 * Ultra: a lawn of real grass blades around the board.
 *
 * Every blade is a thin tapered strip (a few triangles), and a chunk of ground holds thousands
 * of them in ONE instanced draw: the blade geometry once, plus a small per-blade record (where it
 * stands, which way it faces, how tall it is, how far it leans). The chunks are separate meshes
 * with their own bounds, so the ones off screen are skipped. Blades are lit as if they faced
 * straight up (like the ground under them), dark at the root and lighter at the tip, and they
 * stand still. Render-only: nothing here reads or writes the sim.
 */
import {
    Box3,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    MeshLambertMaterial,
    CanvasTexture,
    DataTexture,
    FloatType,
    LinearFilter,
    NearestFilter,
    RedFormat,
    RGBAFormat,
    Sphere,
    type Texture,
    UnsignedByteType,
    Vector2,
    Vector3,
    Vector4,
} from 'three';
import { mulberry32 } from './map';

export interface GrassFieldOptions {
    halfW: number;
    halfH: number;
    /** how far past the board edge the lawn reaches (it thins out toward there) */
    band: number;
    /** blades per square unit right at the board edge */
    density: number;
    seed: number;
    /** ground height under a point */
    height: (x: number, z: number) => number;
    /** 0..1: how much grass grows here (0 on sand, stone, water) */
    grassAt: (x: number, z: number) => number;
    /** grow on the board too (its grass comes from the same grassAt/height) */
    board?: boolean;
}

/** how much of each blade full snow buries (its share of the blade's height) */
const SNOW_BURY = 0.5;

/** blades are full size up to GRASS_NEAR from the camera and gone at GRASS_FAR (world units) */
const GRASS_NEAR = 110;
const GRASS_FAR = 170;

/** chunk edge length (world units) — the culling granularity */
const CHUNK = 16;
/** the grid the grass mask is sampled on (world units) */
const MASK_CELL = 2;
const BLADE_SEGMENTS = 3;

/** one blade: a strip from root (y 0) to tip (y 1), 1 unit wide at the root, a point at the tip */
function bladeGeometry(): BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= BLADE_SEGMENTS; i++) {
        const t = i / BLADE_SEGMENTS;
        const w = i === BLADE_SEGMENTS ? 0 : 0.5 * (1 - t * t * 0.7);
        pos.push(-w, t, 0, w, t, 0);
        uv.push(0, t, 1, t);
        if (i > 0) {
            const a = (i - 1) * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    return g;
}

/** a 1x1 black texture: no fire, no scorch, height 0 */
function blankTexture(float: boolean): DataTexture {
    const t = float
        ? new DataTexture(new Float32Array([0]), 1, 1, RedFormat, FloatType)
        : new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    t.needsUpdate = true;
    return t;
}
const BLANK = blankTexture(false);

export class GrassField {
    readonly group = new Group();
    readonly material: MeshLambertMaterial;
    readonly snowCover = { value: 0 };
    readonly dryGrass: { value: number };
    /**
     * The board the blades read from: its live height grid (so blades sink into craters and
     * ride up ridges) and the ground's masks — live fire, and the wear layer's scorch — so the
     * grass burns where the ground does and grows back as the scar fades.
     */
    readonly board = {
        uTime: { value: 0 },
        uBoardHalf: { value: new Vector2(1, 1) },
        /** nx, nz, cellX, cellZ of the height grid */
        uGrid: { value: new Vector4(2, 2, 1, 1) },
        uHeightTex: { value: blankTexture(true) as Texture },
        uHazard: { value: blankTexture(false) as Texture },
        uWear: { value: blankTexture(false) as Texture },
        uStainTint: { value: blankTexture(false) as Texture },
        uClear: { value: blankTexture(false) as Texture },
        uBoardOn: { value: 0 },
    };
    private readonly blade = bladeGeometry();
    /** how many blades were placed */
    readonly count: number;
    /** the chunks, for the per-frame distance culling and thinning (see updateView) */
    private readonly chunks: { mesh: Mesh; geo: InstancedBufferGeometry; x: number; y: number; z: number; n: number }[] = [];

    constructor(opts: GrassFieldOptions, dryGrass: { value: number }) {
        this.dryGrass = dryGrass;
        this.material = this.makeMaterial();
        this.count = this.build(opts);
    }

    private makeMaterial(): MeshLambertMaterial {
        const mat = new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide });
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uSnowCover = this.snowCover;
            shader.uniforms.uDryGrass = this.dryGrass;
            Object.assign(shader.uniforms, this.board);
            shader.vertexShader =
                `attribute vec4 aBlade;   // root x, y, z, yaw
attribute vec4 aShape;   // width, height, lean, tint
uniform float uTime;
uniform vec2 uBoardHalf;
uniform vec4 uGrid;
uniform sampler2D uHeightTex;
uniform sampler2D uHazard;
uniform sampler2D uWear;
uniform sampler2D uStainTint;
uniform sampler2D uClear;
uniform float uBoardOn;
uniform float uSnowCover;
varying float vSnow;
varying vec4 vStain;
varying vec3 vMark; // oil, acid, trampled
varying float vBladeT;
varying float vBladeTint;
varying float vBladeY;
varying float vBurn;
varying float vFire;
varying vec2 vBladeVar;
float bladeHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
// the board's height at a point: bilinear between the grid's nodes
float boardHeight(vec2 p) {
    vec2 f = (p + uBoardHalf) / uGrid.zw;
    vec2 i = clamp(floor(f), vec2(0.0), uGrid.xy - 2.0);
    vec2 t = clamp(f - i, 0.0, 1.0);
    ivec2 k = ivec2(i);
    float a = texelFetch(uHeightTex, k, 0).r;
    float b = texelFetch(uHeightTex, k + ivec2(1, 0), 0).r;
    float c = texelFetch(uHeightTex, k + ivec2(0, 1), 0).r;
    float d = texelFetch(uHeightTex, k + ivec2(1, 1), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
` +
                shader.vertexShader
                    .replace(
                        '#include <beginnormal_vertex>',
                        'vec3 objectNormal = vec3(0.0, 1.0, 0.0);',
                    )
                    .replace(
                        '#include <begin_vertex>',
                        `float t = position.y;
    vec3 root = aBlade.xyz;
    float burn = 0.0;
    float fire = 0.0;
    vStain = vec4(0.0);
    vMark = vec3(0.0);
    float squash = 0.0;
    float melt = 0.0;
    bool onBoard = uBoardOn > 0.5 && abs(root.x) <= uBoardHalf.x && abs(root.z) <= uBoardHalf.y;
    if (onBoard) {
        // stand on the ground as it is now (craters, pits, ridges)
        root.y = boardHeight(root.xz) - 0.03;
        // the board's uv (the ground mesh's own: v = 1 at the far edge)
        vec2 buv = vec2((root.x + uBoardHalf.x) / (2.0 * uBoardHalf.x), (uBoardHalf.y - root.z) / (2.0 * uBoardHalf.y));
        vec3 haz = textureLod(uHazard, buv, 0.0).rgb;
        float liveFire = smoothstep(0.14, 0.5, haz.g);
        // the ground's own reading of the hazard mask (map.ts groundHazardColorGlsl)
        float oil = smoothstep(0.04, 0.28, haz.r);
        float acidLive = smoothstep(0.12, 0.48, haz.b) * (1.0 - liveFire * 0.85);
        vec3 wear = textureLod(uWear, buv, 0.0).rgb;
        float scorch = smoothstep(0.04, 0.34, wear.b);
        // blood (or a unit's own coloured gore) soaked into the ground: the same stain the
        // ground shows, in its colour — a dark red where no colour was painted
        vec3 gore = textureLod(uStainTint, buv, 0.0).rgb;
        float hasGore = step(0.004, max(gore.r, max(gore.g, gore.b)));
        // (picked up earlier than the ground's own stain: a faint puddle already reddens the blades)
        vStain = vec4(mix(vec3(0.06, 0.005, 0.008), gore, hasGore), smoothstep(0.03, 0.22, wear.g));
        // footprints and sand wear: trodden down where the armies walked
        float trod = smoothstep(0.06, 0.38, wear.r);
        vMark = vec3(oil, acidLive, trod);
        // oil lays the blades flat under the slick, acid wilts them, feet press them down
        // (height left: oil 70%, acid 30%, trodden 30%)
        squash = max(max(oil * 0.3, acidLive * 0.7), trod * 0.7);
        // pressed flat under the deployment plates (green pack plates, tutorial pads), so the
        // plate reads as a clean shape on the ground
        squash = max(squash, textureLod(uClear, buv, 0.0).r * 0.94);
        fire = liveFire;
        burn = max(scorch, liveFire);
        // the board's snow thaws under fire, oil and acid, and on burnt ground
        melt = max(max(liveFire, oil), max(acidLive, scorch));
    }
    // Snow lies on the grass: the same snow line as the meadow and the mountains, thawed where
    // the board's snow thaws.
    float snowLine = mix(220.0, -15.0, uSnowCover);
    float snowAt = smoothstep(snowLine - 40.0, snowLine + 15.0, root.y) * (1.0 - melt);
    vSnow = snowAt;
    // far from the camera the blades shrink away into the ground's own green (no hard edge)
    float camFade = 1.0 - smoothstep(${GRASS_NEAR.toFixed(1)}, ${GRASS_FAR.toFixed(1)}, distance(cameraPosition, root));
    // burnt: down to stubble, and on the worst of it most blades are gone
    float h = aShape.y * mix(1.0, 0.22, burn) * (1.0 - squash) * camFade;
    float gone = step(0.35 + 0.6 * bladeHash(root.xz), burn * burn);
    h *= 1.0 - gone;
    // the blade bends over along its facing: the lean grows with the square of the height
    vec3 local = vec3(position.x * aShape.x * (1.0 - gone) * camFade, t * h, t * t * aShape.z * (1.0 - burn * 0.7) * camFade);
    float c = cos(aBlade.w);
    float s = sin(aBlade.w);
    vec3 transformed = vec3(local.x * c + local.z * s, local.y, -local.x * s + local.z * c) + root;
    // snow buries the lower half of every blade
    transformed.y -= snowAt * ${SNOW_BURY.toFixed(2)} * h;
    vBladeT = t;
    vBladeTint = aShape.w;
    vBladeY = root.y;
    vBurn = burn;
    // x: this blade's own brightness roll; y: a soft patch across the lawn (tens of units wide),
    // so whole stretches run a little darker or yellower than their neighbours
    vec2 pp = root.xz / 23.0;
    vec2 pi = floor(pp);
    vec2 pf = pp - pi;
    pf = pf * pf * (3.0 - 2.0 * pf);
    // ('patch' is a reserved word in GLSL ES 3)
    float lawnPatch = mix(mix(bladeHash(pi), bladeHash(pi + vec2(1.0, 0.0)), pf.x),
                          mix(bladeHash(pi + vec2(0.0, 1.0)), bladeHash(pi + vec2(1.0, 1.0)), pf.x), pf.y);
    vBladeVar = vec2(bladeHash(root.xz * 1.37 + 5.1), lawnPatch);
    // a living fire flickers along the blades it is eating
    vFire = fire * (0.65 + 0.35 * sin(uTime * 9.0 + root.x * 3.1 + root.z * 2.3));`,
                    );
            shader.fragmentShader =
                `uniform float uSnowCover;
uniform float uDryGrass;
varying float vBladeT;
varying float vBladeTint;
varying float vBladeY;
varying float vBurn;
varying float vFire;
varying vec2 vBladeVar;
varying vec4 vStain;
varying vec3 vMark;
varying float vSnow;
` +
                shader.fragmentShader
                    .replace(
                        '#include <color_fragment>',
                        `#include <color_fragment>
    // deep green at the root (in the shade of the others), fresher toward the tip
    vec3 root = vec3(0.028, 0.055, 0.014);
    vec3 tip = mix(vec3(0.12, 0.19, 0.045), vec3(0.17, 0.21, 0.06), vBladeTint);
    vec3 grass = mix(root, tip, smoothstep(0.0, 1.0, vBladeT));
    // variation: every blade a little darker than the brightest (down to ~65%), some leaning
    // yellow and some blue-green, and whole patches of the lawn a shade apart
    float shade = mix(0.65, 1.0, vBladeVar.x) * mix(0.82, 1.0, vBladeVar.y);
    vec3 hueShift = mix(vec3(0.92, 1.0, 1.12), vec3(1.14, 1.0, 0.78), vBladeTint * 0.6 + vBladeVar.y * 0.4);
    grass *= shade * hueShift;
    vec3 dry = mix(grass * vec3(1.35, 1.15, 0.55), vec3(0.42, 0.36, 0.14), 0.3);
    grass = mix(grass, dry, uDryGrass * (0.6 + 0.4 * vBladeTint));
    // under snow the grass is white, the whole blade
    grass = mix(grass, vec3(1.0), vSnow * (1.0 - vBurn));
    // soaked: heaviest at the root, where it pooled, and only a tinge toward the tip
    float soak = vStain.a * mix(1.0, 0.75, vBladeT);
    grass = mix(grass, vStain.rgb * 1.9 + grass * 0.12, soak);
    // trodden: duller and a little dry; acid: sickly yellow, wilted; oil: black and wet
    grass = mix(grass, mix(grass, vec3(dot(grass, vec3(0.3, 0.59, 0.11))), 0.35) * vec3(1.15, 1.02, 0.7), vMark.z * 0.6);
    grass = mix(grass, vec3(0.20, 0.21, 0.03) * mix(0.6, 1.0, vBladeT), vMark.y * 0.85);
    grass = mix(grass, vec3(0.012, 0.011, 0.009), vMark.x * 0.9);
    // burnt stubble: charcoal at the root, a scorched brown at the tips
    vec3 charred = mix(vec3(0.018, 0.014, 0.010), vec3(0.09, 0.055, 0.025), vBladeT);
    diffuseColor.rgb = mix(grass, charred, vBurn);`,
                    )
                    // the glow of the fire on the blades it burns (not lit by anything else)
                    .replace(
                        '#include <emissivemap_fragment>',
                        `#include <emissivemap_fragment>
    totalEmissiveRadiance += vec3(1.0, 0.38, 0.06) * vFire * smoothstep(0.1, 1.0, vBladeT) * 1.6;`,
                    )
                    // lit like the ground: a double-sided blade would flip its normal on the back
                    .replace(
                        '#include <normal_fragment_begin>',
                        `#include <normal_fragment_begin>
    normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    nonPerturbedNormal = normal;`,
                    );
        };
        mat.customProgramCacheKey = () => 'grass-field-v11-plates';
        return mat;
    }

    private build(o: GrassFieldOptions): number {
        const rng = mulberry32((o.seed ^ 0x6a55e1) >>> 0);
        const outerW = o.halfW + o.band;
        const outerH = o.halfH + o.band;
        // the grass mask on a coarse grid (the terrain tests are too costly per blade)
        const mw = Math.ceil((outerW * 2) / MASK_CELL) + 1;
        const mh = Math.ceil((outerH * 2) / MASK_CELL) + 1;
        const mask = new Float32Array(mw * mh);
        for (let j = 0; j < mh; j++) {
            for (let i = 0; i < mw; i++) {
                const x = -outerW + i * MASK_CELL;
                const z = -outerH + j * MASK_CELL;
                const d = Math.max(Math.abs(x) - o.halfW, Math.abs(z) - o.halfH);
                if ((!o.board && d < -1) || d > o.band) continue;
                mask[j * mw + i] = o.grassAt(x, z);
            }
        }
        const maskAt = (x: number, z: number): number => {
            const fi = (x + outerW) / MASK_CELL;
            const fj = (z + outerH) / MASK_CELL;
            const i = Math.max(0, Math.min(mw - 2, Math.floor(fi)));
            const j = Math.max(0, Math.min(mh - 2, Math.floor(fj)));
            const tx = fi - i;
            const tz = fj - j;
            const a = mask[j * mw + i]! + (mask[j * mw + i + 1]! - mask[j * mw + i]!) * tx;
            const b = mask[(j + 1) * mw + i]! + (mask[(j + 1) * mw + i + 1]! - mask[(j + 1) * mw + i]!) * tx;
            return a + (b - a) * tz;
        };

        let total = 0;
        const cx0 = Math.floor(-outerW / CHUNK);
        const cx1 = Math.ceil(outerW / CHUNK);
        const cz0 = Math.floor(-outerH / CHUNK);
        const cz1 = Math.ceil(outerH / CHUNK);
        for (let cz = cz0; cz < cz1; cz++) {
            for (let cx = cx0; cx < cx1; cx++) {
                const x0 = cx * CHUNK;
                const z0 = cz * CHUNK;
                // chunk entirely on the board, or entirely past the band: nothing grows
                const nearX = Math.max(Math.abs(x0), Math.abs(x0 + CHUNK));
                const farX = Math.min(Math.abs(x0), Math.abs(x0 + CHUNK)) * (x0 < 0 && x0 + CHUNK > 0 ? 0 : 1);
                const nearZ = Math.max(Math.abs(z0), Math.abs(z0 + CHUNK));
                const farZ = Math.min(Math.abs(z0), Math.abs(z0 + CHUNK)) * (z0 < 0 && z0 + CHUNK > 0 ? 0 : 1);
                if (!o.board && nearX <= o.halfW && nearZ <= o.halfH) continue;
                if (farX > outerW || farZ > outerH) continue;
                const tries = Math.round(CHUNK * CHUNK * o.density);
                const blade: number[] = [];
                const shape: number[] = [];
                let minY = Infinity;
                let maxY = -Infinity;
                for (let k = 0; k < tries; k++) {
                    const x = x0 + rng() * CHUNK;
                    const z = z0 + rng() * CHUNK;
                    const d = Math.max(Math.abs(x) - o.halfW, Math.abs(z) - o.halfH);
                    if ((!o.board && d < 0.5) || d > o.band) continue;
                    // thick right at the board, thinning out toward the band's edge
                    const falloff = 1 - Math.min(1, Math.max(0, (d - o.band * 0.35) / (o.band * 0.65)));
                    if (rng() > maskAt(x, z) * falloff) continue;
                    const y = o.height(x, z);
                    // mostly short turf, now and then a taller stalk
                    const h = rng() < 0.15 ? 0.5 + rng() * 0.3 : 0.28 + rng() * 0.22;
                    blade.push(x, y - 0.03, z, rng() * Math.PI * 2);
                    shape.push(0.06 + rng() * 0.05, h, (rng() - 0.3) * 0.45 * h, rng());
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y + h);
                }
                const n = blade.length / 4;
                if (n === 0) continue;
                const geo = new InstancedBufferGeometry();
                geo.index = this.blade.index;
                geo.setAttribute('position', this.blade.getAttribute('position'));
                geo.setAttribute('uv', this.blade.getAttribute('uv'));
                geo.setAttribute('normal', this.blade.getAttribute('normal'));
                geo.setAttribute('aBlade', new InstancedBufferAttribute(new Float32Array(blade), 4));
                geo.setAttribute('aShape', new InstancedBufferAttribute(new Float32Array(shape), 4));
                geo.instanceCount = n;
                // the blade geometry's own bounds are one blade: give the chunk its real ones
                // (with room for the board's ground to sink into a crater or rise into a ridge under them)
                geo.boundingBox = new Box3(new Vector3(x0 - 1, minY - 6, z0 - 1), new Vector3(x0 + CHUNK + 1, maxY + 8, z0 + CHUNK + 1));
                geo.boundingSphere = geo.boundingBox.getBoundingSphere(new Sphere());
                const mesh = new Mesh(geo, this.material);
                mesh.receiveShadow = true;
                mesh.castShadow = false;
                // thin blades in the AO pass only add noise
                mesh.userData.gtaoSkip = true;
                this.group.add(mesh);
                this.chunks.push({ mesh, geo, x: x0 + CHUNK / 2, y: (minY + maxY) / 2, z: z0 + CHUNK / 2, n });
                total += n;
            }
        }
        return total;
    }

    /** read the board: its height grid (a live view of the heights) and the ground's masks */
    bindBoard(opts: {
        halfW: number;
        halfH: number;
        nx: number;
        nz: number;
        cellX: number;
        cellZ: number;
        heights: Float32Array;
        hazard: Texture;
    }): void {
        const tex = new DataTexture(opts.heights, opts.nx, opts.nz, RedFormat, FloatType);
        tex.minFilter = tex.magFilter = NearestFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        this.heightTex = tex;
        this.board.uHeightTex.value = tex;
        this.board.uBoardHalf.value.set(opts.halfW, opts.halfH);
        this.boardHalf = { w: opts.halfW, h: opts.halfH };
        this.board.uGrid.value.set(opts.nx, opts.nz, opts.cellX, opts.cellZ);
        this.board.uHazard.value = opts.hazard;
        this.board.uBoardOn.value = 1;
    }

    private heightTex: DataTexture | null = null;

    private clearCanvas: HTMLCanvasElement | null = null;
    private clearTex: CanvasTexture | null = null;
    private clearKey = '';
    private boardHalf = { w: 1, h: 1 };

    /**
     * Where the grass lies down: the footprint plates on the board, drawn into a small mask the
     * blades read (redrawn only when the set of plates changes).
     */
    setClearRects(rects: readonly { x: number; z: number; halfX: number; halfZ: number }[]): void {
        const key = rects.map((r) => `${r.x.toFixed(1)},${r.z.toFixed(1)},${r.halfX},${r.halfZ}`).join('|');
        if (key === this.clearKey) return;
        this.clearKey = key;
        if (!this.clearCanvas) {
            const c = document.createElement('canvas');
            c.width = 512;
            c.height = Math.max(8, Math.round((512 * this.boardHalf.h) / this.boardHalf.w));
            this.clearCanvas = c;
            this.clearTex = new CanvasTexture(c);
            this.clearTex.generateMipmaps = false;
            this.clearTex.minFilter = LinearFilter;
            this.board.uClear.value = this.clearTex;
        }
        const c = this.clearCanvas;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#fff';
        const sx = c.width / (2 * this.boardHalf.w);
        const sz = c.height / (2 * this.boardHalf.h);
        for (const r of rects) {
            // a hair wider than the plate, so no blade stands on its rim
            const x0 = (r.x - r.halfX - 0.4 + this.boardHalf.w) * sx;
            const z0 = (r.z - r.halfZ - 0.4 + this.boardHalf.h) * sz;
            ctx.fillRect(x0, z0, (2 * r.halfX + 0.8) * sx, (2 * r.halfZ + 0.8) * sz);
        }
        this.clearTex!.needsUpdate = true;
    }

    /**
     * Per frame, by distance to the camera: chunks past the far distance are not drawn at all,
     * and the ones in between draw fewer blades the further out they lie (the blades are stored
     * in random order, so the first part of a chunk is an even thinning of the whole). The shader
     * shrinks the blades to nothing toward the far distance, so the lawn has no edge.
     */
    updateView(camera: Vector3): void {
        const reach = GRASS_FAR + CHUNK * 0.75;
        for (const c of this.chunks) {
            const dx = c.x - camera.x;
            const dy = c.y - camera.y;
            const dz = c.z - camera.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const show = d < reach;
            c.mesh.visible = show;
            if (!show) continue;
            const t = Math.min(1, Math.max(0, (d - GRASS_NEAR * 0.7) / (GRASS_FAR - GRASS_NEAR * 0.7)));
            c.geo.instanceCount = Math.max(1, Math.ceil(c.n * (1 - 0.75 * t)));
        }
    }

    /** per frame: the clock, the current wear and stain layers, and a new upload when the ground moved */
    update(time: number, wear: Texture | null, stainTint: Texture | null, heightsChanged: boolean): void {
        this.board.uTime.value = time;
        this.board.uWear.value = wear ?? BLANK;
        this.board.uStainTint.value = stainTint ?? BLANK;
        if (heightsChanged && this.heightTex) this.heightTex.needsUpdate = true;
    }

    /** everything this lawn made: chunks, the blade, the material, and its own textures */
    dispose(): void {
        for (const m of this.group.children) (m as Mesh).geometry.dispose();
        this.blade.dispose();
        this.material.dispose();
        this.heightTex?.dispose();
        this.heightTex = null;
        this.clearTex?.dispose();
        this.clearTex = null;
        this.clearCanvas = null;
    }
}
