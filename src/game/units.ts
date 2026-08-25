import {
    Box3,
    BoxGeometry,
    CanvasTexture,
    Color,
    CylinderGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshStandardMaterial,
    RepeatWrapping,
    SphereGeometry,
    SRGBColorSpace,
    Vector3,
} from 'three';
import { THEME } from '../theme';
import { detAtan2 } from './detMath';

/**
 * The ward dome's skin: a faint violet film with a band of golden runes
 * floating near the base and a double arcane circle. RGB carries the hue,
 * alpha carries how solid each texel is (film ~0.2, runes ~1).
 */
function makeWardRuneTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    // violet film
    ctx.fillStyle = 'rgba(150, 105, 235, 0.2)';
    ctx.fillRect(0, 0, 512, 128);
    // double arcane circle near the dome base (bottom of the texture)
    ctx.strokeStyle = 'rgba(255, 205, 120, 0.85)';
    ctx.lineWidth = 2.5;
    for (const y of [104, 116]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y);
        ctx.stroke();
    }
    // golden rune glyphs between the circles / floating just above them
    const rng = mulberry32(4242);
    ctx.strokeStyle = 'rgba(255, 210, 130, 0.95)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
        const cx = 12 + i * 21 + rng() * 6;
        const cy = 78 + rng() * 22;
        const s = 6 + rng() * 4;
        ctx.beginPath();
        // each rune: a vertical stave plus 2-3 random branches
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
    return texture;
}
import { LEVEL_TINT_COLORS, applyLevelTintColor } from './colors';
import { CELL, mulberry32, worldHeightAt, type Cell } from './map';
import { GROUND_UNIT_Y } from './groundQuality';
import {
    attackNodeWorld,
    cloneUnitModel,
    getUnitSlotLocal,
    getUnitVisualHeight,
    hasUnitModel,
    loadUnitModels,
    seedUnitVisualHeight,
} from './unitModels';
import {
    computeCrowWingRate,
    CROW_RIDER_MODEL_ID,
    setCrowWingRateOnProxy,
    setCrowWingRestOnProxy,
} from './crowWingFlap';
import { cloneAnimatedModel, hasAnimatedModel, loadAnimatedModels } from './unitAnimated';
import { getUnitInstanceRenderer, UnitInstanceRenderer } from './unitInstances';
import { beginBuildingCollapse, beginHammerCrush, clearHammerCrush, groundTipAt, hammerCrushSpin, HAMMER_CRUSH_SEAT_Y } from './buildingCollapse';
import { clearCorpsePose, clearDeathFall, clearDeathTip } from './deathFall';
import { preserveBuildingSnow } from './buildingSnow';

export type Team = 'player' | 'enemy';

/**
 * A unit's battle allegiance: one of the two player sides, or the neutral
 * horde (hostile to everyone — the `a.team !== b.team` checks throughout the
 * sim are already N-team correct). Horde units exist only during battle
 * (spawned as summons at battle start) and own no economy/tech/zone state,
 * so all `Record<Team, …>` ownership tables stay binary.
 */
export type BattleTeam = Team | 'horde';

export interface GridExtent {
    cols: number;
    rows: number;
}

/** a purchasable upgrade for a unit type — pure stat multipliers */
export interface TechProduce {
    /** unit type id to spawn */
    typeId: string;
    /** seconds between each completed spawn ("how often" / time to produce one) */
    interval: number;
    /** max spawns per battle from this tech on one pack */
    max: number;
    /**
     * Seconds after the opening freeze before the first spawn.
     * Omit = use `interval` (first unit after one production cycle).
     */
    delay?: number;
}

/** Battle spawn on kill: each enemy this pack slays raises one `typeId` pack. */
export interface TechOnKill {
    /** unit type id to spawn (typically a 1×1 spawn clone) */
    typeId: string;
}

export interface TechDef {
    id: string;
    name: string;
    cost: number;
    /** multipliers applied to the base stats (attackInterval < 1 = faster) */
    mods: Partial<{
        hp: number;
        damage: number;
        range: number;
        speed: number;
        attackInterval: number;
        splashRadius: number;
    }>;
    /** optional fire / oil on hit — applied when this tech is owned */
    fire?: import('./fire').FireProfile;
    /**
     * Battle production: while this pack lives, spawn `typeId` units on a
     * timer (shared machinery for spider mothers, future dwarf forges, etc.).
     */
    produce?: TechProduce;
    /**
     * On-kill spawn: each enemy this pack kills raises one `typeId` pack
     * (no cap). Spawn type should not itself own this tech.
     */
    onKill?: TechOnKill;
    /**
     * Point-blank disk attack: on each swing, every enemy in this XZ radius
     * around the attacker takes this pack's damage (no projectile).
     */
    cleave?: { radius: number };
    /** shown on hover; auto-derived from `mods` when omitted (see {@link techDescription}) */
    description?: string;
    /** atlas glyph; omit to show `tech-default` (question mark — missing icon) */
    icon?: string;
}

/** atlas id for a tech — its own, or `tech-default` if missing (intentional red flag). */
export function techIcon(tech: TechDef): string {
    return tech.icon ?? 'tech-default';
}

/** human-readable summary of what a tech does — its own text, or built from its mods / produce */
export function techDescription(tech: TechDef): string {
    if (tech.description) return tech.description;
    const parts: string[] = [];
    const pct = (mult: number) => `${mult >= 1 ? '+' : '−'}${Math.round(Math.abs(mult - 1) * 100)}%`;
    const { hp, damage, range, speed, attackInterval, splashRadius } = tech.mods;
    if (hp !== undefined && hp !== 1) parts.push(`${pct(hp)} HP`);
    if (damage !== undefined && damage !== 1) parts.push(`${pct(damage)} damage`);
    if (range !== undefined && range !== 1) parts.push(`${pct(range)} range`);
    if (speed !== undefined && speed !== 1) parts.push(`${pct(speed)} move speed`);
    // a lower attack interval means faster firing (rate = 1 / interval)
    if (attackInterval !== undefined && attackInterval !== 1) {
        parts.push(`${pct(1 / attackInterval)} attack speed`);
    }
    if (splashRadius !== undefined && splashRadius !== 1) {
        parts.push(`${splashRadius}× splash radius`);
    }
    if (tech.produce) {
        const p = tech.produce;
        const childName = unitTypeById(p.typeId)?.name ?? p.typeId;
        const every = formatTechSeconds(p.interval);
        let line = `Produces ${childName} every ${every} (up to ${p.max})`;
        if (p.delay !== undefined && p.delay !== p.interval) {
            line += `, first after ${formatTechSeconds(p.delay)}`;
        }
        line += '. Offspring match parent level';
        parts.push(line);
    }
    if (tech.onKill) {
        const childName = unitTypeById(tech.onKill.typeId)?.name ?? tech.onKill.typeId;
        parts.push(`When this unit kills, raise a ${childName}`);
    }
    if (tech.cleave) {
        parts.push(`Hits every enemy within ${tech.cleave.radius} (around this unit)`);
    }
    return parts.length ? parts.join('. ') : tech.name;
}

/** Compact seconds for tech blurbs (`0.1s`, `3s`). */
function formatTechSeconds(seconds: number): string {
    const n = Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 1000) / 1000);
    return `${n}s`;
}

/** ground-hugging altitude for flyers during deployment (full height comes at battle start) */
export const DEPLOY_AIR_Y = 1.25;

/** Ground / particle residue when a unit dies. */
export type DeathWear = 'blood' | 'ash' | 'none';

/** Resolve death wear: explicit override, else ash for structures, blood otherwise. */
export function resolveDeathWear(type: Pick<UnitType, 'deathWear' | 'structure'>): DeathWear {
    return type.deathWear ?? (type.structure ? 'ash' : 'blood');
}

/**
 * Hit/death particle + ground-stain tint. `undefined` = default red.
 * Only meaningful when wear resolves to blood.
 */
export function bloodColorOf(
    type: Pick<UnitType, 'bloodColor' | 'deathWear' | 'structure'>,
): number | undefined {
    if (resolveDeathWear(type) !== 'blood') return undefined;
    return type.bloodColor;
}

/**
 * Local Y above feet that projectiles loft toward (× meshScale at use).
 * Independent of {@link UnitType.colliders} so hitboxes can stay low while
 * shots still read as aimed at the body.
 */
