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
import { techBlurb, techName, unitName, t } from '../i18n';
import { THEME } from '../theme';
import { BASE_PACK } from './content/basePack';
import { TypeRegistry } from './content/typeRegistry';
import type { BurnAffinity, FireProfile } from './fire';
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
    setCrowWingRateOnProxy,
    setCrowWingRestOnProxy,
    usesWingFlapModel,
} from './crowWingFlap';
import { cloneAnimatedModel, hasAnimatedModel, loadAnimatedModels, resetAnimatedUnit } from './unitAnimated';
import { getUnitInstanceRenderer, UnitInstanceRenderer } from './unitInstances';
import { beginBuildingCollapse, beginHammerCrush, clearHammerCrush, groundTipAt, hammerCrushSpin, HAMMER_CRUSH_SEAT_Y } from './buildingCollapse';
import { clearCorpsePose, clearDeathClip, clearDeathFall, clearDeathTip } from './deathFall';
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

/** a purchasable upgrade for a unit type — mostly multipliers; see `rangeAdd` */
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
    /**
     * Stat changes. Multipliers (attackInterval < 1 = faster) unless noted.
     * `rangeAdd` is a flat bonus applied after any `range` multiplier.
     */
    mods: Partial<{
        hp: number;
        damage: number;
        range: number;
        /** flat range bonus (same units as type.range) */
        rangeAdd: number;
        speed: number;
        attackInterval: number;
        splashRadius: number;
    }>;
    /** optional fire / oil on hit — applied when this tech is owned */
    fire?: FireProfile;
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
    if (tech.description) {
        return techBlurb(tech.id, tech.description);
    }
    const parts: string[] = [];
    const pct = (mult: number) => `${mult >= 1 ? '+' : '−'}${Math.round(Math.abs(mult - 1) * 100)}%`;
    const { hp, damage, range, rangeAdd, speed, attackInterval, splashRadius } = tech.mods;
    if (hp !== undefined && hp !== 1) {
        parts.push(t('tech:_auto.modHp', { pct: pct(hp), defaultValue: `${pct(hp)} HP` }));
    }
    if (damage !== undefined && damage !== 1) {
        parts.push(
            t('tech:_auto.modDamage', { pct: pct(damage), defaultValue: `${pct(damage)} damage` }),
        );
    }
    if (range !== undefined && range !== 1) {
        parts.push(
            t('tech:_auto.modRange', { pct: pct(range), defaultValue: `${pct(range)} range` }),
        );
    }
    if (rangeAdd !== undefined && rangeAdd !== 0) {
        const signed = rangeAdd > 0 ? `+${rangeAdd}` : `${rangeAdd}`;
        parts.push(
            t('tech:_auto.modRangeAdd', {
                amount: signed,
                defaultValue: `${signed} range`,
            }),
        );
    }
    if (speed !== undefined && speed !== 1) {
        parts.push(
            t('tech:_auto.modSpeed', {
                pct: pct(speed),
                defaultValue: `${pct(speed)} move speed`,
            }),
        );
    }
    // a lower attack interval means faster firing (rate = 1 / interval)
    if (attackInterval !== undefined && attackInterval !== 1) {
        const p = pct(1 / attackInterval);
        parts.push(
            t('tech:_auto.modAttackSpeed', { pct: p, defaultValue: `${p} attack speed` }),
        );
    }
    if (splashRadius !== undefined && splashRadius !== 1) {
        parts.push(
            t('tech:_auto.modSplash', {
                mult: splashRadius,
                defaultValue: `${splashRadius}× splash radius`,
            }),
        );
    }
    if (tech.produce) {
        const p = tech.produce;
        const child = unitName(p.typeId, BASE_TYPES.byId(p.typeId)?.name ?? p.typeId);
        const every = formatTechSeconds(p.interval);
        let line = t('tech:_auto.produce', {
            child,
            every,
            max: p.max,
            defaultValue: `Produces ${child} every ${every} (up to ${p.max})`,
        }).replace(/[.。．]+$/u, '');
        if (p.delay !== undefined && p.delay !== p.interval) {
            const first = t('tech:_auto.produceFirst', {
                delay: formatTechSeconds(p.delay),
                defaultValue: `, first after ${formatTechSeconds(p.delay)}`,
            }).replace(/^[,，\s]+/u, '');
            line += `, ${first}`;
        }
        const offspring = t('tech:_auto.produceOffspring', {
            defaultValue: 'Offspring match parent level',
        }).replace(/^[,.。．\s]+/u, '').replace(/[.。．]+$/u, '');
        line += `. ${offspring}`;
        parts.push(line);
    }
    if (tech.onKill) {
        const child = unitName(
            tech.onKill.typeId,
            BASE_TYPES.byId(tech.onKill.typeId)?.name ?? tech.onKill.typeId,
        );
        parts.push(
            t('tech:_auto.onKill', {
                child,
                defaultValue: `When this unit kills, raise a ${child}`,
            }).replace(/[.。．]+$/u, ''),
        );
    }
    if (tech.cleave) {
        parts.push(
            t('tech:_auto.cleave', {
                radius: tech.cleave.radius,
                defaultValue: `Hits every enemy within ${tech.cleave.radius} (around this unit)`,
            }).replace(/[.。．]+$/u, ''),
        );
    }
    return parts.length ? parts.join('. ') : techName(tech.id, tech.name);
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

