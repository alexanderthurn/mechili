import {
    ClampToEdgeWrapping,
    DataTexture,
    InstancedBufferAttribute,
    InstancedMesh,
    LinearFilter,
    LinearMipmapLinearFilter,
    Object3D,
    PlaneGeometry,
    RGBAFormat,
    ShaderMaterial,
    Texture,
    TextureLoader,
    UnsignedByteType,
    type Scene,
} from 'three';
import type { HazardField } from './fire';
import { groundSupportAt } from './map';
import type { FireVfxQuality } from './prefs';

/** allocate once at the high-tier ceiling so tier switches don't rebuild the mesh */
const POOL_MAX = 2048;

type VaporTier = {
    maxPuffs: number;
    rimPerCell: number;
    interiorPerCell: number;
    sizeScale: number;
};

const TIER: Record<'high' | 'medium', VaporTier> = {
    medium: {
        maxPuffs: 1024,
        rimPerCell: 5,
        interiorPerCell: 2,
        sizeScale: 1.95,
    },
    high: {
        maxPuffs: 2048,
        rimPerCell: 6,
        interiorPerCell: 2,
        sizeScale: 2.25,
    },
};

const VAPOR_VERT = /* glsl */ `
    attribute float aPhase;
    attribute float aVariant;
    attribute float aSpeed;
    uniform float uTime;
    varying vec2 vUv;
    varying float vLife;
    varying float vVariant;
    void main() {
        vUv = uv;
        vVariant = aVariant;
        float life = fract(uTime * aSpeed * 0.18 + aPhase);
        vLife = life;
        vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sx = length(vec3(instanceMatrix[0]));
        float sy = length(vec3(instanceMatrix[1]));
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float rise = life * 5.2;
        float sway = sin(uTime * 0.65 + aPhase * 6.2832) * life * 0.55;
        float grow = mix(0.88, 1.32, life);
        vec3 world = origin.xyz
            + camRight * (position.x * sx * grow + sway)
            + camUp * (position.y * sy * grow)
            + vec3(0.0, rise, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
`;

const VAPOR_FRAG = /* glsl */ `
    uniform sampler2D uAtlas;
    varying vec2 vUv;
    varying float vLife;
    varying float vVariant;
    void main() {
        float col = floor(vVariant + 0.5);
        vec2 cell = vec2(mod(col, 2.0), 1.0 - floor(col * 0.5)) * 0.5;
        vec2 atlasUv = vUv * 0.5 + cell;
        vec4 tex = texture2D(uAtlas, atlasUv);
        float lum = max(tex.a, max(tex.r, max(tex.g, tex.b)));
        float fade = smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.58, 1.0, vLife));
        float a = lum * fade * 0.78;
        if (a < 0.02) discard;
        vec3 colRgb = tex.rgb * vec3(0.82, 1.08, 0.28);
        gl_FragColor = vec4(colRgb, a);
    }
`;

function acidRim(field: HazardField, x: number, z: number): { rim: boolean; nx: number; nz: number } {
    const s = field.cellSize;
    let nx = 0;
    let nz = 0;
    if (!field.hasAcidAt(x - s, z)) nx -= 1;
    if (!field.hasAcidAt(x + s, z)) nx += 1;
    if (!field.hasAcidAt(x, z - s)) nz -= 1;
    if (!field.hasAcidAt(x, z + s)) nz += 1;
    if (!field.hasAcidAt(x - s, z - s)) {
        nx -= 0.7;
        nz -= 0.7;
    }
    if (!field.hasAcidAt(x + s, z - s)) {
        nx += 0.7;
        nz -= 0.7;
    }
    if (!field.hasAcidAt(x - s, z + s)) {
        nx -= 0.7;
        nz += 0.7;
    }
    if (!field.hasAcidAt(x + s, z + s)) {
        nx += 0.7;
        nz += 0.7;
    }
    const len = Math.hypot(nx, nz);
    if (len < 0.2) return { rim: false, nx: 0, nz: 0 };
    return { rim: true, nx: nx / len, nz: nz / len };
}

/** True when acid smell billboards are drawn (same tiers as flame tongues). */
export function acidUsesFumes(q: FireVfxQuality): boolean {
    return q === 'medium' || q === 'high';
}

/**
 * Rising smell / fume billboards over acid cells — analog of flame tongues.
 * Texture atlas of flat smell sprites; loops fade out as they drift up.
 */
export class AcidFx {
    private readonly mesh: InstancedMesh;
    private readonly material: ShaderMaterial;
    private readonly phases: InstancedBufferAttribute;
    private readonly variants: InstancedBufferAttribute;
    private readonly speeds: InstancedBufferAttribute;
    private readonly dummy = new Object3D();
    private time = 0;
    private tier: VaporTier = TIER.medium;
    private lastKey = '';
    private atlas: Texture | null = null;

    constructor(scene: Scene) {
        const geometry = new PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0);
        this.phases = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        this.variants = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        this.speeds = new InstancedBufferAttribute(new Float32Array(POOL_MAX), 1);
        geometry.setAttribute('aPhase', this.phases);
        geometry.setAttribute('aVariant', this.variants);
        geometry.setAttribute('aSpeed', this.speeds);

        const placeholder = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
        placeholder.needsUpdate = true;