export function projectileAimY(type: UnitType): number {
    if (type.aimY !== undefined) return type.aimY;
    // Mid-body of the rendered mesh — collider centers are often near the feet.
    const visualH = getUnitVisualHeight(type.modelId ?? type.id);
    if (visualH > 0.15) return visualH * 0.5;
    const c = type.colliders[0]?.y ?? 0.5;
    if (!type.flying && type.colliders.length > 0 && c < 0.55) return 0.65;
    return Math.max(c, 0.55);
}

/** Shop / unlock / AI buy eligibility — {@link UnitType.buyable}. */
export function isPlayerBuyable(type: UnitType): boolean {
    return type.buyable !== false;
}

export interface UnitType {
    id: string;
    name: string;
    cost: number;
    /**
     * End-of-battle HP-withdraw weight for this type (per mech in the sim).
     * Drives post-battle particle wave tier (low / medium / high). Omit to
     * derive from {@link hpWithdrawOf}.
     */
    hpWithdraw?: number;
    /**
     * Once-per-deployment shop unlock fee (supply). Only shop-buyable army
     * types set this — omit for towers / board extras / unlisted types.
     */
    unlockCost?: number;
    /**
     * Supply value used for LEVEL price and XP thresholds when it must differ
     * from {@link cost}. Spawn-only units are free (`cost: 0`), which made both
     * the level price and the XP threshold 0 — i.e. instant, free, repeatable
     * level-ups. Money (buy price, sell refund) still uses `cost`, so raising
     * this cannot be farmed for supply.
     */
    levelBasis?: number;
    /**
     * XP granted to the killer per member of this pack killed. Defaults to
     * `cost / memberCount`, which is 0 for spawn-only (free) units and scales
     * oddly for very large or very small packs — set it when the kill should
     * simply be worth a fixed amount.
     */
    xpValue?: number;
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
    /**
     * When `false`, players and the AI cannot buy or unlock this type from
     * the shop. Omit or `true` = eligible (still subject to unlock / extras).
     * Horde / Der Komtur units set this false.
     */
    buyable?: boolean;
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
    /**
     * Optional local Y above feet that projectiles aim at (× meshScale).
     * Hit detection still uses {@link colliders} — this only steers loft.
     */
    aimY?: number;
    /** ranged mechs fire visible projectiles at this speed (world units/s); melee when absent */
    projectileSpeed?: number;
    /**
     * visual for the flying shot — does not affect sim hit radius.
     * `bolt` = energy bead (default); `arrow` / `largeArrow` = fletched shafts;
     * `stone` = hurled rock (catapult); `orb` = wizard magic orb.
     */
    projectileStyle?: 'bolt' | 'arrow' | 'largeArrow' | 'stone' | 'orb';
    /**
     * spawn height above the unit's altitude (world units). When set, overrides
     * the default collider-mid muzzle for that shot.
     */
    projectileLaunchHeight?: number;
    /**
     * Muzzle height as a fraction of visual mesh height (0..1), above feet.
     * Easier than absolute units — e.g. `0.75` ≈ upper chest / bow. Ignored when
     * {@link projectileLaunchHeight} is set.
     */
    projectileLaunchHeightFrac?: number;
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
    /**
     * Conversion ray — the Wizard's only attack. Progress fills at effective
     * attack (resolved damage × level × tower attack debuff) per second toward
     * the victim's current HP; at full, allegiance flips for the rest of the
     * battle. Buildings, golden-aura mechs, and ward domes cannot be converted
     * — the ray deals the same continuous HP damage instead. `recover` is idle
     * seconds after a successful convert.
     */
    convertRay?: { range: number; recover?: number };
    /**
     * Ground wear strength when walking/standing (1 ≈ typical infantry).
     * Omit = derive from cost + bulk via {@link sandStampWeight}.
     */
    sandWeight?: number;
    /**
     * Ground stain / death particles. Omit = ash if structure, else blood.
     */
    deathWear?: DeathWear;
    /** Ash-death scorch on the wear mask. Omit = global big/small defaults. */
    deathAshScorch?: { radius: number; strength: number };
    /**
     * Hit/death gore tint (hex). Omit = default red. Ignored when wear is
     * ash/none (structures, siege, etc.).
     */
    bloodColor?: number;
    /**
     * Burn / ground-fire inflicted by this unit's hits (projectiles, splash, rockets, melee).
     * Ground fire stamps the shared hazard layer; burn DoT uses refresh + strongest DPS.
     */
    fire?: import('./fire').FireProfile;
    /**
     * Melee disk: each swing hits every enemy in this XZ radius (no projectile).
     * Combined with {@link range} as the engagement distance.
     */
    cleave?: { radius: number };
    /** Camera shake when a flyer cleave slams the ground (0–1+; see explosion.shake). */
    cleaveShake?: number;
    /** how hard burn DoT hits this type (omit = 1; 0 = immune). Air is skipped regardless. */
    burn?: import('./fire').BurnAffinity;
    /**
     * On projectile/splash hit: apply the corroded (acid) debuff to non-horde
     * victims for this many seconds (refreshes).
     */
    corrodeOnHit?: { seconds: number };
    /**
     * Tech ids always owned by this type (even horde / seat −1). Used for
     * innate battle abilities like Schwarze Spinne's brood production.
     */
    innateTechs?: string[];
    /** immune to poison-cloud spells (default: affected) */
    poisonImmune?: boolean;
    /** combat stats, per individual mech */
    hp: number;
    damage: number;
    range: number;
    /**
     * Minimum engagement range (dead zone). A ranged unit cannot fire at an
     * enemy closer than this; it prefers targets it can still hit and backs
     * away when everything left is too close. Omit / 0 = no dead zone.
     */
    minRange?: number;
    /**
     * This unit's attacks ignore {@link Actor.shieldHp} and hit HP directly.
     * Melee contact always pierces (structural) — set this for a RANGED attack
     * that should also bypass shields. DoT (burn / acid / poison) always
     * bypasses, since it never routes through applyDamage.
     */
    piercesShield?: boolean;
    /** seconds between shots */
    attackInterval: number;
    speed: number;
    /**
     * Procedural walk lean *height* for non-skinned ground units (omit = 1).
     * Scales bob / roll / forward lean. Speed (stun, oil, debuffs) still
     * multiplies via displacement. Pair with {@link walkCadence} for step rate.
     */
    walkLean?: number;
    /**
     * Procedural walk *step rate* for non-skinned ground units (omit = 1).
     * Scales gait frequency only — not lean amplitude. See {@link walkLean}.
     */
    walkCadence?: number;
    /**
     * Max yaw change while turning (rad/s). Every mobile type sets its own —
     * small infantry high, siege / bosses low. Structures omit (never turn).
     */
    turnRate?: number;
    /**
     * How locomotion couples to facing while {@link turnRate} applies:
     * - `track` (default) — move along the seek direction; facing eases toward it
     * - `pivot` — stand until roughly aligned, then walk (big spiders, ballista)
     * - `cruise` — keep moving along current facing while yaw eases (flyers)
     */
    turnMove?: 'track' | 'pivot' | 'cruise';
    /** builds ONE mech's meshes around the origin in world units, facing -z (toward the enemy) */
    build: (parts: PartFactory) => void;
    /**
     * Scatters each member off its grid slot by up to this fraction of the
     * slot spacing (0 = the usual tight rectangle). Deterministic — a pure
     * hash of the member's grid index, so every client renders/simulates the
     * identical scatter. Used by horde packs so a wave reads as a mob instead
     * of a drilled formation; regular buildable packs leave this unset.
     */
    formationSpread?: number;
    /**
     * Id to use for 3D model / InstancedMesh-pool lookups (unitModels.ts,
     * unitAnimated.ts, UnitInstanceRenderer) instead of this type's own `id`.
     * Id to look up in unitModels MODEL_SPECS / instance pools instead of
     * this type's own `id`. Lets a variant (e.g. HORDE_ZOMBIE → `horde`)
     * point at a dedicated GLB. Defaults to `id`.
     */
    modelId?: string;
}

/**
 * Deterministic 0..1 pseudo-random from an integer key — pure bitwise
 * integer ops (no floats/trig), so it's bit-identical on every client.
 * Used for {@link UnitType.formationSpread}, which offsets member spawn
 * positions and therefore must stay network-safe.
 */