/** The Komtur / forest wave roster — {@link UnitType.horde}. */
export function isHordeUnit(type: UnitType): boolean {
    return type.horde === true;
}

/**
 * Panel actions a building can offer. Each is implemented once (HUD + action
 * dispatcher); a building lists the ones it offers in {@link UnitType.abilities}.
 */
export type BuildingAbilityId =
    // round services (normally the Research Center)
    | 'recruitLevel'
    | 'deploySlot'
    | 'rangeBoost'
    | 'speedBoost'
    | 'credit'
    // permanent tracks (normally the Command Tower)
    | 'armyBoosts'
    | 'selling'
    | 'rallyRoute'
    | 'movePack'
    // the keep (normally the Stronghold)
    | 'forge'
    | 'forgeSpells'
    | 'sendSupply';

export interface UnitType {
    id: string;
    name: string;
    cost: number;
    /**
     * End-of-battle HP withdrawn per living mech of this type (fixed; ignores
     * pack level and purchase premium). Also feeds particle wave grouping via
     * {@link hpDrawWaveTier}. Omit to use {@link UnitType.cost} /
     * formation headcount.
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
    /**
     * Soft sand pad stamped under a structure, as a multiple of its footprint
     * (default 1). Visual only.
     */
    sandPadScale?: number;
    /** structures don't bob and never rotate to face anything (but are valid facing targets) */
    structure?: boolean;
    /**
     * board extras (shield, rocket): bought like units but never targeted or
     * damaged by ordinary fire, exempt from the deploy limit and recruiting
     */
    extra?: boolean;
    /**
     * Never CHOSEN as a target — an enemy walks past looking for something
     * else. Unlike {@link extra} this is only about acquisition: the unit is
     * still in the target hash, so a shot crossing it connects, and splash,
     * blasts and fire all reach it. A Stronghold archer on a keep: you besiege
     * the keep, and he takes what lands near him.
     */
    notAcquired?: boolean;
    /**
     * What this type's destruction does to the rest of the board. Each effect
     * is implemented once in the sim; a type only switches it on, so a custom
     * building gets the behaviour by setting the attribute — never by id.
     */
    onDestroyed?: {
        /**
         * Its side's whole army collapses with it. Only while the match's
         * `strongholdMode` is `'lifeline'` — the attribute says what the
         * building can do, the match decides whether that is in play.
         */
        collapseOwnArmy?: boolean;
        /** The owning seat takes the tower-destruction debuff (window shrinks with level). */
        seatDebuff?: boolean;
    };
    /**
     * Part of a building rather than a pack: cannot be sold, repositioned or
     * refunded, and never counts as field army.
     */
    fixture?: boolean;
    /**
     * Dies — with no killer — when the unit it is mounted on
     * ({@link Unit.hostUnitId}) is destroyed.
     */
    diesWithHost?: boolean;
    /**
     * Units can be posted onto this building's authored `UnitN` pads, one at a
     * time, from its panel. The first post costs the posted type's own `cost`;
     * each further post adds `priceStep`. Posted units get
     * {@link Unit.hostUnitId} = this building.
     */
    /**
     * An aura this type projects onto allies around it. The effect is
     * implemented once in the sim; a type chooses it and sets the numbers.
     * Applied once shortly after battle start and to units that arrive later.
     */
    aura?: {
        /** `golden`: immune to tower/storm debuffs and takes reduced damage */
        effect: 'golden';
        /** tech on this type that switches the aura on; omit = always on */
        requiresTech?: string;
        /** world units around the source */
        radius: number;
        /** seconds the buff lasts on a recipient */
        duration: number;
    };
    /**
     * Panel actions this building offers. `forge` also makes it the side's rune
     * forge: runes are dropped on it, it can be lit, and its chimney smokes.
     */
    abilities?: readonly BuildingAbilityId[];
    garrison?: {
        /** `UnitN` pad numbers on the model, in fill order */
        slots: readonly number[];
        /** type posted on each pad (looked up in the match's type registry) */
        unitTypeId: string;
        priceStep: number;
    };
    /**
     * When `false`, players and the AI cannot buy or unlock this type from
     * the shop. Omit or `true` = eligible (still subject to unlock / extras).
     * Horde-only units set this false; a type may be both shop and horde.
     */
    buyable?: boolean;
    /**
     * When `true`, eligible for The Komtur wave plan / forest roster.
     * Independent of {@link buyable} — set both for dual-use types.
     */
    horde?: boolean;
    /** shield extra: a dome that absorbs enemy projectiles crossing INTO it */
    shield?: { radius: number; height: number };
    /** rocket extra: waits armed, then homes onto the first enemy in range */
    rocket?: { range: number; speed: number; damage: number; splash: number };
    /** flight altitude in world units — air units collide with nothing on the ground */
    flying?: number;
    /**
     * Free-flight layer (bats): {@link flying} is a low cruise ceiling, not a
     * fixed hover band. Altitude climbs/dives toward chase aims and the mesh
     * pitches at the target. Omit = classic flat air layer (crow riders).
     */
    freeFlight?: boolean;
    /** the can-attack matrix: which layers this unit's weapon can hit */
    targets: { ground: boolean; air: boolean };
    /** ground-plane collision circle per mech, in world units — nothing walks through it */
    collisionRadius: number;
    /**
     * Multiplier on the low-quality ground blob disc (omit = 1).
     * Does not change gameplay collision — visual only.
     */
    blobShadowScale?: number;
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
    /**
     * Multiplier on arrow aim scatter (1 = default archer wobble). Lower = tighter
     * shots. Only applies when {@link projectileStyle} is `arrow` and not homing.
     */
    aimSpread?: number;
    /** ranged mechs fire visible projectiles at this speed (world units/s); melee when absent */
    projectileSpeed?: number;
    /**
     * visual for the flying shot — does not affect sim hit radius.
     * `bolt` = energy bead (default); `arrow` / `largeArrow` = fletched shafts;
     * `stone` = hurled rock (catapult); `orb` = wizard magic orb.
     */
    projectileStyle?: 'bolt' | 'arrow' | 'largeArrow' | 'stone' | 'orb';
    /**
     * Scale vs the style's default projectile mesh (1 = archer/ballista size).
     * Number = uniform. For shafts, `{ length, thickness }` scales Z (flight)
     * vs X/Y (girth) separately — goblins use short but thick arrows.
     */
    projectileScale?: number | { length?: number; thickness?: number };
    /**
     * If set (uniform number scales only), the mesh lerps from
     * {@link projectileScale} → this over the flight path (xz), so a blast
     * shot can start small and end near splash size.
     */
    projectileScaleEnd?: number;
    /**
     * How many projectiles leave the muzzle per attack (Stormcaller volley).
     * Omit / 1 = single shot. Each shot deals full {@link damage} and uses
     * {@link aimSpread} (or a default fan when count > 1).
     */
    projectileCount?: number;
    /**
     * Soft VFX ribbon behind flying shots. `cloud` = misty smoke puffs
     * (mortar / Stormcaller stones).
     */
    projectileTrail?: 'cloud';
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
     * Without {@link projectileLaunchAngleDeg}, `projectileSpeed` is the fixed
     * horizontal speed (arc height grows with range). With a launch angle set,
     * elevation is fixed and muzzle speed is solved from distance (farther =
     * faster shot, same angle).
     */
    projectileBallistic?: boolean;
    /**
     * Ballistic launch elevation in degrees (e.g. 40). When set, muzzle speed
     * is derived from range so the lob angle stays constant.
     */
    projectileLaunchAngleDeg?: number;
    /**
     * Ballistic only: stretch the solved parabola in time (same path, longer
     * hang). 1 = normal; 2 = twice as slow. When set ≠ 1, aim is the target's
     * position at fire time (no lead) so movers walk out from under the lob.
     */
    projectileBallisticTimeScale?: number;
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
     * Multiplier on flesh hit/death blood particles and ground stamps
     * (1 = normal infantry). Small chaff (bats) use ~0.25–0.4.
     */
    bloodScale?: number;
    /**
     * Burn / ground-fire inflicted by this unit's hits (projectiles, splash, rockets, melee).
     * Ground fire stamps the shared hazard layer; burn DoT uses refresh + strongest DPS.
     */
    fire?: FireProfile;
    /**
     * Melee disk: each swing hits every enemy in this XZ radius (no projectile).
     * Combined with {@link range} as the engagement distance.
     */
    cleave?: { radius: number };
    /**
     * When false, cleave swings skip the ground scorch stamp (still deal damage).
     * Omit/true = stamp like a stomp crater.
     */
    cleaveScar?: boolean;
    /**
     * When false, splash projectile explosions skip the ground scorch stamp.
     * Omit/true = stamp like other blasts.
     */
    splashScar?: boolean;
    /** Camera shake when a flyer cleave slams the ground (0–1+; see explosion.shake). */
    cleaveShake?: number;
    /** how hard burn DoT hits this type (omit = 1; 0 = immune). Air is skipped regardless. */
    burn?: BurnAffinity;
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
    /**
     * Melee only: seconds after the swing starts (cooldown bump / fire anim)
     * before damage applies. Omit / 0 = hit immediately. Use so long smash
     * clips connect mid-animation instead of on frame 0.
     */
    meleeHitDelay?: number;
    /**
     * Melee only: start the swing this many world units before true
     * contact range (extra surface gap). The unit keeps closing during the
     * windup — reads as a charge / attack slide instead of plant-then-swing.
     */
    meleeLunge?: number;
    /**
     * Melee only: after hitting a ground target, back off until this many
     * world units of surface gap remain, then dive again. Flyers use this for
     * hit-and-run (Wasp-like); air-vs-air stays in contact. Omit / 0 = cling.
     */
    meleeRetreat?: number;
    /**
     * Melee only: how close this unit presses while swinging, as a fraction of
     * its reach (range + both radii). Omit / 1 = plant where contact is made
     * and swing from there, which is how every melee unit behaved before the
     * ogre. Below 1 the unit keeps closing while it fights — and, if it has a
     * {@link meleeHitDelay}, slides through the windup so a big smash reads as
     * a charge rather than a stop-then-swing. 0.85 = press in to 85% of reach.
     *
     * Per-unit on purpose: a heavy breaker wants the slide, a line of dwarves
     * does not, and the next melee unit may want its own number.
     */
    meleePress?: number;
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
    /**
     * Named procedural mesh builder ({@link PROCEDURAL_MODELS}): ONE mech's
     * meshes around the origin, facing -z. Used for the provisional height
     * probe, previews, and wherever no GLB is loaded. A name, not a function,
     * so a type definition stays plain data.
     */
    proceduralModel: ProceduralModelId;
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

function buildGoblin(parts: PartFactory): void {
    // Fang-like ranged chaff — procedural fallback if GLB missing
    parts.sphere(0.38, 0, 0.32, 0, 'hull');
    parts.sphere(0.15, 0, 0.55, -0.22, 'accent');
    parts.box(0.7, 0.12, 0.35, 0, 0.55, -0.45, 'dark'); // crude bow
}

function buildHammerer(parts: PartFactory): void {
    // Arclight-like splash clearer — procedural fallback if GLB missing
    for (const side of [-1, 1]) {
        parts.cylinder(0.12, 0.16, 0.85, side * 0.28, 0.42, 0.05, 'dark');
    }
    parts.box(1.05, 0.85, 0.8, 0, 1.15, 0, 'hull'); // breastplate
    parts.sphere(0.28, 0, 1.75, -0.08, 'accent'); // kettle helm
    const gun = parts.cylinder(0.14, 0.18, 1.35, 0, 1.2, -0.75, 'dark');
    gun.rotation.x = Math.PI / 2;
    parts.box(0.35, 0.35, 0.28, 0, 1.2, -1.45, 'accent'); // muzzle
}

function buildOgre(parts: PartFactory): void {
    // Rhino-like breakthrough melee — procedural fallback if GLB missing
    for (const side of [-1, 1]) {
        parts.cylinder(0.14, 0.18, 0.95, side * 0.32, 0.48, 0.05, 'dark');
    }
    parts.box(1.2, 1.1, 0.9, 0, 1.35, 0, 'hull');
    parts.sphere(0.35, 0, 2.05, -0.05, 'accent');
    parts.box(0.35, 0.35, 1.4, 0.55, 1.4, -0.55, 'dark'); // cleaver
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

function buildBat(parts: PartFactory): void {
    parts.sphere(0.35, 0, 0.05, 0, 'dark'); // body
    parts.sphere(0.18, 0, 0.12, -0.35, 'dark'); // head
    const wings = parts.box(1.6, 0.06, 0.55, 0, 0.15, 0.05, 'dark');
    wings.scale.y = 0.5;
    parts.box(0.08, 0.25, 0.35, 0, -0.05, 0.25, 'dark'); // legs
}

function buildMortar(parts: PartFactory): void {
    parts.box(1.4, 0.35, 1.6, 0, 0.25, 0, 'dark'); // base plate
    parts.cylinder(0.55, 0.7, 0.45, 0, 0.55, 0.1, 'hull'); // turntable
    const tube = parts.cylinder(0.28, 0.34, 2.1, 0, 1.35, -0.35, 'hull');
    tube.rotation.x = -0.55; // lofted barrel
    parts.sphere(0.22, 0, 0.95, 0.55, 'accent'); // breech
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

/**
 * Procedural mesh builders by name. Type definitions refer to these by
 * {@link UnitType.proceduralModel}, so the definitions themselves hold no code.
 */
const PROCEDURAL_MODELS: Record<ProceduralModelId, (parts: PartFactory) => void> = {
    dwarf: buildDwarf,
    goblin: buildGoblin,
    hammerer: buildHammerer,
    ogre: buildOgre,
    archer: buildArcher,
    wizard: buildWizard,
    ballista: buildBallista,
    crowRider: buildCrowRider,
    bat: buildBat,
    mortar: buildMortar,
    shield: buildShield,
    rocket: buildRocket,
    tower: buildTower,
};

/** Names of the procedural mesh builders ({@link PROCEDURAL_MODELS} must cover exactly these). */
export type ProceduralModelId =
    | 'dwarf'
    | 'goblin'
    | 'hammerer'
    | 'ogre'
    | 'archer'
    | 'wizard'
    | 'ballista'
    | 'crowRider'
    | 'bat'
    | 'mortar'
    | 'shield'
    | 'rocket'
    | 'tower';

/** Is `id` a known procedural model? (for validating loaded definitions) */
export function isProceduralModelId(id: string): id is ProceduralModelId {
    return Object.prototype.hasOwnProperty.call(PROCEDURAL_MODELS, id);
}

/** Build ONE mech of `type` with its named procedural builder. */
function buildProcedural(type: UnitType, parts: PartFactory): void {
    PROCEDURAL_MODELS[type.proceduralModel](parts);
}

/**
 * The base game's unit and building definitions, from `assets/data/**.jsonc`
 * (see src/game/content/basePack.ts). Code that runs inside a match asks the
 * match's own registry (`Game.types`) instead, so a level's definitions can
 * differ; `BASE_TYPES` is for everything outside a match — menus, the
 * homepage, icons, model preload, the player's loadout profile.
 */
export const BASE_TYPES = new TypeRegistry(BASE_PACK);

{
    const bad = [...BASE_TYPES.all()].filter((t) => !isProceduralModelId(t.proceduralModel));
    if (bad.length > 0) {
        throw new Error(
            `[units] unknown proceduralModel: ${bad.map((t) => `${t.id} → "${t.proceduralModel}"`).join(', ')}`,
        );
    }
}


/**
 * World position of one of a keep's authored standing spots.
 *
 * Deliberately the BAKED path only — never the live `getObjectByName` lookup
 * the commander's decoration uses. This feeds where a Stronghold archer stands
 * and therefore what he can shoot, so it has to come out identical on every
 * peer from the action log alone, with no reference to view state.
 */
export function strongholdArcherSlotWorld(keep: Unit, slot: number): { x: number; y: number; z: number } | null {
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

/**
 * A Stronghold archer's field of fire, in degrees. He covers this much centred on
 * outward, and the rest — pointing back into his own keep — is dead. Written in
 * degrees because that is how it gets tuned; the half-angle below is what the
 * sim and the marker actually use.
 */
export const STRONGHOLD_ARCHER_FOV_DEGREES = 240;
export const STRONGHOLD_ARCHER_FOV_HALF = (STRONGHOLD_ARCHER_FOV_DEGREES * Math.PI) / 360;


/** Ward Stone dome size — read from its type so the definition is the only copy. */
const WARD_DOME = BASE_TYPES.roster.find((t) => t.shield)!.shield!;
export const SHIELD_RADIUS = WARD_DOME.radius;
export const SHIELD_HEIGHT = WARD_DOME.height;


/** Mechs in a pack — used for default hpWithdraw derivation. */
export function formationHeadcount(type: UnitType): number {
    return Math.max(1, type.formation.cols * type.formation.rows);
}

/**
 * Per-mech HP withdrawn at battle end. Explicit `hpWithdraw` on the type wins;
 * otherwise {@link UnitType.cost} / formation headcount — always the type's
 * base cost, never what was paid to buy or level the pack (a level-2 archer
 * still withdraws 100). Wave tier is derived from this ({@link hpDrawWaveTier}).
 */
export function hpWithdrawOf(type: UnitType): number {
    if (type.hpWithdraw !== undefined) return type.hpWithdraw;
    return type.cost / formationHeadcount(type);
}

export type HpDrawWaveTier = 'low' | 'medium' | 'high';

/** Particle wave from withdraw amount: low < 100, medium < 300, high otherwise. */
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
     * terrain under it — a Stronghold archer up on his keep's battlement. Set
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
     * vector from the building's middle to its slot. A Stronghold archer covers
     * {@link STRONGHOLD_ARCHER_FOV_HALF} to either side of it; the wedge behind him is
     * his own keep, and he does not fire arrows through it.
     */
    fovYaw: number | null = null;
    /**
     * Which authored `UnitN` spot on its side's keep this pack occupies. The
     * anchor is re-derived from that keep every frame rather than kept: a keep
     * GROWS 10% per level, so a position baked when the archer was bought
     * leaves him buried in the masonry the moment the keep is upgraded.
     */
    strongholdArcherSlot: number | null = null;
    /**
     * The unit this one is mounted on (a battlement archer's keep), by id.
     * Set when it is placed from the log, so every peer agrees; read by
     * {@link UnitType.diesWithHost} and by re-seating.
     */
    hostUnitId: number | null = null;
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
                        buildProcedural(type, new PartFactory(mesh, team));
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
        // Wide bases (e.g. the Stronghold, radius 11.4) tip very little — a big
        // lean lifts one side into the air
        const wide = this.type.collisionRadius >= 4;
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
            // Buildings never turn, but a Hammer of the Gods crush spins the rubble
            // to a random yaw — without this a hammered tower stood back up still
            // twisted. Only the rocket extra keeps its own aim.
            if (!this.type.rocket) m.mesh.rotation.y = this.facing;
            m.mesh.rotation.z = 0; // stand wrecks back up
            m.mesh.rotation.x = 0;
            m.mesh.scale.setScalar(this.visualMeshScale()); // un-squash tower rubble (+ level size)
            m.mesh.userData.dead = false;
            clearDeathFall(m.mesh);
            clearDeathTip(m.mesh);
            clearDeathClip(m.mesh);
            clearCorpsePose(m.mesh);
            clearHammerCrush(m.mesh);
            if (m.mesh.userData.animated) resetAnimatedUnit(m.mesh);
            if (usesWingFlapModel(this.type.modelId ?? this.type.id)) {
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

    /** Instanced wing flap speed from deployment pose / movement. */
    private updateCrowWingRates(moving: number, altitude = 0): void {
        if (!usesWingFlapModel(this.type.modelId ?? this.type.id)) return;
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
            for (const type of [...BASE_TYPES.roster, ...BASE_TYPES.buildings]) {
                const probe = new Group();
                buildProcedural(type, new PartFactory(probe, 'player'));
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
    buildProcedural(type, new PartFactory(group, team, true));
    group.scale.setScalar(type.meshScale);
    return group;
}


/** Does this type offer the given panel action? */
export function hasAbility(type: UnitType, ability: BuildingAbilityId): boolean {
    return type.abilities?.includes(ability) === true;
}


/** what one level costs / how much XP it needs, in supply terms */
export function levelBasisOf(type: UnitType): number {
    return type.levelBasis ?? type.cost;
}