        this.material = new ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAtlas: { value: placeholder },
            },
            transparent: true,
            depthWrite: false,
            depthTest: true,
            fog: false,
            toneMapped: false,
            vertexShader: VAPOR_VERT,
            fragmentShader: VAPOR_FRAG,
        });

        this.mesh = new InstancedMesh(geometry, this.material, POOL_MAX);
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        this.mesh.renderOrder = 2;
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        scene.add(this.mesh);

        const url = new URL('../../assets/textures/vfx/acid-smell-atlas.png', import.meta.url).href;
        new TextureLoader().load(url, (tex) => {
            tex.wrapS = ClampToEdgeWrapping;
            tex.wrapT = ClampToEdgeWrapping;
            tex.magFilter = LinearFilter;
            tex.minFilter = LinearMipmapLinearFilter;
            tex.generateMipmaps = true;
            tex.needsUpdate = true;
            this.atlas = tex;
            this.material.uniforms.uAtlas!.value = tex;
        });
    }

    setQuality(q: FireVfxQuality): void {
        if (q === 'high' || q === 'medium') {
            this.tier = TIER[q];
            this.mesh.visible = true;
        } else {
            this.mesh.visible = false;
            this.mesh.count = 0;
            this.lastKey = '';
        }
    }

    clear(): void {
        this.mesh.count = 0;
        this.lastKey = '';
    }

    /** One dummy puff so WebGL compiles this shader at boot / match start. */
    primeForCompile(): void {
        this.mesh.visible = true;
        this.dummy.position.set(0, 1, 0);
        this.dummy.scale.set(1.4, 2.4, 1);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(0, this.dummy.matrix);
        this.phases.setX(0, 0);
        this.variants.setX(0, 0);
        this.speeds.setX(0, 1);
        this.mesh.count = 1;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.phases.needsUpdate = true;
        this.variants.needsUpdate = true;
        this.speeds.needsUpdate = true;
    }

    update(dt: number, field: HazardField | null): void {
        this.time += dt;
        this.material.uniforms.uTime!.value = this.time;
        if (!this.mesh.visible) {
            this.mesh.count = 0;
            return;
        }
        if (!field) {
            this.mesh.count = 0;
            this.lastKey = '';
            return;
        }

        const { maxPuffs, rimPerCell, interiorPerCell, sizeScale } = this.tier;
        let total = 0;
        let rimN = 0;
        let hash = 0;
        field.forEachAcidCell((x, z, exp) => {
            total++;
            if (acidRim(field, x, z).rim) rimN++;
            hash = (hash + Math.imul(Math.floor(x * 8), 73856093) + Math.imul(Math.floor(z * 8), 19349663) + exp) | 0;
        });
        const key = `${total}:${hash}:${maxPuffs}:${sizeScale}`;
        if (key === this.lastKey) return;
        this.lastKey = key;

        if (total === 0) {
            this.mesh.count = 0;
            return;
        }

        const cellSize = field.cellSize;
        let rimPer = rimPerCell;
        let rimStride = 1;
        if (rimN > 0 && rimN * rimPer > maxPuffs) {
            rimPer = Math.max(2, Math.floor(maxPuffs / rimN));
            if (rimN * rimPer > maxPuffs) rimStride = Math.ceil(rimN / Math.max(1, Math.floor(maxPuffs / rimPer)));
        }

        let n = 0;
        let ri = 0;
        field.forEachAcidCell((x, z) => {
            if (n >= maxPuffs) return;
            const rim = acidRim(field, x, z);
            if (!rim.rim) return;
            if (ri++ % rimStride !== 0) return;
            for (let t = 0; t < rimPer && n < maxPuffs; t++) {
                n = this.placePuff(n, x, z, t, sizeScale, true, rim.nx, rim.nz, cellSize);
            }
        });

        const left = maxPuffs - n;
        const interiorN = total - rimN;
        let inPer = interiorPerCell;
        let inStride = 1;
        if (left <= 0 || interiorN === 0) {
            this.commitCount(n);
            return;
        }
        if (interiorN * inPer > left) {
            inPer = Math.max(1, Math.floor(left / interiorN));
            if (interiorN * inPer > left) inStride = Math.ceil(interiorN / Math.max(1, left));
        }

        let ii = 0;
        field.forEachAcidCell((x, z) => {
            if (n >= maxPuffs) return;
            if (acidRim(field, x, z).rim) return;
            if (ii++ % inStride !== 0) return;
            for (let t = 0; t < inPer && n < maxPuffs; t++) {
                n = this.placePuff(n, x, z, t, sizeScale, false, 0, 0, cellSize);
            }
        });
        this.commitCount(n);
    }

    private commitCount(n: number): void {
        this.mesh.count = n;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.phases.needsUpdate = true;
        this.variants.needsUpdate = true;
        this.speeds.needsUpdate = true;
    }

    private placePuff(
        n: number,
        x: number,
        z: number,
        t: number,
        sizeScale: number,
        rim: boolean,
        nx: number,
        nz: number,
        cellSize: number,
    ): number {
        const h =
            Math.abs(Math.sin(x * 12.9898 + z * 78.233 + t * 19.19) * 43758.5453) % 1;
        const boost = rim ? 1.55 : 0.82;
        const width = (1.45 + h * 0.75) * sizeScale * boost;
        const height = (3.15 + h * 1.45) * sizeScale * boost;
        const out = rim ? cellSize * (0.62 + (t % 3) * 0.28) : (h - 0.5) * 0.55;
        const side = ((h * 2 - 1) * (rim ? 0.7 : 0.45)) * cellSize;
        this.dummy.position.set(
            x + nx * out + -nz * side * 0.35 + (h - 0.5) * 0.35,
            groundSupportAt(x, z) + 0.05,
            z + nz * out + nx * side * 0.35 + ((((h * 7 + t * 3) % 1) - 0.5) * 0.35),
        );
        this.dummy.scale.set(width, height, 1);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        this.phases.setX(n, h * 3.1 + t * 0.41);
        this.variants.setX(n, Math.floor(h * 2.9 + t) % 3);
        this.speeds.setX(n, 0.72 + h * 0.5);
        return n + 1;
    }

    dispose(): void {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.atlas?.dispose();
    }
}