function hash01(n: number): number {
    let h = (n ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
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

function accentMaterial(_team: BattleTeam): MeshStandardMaterial {
    // neutral accent — ownership is HP-bar / panel; mesh tint is by level
    return material('accent-neutral', () => {
        return new MeshStandardMaterial({
            color: THEME.hull,
            emissive: THEME.hull,
            emissiveIntensity: THEME.accentEmissive * 0.35,
            roughness: 0.4,
        });
    });
}

/** Small helper handed to unit builders: adds primitives with shadows enabled. */
class PartFactory {
    constructor(
        private readonly group: Group,
        private readonly team: BattleTeam,
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

    /** translucent arcane ward dome (shield extra) — casts no shadow */
    dome(r: number, heightScale: number): Mesh {
        const mesh = new Mesh(
            new SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
            material('shield-dome-arcane', () => {
                const runes = makeWardRuneTexture();
                const m = new MeshStandardMaterial({
                    color: 0xffffff,
                    map: runes, // violet film + golden rune band (alpha carries both)
                    emissive: 0xffffff,
                    emissiveMap: runes,
                    emissiveIntensity: 0.85,
                    transparent: true,
                    opacity: 0.6,
                    roughness: 0.4,
                    side: DoubleSide,
                    depthWrite: false,
                });
                // arcane fresnel rim: the dome edge glows violet like a soap
                // bubble of magic instead of a flat sci-fi tint
                m.onBeforeCompile = (shader) => {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <emissivemap_fragment>',
                        `#include <emissivemap_fragment>
    float wardFres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
    totalEmissiveRadiance += vec3(0.62, 0.38, 1.0) * wardFres * 1.4;
    diffuseColor.a = clamp(diffuseColor.a + wardFres * 0.5, 0.0, 1.0);`,
                    );
                };
                m.customProgramCacheKey = () => 'shield-dome-arcane';
                return m;
            }),
        );
        mesh.scale.y = heightScale;
        // Visual-only: the hull must not steal unit picks (build or battle).
        // Click the stone/pylon to select the ward; units under the dome stay clickable.
        mesh.raycast = () => {};
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

function buildWizard(parts: PartFactory): void {
    for (const side of [-1, 1]) {
        parts.cylinder(0.1, 0.14, 1.05, side * 0.28, 0.52, 0.08, 'dark'); // legs
    }
    parts.box(0.85, 1.0, 0.7, 0, 1.35, 0, 'hull'); // robe torso
    parts.sphere(0.28, 0, 2.05, -0.05, 'accent'); // hooded head
    parts.cylinder(0.05, 0.05, 2.4, 0.55, 1.4, -0.15, 'dark'); // staff
    parts.sphere(0.2, 0.55, 2.7, -0.15, 'accent'); // staff orb
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
 * each carries its own role (and upgrade level). The Research Center hosts the
 * recruit-level switch; the Command Tower's role is still open.
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
        burn: { takenMult: 0.35 }, // stone / masonry resists
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
        build: buildTower,
    };
}

export const COMMAND_TOWER = makeTower('command-tower', 'Vanguard', 3.0, 3);
export const RESEARCH_CENTER = makeTower('research-center', 'Garrison');
/** each side's main castle at the back of its territory — bigger and sturdier */
export const STRONGHOLD = makeTower('stronghold', 'Stronghold', 5, 4.2, 3000);

/**
 * An archer bought onto the keep's battlements. Shoots exactly like the pack
 * archer — same bow, same numbers — and differs in three ways only: he cannot
 * move (`speed: 0`), nothing can shoot him (`colliders: []`, the Ward Stone's
 * trick), and he stands on an authored `UnitN` slot rather than the grid, via
 * {@link Unit.pinnedY}. He is deliberately not in UNIT_TYPES: the shop must
 * never offer him, he is bought from the Stronghold panel one at a time.
 */
export const GARRISON_ARCHER: UnitType = {
    id: 'garrison-archer',
    name: 'Garrison Archer',
    // reuses the archer GLB — no second model, and no new fingerprint entry
    modelId: 'archer',
    cost: 100,
    footprint: { cols: 1, rows: 1 },
    formation: { cols: 1, rows: 1 },
    meshScale: 2.2,
    burn: { takenMult: 1.1 },
    targets: { ground: true, air: true },
    collisionRadius: 1.0,
    /**
     * `extra` is what makes him unshootable — the sim's own "not a target"
     * flag, the same one the Ward Stone uses, honoured by every targeting,
     * splash, blast and burn path. His colliders stay REAL: the mouse picker
     * builds its pick spheres from this list too, and an empty one made him
     * impossible to click as well as impossible to shoot.
     */
    extra: true,
    colliders: [{ y: 1.1, r: 0.75 }],
    projectileSpeed: 100,
    projectileStyle: 'arrow',
    projectileBallistic: true,
    projectileLaunchHeightFrac: 0.75,
    hp: 130,
    damage: 65,
    range: 45,
    attackInterval: 1.4,
    speed: 0,
    turnRate: 6,
    build: buildArcher,
};

/**
 * World position of one of a keep's authored standing spots.
 *
 * Deliberately the BAKED path only — never the live `getObjectByName` lookup
 * the commander's decoration uses. This feeds where a garrison archer stands
 * and therefore what he can shoot, so it has to come out identical on every
 * peer from the action log alone, with no reference to view state.
 */
export function garrisonSlotWorld(keep: Unit, slot: number): { x: number; y: number; z: number } | null {
    const local = getUnitSlotLocal(keep.type.id, slot);
    if (!local) return null;
    const footY = worldHeightAt(keep.world.x, keep.world.z) + GROUND_UNIT_Y;
    return attackNodeWorld(
        local,
        keep.world.x,
        footY,
        keep.world.z,
        keep.facing,
        keep.visualMeshScale(),
    );
}

/** How many archers a keep's battlements hold — `Unit5` is the commander's. */
export const GARRISON_SLOTS = [1, 2, 3, 4] as const;
/**
 * Half of a garrison archer's field of fire: 135° each side of outward, so he
 * covers 270° and the 90° wedge pointing back into the keep is dead.
 */
export const GARRISON_FOV_HALF = (Math.PI * 3) / 4;
/** first archer 1, second 2, third 3, fourth 4 — TEST PRICING, raise to 100 */
export const GARRISON_STEP_COST = 1;

/** shield dome coverage, world units — the top stays below the air layer (18) */
export const SHIELD_RADIUS = 20;
export const SHIELD_HEIGHT = 17;

/**
 * Der Komtur's light spider swarm — `horde.glb` at base scale. Cheap melee
 * fodder. `buyable: false`.
 */
export const HORDE_BRUT: UnitType = {
    id: 'hordeZombie', // keep legacy id for hydrate/replay
    name: 'Black Brood',
    cost: 80,
    hpWithdraw: 2,
    buyable: false,
    modelId: 'horde',
    // 2× terrain pack area vs original 10×6; same small mesh
    footprint: { cols: 20, rows: 12 },
    formation: { cols: 8, rows: 6 }, // 48 — 2× prior 8×3 headcount
    formationSpread: 0.95,
    meshScale: 0.5,
    burn: { takenMult: 0.5 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: false },
    collisionRadius: 0.6,
    colliders: [{ y: 0.3, r: 0.5 }],
    sandWeight: 0.15,
    hp: 42,
    xpValue: 1,
    damage: 10,
    range: 2,
    attackInterval: 0.65,
    speed: 12,
    turnRate: 10,
    build: buildDwarf,
};

/** @deprecated use {@link HORDE_BRUT} */
export const HORDE_ZOMBIE = HORDE_BRUT;

/**
 * Mid spider pack — `horde.glb` at 2×. Distant fighters (special attacks later).
 * Smaller packs than Brut. `buyable: false`.
 */
export const HORDE_WEBWEAVER: UnitType = {
    id: 'hordeWebweaver',
    name: 'Webweaver',
    cost: 200,
    hpWithdraw: 12,
    buyable: false,
    modelId: 'horde',
    // 2× terrain pack area vs original 6×4; same mesh scale
    footprint: { cols: 12, rows: 8 },
    formation: { cols: 4, rows: 2 }, // 8 mechs, more spread out
    formationSpread: 1.0,
    meshScale: 1.0,
    burn: { takenMult: 0.5 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: false },
    collisionRadius: 0.7,
    colliders: [{ y: 0.5, r: 0.75 }],
    sandWeight: 0.2,
    projectileSpeed: 55,
    projectileStyle: 'bolt',
    corrodeOnHit: { seconds: 5 },
    hp: 210,
    damage: 100,
    range: 16,
    attackInterval: 0.9,
    speed: 12,
    turnRate: 5,
    build: buildDwarf,
};

/**
 * Single Schwarze Brut spawned by the mother Spinne — same stats as the swarm
 * mech, 1×1 formation so brood doesn't dump full packs. `buyable: false`.
 */
export const HORDE_BRUT_SPAWN: UnitType = {
    id: 'hordeBrutSpawn',
    name: 'Black Brood',
    cost: 0,
    levelBasis: 100, // free to gain, but 50 per level and 100 xp per level
    hpWithdraw: 2,
    buyable: false,
    modelId: 'horde',
    footprint: { cols: 2, rows: 2 },
    formation: { cols: 1, rows: 1 },
    meshScale: 0.5,
    burn: { takenMult: 0.5 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: false },
    collisionRadius: 0.45,
    colliders: [{ y: 0.3, r: 0.5 }],
    sandWeight: 0.15,
    hp: 42,
    xpValue: 1,
    damage: 10,
    range: 2,
    attackInterval: 0.65,
    speed: 12,
    turnRate: 10,
    build: buildDwarf,
};

/**
 * The one Schwarze Spinne — `horde.glb` at large scale. Mother of spiders via
 * innate `spiderMother` produce tech + acid shots. `buyable: false`.
 */
export const HORDE_SPINNE: UnitType = {
    id: 'hordeSpinne',
    name: 'Black Spider',
    cost: 500,
    hpWithdraw: 70,
    buyable: false,
    modelId: 'horde',
    footprint: { cols: 4, rows: 3 },
    formation: { cols: 1, rows: 1 },
    meshScale: 6.0, // 12× Brood — showcase boss presence
    burn: { takenMult: 0.4 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: true },
    collisionRadius: 3.2,
    colliders: [
        { y: 0.7, r: 1.5 },
        { y: 2.0, r: 1.1 },
    ],
    sandWeight: 0.135, // 10% of prior 1.35
    projectileSpeed: 70,
    projectileStyle: 'orb',
    corrodeOnHit: { seconds: 6 },
    innateTechs: ['spiderMother'],
    hp: 4500, // 5× prior
    damage: 200,
    range: 44,
    attackInterval: 0.4,
    speed: 12,
    turnRate: 1.0,
    turnMove: 'pivot',
    build: buildDwarf,
    walkCadence: 1.5,
    walkLean: 1.5,
};

/**
 * Der Komtur's forest levy — `horde2.glb` farmer. `buyable: false`.
 */
export const HORDE_FARMER: UnitType = {
    id: 'hordeFarmer',
    name: 'Dead Farmer',
    cost: 175,
    hpWithdraw: 7,
    buyable: false,
    modelId: 'horde2',
    footprint: { cols: 10, rows: 6 },
    formation: { cols: 6, rows: 2 }, // 12 — fewer than Brut swarm
    formationSpread: 0.75,
    meshScale: 1.7, // 2× prior 0.85
    burn: { takenMult: 0.5 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: false },
    collisionRadius: 0.9,
    colliders: [{ y: 0.55, r: 0.95 }],
    sandWeight: 0.25,
    innateTechs: ['darkHarvest'],
    hp: 200,
    damage: 100,
    range: 2,
    attackInterval: 0.7,
    speed: 12,
    turnRate: 4,
    build: buildDwarf,
};

/**
 * On-kill spawn from Dark Harvest — half the Dead Farmer in size and combat
 * weight, 1×1 so each kill raises one body. No Dark Harvest (no chain).
 */
export const HORDE_FARMER_SPAWN: UnitType = {
    id: 'hordeFarmerSpawn',
    name: 'Dead Farmhand',
    cost: 0,
    levelBasis: 100, // free to gain, but 50 per level and 100 xp per level
    hpWithdraw: 4,
    buyable: false,
    modelId: 'horde2',
    footprint: { cols: 2, rows: 2 },
    formation: { cols: 1, rows: 1 },
    meshScale: 0.85,
    burn: { takenMult: 0.5 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: false },
    collisionRadius: 0.45,
    colliders: [{ y: 0.28, r: 0.48 }],
    sandWeight: 0.125,
    hp: 100,
    damage: 50,
    range: 2,
    attackInterval: 0.7,
    speed: 12,
    turnRate: 5,
    build: buildDwarf,
};

/**
 * Der Komtur himself — mounted knight on `horde3.glb`. Flying melee boss:
 * each swing slams a short disk and lights the lawn. `buyable: false`.
 */
export const HORDE_KOMTUR: UnitType = {
    id: 'hordeKomtur',
    name: 'Hans von Stoffeln',
    cost: 600,
    hpWithdraw: 800,
    buyable: false,
    modelId: 'horde3',
    footprint: { cols: 4, rows: 3 },
    formation: { cols: 1, rows: 1 },
    meshScale: 4.2, // half of prior 8.4
    flying: 22,
    burn: { takenMult: 0.35 },
    bloodColor: 0x8cef18,
    targets: { ground: true, air: true },
    collisionRadius: 1.1,
    colliders: [
        { y: 0.8, r: 2.0 },
        { y: 2.4, r: 1.5 },
    ],
    cleave: { radius: 8 },
    cleaveShake: 1,
    fire: {
        ground: { radius: 8, duration: 8, intensity: 21 },
    },
    hp: 12000, // 10× prior boss weight
    damage: 550,
    range: 8,
    attackInterval: 0.85,
    speed: 12,
    turnRate: 2.2,
    turnMove: 'cruise',
    build: buildDwarf,
};

export const UNIT_TYPES: UnitType[] = [
    {
        id: 'dwarf',
        name: 'Dwarf',
        cost: 100,
        unlockCost: 0,
        footprint: { cols: 5, rows: 2 },
        formation: { cols: 8, rows: 3 }, // a pack of 24 fighters
        meshScale: 1,
        burn: { takenMult: 0.5 }, // tough infantry — resists fire better
        targets: { ground: true, air: false }, // can't reach the sky
        collisionRadius: 0.6,
        colliders: [{ y: 0.35, r: 0.55 }],
        hp: 40,
        damage: 8,
        range: 2,
        attackInterval: 0.7,
        speed: 6,
        // short legs — taller lean + quicker steps than other walkers
        walkLean: 1,
        walkCadence: 1.5,
        turnRate: 12,
        build: buildDwarf,
    },
    {
        id: 'archer',
        name: 'Archer',
        cost: 100,
        unlockCost: 0,
        footprint: { cols: 2, rows: 2 },
        formation: { cols: 1, rows: 1 },
        meshScale: 2.2,
        burn: { takenMult: 1.1 },
        targets: { ground: true, air: true }, // picks off anything
        collisionRadius: 1.0,
        colliders: [{ y: 1.1, r: 0.75 }],
        projectileSpeed: 100,
        projectileStyle: 'arrow',
        projectileBallistic: true, // bow lob — lead-aimed so moving targets still get clipped
        projectileLaunchHeightFrac: 0.75,
        hp: 130,
        damage: 65,
        range: 45,
        attackInterval: 1.4,
        speed: 3.5,
        turnRate: 6,
        build: buildArcher,
    },
    {
        id: 'wizard',
        name: 'Wizard',
        cost: 400,
        unlockCost: 200,
        footprint: { cols: 2, rows: 2 },
        formation: { cols: 1, rows: 1 },
        meshScale: 2.2,
        burn: { takenMult: 1.15 },
        // convert ray is the only attack — ground by default; Sky Bind unlocks air.
        // Buildings / golden aura / wards take HP damage from the same ray.
        targets: { ground: true, air: false },
        collisionRadius: 1.0,
        colliders: [{ y: 1.1, r: 0.75 }],
        convertRay: { range: 80, recover: 1.25 },
        hp: 160,
        // attack = convert intensity / ray DPS (HP progress or damage per second)
        damage: 45,
        range: 80,
        attackInterval: 1.6,
        speed: 3.2,
        turnRate: 5,
        build: buildWizard,
    },
    {
        id: 'crowRider',
        name: 'Crow Rider',
        cost: 200,
        unlockCost: 50,
        footprint: { cols: 5, rows: 2 }, // same pack size as dwarves
        formation: { cols: 4, rows: 1 }, // a flock of 12 riders, two wide rows
        meshScale: 4.35, // slightly smaller so the tighter columns don't touch
        flying: 18,
        burn: { takenMult: 1 }, // air: burn status ignored while aloft
        targets: { ground: true, air: true },
        collisionRadius: 3,
        colliders: [{ y: 0.1, r: 0.75 }],
        projectileSpeed: 70,
        projectileStyle: 'stone',
        // wide blast vs packed dwarves (3× the ballista's old splash radius of 3)
        splashRadius: 3,
        hp: 45,
        damage: 35,
        range: 12,
        attackInterval: 1.1,
        speed: 8,
        turnRate: 0.5,
        turnMove: 'cruise',
        build: buildCrowRider,
    },
    {
        id: 'ballista',
        name: 'Ballista',
        cost: 400,
        unlockCost: 200,
        hpWithdraw: 400,
        footprint: { cols: 4, rows: 4 },
        formation: { cols: 1, rows: 1 },
        meshScale: 3.2,
        targets: { ground: true, air: false }, // Sky Bind baked in — bolts can elevate
        collisionRadius: 2.8,
        colliders: [{ y: 0.9, r: 1.1 }],
        projectileSpeed: 50,
        projectileStyle: 'largeArrow',
        // cradle sits high on the siege frame — not at the chassis collider mid
        projectileLaunchHeight: 5.8,
        projectileBallistic: true,
        splashRadius: 5, // bolts shatter — everything near the impact takes the hit
        // heavy chassis would stamp hard from cost/bulk — keep a light track
        sandWeight: 1.1,
        deathWear: 'ash', // wood/iron siege — burns, no blood
        deathAshScorch: { radius: 5, strength: 0.35 }, // half the default big-unit ash scar
        burn: { takenMult: 4.0 }, // timber siege — burns hard once lit
        hp: 500,
        damage: 500,
        range: 84,
        minRange: 30, // siege dead zone — can't hit foes that close in
        attackInterval: 3.8,
        speed: 2.2,
        turnRate: 1.2,
        turnMove: 'pivot',
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
        burn: { takenMult: 0 },
        shield: { radius: SHIELD_RADIUS, height: SHIELD_HEIGHT },
        targets: { ground: false, air: false },
        collisionRadius: 1.3, // only the emitter pylon blocks walking
        colliders: [], // nothing can shoot it — it only absorbs crossings
        hp: 3000, // the absorb pool; refills between rounds if it survives
        damage: 0,
        range: 0,
        attackInterval: 1,
        speed: 0,
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
        flying: 36, // always at combat altitude (unlike crow riders)
        rocket: { range: 35, speed: 30, damage: 5000, splash: 8 }, // wipes a close-packed swarm
        splashRadius: 8, // display only — the blast itself comes from `rocket.splash`
        // splash + lingering burn + ground fire (oil connected to this ignites)
        fire: {
            burn: { dps: 28, duration: 12 },
            ground: { radius: 8, duration: 20, intensity: 27 },
        },
        burn: { takenMult: 0 }, // the bolt itself doesn't cook
        targets: { ground: true, air: true }, // what it may home onto / hurt
        collisionRadius: 0.8,
        colliders: [],
        hp: 100,
        damage: 5000,
        range: 35,
        attackInterval: 1,
        speed: 0,
        build: buildRocket,
    },
    // Der Komtur's forest roster — in the catalog for lookup/preload, not shop
    HORDE_BRUT,
    HORDE_BRUT_SPAWN,
    HORDE_WEBWEAVER,
    HORDE_SPINNE,
    HORDE_FARMER,
    HORDE_FARMER_SPAWN,
    HORDE_KOMTUR,
];

/** Mechs in a pack — used for default hpWithdraw derivation. */
export function formationHeadcount(type: UnitType): number {
    return Math.max(1, type.formation.cols * type.formation.rows);
}

/**
 * Per-mech HP-withdraw weight for wave grouping. Explicit `hpWithdraw` on the
 * type wins; otherwise `cost / formation headcount` (same basis as battle-end
 * damage per sim actor).
 */
export function hpWithdrawOf(type: UnitType): number {
    if (type.hpWithdraw !== undefined) return type.hpWithdraw;
    return type.cost / formationHeadcount(type);
}

export type HpDrawWaveTier = 'low' | 'medium' | 'high';

/** Post-battle particle wave from hpWithdraw: low < 100, medium < 300, high otherwise. */
export function hpDrawWaveTier(withdraw: number): HpDrawWaveTier {
    if (withdraw < 100) return 'low';
    if (withdraw < 300) return 'medium';
    return 'high';
}

/**
 * A placed unit: one or more real 3D mech meshes standing in formation
 * across the unit's footprint. `cell` is the top-left anchor tile and
 * `world` the center of the footprint rectangle.
 */
export class Unit {
    /** stable per-match id, assigned at spawn — actions reference units by this */
    id = 0;
    /** the commander (seat) this pack belongs to; 0-based index into the roster */
    seat = 0;
    readonly view = new Group();
    /**
     * false while the owner is still in a build phase: opponents can't see the
     * unit yet, and it is ignored when other units pick a facing target.
     */
    revealed = true;
    /**
     * Absolute world Y this pack is pinned to, instead of standing on the
     * terrain under it — a garrison archer up on his keep's battlement. Set
     * once when the pack is created and never animated: he does not bob, climb
     * or walk, so every consumer can treat it as a constant.
     */
    /**
     * Spawned straight into the world with no grid cell — {@link Unit.cell} is
     * a {0,0} placeholder and must never be used to position anything.
     */
    gridless = false;
    pinnedY: number | null = null;
    /**
     * Outward direction this pack may shoot along, as `detAtan2(dx, dz)` of the
     * vector from the building's middle to its slot. A garrison archer covers
     * {@link GARRISON_FOV_HALF} to either side of it; the wedge behind him is
     * his own keep, and he does not fire arrows through it.
     */
    fovYaw: number | null = null;
    /** towers: down for the rest of the CURRENT battle — no longer a target, debuffs its owner's side */
    destroyed = false;
    /**
     * Flattened by its own keep's collapse rather than destroyed by an enemy.
     * Down all the same, but it owes its side no debuff on any path.
     */
    razed = false;
    /** board extras: used up this battle (shield broken, rocket fired) — removed at the round reset */
    consumed = false;
    /** the pack's equipped items (up to that type's itemSlotLimit) — permanent once its deployment ended */
    readonly items: string[] = [];
    /**
     * Parallel to {@link items}: round each rune was applied. Removable only
     * while `itemAppliedRound[i] === current deploy round` (drag-off / removeItem).
     */
    readonly itemAppliedRound: number[] = [];
    /** flank spawn already happened once for this pack */
    flankSpawnDone = false;
    /** battle-only summon (spawn spell): removed when the battle ends */
    summoned = false;
    /** horde forest-ring spawn: outside the playable board, walking straight
     *  toward center — no combat AI, no hashing, not a target, no footprint.
     *  Cleared (one-way) the moment it crosses into the board's AABB, at
     *  which point it becomes a completely normal combat actor. See
     *  BattleSim's per-tick handling in sim.ts. */
    marchIn = false;
    /** seconds after the opening freeze until a summon materializes */
    summonDelay = 0;
    /**
     * Production-tech child ({@link TechDef.produce}): stays dormant in the
     * sim until the parent releases it. `productionParentId` is the parent's
     * unit id; `productionTechId` which produce tech lane spawned it.
     */
    productionHeld = false;
    productionParentId: number | null = null;
    productionTechId: string | null = null;
    /** lifetime EFFECTIVE damage dealt (capped at each victim's remaining hp) */
    damageDealt = 0;
    /** lifetime individual mechs killed (a wiped 24-dwarf pack counts 24) */
    kills = 0;
    /** round this unit was deployed in — only units from the current round may be moved */
    deployedRound = 0;
    /** veterancy, persists across rounds: kills grant XP, levels multiply hp & damage */
    level = 1;
    xp = 0;
    /** last level used for mesh tint (avoids re-applying every fog frame) */
    private lookDisplayLevel = -1;
    /** rotation around y the unit currently faces (0 = toward -z / the enemy edge) */
    facing: number;
    /** individual mechs; `home` is each one's formation slot (local offset from the unit center) */
    readonly members: { mesh: Group; phase: number; home: Vector3 }[] = [];
    /** 0 on the ground in deployment, animates to 1 at full combat altitude */
    flightLift = 0;
    /**
     * Flight altitude from Sky Lift / Earthbound. `null` = use {@link UnitType.flying}.
     * Refresh via the match when those techs change.
     */
    techFlying: number | null = null;
    inDeployment = true;
    /** Pack origin xz — tracks movement for crow-rider wing flap during deployment. */
    private wingLastOx = 0;
    private wingLastOz = 0;

    constructor(
        readonly type: UnitType,
        /** top-left anchor tile of the footprint */
        public cell: Cell,
        readonly team: BattleTeam,
        readonly world: Vector3,
        /** placement rotated 90°: footprint and formation use swapped cols/rows */
        public rotated = false,
    ) {
        // Fire Bolt hovers at combat altitude from the moment it's placed —
        // unlike crow riders, it never hugs the ground during deployment
        if (type.rocket && type.flying) this.flightLift = 1;
        const footprint = rotated ? swapExtent(type.footprint) : type.footprint;
        const formation = rotated ? swapExtent(type.formation) : type.formation;
        const spacingX = (footprint.cols * CELL) / formation.cols;
        const spacingZ = (footprint.rows * CELL) / formation.rows;
        // which model/instance-pool asset to use — defaults to the type's own
        // id, but a horde-only variant (e.g. HORDE_ZOMBIE) can point this at a
        // dedicated GLB via modelId (see UnitType.modelId)
        const modelKey = type.modelId ?? type.id;
        for (let i = 0; i < formation.cols; i++) {
            for (let j = 0; j < formation.rows; j++) {
                const mesh = new Group();
                // rigged/animated FBX first, then static GLB (instanced when
                // possible), else procedural primitives. Models are
                // pre-normalized to the procedural LOCAL size, so meshScale
                // below (and wreck/reset scaling) is uniform.
                const animated = hasAnimatedModel(modelKey)
                    ? cloneAnimatedModel(modelKey, team, type.speed)
                    : null;
                if (animated) {
                    mesh.userData.animated = true;
                    mesh.add(animated);
                } else if (
                    !type.structure &&
                    UnitInstanceRenderer.canInstance(modelKey) &&
                    getUnitInstanceRenderer()
                ) {
                    // empty proxy — UnitInstanceRenderer draws the shared mesh
                    // (structures stay as clones: one each, often quantized/heavy)
                    getUnitInstanceRenderer()!.register(mesh, modelKey, team);
                } else {
                    const model = hasUnitModel(modelKey) ? cloneUnitModel(modelKey, team) : null;
                    if (model) {
                        mesh.add(model);
                        // GLB replaces the stone mesh, not the energy dome — attach
                        // it in local units so meshScale still yields world radius
                        if (type.shield) {
                            const inv = 1 / type.meshScale;
                            new PartFactory(mesh, team).dome(
                                type.shield.radius * inv,
                                type.shield.height / type.shield.radius,
                            );
                        }
                    } else {
                        type.build(new PartFactory(mesh, team));
                    }
                }
                mesh.scale.setScalar(type.meshScale);
                let ox = (i - (formation.cols - 1) / 2) * spacingX;
                let oz = (j - (formation.rows - 1) / 2) * spacingZ;
                if (type.formationSpread) {
                    const key = i * 131 + j * 7919;
                    ox += (hash01(key + 1) - 0.5) * spacingX * type.formationSpread;
                    oz += (hash01(key + 104729) - 0.5) * spacingZ * type.formationSpread;
                }
                mesh.position.set(ox, 0, oz);
                this.view.add(mesh);
                this.members.push({ mesh, phase: Math.random() * Math.PI * 2, home: new Vector3(ox, 0, oz) });
            }
        }
        // Default facing until a target is known: straight at the opposing
        // edge — structures too (a castle's gate looks at the enemy), they
        // just never turn again afterwards.
        //
        // Keyed on the BOARD, never on `team`. 'player'/'enemy' are per-client
        // labels — every client calls its own side 'player' — so keying on
        // them gave one unit opposite yaws on two clients. Facing is in the
        // state hash, and structures never turn, so that mirrored value rode
        // into every battle-start comparison for the whole match: a desync a
        // resync could not repair, because both peers just rebuilt it. It also
        // drew the far side's castles facing backwards. Yaw 0 looks down −z.
        this.facing = world.z >= 0 ? 0 : Math.PI;
        for (const m of this.members) m.mesh.rotation.y = this.facing;
        this.view.position.copy(this.world);
        this.seatMembers();
        this.applyLevelLook(this.level);
        this.wingLastOx = this.view.position.x;
        this.wingLastOz = this.view.position.z;
    }

    /** Effective combat flight altitude (tech override or type default). */
    flightCeiling(): number {
        if (this.techFlying !== null) return this.techFlying;
        return this.type.flying ?? 0;
    }

    /** current hover base for idle bob (deployment keeps flyers near the ground) */
    memberBaseY(): number {
        const flying = this.flightCeiling();
        if (!flying) return GROUND_UNIT_Y;
        // rockets use absolute combat altitude (see seatMembers) — this is
        // only consulted for crow-rider-style flyers
        if (this.type.rocket) return flying;
        return DEPLOY_AIR_Y + (flying - DEPLOY_AIR_Y) * this.flightLift;
    }

    /**
     * Stick every member to the terrain at the pack origin:
     * `y = groundSupportAt + memberBaseY()` (flyers = ground + altitude).
     * Rockets sit at absolute combat altitude so they match battle sim / launch.
     * Defaults to the current view xz so drag previews follow the hills.
     */
    seatMembers(originX = this.view.position.x, originZ = this.view.position.z): void {
        const rocketAlt = this.type.rocket ? this.flightCeiling() : undefined;
        for (const m of this.members) {
            if (m.mesh.userData.dead) continue;
            if (this.pinnedY != null) {
                // absolute, like the rocket below — the battlement he stands on
                // is not the ground beneath him
                m.mesh.position.y = this.pinnedY;
                continue;
            }
            if (rocketAlt != null) {
                m.mesh.position.y = rocketAlt;
                continue;
            }
            // worldHeightAt (board + outer world) rather than the board-only
            // groundSupportAt — horde packs spawn/stand outside the board
            // during deployment and need to sit on the outer relief too
            m.mesh.position.y =
                worldHeightAt(originX + m.home.x, originZ + m.home.z) + this.memberBaseY();
        }
    }

    setDeployment(deploy: boolean): void {
        this.inDeployment = deploy;
        if (deploy) {
            // rockets stay armed at altitude; other flyers drop to ground-hug
            this.flightLift = this.type.rocket ? 1 : 0;
        }
    }

    /** ramps flyers up (battle) or down (deployment) — ~0.6s full climb */
    tickFlight(dtSeconds: number): void {
        if (!this.flightCeiling()) return;
        // Fire Bolt never climbs/descends with the flock — always combat height
        if (this.type.rocket) {
            this.flightLift = 1;
            return;
        }
        const target = this.inDeployment ? 0 : 1;
        const rate = 1.6;
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

    /**
     * Collapses the meshes into rubble until the next round reset.
     * `knock` leans the settle along the killing blow (render-only).
     * `crush` = Hammer of the Gods pancake (super-flat).
     */
    markDestroyed(knock?: { x: number; z: number }, opts?: { crush?: boolean }): void {
        this.destroyed = true;
        const instances = getUnitInstanceRenderer();
        if (opts?.crush) {
            for (let i = 0; i < this.members.length; i++) {
                const m = this.members[i]!;
                m.mesh.userData.dead = true;
                setCrowWingRateOnProxy(m.mesh, 0);
                const wx = this.world.x + m.mesh.position.x;
                const wz = this.world.z + m.mesh.position.z;
                const tip = groundTipAt(wx, wz);
                beginHammerCrush(m.mesh, {
                    groundY: worldHeightAt(wx, wz) + HAMMER_CRUSH_SEAT_Y,
                    spin: hammerCrushSpin(this.id * 131 + i + 17),
                    endTipX: tip.tipX,
                    endTipZ: tip.tipZ,
                });
                instances?.setDead(m.mesh);
                m.mesh.visible = true;
            }
            return;
        }
        const klen = knock ? Math.hypot(knock.x, knock.z) : 0;
        // Wide bases (Stronghold) tip very little — a big lean lifts one side into the air
        const wide = this.type.collisionRadius >= 4 || this.type.id === 'stronghold';
        const tipAmp = wide ? 0.045 : 0.09;
        const tipZ = klen > 1e-6 ? Math.sign(knock!.z || 1) * tipAmp : tipAmp * 0.85;
        const tipX = klen > 1e-6 ? Math.sign(knock!.x || 1) * tipAmp * 0.35 : tipAmp * 0.3;
        const halfW = Math.max(1.2, this.type.collisionRadius * 0.55);
        const sink = halfW * Math.sin(Math.hypot(tipX, tipZ)) * (wide ? 1.15 : 0.85);
        for (const m of this.members) {
            m.mesh.userData.dead = true;
            setCrowWingRateOnProxy(m.mesh, 0);
            instances?.setDead(m.mesh);
            beginBuildingCollapse(m.mesh, { tipX, tipZ, sink });
        }
    }

    /**
     * Updates level visuals (tint + tower scale). Pass displayLevel for stale intel fog.
     */
    refreshLevelBadge(displayLevel = this.level): void {
        this.applyLevelLook(displayLevel);
    }

    /** Visual scale: towers grow each level; packs only a little, capped at L3. */
    visualMeshScale(level = this.level): number {
        const base = this.type.meshScale;
        if (this.type.structure && !this.type.extra) {
            // +10% per level above 1 → L5 ≈ 1.4× (tower upgrade max)
            return base * (1 + (level - 1) * 0.1);
        }
        if (this.type.structure) return base; // extras (shield / rocket)
        // packs: +5% per level, only through L3 → max +10%
        const steps = Math.min(2, Math.max(0, level - 1));
        return base * (1 + steps * 0.05);
    }

    /** Mesh tint by level (packs only); base buildings scale up instead. */
    applyLevelLook(level = this.level): void {
        const scale = this.visualMeshScale(level);
        for (const m of this.members) {
            if (!m.mesh.userData.dead) m.mesh.scale.setScalar(scale);
        }
        // A building says its level by growing, and by the badge over it. The
        // veterancy hue is a pack's alone: dyeing masonry blue or gold buries
        // the model's own material under a flat wash.
        const tintLevel = this.type.structure ? 1 : level;
        if (tintLevel === this.lookDisplayLevel) return;
        this.lookDisplayLevel = tintLevel;
        for (const m of this.members) {
            if (m.mesh.userData.instanced) {
                getUnitInstanceRenderer()?.setLevelTint(m.mesh, tintLevel);
            } else {
                applyMeshLevelTint(m.mesh, tintLevel);
            }
        }
    }

    /**
     * Puts every mech back on its formation slot, alive and visible — the
     * battle phase is a simulation; deployments persist between rounds.
     * Destroyed towers are rebuilt too: rubble stands back up.
     */
    resetFormation(): void {
        const instances = getUnitInstanceRenderer();
        for (const m of this.members) {
            clearBattleTint(m.mesh);
            m.mesh.position.copy(m.home);
            m.mesh.visible = true;
            if (!this.type.structure) m.mesh.rotation.y = this.facing;
            m.mesh.rotation.z = 0; // stand wrecks back up
            m.mesh.rotation.x = 0;
            m.mesh.scale.setScalar(this.visualMeshScale()); // un-squash tower rubble (+ level size)
            m.mesh.userData.dead = false;
            clearDeathFall(m.mesh);
            clearDeathTip(m.mesh);
            clearCorpsePose(m.mesh);
            clearHammerCrush(m.mesh);
            if ((this.type.modelId ?? this.type.id) === CROW_RIDER_MODEL_ID) {
                setCrowWingRateOnProxy(m.mesh, 0);
                setCrowWingRestOnProxy(m.mesh, 0);
            }
            instances?.setAlive(m.mesh);
        }
        this.seatMembers();
        this.destroyed = false;
        this.razed = false;
        this.applyLevelLook(this.level);
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
            m.mesh.rotation.y = detAtan2(-(best.x - mx), -(best.z - mz));
            if (bestD < squadBestD) {
                squadBestD = bestD;
                squadBest = best;
            }
        }
        this.facing = detAtan2(-(squadBest.x - this.world.x), -(squadBest.z - this.world.z));
    }

    update(timeSeconds: number): void {
        // battle owns per-mech Y via BattleSim — don't overwrite walkers with
        // the pack's home-slot height or they sink into (or float over) hills
        if (this.type.structure || !this.inDeployment) return;
        // pinned packs never bob or re-seat — seatMembers already put them on
        // their spot, and the idle sway would float them off it
        if (this.pinnedY != null) return;
        const base = this.memberBaseY();
        const amplitude = 0.04;
        const ox = this.view.position.x;
        const oz = this.view.position.z;
        for (const m of this.members) {
            if (m.mesh.userData.dead) continue;
            const ground = worldHeightAt(ox + m.home.x, oz + m.home.z);
            m.mesh.position.y = ground + base + Math.sin(timeSeconds * 2 + m.phase) * amplitude;
        }
        this.updateCrowWingRates(
            Math.min(1, Math.hypot(ox - this.wingLastOx, oz - this.wingLastOz) / 0.1),
        );
        this.wingLastOx = ox;
        this.wingLastOz = oz;
    }

    /** Instanced crow-rider wing flap speed from deployment pose / movement. */
    private updateCrowWingRates(moving: number, altitude = 0): void {
        if ((this.type.modelId ?? this.type.id) !== CROW_RIDER_MODEL_ID) return;
        for (const m of this.members) {
            if (!m.mesh.userData.instanced) continue;
            setCrowWingRateOnProxy(
                m.mesh,
                computeCrowWingRate({
                    dead: !!m.mesh.userData.dead,
                    inDeployment: this.inDeployment,
                    flightLift: this.flightLift,
                    altitude,
                    moving,
                }),
            );
            if (!m.mesh.userData.dead) setCrowWingRestOnProxy(m.mesh, 0);
        }
    }
}

function swapExtent(e: GridExtent): GridExtent {
    return { cols: e.rows, rows: e.cols };
}

// scratch colors for syncBattleTint — it runs per mech per frame, so it must not allocate
const TINT_GOLD = new Color(THEME.veteran);
const TINT_GREY = new Color(0x888890);
const tintScratch = new Color();

/** Apply veterancy color to a non-instanced mech (GLB clone or procedural). */
function applyMeshLevelTint(root: Group, level: number): void {
    const hex =
        level >= 2 && level < LEVEL_TINT_COLORS.length ? LEVEL_TINT_COLORS[level]! : null;

    root.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        if (!child.userData.levelTintReady) {
            const src = child.material;
            if (Array.isArray(src)) {
                child.material = src.map((m) => {
                    const c = (m as MeshStandardMaterial).clone();
                    preserveBuildingSnow(m as MeshStandardMaterial, c);
                    c.userData.levelBaseColor = c.color.clone();
                    c.userData.levelBaseEmissive = c.emissive.clone();
                    c.userData.levelBaseEmissiveIntensity = c.emissiveIntensity;
                    return c;
                });
            } else if (src) {
                const c = (src as MeshStandardMaterial).clone();
                preserveBuildingSnow(src as MeshStandardMaterial, c);
                c.userData.levelBaseColor = c.color.clone();
                c.userData.levelBaseEmissive = c.emissive.clone();
                c.userData.levelBaseEmissiveIntensity = c.emissiveIntensity;
                child.material = c;
            }
            child.userData.levelTintReady = true;
        }

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
            if (!(m instanceof MeshStandardMaterial)) continue;
            const base = (m.userData.levelBaseColor as Color | undefined) ?? m.color;
            if (!m.userData.levelBaseColor) m.userData.levelBaseColor = m.color.clone();
            const baseEmissive = (m.userData.levelBaseEmissive as Color | undefined) ?? m.emissive;
            if (!m.userData.levelBaseEmissive) {
                m.userData.levelBaseEmissive = m.emissive.clone();
                m.userData.levelBaseEmissiveIntensity = m.emissiveIntensity;
            }
            if (hex == null) {
                m.color.copy(base);
                m.emissive.copy(baseEmissive);
                m.emissiveIntensity = (m.userData.levelBaseEmissiveIntensity as number) ?? 0;
            } else {
                applyLevelTintColor(m, base, hex);
                m.emissive.setRGB(0, 0, 0);
                m.emissiveIntensity = 0;
            }
        }

        // keep battle "original" in sync so effects restore to the level tint
        const orig = child.userData.battleOrigMat as MeshStandardMaterial | undefined;
        if (orig && orig.userData.levelBaseColor) {
            const base = orig.userData.levelBaseColor as Color;
            if (hex == null) {
                orig.color.copy(base);
                orig.emissive.setRGB(0, 0, 0);
                orig.emissiveIntensity = 0;
            } else {
                applyLevelTintColor(orig, base, hex);
                orig.emissive.setRGB(0, 0, 0);
                orig.emissiveIntensity = 0;
            }
        }
    });
}

/** tints a mech during battle — golden > debuff > acid > burn > spawning > normal */
export type BattleTint = 'normal' | 'golden' | 'debuff' | 'acid' | 'burn' | 'spawning';

export function syncBattleTint(
    mesh: Group,
    tint: BattleTint,
    timeSeconds: number,
    debuffStacks = 1,
    spawnProgress = 0,
): void {
    if (mesh.userData.instanced) {
        getUnitInstanceRenderer()?.setTint(mesh, tint, timeSeconds, debuffStacks, spawnProgress);
        return;
    }

    const gold = TINT_GOLD;
    const grey = TINT_GREY;
    const goldPulse = 1.15 + Math.sin(timeSeconds * 4.5) * 0.4;
    const debuffT = timeSeconds * 7;
    const acidT = timeSeconds * 5.5;
    const burnT = timeSeconds * 6.2;
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
                preserveBuildingSnow(child.userData.battleOrigMat as MeshStandardMaterial, tinted);
                // solid gold: drop the diffuse texture so it fully overlaps the
                // skin, polished metal shine, strong emissive for the pulse glow
                tinted.map = null;
                tinted.color.copy(gold);
                tinted.emissive.copy(gold);
                tinted.metalness = 0.95;
                tinted.roughness = 0.1;
                tinted.needsUpdate = true; // removing the map changes the shader
                child.userData.goldenMat = tinted;
            }
            tinted.emissiveIntensity = goldPulse;
            child.material = tinted;
            return;
        }

        if (tint === 'debuff') {
            let tinted = child.userData.debuffMat as MeshStandardMaterial | undefined;
            const base = child.userData.battleOrigMat as MeshStandardMaterial;
            if (!tinted) {
                tinted = base.clone();
                preserveBuildingSnow(base, tinted);
            }
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

        if (tint === 'acid') {
            let tinted = child.userData.acidMat as MeshStandardMaterial | undefined;
            const base = child.userData.battleOrigMat as MeshStandardMaterial;
            if (!tinted) {
                tinted = base.clone();
                preserveBuildingSnow(base, tinted);
                child.userData.acidMat = tinted;
            }
            const pulse = 0.5 + 0.5 * Math.sin(acidT);
            const g = 0.55 + 0.35 * Math.sin(acidT + 1.2);
            const y = 0.35 + 0.25 * pulse;
            const slime = new Color(0.25 + y * 0.35, 0.75 + g * 0.2, 0.12 + pulse * 0.1);
            tinted.color.lerpColors(base.color, slime, 0.55 + pulse * 0.2);
            tinted.emissive.setRGB(0.15 + pulse * 0.2, 0.65 + g * 0.25, 0.08);
            tinted.emissiveIntensity = 0.35 + pulse * 0.45;
            child.material = tinted;
            return;
        }

        if (tint === 'burn') {
            let tinted = child.userData.burnMat as MeshStandardMaterial | undefined;
            const base = child.userData.battleOrigMat as MeshStandardMaterial;
            if (!tinted) {
                tinted = base.clone();
                preserveBuildingSnow(base, tinted);
                child.userData.burnMat = tinted;
            }
            const pulse = 0.5 + 0.5 * Math.sin(burnT);
            const flicker = 0.5 + 0.5 * Math.sin(burnT * 2.1 + 0.7);
            const ember = new Color(0.85 + pulse * 0.15, 0.22 + flicker * 0.2, 0.04);
            const char = new Color(0.18, 0.1, 0.06);
            tinted.color.lerpColors(base.color, char, 0.45);
            tinted.color.lerp(ember, 0.35 + pulse * 0.25);
            tinted.emissive.setRGB(0.95, 0.28 + flicker * 0.35, 0.02);
            tinted.emissiveIntensity = 0.45 + pulse * 0.55 + flicker * 0.2;
            child.material = tinted;
            return;
        }

        if (tint === 'spawning') {
            let tinted = child.userData.spawnMat as MeshStandardMaterial | undefined;
            const base = child.userData.battleOrigMat as MeshStandardMaterial;
            if (!tinted) {
                tinted = base.clone();
                preserveBuildingSnow(base, tinted);
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
    if (mesh.userData.instanced) {
        getUnitInstanceRenderer()?.setTint(mesh, 'normal', 0);
        return;
    }
    mesh.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const orig = child.userData.battleOrigMat as MeshStandardMaterial | undefined;
        if (orig) child.material = orig;
        const golden = child.userData.goldenMat as MeshStandardMaterial | undefined;
        const debuff = child.userData.debuffMat as MeshStandardMaterial | undefined;
        const acid = child.userData.acidMat as MeshStandardMaterial | undefined;
        const burn = child.userData.burnMat as MeshStandardMaterial | undefined;
        const spawn = child.userData.spawnMat as MeshStandardMaterial | undefined;
        golden?.dispose();
        debuff?.dispose();
        acid?.dispose();
        burn?.dispose();
        spawn?.dispose();
        delete child.userData.battleOrigMat;
        delete child.userData.goldenMat;
        delete child.userData.debuffMat;
        delete child.userData.acidMat;
        delete child.userData.burnMat;
        delete child.userData.spawnMat;
    });
}

/**
 * Measure each modeled unit's procedural local height, then load its GLB
 * template at that size. Call once at startup before any Unit is built; units
 * without a model (or whose model fails to load) keep their procedural mesh.
 */
let visualsPromise: Promise<void> | null = null;
export function preloadUnitVisuals(
    onProgress?: (done: number, total: number) => void,
): Promise<void> {
    if (visualsPromise) return visualsPromise;
    visualsPromise = (async () => {
        try {
            const heights: Record<string, number> = {};
            for (const type of [...UNIT_TYPES, COMMAND_TOWER, RESEARCH_CENTER, STRONGHOLD]) {
                const probe = new Group();
                type.build(new PartFactory(probe, 'player'));
                const h = new Box3().setFromObject(probe).getSize(new Vector3()).y || 1;
                heights[type.id] = h;
                // provisional — GLB load overwrites with measured post-normalize height
                seedUnitVisualHeight(type.id, h);
            }
            await Promise.all([loadUnitModels(heights, onProgress), loadAnimatedModels(heights)]);
        } catch (e) {
            console.error('[unitModels] preloadUnitVisuals failed', e);
        }
    })();
    return visualsPromise;
}
/** one mech mesh for UI thumbnails — same builders as in-game, preview-sized */
export function buildUnitPreviewMesh(type: UnitType, team: BattleTeam = 'player'): Group {
    const group = new Group();
    type.build(new PartFactory(group, team, true));
    group.scale.setScalar(type.meshScale);
    return group;
}

/** type lookup by id — actions and replays store unit types as strings */
export function unitTypeById(id: string): UnitType | null {
    if (id === GARRISON_ARCHER.id) return GARRISON_ARCHER;
    if (id === COMMAND_TOWER.id) return COMMAND_TOWER;
    if (id === RESEARCH_CENTER.id) return RESEARCH_CENTER;
    if (id === STRONGHOLD.id) return STRONGHOLD;
    return UNIT_TYPES.find((t) => t.id === id) ?? null;
}

/** once-per-deployment shop unlock fee — {@link UnitType.unlockCost} */
/** what one level costs / how much XP it needs, in supply terms */
export function levelBasisOf(type: UnitType): number {
    return type.levelBasis ?? type.cost;
}

export function unitUnlockCost(typeId: string): number {
    const type = unitTypeById(typeId);
    if (!type || !isPlayerBuyable(type)) return Number.POSITIVE_INFINITY;
    const cost = type.unlockCost;
    return cost !== undefined ? cost : Number.POSITIVE_INFINITY;
}
