/**
 * Web Audio bus for Melodan: groups (master / sfx / music / ui), cue variants,
 * concurrent voice caps (pooling), and distance attenuation for battlefield SFX.
 *
 * Render-only — never touch from the deterministic sim. Drive from SimEvent
 * drain + UI, same lifecycle as particles.
 */
import { assetUrl, isBaseAsset } from './assets';
import type { Projectile, SimEvent } from './sim';
import { onPrefsChange, prefs } from './prefs';
import { beamMuzzleWorld } from './conversionFx';
import type { Actor } from './sim';
import { BASE_TYPES } from './units';

export type AudioGroupId = 'sfx' | 'music' | 'ui';

export type CueDef = {
    /** Paths under assets/ — multiple = random variants */
    paths: readonly string[];
    group: AudioGroupId;
    /** Max overlapping voices for this cue (extra plays are dropped). */
    maxVoices?: number;
    /** World-xz distance attenuation (battle SFX). */
    spatial?: boolean;
    /** Distance at full volume (world units). */
    refDistance?: number;
    /** Beyond this, voice is culled. */
    maxDistance?: number;
    /** Inverse-distance rolloff (higher = falls off faster). */
    rolloff?: number;
    /** Base gain for this cue (before group / master / distance). */
    gain?: number;
};

/**
 * Default battlefield spatial falloff.
 * Inverse model: full volume inside {@link SPATIAL_REF}, then steeper drop;
 * hard-silent past {@link SPATIAL_MAX}.
 */
const SPATIAL_REF = 11;
const SPATIAL_MAX = 34;

/** Fraction of new pack selects that may bark (1 = always, subject to cooldown). */
const UNIT_SELECT_CHANCE = 1;
/** Min wall-clock gap between unit select barks. */
const UNIT_SELECT_COOLDOWN_MS = 1000;
/** Min wall-clock gap between unit hurt yelps (global — packs don't chorus). */
const UNIT_HURT_COOLDOWN_MS = 450;
/** Unit types that share another type's VO cue (e.g. stronghold archer → archer). */
const UNIT_VOICE_ALIAS: Record<string, string> = {
    'stronghold-archer': 'archer',
};

/**
 * Play-time spatial overrides for pack-scale combat (small units).
 * Matches death_unit vs death_unit_big: quieter + nearer.
 */
type CombatSpatialOpts = {
    gainMul?: number;
    refDistance?: number;
    maxDistance?: number;
    rolloff?: number;
};

type SoundSize = 'small' | 'medium' | 'large';

/** Pack fodder (dwarf/goblin/…) — quieter; falloff starts at half of max. */
const SMALL_SOUND_SPATIAL: CombatSpatialOpts = {
    gainMul: 0.55,
    refDistance: 8,
    maxDistance: 16,
    rolloff: 1.5,
};

/** Standard combatants (archer/wizard/hammerer/mortar). */
const MEDIUM_SOUND_SPATIAL: CombatSpatialOpts = {
    gainMul: 0.8,
    refDistance: 30,
    maxDistance: 60,
    rolloff: 1.4,
};

/**
 * Attack / muzzle beds — louder and farther than default battlefield SFX.
 * Death / hit stay on the tighter default (or size profiles below).
 */
const ATTACK_REF = 16;
const ATTACK_MAX = 96;
const ATTACK_ROLLOFF = 1.35;

function soundSizeOf(typeId: string | undefined): SoundSize {
    if (!typeId) return 'medium';
    const id = UNIT_VOICE_ALIAS[typeId] ?? typeId;
    const t = BASE_TYPES.byId(id);
    return t?.soundSize ?? 'medium';
}

/** Hit / hurt / melee presence from {@link UnitType.soundSize}. Large = full cue. */
function sizeSpatialOpts(typeId: string | undefined): CombatSpatialOpts | undefined {
    switch (soundSizeOf(typeId)) {
        case 'small':
            return SMALL_SOUND_SPATIAL;
        case 'medium':
            return MEDIUM_SOUND_SPATIAL;
        case 'large':
            return undefined;
    }
}

/** Melee swing/hit hear ranges — falloff starts at half of maxDistance. */
const MELEE_HEAR = {
    small: { maxDistance: 14, refDistance: 7 },
    medium: { maxDistance: 56, refDistance: 28 },
    large: { maxDistance: 120, refDistance: 60 },
} as const;

/** Melee swings: size sets how far they carry; quieter for packs. */
function meleeSwingOpts(typeId: string | undefined): CombatSpatialOpts {
    const size = soundSizeOf(typeId);
    const hear = MELEE_HEAR[size];
    switch (size) {
        case 'small':
            return { gainMul: 0.4, ...hear, rolloff: 1.6 };
        case 'medium':
            return { gainMul: 0.75, ...hear, rolloff: 1.45 };
        case 'large':
            return { gainMul: 1, ...hear, rolloff: 1.3 };
    }
}

/** Melee contact hits — same hear envelope as swings, by victim size. */
function meleeHitOpts(typeId: string | undefined): CombatSpatialOpts {
    const size = soundSizeOf(typeId);
    const hear = MELEE_HEAR[size];
    switch (size) {
        case 'small':
            return { gainMul: 0.45, ...hear, rolloff: 1.6 };
        case 'medium':
            return { gainMul: 0.8, ...hear, rolloff: 1.45 };
        case 'large':
            return { gainMul: 1, ...hear, rolloff: 1.3 };
    }
}
/** Structure type id → select SFX cue (stronghold uses commander VO instead). */
const BUILDING_SELECT_CUE: Record<string, string> = {
    'command-tower': 'select_command_tower',
    'research-center': 'select_research_center',
    tent: 'select_tent',
};
const SPATIAL_ROLLOFF = 2.2;

const CUES: Record<string, CueDef> = {
    /** Proximity bed while camera is near acid puddles. */
    acid_loop: {
        paths: ['audio/acid_loop_1.ogg'],
        group: 'sfx',
        maxVoices: 1,
        gain: 0.4,
    },
    archer_shot: {
        paths: [
            'audio/archer_shot_1.ogg',
            'audio/archer_shot_2.ogg',
            'audio/archer_shot_3.ogg',
            'audio/archer_shot_4.ogg',
        ],
        group: 'sfx',
        maxVoices: 12,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 0.9,
    },
    /**
     * Goblin volleys — same clips as archer_shot, quieter so packs don't drown
     * the board (goblins shoot smaller arrows, many at once).
     */
    goblin_shot: {
        paths: [
            'audio/archer_shot_1.ogg',
            'audio/archer_shot_2.ogg',
            'audio/archer_shot_3.ogg',
            'audio/archer_shot_4.ogg',
        ],
        group: 'sfx',
        maxVoices: 14,
        spatial: true,
        // Small-unit projectile: half of medium arrow silent range.
        refDistance: 18,
        maxDistance: 36,
        rolloff: 1.5,
        gain: 0.52,
    },
    ballista_shot: {
        paths: [
            'audio/ballista_shot_1.ogg',
            'audio/ballista_shot_2.ogg',
            'audio/ballista_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: ATTACK_REF + 4,
        maxDistance: 112,
        rolloff: 1.2,
        gain: 1.15,
    },
    bolt_shot: {
        paths: [
            'audio/bolt_shot_1.ogg',
            'audio/bolt_shot_2.ogg',
            'audio/bolt_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 0.85,
    },
    card_pick: {
        paths: [
            'audio/card_pick_1.ogg',
            'audio/card_pick_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    /** Unit select bark — distinct lines as path variants (see playUnitSelect). */
    unit_archer: {
        paths: [
            'audio/unit_archer_1.ogg',
            'audio/unit_archer_2.ogg',
            'audio/unit_archer_3.ogg',
            'audio/unit_archer_4.ogg',
            'audio/unit_archer_5.ogg',
            'audio/unit_archer_6.ogg',
            'audio/unit_archer_7.ogg',
            'audio/unit_archer_8.ogg',
            'audio/unit_archer_9.ogg',
            'audio/unit_archer_10.ogg',
            'audio/unit_archer_11.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_archer_rival: {
        paths: [
            'audio/unit_archer_rival_1.ogg',
            'audio/unit_archer_rival_2.ogg',
            'audio/unit_archer_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_archer_death: {
        paths: [
            'audio/unit_archer_death_1.ogg',
            'audio/unit_archer_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_archer_hurt: {
        paths: [
            'audio/unit_archer_hurt_1.ogg',
            'audio/unit_archer_hurt_2.ogg',
            'audio/unit_archer_hurt_3.ogg',
            'audio/unit_archer_hurt_4.ogg',
            'audio/unit_archer_hurt_5.ogg',
            'audio/unit_archer_hurt_6.ogg',
            'audio/unit_archer_hurt_7.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        // near-field — silent beyond (doubled from 16)
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_ballista: {
        paths: [
            'audio/unit_ballista_1.ogg',
            'audio/unit_ballista_2.ogg',
            'audio/unit_ballista_3.ogg',
            'audio/unit_ballista_4.ogg',
            'audio/unit_ballista_5.ogg',
            'audio/unit_ballista_6.ogg',
            'audio/unit_ballista_7.ogg',
            'audio/unit_ballista_8.ogg',
            'audio/unit_ballista_9.ogg',
            'audio/unit_ballista_10.ogg',
            'audio/unit_ballista_11.ogg',
            'audio/unit_ballista_12.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_ballista_rival: {
        paths: [
            'audio/unit_ballista_rival_1.ogg',
            'audio/unit_ballista_rival_2.ogg',
            'audio/unit_ballista_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_ballista_death: {
        paths: [
            'audio/unit_ballista_death_1.ogg',
            'audio/unit_ballista_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_ballista_hurt: {
        paths: [
            'audio/unit_ballista_hurt_1.ogg',
            'audio/unit_ballista_hurt_2.ogg',
            'audio/unit_ballista_hurt_3.ogg',
            'audio/unit_ballista_hurt_4.ogg',
            'audio/unit_ballista_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_wizard: {
        paths: [
            'audio/unit_wizard_1.ogg',
            'audio/unit_wizard_2.ogg',
            'audio/unit_wizard_3.ogg',
            'audio/unit_wizard_4.ogg',
            'audio/unit_wizard_5.ogg',
            'audio/unit_wizard_6.ogg',
            'audio/unit_wizard_7.ogg',
            'audio/unit_wizard_8.ogg',
            'audio/unit_wizard_9.ogg',
            'audio/unit_wizard_10.ogg',
            'audio/unit_wizard_11.ogg',
            'audio/unit_wizard_12.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_wizard_rival: {
        paths: [
            'audio/unit_wizard_rival_1.ogg',
            'audio/unit_wizard_rival_2.ogg',
            'audio/unit_wizard_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_wizard_death: {
        paths: [
            'audio/unit_wizard_death_1.ogg',
            'audio/unit_wizard_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_wizard_hurt: {
        paths: [
            'audio/unit_wizard_hurt_1.ogg',
            'audio/unit_wizard_hurt_2.ogg',
            'audio/unit_wizard_hurt_3.ogg',
            'audio/unit_wizard_hurt_4.ogg',
            'audio/unit_wizard_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_crowRider: {
        paths: [
            'audio/unit_crowRider_1.ogg',
            'audio/unit_crowRider_2.ogg',
            'audio/unit_crowRider_3.ogg',
            'audio/unit_crowRider_4.ogg',
            'audio/unit_crowRider_5.ogg',
            'audio/unit_crowRider_6.ogg',
            'audio/unit_crowRider_7.ogg',
            'audio/unit_crowRider_8.ogg',
            'audio/unit_crowRider_9.ogg',
            'audio/unit_crowRider_10.ogg',
            'audio/unit_crowRider_11.ogg',
            'audio/unit_crowRider_12.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_crowRider_rival: {
        paths: [
            'audio/unit_crowRider_rival_1.ogg',
            'audio/unit_crowRider_rival_2.ogg',
            'audio/unit_crowRider_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_crowRider_death: {
        paths: [
            'audio/unit_crowRider_death_1.ogg',
            'audio/unit_crowRider_death_2.ogg',
            'audio/unit_crowRider_death_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_crowRider_hurt: {
        paths: [
            'audio/unit_crowRider_hurt_1.ogg',
            'audio/unit_crowRider_hurt_2.ogg',
            'audio/unit_crowRider_hurt_3.ogg',
            'audio/unit_crowRider_hurt_4.ogg',
            'audio/unit_crowRider_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_dwarf: {
        paths: [
            'audio/unit_dwarf_1.ogg',
            'audio/unit_dwarf_2.ogg',
            'audio/unit_dwarf_3.ogg',
            'audio/unit_dwarf_4.ogg',
            'audio/unit_dwarf_5.ogg',
            'audio/unit_dwarf_6.ogg',
            'audio/unit_dwarf_7.ogg',
            'audio/unit_dwarf_8.ogg',
            'audio/unit_dwarf_9.ogg',
            'audio/unit_dwarf_10.ogg',
            'audio/unit_dwarf_11.ogg',
            'audio/unit_dwarf_12.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_dwarf_rival: {
        paths: [
            'audio/unit_dwarf_rival_1.ogg',
            'audio/unit_dwarf_rival_2.ogg',
            'audio/unit_dwarf_rival_3.ogg',
            'audio/unit_dwarf_rival_4.ogg',
            'audio/unit_dwarf_rival_5.ogg',
            'audio/unit_dwarf_rival_6.ogg',
            'audio/unit_dwarf_rival_7.ogg',
            'audio/unit_dwarf_rival_8.ogg',
            'audio/unit_dwarf_rival_9.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_dwarf_death: {
        paths: [
            'audio/unit_dwarf_death_1.ogg',
            'audio/unit_dwarf_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_dwarf_hurt: {
        paths: [
            'audio/unit_dwarf_hurt_1.ogg',
            'audio/unit_dwarf_hurt_2.ogg',
            'audio/unit_dwarf_hurt_3.ogg',
            'audio/unit_dwarf_hurt_4.ogg',
            'audio/unit_dwarf_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_goblin: {
        paths: [
            'audio/unit_goblin_1.ogg',
            'audio/unit_goblin_2.ogg',
            'audio/unit_goblin_3.ogg',
            'audio/unit_goblin_4.ogg',
            'audio/unit_goblin_5.ogg',
            'audio/unit_goblin_6.ogg',
            'audio/unit_goblin_7.ogg',
            'audio/unit_goblin_8.ogg',
            'audio/unit_goblin_9.ogg',
            'audio/unit_goblin_10.ogg',
            'audio/unit_goblin_11.ogg',
            'audio/unit_goblin_12.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_goblin_rival: {
        paths: [
            'audio/unit_goblin_rival_1.ogg',
            'audio/unit_goblin_rival_2.ogg',
            'audio/unit_goblin_rival_3.ogg',
            'audio/unit_goblin_rival_4.ogg',
            'audio/unit_goblin_rival_5.ogg',
            'audio/unit_goblin_rival_6.ogg',
            'audio/unit_goblin_rival_7.ogg',
            'audio/unit_goblin_rival_8.ogg',
            'audio/unit_goblin_rival_9.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_goblin_death: {
        paths: [
            'audio/unit_goblin_death_1.ogg',
            'audio/unit_goblin_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_goblin_hurt: {
        paths: [
            'audio/unit_goblin_hurt_1.ogg',
            'audio/unit_goblin_hurt_2.ogg',
            'audio/unit_goblin_hurt_3.ogg',
            'audio/unit_goblin_hurt_4.ogg',
            'audio/unit_goblin_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_hammerer: {
        paths: [
            'audio/unit_hammerer_1.ogg',
            'audio/unit_hammerer_2.ogg',
            'audio/unit_hammerer_3.ogg',
            'audio/unit_hammerer_4.ogg',
            'audio/unit_hammerer_5.ogg',
            'audio/unit_hammerer_6.ogg',
            'audio/unit_hammerer_7.ogg',
            'audio/unit_hammerer_8.ogg',
            'audio/unit_hammerer_9.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_hammerer_rival: {
        paths: [
            'audio/unit_hammerer_rival_1.ogg',
            'audio/unit_hammerer_rival_2.ogg',
            'audio/unit_hammerer_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_hammerer_death: {
        paths: [
            'audio/unit_hammerer_death_1.ogg',
            'audio/unit_hammerer_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_hammerer_hurt: {
        paths: [
            'audio/unit_hammerer_hurt_1.ogg',
            'audio/unit_hammerer_hurt_2.ogg',
            'audio/unit_hammerer_hurt_3.ogg',
            'audio/unit_hammerer_hurt_4.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_mortar: {
        paths: [
            'audio/unit_mortar_1.ogg',
            'audio/unit_mortar_2.ogg',
            'audio/unit_mortar_3.ogg',
            'audio/unit_mortar_4.ogg',
            'audio/unit_mortar_5.ogg',
            'audio/unit_mortar_6.ogg',
            'audio/unit_mortar_7.ogg',
            'audio/unit_mortar_8.ogg',
            'audio/unit_mortar_9.ogg',
            'audio/unit_mortar_10.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_mortar_rival: {
        paths: [
            'audio/unit_mortar_rival_1.ogg',
            'audio/unit_mortar_rival_2.ogg',
            'audio/unit_mortar_rival_3.ogg',
            'audio/unit_mortar_rival_4.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_mortar_death: {
        paths: [
            'audio/unit_mortar_death_1.ogg',
            'audio/unit_mortar_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_mortar_hurt: {
        paths: [
            'audio/unit_mortar_hurt_1.ogg',
            'audio/unit_mortar_hurt_2.ogg',
            'audio/unit_mortar_hurt_3.ogg',
            'audio/unit_mortar_hurt_4.ogg',
            'audio/unit_mortar_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_ogre: {
        paths: [
            'audio/unit_ogre_1.ogg',
            'audio/unit_ogre_2.ogg',
            'audio/unit_ogre_3.ogg',
            'audio/unit_ogre_4.ogg',
            'audio/unit_ogre_5.ogg',
            'audio/unit_ogre_6.ogg',
            'audio/unit_ogre_7.ogg',
            'audio/unit_ogre_8.ogg',
            'audio/unit_ogre_9.ogg',
            'audio/unit_ogre_10.ogg',
            'audio/unit_ogre_11.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_ogre_rival: {
        paths: [
            'audio/unit_ogre_rival_1.ogg',
            'audio/unit_ogre_rival_2.ogg',
            'audio/unit_ogre_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_ogre_death: {
        paths: [
            'audio/unit_ogre_death_1.ogg',
            'audio/unit_ogre_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_ogre_hurt: {
        paths: [
            'audio/unit_ogre_hurt_1.ogg',
            'audio/unit_ogre_hurt_2.ogg',
            'audio/unit_ogre_hurt_3.ogg',
            'audio/unit_ogre_hurt_4.ogg',
            'audio/unit_ogre_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    unit_prismCannon: {
        paths: [
            'audio/unit_prismCannon_1.ogg',
            'audio/unit_prismCannon_2.ogg',
            'audio/unit_prismCannon_3.ogg',
            'audio/unit_prismCannon_4.ogg',
            'audio/unit_prismCannon_5.ogg',
            'audio/unit_prismCannon_6.ogg',
            'audio/unit_prismCannon_7.ogg',
            'audio/unit_prismCannon_8.ogg',
            'audio/unit_prismCannon_9.ogg',
            'audio/unit_prismCannon_10.ogg',
            'audio/unit_prismCannon_11.ogg',
            'audio/unit_prismCannon_12.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },
    unit_prismCannon_rival: {
        paths: [
            'audio/unit_prismCannon_rival_1.ogg',
            'audio/unit_prismCannon_rival_2.ogg',
            'audio/unit_prismCannon_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.8,
    },

    unit_prismCannon_death: {
        paths: [
            'audio/unit_prismCannon_death_1.ogg',
            'audio/unit_prismCannon_death_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.85,
    },
    unit_prismCannon_hurt: {
        paths: [
            'audio/unit_prismCannon_hurt_1.ogg',
            'audio/unit_prismCannon_hurt_2.ogg',
            'audio/unit_prismCannon_hurt_3.ogg',
            'audio/unit_prismCannon_hurt_4.ogg',
            'audio/unit_prismCannon_hurt_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 3,
        spatial: true,
        refDistance: 16,
        maxDistance: 32,
        rolloff: 2.4,
        gain: 0.7,
    },
    commander_addi: {
        paths: [
            'audio/commander_addi.ogg',
            'audio/commander_addi_2.ogg',
            'audio/commander_addi_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_addi_win: {
        paths: [
            'audio/commander_addi_win_1.ogg',
            'audio/commander_addi_win_2.ogg',
            'audio/commander_addi_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_addi_victory: {
        paths: ['audio/commander_addi_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_addi_defeat: {
        paths: ['audio/commander_addi_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_addi_rival: {
        paths: [
            'audio/commander_addi_rival_1.ogg',
            'audio/commander_addi_rival_2.ogg',
            'audio/commander_addi_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_air: {
        paths: [
            'audio/commander_air.ogg',
            'audio/commander_air_2.ogg',
            'audio/commander_air_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_air_win: {
        paths: [
            'audio/commander_air_win_1.ogg',
            'audio/commander_air_win_2.ogg',
            'audio/commander_air_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_air_victory: {
        paths: ['audio/commander_air_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_air_defeat: {
        paths: ['audio/commander_air_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_air_rival: {
        paths: [
            'audio/commander_air_rival_1.ogg',
            'audio/commander_air_rival_2.ogg',
            'audio/commander_air_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_archer: {
        paths: [
            'audio/commander_archer.ogg',
            'audio/commander_archer_2.ogg',
            'audio/commander_archer_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_archer_win: {
        paths: [
            'audio/commander_archer_win_1.ogg',
            'audio/commander_archer_win_2.ogg',
            'audio/commander_archer_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_archer_victory: {
        paths: ['audio/commander_archer_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_archer_defeat: {
        paths: ['audio/commander_archer_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_archer_rival: {
        paths: [
            'audio/commander_archer_rival_1.ogg',
            'audio/commander_archer_rival_2.ogg',
            'audio/commander_archer_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_cost: {
        paths: [
            'audio/commander_cost.ogg',
            'audio/commander_cost_2.ogg',
            'audio/commander_cost_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_cost_win: {
        paths: [
            'audio/commander_cost_win_1.ogg',
            'audio/commander_cost_win_2.ogg',
            'audio/commander_cost_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_cost_victory: {
        paths: ['audio/commander_cost_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_cost_defeat: {
        paths: ['audio/commander_cost_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_cost_rival: {
        paths: [
            'audio/commander_cost_rival_1.ogg',
            'audio/commander_cost_rival_2.ogg',
            'audio/commander_cost_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_cursed: {
        paths: [
            'audio/commander_cursed.ogg',
            'audio/commander_cursed_2.ogg',
            'audio/commander_cursed_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_cursed_win: {
        paths: [
            'audio/commander_cursed_win_1.ogg',
            'audio/commander_cursed_win_2.ogg',
            'audio/commander_cursed_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_cursed_victory: {
        paths: ['audio/commander_cursed_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_cursed_defeat: {
        paths: ['audio/commander_cursed_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_cursed_rival: {
        paths: [
            'audio/commander_cursed_rival_1.ogg',
            'audio/commander_cursed_rival_2.ogg',
            'audio/commander_cursed_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_elite: {
        paths: [
            'audio/commander_elite.ogg',
            'audio/commander_elite_2.ogg',
            'audio/commander_elite_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_elite_win: {
        paths: [
            'audio/commander_elite_win_1.ogg',
            'audio/commander_elite_win_2.ogg',
            'audio/commander_elite_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_elite_victory: {
        paths: ['audio/commander_elite_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_elite_defeat: {
        paths: ['audio/commander_elite_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_elite_rival: {
        paths: [
            'audio/commander_elite_rival_1.ogg',
            'audio/commander_elite_rival_2.ogg',
            'audio/commander_elite_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_flanky: {
        paths: [
            'audio/commander_flanky.ogg',
            'audio/commander_flanky_2.ogg',
            'audio/commander_flanky_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_flanky_win: {
        paths: [
            'audio/commander_flanky_win_1.ogg',
            'audio/commander_flanky_win_2.ogg',
            'audio/commander_flanky_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_flanky_victory: {
        paths: ['audio/commander_flanky_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_flanky_defeat: {
        paths: ['audio/commander_flanky_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_flanky_rival: {
        paths: [
            'audio/commander_flanky_rival_1.ogg',
            'audio/commander_flanky_rival_2.ogg',
            'audio/commander_flanky_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_giant: {
        paths: [
            'audio/commander_giant.ogg',
            'audio/commander_giant_2.ogg',
            'audio/commander_giant_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_giant_win: {
        paths: [
            'audio/commander_giant_win_1.ogg',
            'audio/commander_giant_win_2.ogg',
            'audio/commander_giant_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_giant_victory: {
        paths: ['audio/commander_giant_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_giant_defeat: {
        paths: ['audio/commander_giant_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_giant_rival: {
        paths: [
            'audio/commander_giant_rival_1.ogg',
            'audio/commander_giant_rival_2.ogg',
            'audio/commander_giant_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_meteor: {
        paths: [
            'audio/commander_meteor.ogg',
            'audio/commander_meteor_2.ogg',
            'audio/commander_meteor_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_meteor_win: {
        paths: [
            'audio/commander_meteor_win_1.ogg',
            'audio/commander_meteor_win_2.ogg',
            'audio/commander_meteor_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_meteor_victory: {
        paths: ['audio/commander_meteor_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_meteor_defeat: {
        paths: ['audio/commander_meteor_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_meteor_rival: {
        paths: [
            'audio/commander_meteor_rival_1.ogg',
            'audio/commander_meteor_rival_2.ogg',
            'audio/commander_meteor_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_money: {
        paths: [
            'audio/commander_money.ogg',
            'audio/commander_money_2.ogg',
            'audio/commander_money_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_money_win: {
        paths: [
            'audio/commander_money_win_1.ogg',
            'audio/commander_money_win_2.ogg',
            'audio/commander_money_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_money_victory: {
        paths: ['audio/commander_money_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_money_defeat: {
        paths: ['audio/commander_money_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_money_rival: {
        paths: [
            'audio/commander_money_rival_1.ogg',
            'audio/commander_money_rival_2.ogg',
            'audio/commander_money_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_speed: {
        paths: [
            'audio/commander_speed.ogg',
            'audio/commander_speed_2.ogg',
            'audio/commander_speed_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_speed_win: {
        paths: [
            'audio/commander_speed_win_1.ogg',
            'audio/commander_speed_win_2.ogg',
            'audio/commander_speed_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_speed_victory: {
        paths: ['audio/commander_speed_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_speed_defeat: {
        paths: ['audio/commander_speed_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_speed_rival: {
        paths: [
            'audio/commander_speed_rival_1.ogg',
            'audio/commander_speed_rival_2.ogg',
            'audio/commander_speed_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_tutor: {
        paths: [
            'audio/commander_tutor.ogg',
            'audio/commander_tutor_2.ogg',
            'audio/commander_tutor_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_tutor_win: {
        paths: [
            'audio/commander_tutor_win_1.ogg',
            'audio/commander_tutor_win_2.ogg',
            'audio/commander_tutor_win_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.9,
    },
    commander_tutor_victory: {
        paths: ['audio/commander_tutor_victory.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_tutor_defeat: {
        paths: ['audio/commander_tutor_defeat.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_tutor_rival: {
        paths: [
            'audio/commander_tutor_rival_1.ogg',
            'audio/commander_tutor_rival_2.ogg',
            'audio/commander_tutor_rival_3.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    /** Proximity bed while a stronghold collapse front rolls near the camera. */
    collapse_thunder: {
        paths: ['audio/collapse_thunder_1.ogg'],
        group: 'sfx',
        maxVoices: 1,
        gain: 0.62,
    },
    convert: {
        paths: [
            'audio/convert_1.ogg',
            'audio/convert_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    convert_beam: {
        paths: [
            'audio/convert_beam_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 1,
        spatial: true,
        refDistance: 8,
        maxDistance: 40,
        rolloff: 1.2,
        // Louder than prism_hum — the file is softer/duller and was vanishing in the mix.
        gain: 0.85,
    },
    // Building ruin stings — non-spatial UI (heard everywhere, not FF-ducked).
    // One take each; stronghold uses `stronghold_collapse` instead of a death cue.
    death_command_tower: {
        paths: ['audio/death_command_tower_1.ogg'],
        group: 'ui',
        maxVoices: 3,
        gain: 1.05,
    },
    death_research_center: {
        paths: ['audio/death_research_center_1.ogg'],
        group: 'ui',
        maxVoices: 3,
        gain: 1.05,
    },
    death_shield: {
        paths: ['audio/death_shield_1.ogg'],
        group: 'ui',
        maxVoices: 3,
        gain: 1.0,
    },
    death_structure: {
        paths: ['audio/death_structure_1.ogg'],
        group: 'ui',
        maxVoices: 4,
        gain: 0.95,
    },
    death_tent: {
        paths: ['audio/death_tent_1.ogg'],
        group: 'ui',
        maxVoices: 3,
        gain: 1.0,
    },
    death_unit: {
        paths: [
            'audio/death_unit_1.ogg',
            'audio/death_unit_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        // Base for medium; small gets sizeSpatialOpts on play.
        refDistance: 24,
        maxDistance: 48,
        rolloff: 1.5,
        gain: 0.5,
    },
    death_unit_big: {
        paths: [
            'audio/death_unit_big_1.ogg',
            'audio/death_unit_big_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 34,
        maxDistance: 68,
        rolloff: 1.5,
        gain: 0.7,
    },
    defeat: {
        paths: [
            'audio/defeat_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.65,
    },
    draw_match: {
        paths: [
            'audio/draw_match_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.6,
    },
    explosion: {
        paths: [
            'audio/explosion_1.ogg',
            'audio/explosion_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 6,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    explosion_fire: {
        paths: [
            'audio/explosion_fire_1.ogg',
            'audio/explosion_fire_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    explosion_heavy: {
        paths: [
            'audio/explosion_heavy_1.ogg',
            'audio/explosion_heavy_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    forge_light: {
        paths: [
            'audio/forge_light_1.ogg',
            'audio/forge_light_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    /** Proximity bed while camera is near burning ground. */
    fire_loop: {
        paths: ['audio/fire_loop_1.ogg'],
        group: 'sfx',
        maxVoices: 1,
        // asset is quieter than acid_loop — matched by ear to acid's presence
        gain: 0.72,
    },
    ground_fire: {
        paths: [
            'audio/ground_fire_1.ogg',
            'audio/ground_fire_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    hammer_crush: {
        paths: [
            'audio/hammer_crush_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 1.1,
    },
    hammerer_smash: {
        paths: [
            'audio/hammerer_smash_1.ogg',
            'audio/hammerer_smash_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 0.95,
    },
    /** Ogre wooden bat ground smash — replaces generic melee_swing for ogre. */
    ogre_smash: {
        paths: [
            'audio/ogre_smash_1.ogg',
            'audio/ogre_smash_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        // Soft falloff — stays strong at typical camera look-xz (~20–50).
        refDistance: 48,
        maxDistance: 160,
        rolloff: 1.0,
        gain: 2.8,
    },
    hazard_drip: {
        paths: [
            'audio/hazard_drip_1.ogg',
            'audio/hazard_drip_2.ogg',
            'audio/hazard_drip_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    hp_draw_high: {
        paths: ['audio/hp_draw_high_1.ogg'],
        group: 'ui',
        maxVoices: 6,
        gain: 2.0,
    },
    hp_draw_low: {
        paths: ['audio/hp_draw_low_1.ogg'],
        group: 'ui',
        maxVoices: 8,
        gain: 2.0,
    },
    hp_draw_medium: {
        paths: ['audio/hp_draw_medium_1.ogg'],
        group: 'ui',
        maxVoices: 7,
        gain: 2.0,
    },
    impact_flesh: {
        paths: [
            'audio/impact_flesh_1.ogg',
            'audio/impact_flesh_2.ogg',
            'audio/impact_flesh_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: 6,
        maxDistance: 20,
        rolloff: 1.8,
        gain: 0.38,
    },
    impact_ground: {
        paths: [
            'audio/impact_ground_1.ogg',
            'audio/impact_ground_2.ogg',
            'audio/impact_ground_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    impact_masonry: {
        paths: [
            'audio/impact_masonry_1.ogg',
            'audio/impact_masonry_2.ogg',
            'audio/impact_masonry_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    impact_stone_drop: {
        paths: [
            'audio/impact_stone_drop_1.ogg',
            'audio/impact_stone_drop_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 6,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    /** Sci-fi forcefield pulse when a ward absorbs a hit. */
    impact_ward: {
        paths: [
            'audio/impact_ward_1.ogg',
            'audio/impact_ward_2.ogg',
            'audio/impact_ward_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: 1.2,
        gain: 1.15,
    },
    levelup: {
        paths: ['audio/levelup_1.ogg'],
        group: 'ui',
        maxVoices: 3,
        gain: 0.72,
    },
    melee_hit: {
        paths: [
            'audio/melee_hit_1.ogg',
            'audio/melee_hit_2.ogg',
            'audio/melee_hit_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        // Defaults overridden per soundSize on play (see meleeHitOpts).
        refDistance: MELEE_HEAR.medium.refDistance,
        maxDistance: MELEE_HEAR.medium.maxDistance,
        rolloff: 1.45,
        gain: 0.38,
    },
    melee_swing: {
        paths: [
            'audio/melee_swing_1.ogg',
            'audio/melee_swing_2.ogg',
            'audio/melee_swing_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 12,
        spatial: true,
        // Defaults overridden per soundSize on play (see meleeSwingOpts).
        refDistance: MELEE_HEAR.large.refDistance,
        maxDistance: MELEE_HEAR.large.maxDistance,
        rolloff: 1.3,
        gain: 0.62,
    },
    /** Siege mortar tube fire — not the generic stone_throw (crow/hammerer). */
    mortar_shot: {
        paths: [
            'audio/mortar_shot_1.ogg',
            'audio/mortar_shot_2.ogg',
            'audio/mortar_shot_3.ogg',
            'audio/mortar_shot_4.ogg',
            'audio/mortar_shot_5.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 1.0,
    },
    /** Default match bed — fallback when no seasonal phase track exists. */
    music_battle: {
        paths: ['audio/music_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** Main menu bed — courtyard / moonlit keep / hearth hall. */
    music_menu: {
        paths: ['audio/music_menu_1.ogg', 'audio/music_menu_2.ogg', 'audio/music_menu_3.ogg'],
        group: 'music',
        gain: 0.42,
    },
    /** The Year beat 1 — Spring morning, deployment. */
    music_spring_morning_deploy: {
        paths: ['audio/music_spring_morning_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 1 — Spring morning, battle. */
    music_spring_morning_battle: {
        paths: ['audio/music_spring_morning_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 2 — Spring rain, deployment. */
    music_spring_rain_deploy: {
        paths: ['audio/music_spring_rain_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 2 — Spring rain, battle. */
    music_spring_rain_battle: {
        paths: ['audio/music_spring_rain_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 3 — Summer noon, deployment. */
    music_summer_noon_deploy: {
        paths: ['audio/music_summer_noon_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 3 — Summer noon, battle. */
    music_summer_noon_battle: {
        paths: ['audio/music_summer_noon_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 4 — Summer golden, deployment. */
    music_summer_golden_deploy: {
        paths: ['audio/music_summer_golden_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 4 — Summer golden, battle. */
    music_summer_golden_battle: {
        paths: ['audio/music_summer_golden_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 5 — Summer night, deployment. */
    music_summer_night_deploy: {
        paths: ['audio/music_summer_night_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 5 — Summer night, battle. */
    music_summer_night_battle: {
        paths: ['audio/music_summer_night_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 6 — Autumn dusk, deployment. */
    music_autumn_dusk_deploy: {
        paths: ['audio/music_autumn_dusk_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 6 — Autumn dusk, battle. */
    music_autumn_dusk_battle: {
        paths: ['audio/music_autumn_dusk_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 7 — Autumn storm, deployment. */
    music_autumn_storm_deploy: {
        paths: ['audio/music_autumn_storm_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 7 — Autumn storm, battle. */
    music_autumn_storm_battle: {
        paths: ['audio/music_autumn_storm_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 8 — First snow, deployment. */
    music_first_snow_deploy: {
        paths: ['audio/music_first_snow_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 8 — First snow, battle. */
    music_first_snow_battle: {
        paths: ['audio/music_first_snow_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** The Year beat 9 — Deep winter, deployment. */
    music_deep_winter_deploy: {
        paths: ['audio/music_deep_winter_deploy_1.ogg'],
        group: 'music',
        gain: 0.4,
    },
    /** The Year beat 9 — Deep winter, battle. */
    music_deep_winter_battle: {
        paths: ['audio/music_deep_winter_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    orb_shot: {
        paths: [
            'audio/orb_shot_1.ogg',
            'audio/orb_shot_2.ogg',
            'audio/orb_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 0.85,
    },
    phase_battle: {
        paths: [
            'audio/phase_gong_1.ogg',
            'audio/phase_gong_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.72,
    },
    phase_deploy: {
        paths: [
            'audio/phase_gong_1.ogg',
            'audio/phase_gong_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.72,
    },
    /**
     * Prism cannon proximity hum (copy of stone_whistle — replace that file
     * later without touching this cue). Near-field only via syncBeamLoops.
     */
    prism_hum: {
        paths: ['audio/prism_hum_1.ogg'],
        group: 'sfx',
        maxVoices: 1,
        spatial: true,
        refDistance: 8,
        maxDistance: 40,
        rolloff: 1.2,
        gain: 0.42,
    },
    ramp_beam: {
        paths: [
            'audio/ramp_beam_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 1,
        spatial: true,
        refDistance: 4,
        maxDistance: 22,
        rolloff: 1.4,
        gain: 0.38,
    },
    rocket_blast: {
        paths: [
            'audio/rocket_blast_1.ogg',
            'audio/rocket_blast_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    rocket_launch: {
        paths: [
            'audio/rocket_launch_1.ogg',
            'audio/rocket_launch_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 0.95,
    },
    spell_acid_spill: {
        paths: [
            'audio/spell_acid_spill_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    /** Acid droplet falling (hiss-drip) — Acid Spill pour. */
    spell_acid_drop: {
        paths: [
            'audio/spell_acid_drop_1.ogg',
            'audio/spell_acid_drop_2.ogg',
            'audio/spell_acid_drop_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: 100,
        maxDistance: ATTACK_MAX * 2,
        rolloff: 1.15,
        gain: 1.25,
    },
    /** Poison Cloud acid rain — thinner droppy plips (dripScale set on those drips). */
    spell_acid_rain: {
        paths: [
            'audio/spell_acid_rain_1.ogg',
            'audio/spell_acid_rain_2.ogg',
            'audio/spell_acid_rain_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 12,
        spatial: true,
        // Huge zone + half gain — keep full volume across most of the board.
        refDistance: 40,
        maxDistance: 80,
        rolloff: 1.05,
        gain: 0.525,
    },
    spell_dragon_approach: {
        paths: [
            'audio/spell_dragon_approach_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        // Global bed — full volume everywhere (no spatial falloff).
        spatial: false,
        // Looped for the full dive/strafe (approach) and spit/pour (breath).
        gain: 1.25,
    },
    spell_dragon_breath: {
        paths: [
            'audio/spell_dragon_breath_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: false,
        gain: 1.35,
    },
    spell_fire_spill: {
        paths: [
            'audio/spell_fire_spill_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    /** Ember / molten blob falling — distinct from spill start and ground_fire land. */
    spell_fire_drop: {
        paths: [
            'audio/spell_fire_drop_1.ogg',
            'audio/spell_fire_drop_2.ogg',
            'audio/spell_fire_drop_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: 100,
        maxDistance: ATTACK_MAX * 2,
        rolloff: 1.15,
        gain: 1.25,
    },
    spell_lightning: {
        paths: [
            'audio/spell_lightning_1.ogg',
            'audio/spell_lightning_2.ogg',
            'audio/spell_lightning_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 6,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    spell_meteor_fall: {
        paths: [
            'audio/spell_meteor_fall_1.ogg',
            'audio/spell_meteor_fall_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    /** Oil blob falling through the air (blug) — plays at drip fall-start. */
    spell_oil_drop: {
        paths: [
            'audio/spell_oil_drop_1.ogg',
            'audio/spell_oil_drop_2.ogg',
            'audio/spell_oil_drop_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: 100,
        maxDistance: ATTACK_MAX * 2,
        rolloff: 1.15,
        gain: 1.25,
    },
    spell_oil_spill: {
        paths: [
            'audio/spell_oil_spill_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    spell_poison_cloud: {
        paths: [
            'audio/spell_poison_cloud_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    spell_storm: {
        paths: [
            'audio/spell_storm_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    stone_throw: {
        paths: [
            'audio/stone_throw_1.ogg',
            'audio/stone_throw_2.ogg',
            'audio/stone_throw_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: ATTACK_REF,
        maxDistance: ATTACK_MAX,
        rolloff: ATTACK_ROLLOFF,
        gain: 0.85,
    },
    /** Seamless airplane-air whoosh — proximity bed (same family as fire/acid). */
    stone_whistle: {
        paths: ['audio/stone_whistle_1.ogg'],
        group: 'sfx',
        maxVoices: 1,
        gain: 0.55,
    },
    stronghold_collapse: {
        paths: ['audio/stronghold_collapse_1.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 1.25,
    },
    summon_flying: {
        paths: [
            'audio/summon_flying_1.ogg',
            'audio/summon_flying_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    summon_ground: {
        paths: [
            'audio/summon_ground_1.ogg',
            'audio/summon_ground_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    tactic_move: {
        paths: [
            'audio/tactic_move_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    tactic_rally: {
        paths: [
            'audio/tactic_rally_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    tactic_sell: {
        paths: [
            'audio/tactic_sell_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    tactic_tutor: {
        paths: [
            'audio/tactic_tutor_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    timer_warn: {
        paths: [
            'audio/timer_warn_2.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.62,
    },
    tower_debuff: {
        paths: [
            'audio/tower_debuff_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    ui_click: {
        paths: ['audio/ui_click_1.ogg'],
        group: 'ui',
        maxVoices: 2,
        gain: 1.0,
    },
    /** Soft menu hover (dedicated sample — quieter source than click). */
    ui_hover: {
        paths: ['audio/ui_hover_1.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.55,
    },
    /** Submenu open / back — book page turns (one of four). */
    ui_page: {
        paths: [
            'audio/ui_page_1.ogg',
            'audio/ui_page_2.ogg',
            'audio/ui_page_3.ogg',
            'audio/ui_page_4.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.8,
    },
    /** Cold-boot main-menu greeting (narrator voice). */
    narration_welcome: {
        paths: ['audio/narration_welcome.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    narration_year_begins: {
        paths: ['audio/narration_year_begins.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    ui_confirm: {
        paths: [
            'audio/ui_confirm_1.ogg',
            'audio/ui_confirm_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.45,
    },
    ui_deny: {
        paths: [
            'audio/ui_deny_1.ogg',
            'audio/ui_deny_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.4,
    },
    /** Building select — stone / canvas UI hits (not VO). */
    select_command_tower: {
        paths: [
            'audio/select_command_tower_1.ogg',
            'audio/select_command_tower_2.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.5,
    },
    select_research_center: {
        paths: [
            'audio/select_research_center_1.ogg',
            'audio/select_research_center_2.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.5,
    },
    select_tent: {
        paths: [
            'audio/select_tent_1.ogg',
            'audio/select_tent_2.ogg',
        ],
        group: 'ui',
        maxVoices: 1,
        gain: 0.48,
    },
    victory: {
        paths: [
            'audio/victory_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.7,
    },
};

// Literal assetUrl() calls so `npm run assets:manifest` ships these files.
void [
    assetUrl('audio/acid_loop_1.ogg'),
    assetUrl('audio/archer_shot_1.ogg'),
    assetUrl('audio/archer_shot_2.ogg'),
    assetUrl('audio/archer_shot_3.ogg'),
    assetUrl('audio/archer_shot_4.ogg'),
    assetUrl('audio/ballista_shot_1.ogg'),
    assetUrl('audio/ballista_shot_2.ogg'),
    assetUrl('audio/ballista_shot_3.ogg'),
    assetUrl('audio/bolt_shot_1.ogg'),
    assetUrl('audio/bolt_shot_2.ogg'),
    assetUrl('audio/bolt_shot_3.ogg'),
    assetUrl('audio/card_pick_1.ogg'),
    assetUrl('audio/card_pick_2.ogg'),
    assetUrl('audio/commander_addi.ogg'),
    assetUrl('audio/commander_addi_2.ogg'),
    assetUrl('audio/commander_addi_3.ogg'),
    assetUrl('audio/commander_addi_win_1.ogg'),
    assetUrl('audio/commander_addi_win_2.ogg'),
    assetUrl('audio/commander_addi_win_3.ogg'),
    assetUrl('audio/commander_addi_victory.ogg'),
    assetUrl('audio/commander_addi_defeat.ogg'),
    assetUrl('audio/commander_addi_rival_1.ogg'),
    assetUrl('audio/commander_addi_rival_2.ogg'),
    assetUrl('audio/commander_addi_rival_3.ogg'),
    assetUrl('audio/commander_air.ogg'),
    assetUrl('audio/commander_air_2.ogg'),
    assetUrl('audio/commander_air_3.ogg'),
    assetUrl('audio/commander_air_win_1.ogg'),
    assetUrl('audio/commander_air_win_2.ogg'),
    assetUrl('audio/commander_air_win_3.ogg'),
    assetUrl('audio/commander_air_victory.ogg'),
    assetUrl('audio/commander_air_defeat.ogg'),
    assetUrl('audio/commander_air_rival_1.ogg'),
    assetUrl('audio/commander_air_rival_2.ogg'),
    assetUrl('audio/commander_air_rival_3.ogg'),
    assetUrl('audio/commander_archer.ogg'),
    assetUrl('audio/commander_archer_2.ogg'),
    assetUrl('audio/commander_archer_3.ogg'),
    assetUrl('audio/commander_archer_win_1.ogg'),
    assetUrl('audio/commander_archer_win_2.ogg'),
    assetUrl('audio/commander_archer_win_3.ogg'),
    assetUrl('audio/commander_archer_victory.ogg'),
    assetUrl('audio/commander_archer_defeat.ogg'),
    assetUrl('audio/commander_archer_rival_1.ogg'),
    assetUrl('audio/commander_archer_rival_2.ogg'),
    assetUrl('audio/commander_archer_rival_3.ogg'),
    assetUrl('audio/commander_cost.ogg'),
    assetUrl('audio/commander_cost_2.ogg'),
    assetUrl('audio/commander_cost_3.ogg'),
    assetUrl('audio/commander_cost_win_1.ogg'),
    assetUrl('audio/commander_cost_win_2.ogg'),
    assetUrl('audio/commander_cost_win_3.ogg'),
    assetUrl('audio/commander_cost_victory.ogg'),
    assetUrl('audio/commander_cost_defeat.ogg'),
    assetUrl('audio/commander_cost_rival_1.ogg'),
    assetUrl('audio/commander_cost_rival_2.ogg'),
    assetUrl('audio/commander_cost_rival_3.ogg'),
    assetUrl('audio/commander_cursed.ogg'),
    assetUrl('audio/commander_cursed_2.ogg'),
    assetUrl('audio/commander_cursed_3.ogg'),
    assetUrl('audio/commander_cursed_win_1.ogg'),
    assetUrl('audio/commander_cursed_win_2.ogg'),
    assetUrl('audio/commander_cursed_win_3.ogg'),
    assetUrl('audio/commander_cursed_victory.ogg'),
    assetUrl('audio/commander_cursed_defeat.ogg'),
    assetUrl('audio/commander_cursed_rival_1.ogg'),
    assetUrl('audio/commander_cursed_rival_2.ogg'),
    assetUrl('audio/commander_cursed_rival_3.ogg'),
    assetUrl('audio/commander_elite.ogg'),
    assetUrl('audio/commander_elite_2.ogg'),
    assetUrl('audio/commander_elite_3.ogg'),
    assetUrl('audio/commander_elite_win_1.ogg'),
    assetUrl('audio/commander_elite_win_2.ogg'),
    assetUrl('audio/commander_elite_win_3.ogg'),
    assetUrl('audio/commander_elite_victory.ogg'),
    assetUrl('audio/commander_elite_defeat.ogg'),
    assetUrl('audio/commander_elite_rival_1.ogg'),
    assetUrl('audio/commander_elite_rival_2.ogg'),
    assetUrl('audio/commander_elite_rival_3.ogg'),
    assetUrl('audio/commander_flanky.ogg'),
    assetUrl('audio/commander_flanky_2.ogg'),
    assetUrl('audio/commander_flanky_3.ogg'),
    assetUrl('audio/commander_flanky_win_1.ogg'),
    assetUrl('audio/commander_flanky_win_2.ogg'),
    assetUrl('audio/commander_flanky_win_3.ogg'),
    assetUrl('audio/commander_flanky_victory.ogg'),
    assetUrl('audio/commander_flanky_defeat.ogg'),
    assetUrl('audio/commander_flanky_rival_1.ogg'),
    assetUrl('audio/commander_flanky_rival_2.ogg'),
    assetUrl('audio/commander_flanky_rival_3.ogg'),
    assetUrl('audio/commander_giant.ogg'),
    assetUrl('audio/commander_giant_2.ogg'),
    assetUrl('audio/commander_giant_3.ogg'),
    assetUrl('audio/commander_giant_win_1.ogg'),
    assetUrl('audio/commander_giant_win_2.ogg'),
    assetUrl('audio/commander_giant_win_3.ogg'),
    assetUrl('audio/commander_giant_victory.ogg'),
    assetUrl('audio/commander_giant_defeat.ogg'),
    assetUrl('audio/commander_giant_rival_1.ogg'),
    assetUrl('audio/commander_giant_rival_2.ogg'),
    assetUrl('audio/commander_giant_rival_3.ogg'),
    assetUrl('audio/commander_meteor.ogg'),
    assetUrl('audio/commander_meteor_2.ogg'),
    assetUrl('audio/commander_meteor_3.ogg'),
    assetUrl('audio/commander_meteor_win_1.ogg'),
    assetUrl('audio/commander_meteor_win_2.ogg'),
    assetUrl('audio/commander_meteor_win_3.ogg'),
    assetUrl('audio/commander_meteor_victory.ogg'),
    assetUrl('audio/commander_meteor_defeat.ogg'),
    assetUrl('audio/commander_meteor_rival_1.ogg'),
    assetUrl('audio/commander_meteor_rival_2.ogg'),
    assetUrl('audio/commander_meteor_rival_3.ogg'),
    assetUrl('audio/commander_money.ogg'),
    assetUrl('audio/commander_money_2.ogg'),
    assetUrl('audio/commander_money_3.ogg'),
    assetUrl('audio/commander_money_win_1.ogg'),
    assetUrl('audio/commander_money_win_2.ogg'),
    assetUrl('audio/commander_money_win_3.ogg'),
    assetUrl('audio/commander_money_victory.ogg'),
    assetUrl('audio/commander_money_defeat.ogg'),
    assetUrl('audio/commander_money_rival_1.ogg'),
    assetUrl('audio/commander_money_rival_2.ogg'),
    assetUrl('audio/commander_money_rival_3.ogg'),
    assetUrl('audio/commander_speed.ogg'),
    assetUrl('audio/commander_speed_2.ogg'),
    assetUrl('audio/commander_speed_3.ogg'),
    assetUrl('audio/commander_speed_win_1.ogg'),
    assetUrl('audio/commander_speed_win_2.ogg'),
    assetUrl('audio/commander_speed_win_3.ogg'),
    assetUrl('audio/commander_speed_victory.ogg'),
    assetUrl('audio/commander_speed_defeat.ogg'),
    assetUrl('audio/commander_speed_rival_1.ogg'),
    assetUrl('audio/commander_speed_rival_2.ogg'),
    assetUrl('audio/commander_speed_rival_3.ogg'),
    assetUrl('audio/commander_tutor.ogg'),
    assetUrl('audio/commander_tutor_2.ogg'),
    assetUrl('audio/commander_tutor_3.ogg'),
    assetUrl('audio/commander_tutor_win_1.ogg'),
    assetUrl('audio/commander_tutor_win_2.ogg'),
    assetUrl('audio/commander_tutor_win_3.ogg'),
    assetUrl('audio/commander_tutor_victory.ogg'),
    assetUrl('audio/commander_tutor_defeat.ogg'),
    assetUrl('audio/commander_tutor_rival_1.ogg'),
    assetUrl('audio/commander_tutor_rival_2.ogg'),
    assetUrl('audio/commander_tutor_rival_3.ogg'),
    assetUrl('audio/convert_1.ogg'),
    assetUrl('audio/convert_2.ogg'),
    assetUrl('audio/convert_beam_1.ogg'),
    assetUrl('audio/death_command_tower_1.ogg'),
    assetUrl('audio/death_research_center_1.ogg'),
    assetUrl('audio/death_shield_1.ogg'),
    assetUrl('audio/death_structure_1.ogg'),
    assetUrl('audio/death_tent_1.ogg'),
    assetUrl('audio/death_unit_1.ogg'),
    assetUrl('audio/death_unit_2.ogg'),
    assetUrl('audio/death_unit_big_1.ogg'),
    assetUrl('audio/death_unit_big_2.ogg'),
    assetUrl('audio/defeat_1.ogg'),
    assetUrl('audio/draw_match_1.ogg'),
    assetUrl('audio/explosion_1.ogg'),
    assetUrl('audio/explosion_2.ogg'),
    assetUrl('audio/explosion_fire_1.ogg'),
    assetUrl('audio/explosion_fire_2.ogg'),
    assetUrl('audio/explosion_heavy_1.ogg'),
    assetUrl('audio/explosion_heavy_2.ogg'),
    assetUrl('audio/forge_light_1.ogg'),
    assetUrl('audio/forge_light_2.ogg'),
    assetUrl('audio/fire_loop_1.ogg'),
    assetUrl('audio/ground_fire_1.ogg'),
    assetUrl('audio/ground_fire_2.ogg'),
    assetUrl('audio/hammer_crush_1.ogg'),
    assetUrl('audio/hammerer_smash_1.ogg'),
    assetUrl('audio/hammerer_smash_2.ogg'),
    assetUrl('audio/ogre_smash_1.ogg'),
    assetUrl('audio/ogre_smash_2.ogg'),
    assetUrl('audio/hazard_drip_1.ogg'),
    assetUrl('audio/hazard_drip_2.ogg'),
    assetUrl('audio/hazard_drip_3.ogg'),
    assetUrl('audio/hp_draw_high_1.ogg'),
    assetUrl('audio/hp_draw_low_1.ogg'),
    assetUrl('audio/hp_draw_medium_1.ogg'),
    assetUrl('audio/impact_flesh_1.ogg'),
    assetUrl('audio/impact_flesh_2.ogg'),
    assetUrl('audio/impact_flesh_3.ogg'),
    assetUrl('audio/impact_ground_1.ogg'),
    assetUrl('audio/impact_ground_2.ogg'),
    assetUrl('audio/impact_ground_3.ogg'),
    assetUrl('audio/impact_masonry_1.ogg'),
    assetUrl('audio/impact_masonry_2.ogg'),
    assetUrl('audio/impact_masonry_3.ogg'),
    assetUrl('audio/impact_stone_drop_1.ogg'),
    assetUrl('audio/impact_stone_drop_2.ogg'),
    assetUrl('audio/impact_ward_1.ogg'),
    assetUrl('audio/impact_ward_2.ogg'),
    assetUrl('audio/impact_ward_3.ogg'),
    assetUrl('audio/levelup_1.ogg'),
    assetUrl('audio/melee_hit_1.ogg'),
    assetUrl('audio/melee_hit_2.ogg'),
    assetUrl('audio/melee_hit_3.ogg'),
    assetUrl('audio/melee_swing_1.ogg'),
    assetUrl('audio/melee_swing_2.ogg'),
    assetUrl('audio/melee_swing_3.ogg'),
    assetUrl('audio/mortar_shot_1.ogg'),
    assetUrl('audio/mortar_shot_2.ogg'),
    assetUrl('audio/mortar_shot_3.ogg'),
    assetUrl('audio/mortar_shot_4.ogg'),
    assetUrl('audio/mortar_shot_5.ogg'),
    assetUrl('audio/music_autumn_dusk_battle_1.ogg'),
    assetUrl('audio/music_autumn_dusk_deploy_1.ogg'),
    assetUrl('audio/music_autumn_storm_battle_1.ogg'),
    assetUrl('audio/music_autumn_storm_deploy_1.ogg'),
    assetUrl('audio/music_battle_1.ogg'),
    assetUrl('audio/music_deep_winter_battle_1.ogg'),
    assetUrl('audio/music_deep_winter_deploy_1.ogg'),
    assetUrl('audio/music_first_snow_battle_1.ogg'),
    assetUrl('audio/music_first_snow_deploy_1.ogg'),
    assetUrl('audio/music_menu_1.ogg'),
    assetUrl('audio/music_menu_2.ogg'),
    assetUrl('audio/music_menu_3.ogg'),
    assetUrl('audio/music_spring_morning_battle_1.ogg'),
    assetUrl('audio/music_spring_morning_deploy_1.ogg'),
    assetUrl('audio/music_spring_rain_battle_1.ogg'),
    assetUrl('audio/music_spring_rain_deploy_1.ogg'),
    assetUrl('audio/music_summer_golden_battle_1.ogg'),
    assetUrl('audio/music_summer_golden_deploy_1.ogg'),
    assetUrl('audio/music_summer_night_battle_1.ogg'),
    assetUrl('audio/music_summer_night_deploy_1.ogg'),
    assetUrl('audio/music_summer_noon_battle_1.ogg'),
    assetUrl('audio/music_summer_noon_deploy_1.ogg'),
    assetUrl('audio/orb_shot_1.ogg'),
    assetUrl('audio/orb_shot_2.ogg'),
    assetUrl('audio/orb_shot_3.ogg'),
    assetUrl('audio/phase_gong_1.ogg'),
    assetUrl('audio/phase_gong_2.ogg'),
    assetUrl('audio/collapse_thunder_1.ogg'),
    assetUrl('audio/prism_hum_1.ogg'),
    assetUrl('audio/ramp_beam_1.ogg'),
    assetUrl('audio/rocket_blast_1.ogg'),
    assetUrl('audio/rocket_blast_2.ogg'),
    assetUrl('audio/rocket_launch_1.ogg'),
    assetUrl('audio/rocket_launch_2.ogg'),
    assetUrl('audio/spell_acid_drop_1.ogg'),
    assetUrl('audio/spell_acid_drop_2.ogg'),
    assetUrl('audio/spell_acid_drop_3.ogg'),
    assetUrl('audio/spell_acid_rain_1.ogg'),
    assetUrl('audio/spell_acid_rain_2.ogg'),
    assetUrl('audio/spell_acid_rain_3.ogg'),
    assetUrl('audio/spell_acid_spill_1.ogg'),
    assetUrl('audio/spell_dragon_approach_1.ogg'),
    assetUrl('audio/spell_dragon_breath_1.ogg'),
    assetUrl('audio/spell_fire_drop_1.ogg'),
    assetUrl('audio/spell_fire_drop_2.ogg'),
    assetUrl('audio/spell_fire_drop_3.ogg'),
    assetUrl('audio/spell_fire_spill_1.ogg'),
    assetUrl('audio/spell_lightning_1.ogg'),
    assetUrl('audio/spell_lightning_2.ogg'),
    assetUrl('audio/spell_lightning_3.ogg'),
    assetUrl('audio/spell_meteor_fall_1.ogg'),
    assetUrl('audio/spell_meteor_fall_2.ogg'),
    assetUrl('audio/spell_oil_drop_1.ogg'),
    assetUrl('audio/spell_oil_drop_2.ogg'),
    assetUrl('audio/spell_oil_drop_3.ogg'),
    assetUrl('audio/spell_oil_spill_1.ogg'),
    assetUrl('audio/spell_poison_cloud_1.ogg'),
    assetUrl('audio/spell_storm_1.ogg'),
    assetUrl('audio/stone_throw_1.ogg'),
    assetUrl('audio/stone_throw_2.ogg'),
    assetUrl('audio/stone_throw_3.ogg'),
    assetUrl('audio/stone_whistle_1.ogg'),
    assetUrl('audio/stronghold_collapse_1.ogg'),
    assetUrl('audio/summon_flying_1.ogg'),
    assetUrl('audio/summon_flying_2.ogg'),
    assetUrl('audio/summon_ground_1.ogg'),
    assetUrl('audio/summon_ground_2.ogg'),
    assetUrl('audio/tactic_move_1.ogg'),
    assetUrl('audio/tactic_rally_1.ogg'),
    assetUrl('audio/tactic_sell_1.ogg'),
    assetUrl('audio/tactic_tutor_1.ogg'),
    assetUrl('audio/timer_warn_2.ogg'),
    assetUrl('audio/tower_debuff_1.ogg'),
    assetUrl('audio/select_command_tower_1.ogg'),
    assetUrl('audio/select_command_tower_2.ogg'),
    assetUrl('audio/select_research_center_1.ogg'),
    assetUrl('audio/select_research_center_2.ogg'),
    assetUrl('audio/select_tent_1.ogg'),
    assetUrl('audio/select_tent_2.ogg'),
    assetUrl('audio/ui_click_1.ogg'),
    assetUrl('audio/ui_hover_1.ogg'),
    assetUrl('audio/ui_page_1.ogg'),
    assetUrl('audio/ui_page_2.ogg'),
    assetUrl('audio/ui_page_3.ogg'),
    assetUrl('audio/ui_page_4.ogg'),
    assetUrl('audio/narration_welcome.ogg'),
    assetUrl('audio/narration_year_begins.ogg'),
    assetUrl('audio/ui_confirm_1.ogg'),
    assetUrl('audio/ui_confirm_2.ogg'),
    assetUrl('audio/ui_deny_1.ogg'),
    assetUrl('audio/ui_deny_2.ogg'),
    assetUrl('audio/unit_archer_1.ogg'),
    assetUrl('audio/unit_archer_2.ogg'),
    assetUrl('audio/unit_archer_3.ogg'),
    assetUrl('audio/unit_archer_4.ogg'),
    assetUrl('audio/unit_archer_5.ogg'),
    assetUrl('audio/unit_archer_6.ogg'),
    assetUrl('audio/unit_archer_7.ogg'),
    assetUrl('audio/unit_archer_8.ogg'),
    assetUrl('audio/unit_archer_9.ogg'),
    assetUrl('audio/unit_archer_10.ogg'),
    assetUrl('audio/unit_archer_11.ogg'),
    assetUrl('audio/unit_archer_rival_1.ogg'),
    assetUrl('audio/unit_archer_rival_2.ogg'),
    assetUrl('audio/unit_archer_rival_3.ogg'),
    assetUrl('audio/unit_archer_death_1.ogg'),
    assetUrl('audio/unit_archer_death_2.ogg'),
    assetUrl('audio/unit_archer_hurt_1.ogg'),
    assetUrl('audio/unit_archer_hurt_2.ogg'),
    assetUrl('audio/unit_archer_hurt_3.ogg'),
    assetUrl('audio/unit_archer_hurt_4.ogg'),
    assetUrl('audio/unit_archer_hurt_5.ogg'),
    assetUrl('audio/unit_archer_hurt_6.ogg'),
    assetUrl('audio/unit_archer_hurt_7.ogg'),
    assetUrl('audio/unit_ballista_1.ogg'),
    assetUrl('audio/unit_ballista_2.ogg'),
    assetUrl('audio/unit_ballista_3.ogg'),
    assetUrl('audio/unit_ballista_4.ogg'),
    assetUrl('audio/unit_ballista_5.ogg'),
    assetUrl('audio/unit_ballista_6.ogg'),
    assetUrl('audio/unit_ballista_7.ogg'),
    assetUrl('audio/unit_ballista_8.ogg'),
    assetUrl('audio/unit_ballista_9.ogg'),
    assetUrl('audio/unit_ballista_10.ogg'),
    assetUrl('audio/unit_ballista_11.ogg'),
    assetUrl('audio/unit_ballista_12.ogg'),
    assetUrl('audio/unit_ballista_rival_1.ogg'),
    assetUrl('audio/unit_ballista_rival_2.ogg'),
    assetUrl('audio/unit_ballista_rival_3.ogg'),
    assetUrl('audio/unit_ballista_death_1.ogg'),
    assetUrl('audio/unit_ballista_death_2.ogg'),
    assetUrl('audio/unit_ballista_hurt_1.ogg'),
    assetUrl('audio/unit_ballista_hurt_2.ogg'),
    assetUrl('audio/unit_ballista_hurt_3.ogg'),
    assetUrl('audio/unit_ballista_hurt_4.ogg'),
    assetUrl('audio/unit_ballista_hurt_5.ogg'),
    assetUrl('audio/unit_wizard_1.ogg'),
    assetUrl('audio/unit_wizard_2.ogg'),
    assetUrl('audio/unit_wizard_3.ogg'),
    assetUrl('audio/unit_wizard_4.ogg'),
    assetUrl('audio/unit_wizard_5.ogg'),
    assetUrl('audio/unit_wizard_6.ogg'),
    assetUrl('audio/unit_wizard_7.ogg'),
    assetUrl('audio/unit_wizard_8.ogg'),
    assetUrl('audio/unit_wizard_9.ogg'),
    assetUrl('audio/unit_wizard_10.ogg'),
    assetUrl('audio/unit_wizard_11.ogg'),
    assetUrl('audio/unit_wizard_12.ogg'),
    assetUrl('audio/unit_wizard_rival_1.ogg'),
    assetUrl('audio/unit_wizard_rival_2.ogg'),
    assetUrl('audio/unit_wizard_rival_3.ogg'),
    assetUrl('audio/unit_wizard_death_1.ogg'),
    assetUrl('audio/unit_wizard_death_2.ogg'),
    assetUrl('audio/unit_wizard_hurt_1.ogg'),
    assetUrl('audio/unit_wizard_hurt_2.ogg'),
    assetUrl('audio/unit_wizard_hurt_3.ogg'),
    assetUrl('audio/unit_wizard_hurt_4.ogg'),
    assetUrl('audio/unit_wizard_hurt_5.ogg'),
    assetUrl('audio/unit_crowRider_1.ogg'),
    assetUrl('audio/unit_crowRider_2.ogg'),
    assetUrl('audio/unit_crowRider_3.ogg'),
    assetUrl('audio/unit_crowRider_4.ogg'),
    assetUrl('audio/unit_crowRider_5.ogg'),
    assetUrl('audio/unit_crowRider_6.ogg'),
    assetUrl('audio/unit_crowRider_7.ogg'),
    assetUrl('audio/unit_crowRider_8.ogg'),
    assetUrl('audio/unit_crowRider_9.ogg'),
    assetUrl('audio/unit_crowRider_10.ogg'),
    assetUrl('audio/unit_crowRider_11.ogg'),
    assetUrl('audio/unit_crowRider_12.ogg'),
    assetUrl('audio/unit_crowRider_rival_1.ogg'),
    assetUrl('audio/unit_crowRider_rival_2.ogg'),
    assetUrl('audio/unit_crowRider_rival_3.ogg'),
    assetUrl('audio/unit_crowRider_death_1.ogg'),
    assetUrl('audio/unit_crowRider_death_2.ogg'),
    assetUrl('audio/unit_crowRider_death_3.ogg'),
    assetUrl('audio/unit_crowRider_hurt_1.ogg'),
    assetUrl('audio/unit_crowRider_hurt_2.ogg'),
    assetUrl('audio/unit_crowRider_hurt_3.ogg'),
    assetUrl('audio/unit_crowRider_hurt_4.ogg'),
    assetUrl('audio/unit_crowRider_hurt_5.ogg'),
    assetUrl('audio/unit_dwarf_1.ogg'),
    assetUrl('audio/unit_dwarf_2.ogg'),
    assetUrl('audio/unit_dwarf_3.ogg'),
    assetUrl('audio/unit_dwarf_4.ogg'),
    assetUrl('audio/unit_dwarf_5.ogg'),
    assetUrl('audio/unit_dwarf_6.ogg'),
    assetUrl('audio/unit_dwarf_7.ogg'),
    assetUrl('audio/unit_dwarf_8.ogg'),
    assetUrl('audio/unit_dwarf_9.ogg'),
    assetUrl('audio/unit_dwarf_10.ogg'),
    assetUrl('audio/unit_dwarf_11.ogg'),
    assetUrl('audio/unit_dwarf_12.ogg'),
    assetUrl('audio/unit_dwarf_rival_1.ogg'),
    assetUrl('audio/unit_dwarf_rival_2.ogg'),
    assetUrl('audio/unit_dwarf_rival_3.ogg'),
    assetUrl('audio/unit_dwarf_rival_4.ogg'),
    assetUrl('audio/unit_dwarf_rival_5.ogg'),
    assetUrl('audio/unit_dwarf_rival_6.ogg'),
    assetUrl('audio/unit_dwarf_rival_7.ogg'),
    assetUrl('audio/unit_dwarf_rival_8.ogg'),
    assetUrl('audio/unit_dwarf_rival_9.ogg'),
    assetUrl('audio/unit_dwarf_death_1.ogg'),
    assetUrl('audio/unit_dwarf_death_2.ogg'),
    assetUrl('audio/unit_dwarf_hurt_1.ogg'),
    assetUrl('audio/unit_dwarf_hurt_2.ogg'),
    assetUrl('audio/unit_dwarf_hurt_3.ogg'),
    assetUrl('audio/unit_dwarf_hurt_4.ogg'),
    assetUrl('audio/unit_dwarf_hurt_5.ogg'),
    assetUrl('audio/unit_goblin_1.ogg'),
    assetUrl('audio/unit_goblin_2.ogg'),
    assetUrl('audio/unit_goblin_3.ogg'),
    assetUrl('audio/unit_goblin_4.ogg'),
    assetUrl('audio/unit_goblin_5.ogg'),
    assetUrl('audio/unit_goblin_6.ogg'),
    assetUrl('audio/unit_goblin_7.ogg'),
    assetUrl('audio/unit_goblin_8.ogg'),
    assetUrl('audio/unit_goblin_9.ogg'),
    assetUrl('audio/unit_goblin_10.ogg'),
    assetUrl('audio/unit_goblin_11.ogg'),
    assetUrl('audio/unit_goblin_12.ogg'),
    assetUrl('audio/unit_goblin_rival_1.ogg'),
    assetUrl('audio/unit_goblin_rival_2.ogg'),
    assetUrl('audio/unit_goblin_rival_3.ogg'),
    assetUrl('audio/unit_goblin_rival_4.ogg'),
    assetUrl('audio/unit_goblin_rival_5.ogg'),
    assetUrl('audio/unit_goblin_rival_6.ogg'),
    assetUrl('audio/unit_goblin_rival_7.ogg'),
    assetUrl('audio/unit_goblin_rival_8.ogg'),
    assetUrl('audio/unit_goblin_rival_9.ogg'),
    assetUrl('audio/unit_goblin_death_1.ogg'),
    assetUrl('audio/unit_goblin_death_2.ogg'),
    assetUrl('audio/unit_goblin_hurt_1.ogg'),
    assetUrl('audio/unit_goblin_hurt_2.ogg'),
    assetUrl('audio/unit_goblin_hurt_3.ogg'),
    assetUrl('audio/unit_goblin_hurt_4.ogg'),
    assetUrl('audio/unit_goblin_hurt_5.ogg'),
    assetUrl('audio/unit_hammerer_1.ogg'),
    assetUrl('audio/unit_hammerer_2.ogg'),
    assetUrl('audio/unit_hammerer_3.ogg'),
    assetUrl('audio/unit_hammerer_4.ogg'),
    assetUrl('audio/unit_hammerer_5.ogg'),
    assetUrl('audio/unit_hammerer_6.ogg'),
    assetUrl('audio/unit_hammerer_7.ogg'),
    assetUrl('audio/unit_hammerer_8.ogg'),
    assetUrl('audio/unit_hammerer_9.ogg'),
    assetUrl('audio/unit_hammerer_rival_1.ogg'),
    assetUrl('audio/unit_hammerer_rival_2.ogg'),
    assetUrl('audio/unit_hammerer_rival_3.ogg'),
    assetUrl('audio/unit_hammerer_death_1.ogg'),
    assetUrl('audio/unit_hammerer_death_2.ogg'),
    assetUrl('audio/unit_hammerer_hurt_1.ogg'),
    assetUrl('audio/unit_hammerer_hurt_2.ogg'),
    assetUrl('audio/unit_hammerer_hurt_3.ogg'),
    assetUrl('audio/unit_hammerer_hurt_4.ogg'),
    assetUrl('audio/unit_mortar_1.ogg'),
    assetUrl('audio/unit_mortar_2.ogg'),
    assetUrl('audio/unit_mortar_3.ogg'),
    assetUrl('audio/unit_mortar_4.ogg'),
    assetUrl('audio/unit_mortar_5.ogg'),
    assetUrl('audio/unit_mortar_6.ogg'),
    assetUrl('audio/unit_mortar_7.ogg'),
    assetUrl('audio/unit_mortar_8.ogg'),
    assetUrl('audio/unit_mortar_9.ogg'),
    assetUrl('audio/unit_mortar_10.ogg'),
    assetUrl('audio/unit_mortar_rival_1.ogg'),
    assetUrl('audio/unit_mortar_rival_2.ogg'),
    assetUrl('audio/unit_mortar_rival_3.ogg'),
    assetUrl('audio/unit_mortar_rival_4.ogg'),
    assetUrl('audio/unit_mortar_death_1.ogg'),
    assetUrl('audio/unit_mortar_death_2.ogg'),
    assetUrl('audio/unit_mortar_hurt_1.ogg'),
    assetUrl('audio/unit_mortar_hurt_2.ogg'),
    assetUrl('audio/unit_mortar_hurt_3.ogg'),
    assetUrl('audio/unit_mortar_hurt_4.ogg'),
    assetUrl('audio/unit_mortar_hurt_5.ogg'),
    assetUrl('audio/unit_ogre_1.ogg'),
    assetUrl('audio/unit_ogre_2.ogg'),
    assetUrl('audio/unit_ogre_3.ogg'),
    assetUrl('audio/unit_ogre_4.ogg'),
    assetUrl('audio/unit_ogre_5.ogg'),
    assetUrl('audio/unit_ogre_6.ogg'),
    assetUrl('audio/unit_ogre_7.ogg'),
    assetUrl('audio/unit_ogre_8.ogg'),
    assetUrl('audio/unit_ogre_9.ogg'),
    assetUrl('audio/unit_ogre_10.ogg'),
    assetUrl('audio/unit_ogre_11.ogg'),
    assetUrl('audio/unit_ogre_rival_1.ogg'),
    assetUrl('audio/unit_ogre_rival_2.ogg'),
    assetUrl('audio/unit_ogre_rival_3.ogg'),
    assetUrl('audio/unit_ogre_death_1.ogg'),
    assetUrl('audio/unit_ogre_death_2.ogg'),
    assetUrl('audio/unit_ogre_hurt_1.ogg'),
    assetUrl('audio/unit_ogre_hurt_2.ogg'),
    assetUrl('audio/unit_ogre_hurt_3.ogg'),
    assetUrl('audio/unit_ogre_hurt_4.ogg'),
    assetUrl('audio/unit_ogre_hurt_5.ogg'),
    assetUrl('audio/unit_prismCannon_1.ogg'),
    assetUrl('audio/unit_prismCannon_2.ogg'),
    assetUrl('audio/unit_prismCannon_3.ogg'),
    assetUrl('audio/unit_prismCannon_4.ogg'),
    assetUrl('audio/unit_prismCannon_5.ogg'),
    assetUrl('audio/unit_prismCannon_6.ogg'),
    assetUrl('audio/unit_prismCannon_7.ogg'),
    assetUrl('audio/unit_prismCannon_8.ogg'),
    assetUrl('audio/unit_prismCannon_9.ogg'),
    assetUrl('audio/unit_prismCannon_10.ogg'),
    assetUrl('audio/unit_prismCannon_11.ogg'),
    assetUrl('audio/unit_prismCannon_12.ogg'),
    assetUrl('audio/unit_prismCannon_rival_1.ogg'),
    assetUrl('audio/unit_prismCannon_rival_2.ogg'),
    assetUrl('audio/unit_prismCannon_rival_3.ogg'),
    assetUrl('audio/unit_prismCannon_death_1.ogg'),
    assetUrl('audio/unit_prismCannon_death_2.ogg'),
    assetUrl('audio/unit_prismCannon_hurt_1.ogg'),
    assetUrl('audio/unit_prismCannon_hurt_2.ogg'),
    assetUrl('audio/unit_prismCannon_hurt_3.ogg'),
    assetUrl('audio/unit_prismCannon_hurt_4.ogg'),
    assetUrl('audio/unit_prismCannon_hurt_5.ogg'),
    assetUrl('audio/victory_1.ogg'),
];

type Voice = {
    cueId: string;
    source: AudioBufferSourceNode;
    gain: GainNode;
    panner?: PannerNode;
};

class AudioBus {
    private ctx: AudioContext | null = null;
    private master!: GainNode;
    private groups!: Record<AudioGroupId, GainNode>;
    /** Hazard / beam beds — same SFX volume pref, never time-scaled or ducked. */
    private loopBus!: GainNode;
    /**
     * Optional tap of `master` for MediaRecorder (game video clips).
     * Speakers stay on `ctx.destination`; this is an extra fan-out.
     */
    private recordDest: MediaStreamAudioDestinationNode | null = null;
    private recordTapUsers = 0;
    private buffers = new Map<string, AudioBuffer>();
    /** In-flight fetches so parallel ensureCue / death storms share one decode. */
    private inflightDecode = new Map<string, Promise<void>>();
    private voices: Voice[] = [];
    private voiceCount = new Map<string, number>();
    /** Last path played per cue — avoid immediate repeats when a cue has variants. */
    private lastCuePath = new Map<string, string>();
    private listenerX = 0;
    private listenerZ = 0;
    /** Camera height above ground — used to duck close-cam-only cues (hurt/death). */
    private listenerCamAlt = 0;
    private unlocked = false;
    private musicSource: AudioBufferSourceNode | null = null;
    private musicCueId: string | null = null;
    private musicGain: GainNode | null = null;
    /** Bumps when a newer playMusic request supersedes an in-flight load. */
    private musicGen = 0;
    /** The bed the game's current state asks for (menu / match / none) — see {@link playMusic}. */
    private wantedMusic: string | null = null;
    /** The bed being decoded right now (not yet audible), so a repeat ask doesn't restart it. */
    private loadingMusic: string | null = null;
    private unsubPrefs: (() => void) | null = null;
    /** Sustained beam / hazard loops keyed by cue id. */
    private loops = new Map<
        string,
        { source: AudioBufferSourceNode; gain: GainNode; panner?: PannerNode }
    >;
    /**
     * Effective battle/replay speed (0 = paused, 0.25 = slo-mo, 1 = normal,
     * 2/8/32 = fast-forward). Drives SFX playbackRate + soft duck only —
     * music / UI / commander VO stay at real time.
     */
    private timeScale = 1;
    /** Wall-clock of last unit select bark that actually fired. */
    private lastUnitSelectAt = 0;
    /** Homepage: next select-line index per voice id (cycles on each click). */
    private unitSelectNextIndex = new Map<string, number>();
    /** Wall-clock of last unit hurt yelp that actually fired. */
    private lastUnitHurtAt = 0;
    /** Bumps to cancel an in-flight homepage VO preview sequence. */
    private unitPreviewGen = 0;

    /** Idempotent — call from first pointer/click and again at match start. */
    unlock(): void {
        const ctx = this.ensureCtx();
        if (ctx.state === 'suspended') void ctx.resume();
        this.unlocked = true;
        // the state may have asked for music before there was a context
        this.syncMusic();
    }

    get isUnlocked(): boolean {
        return this.unlocked;
    }

    /**
     * Fan-out `master` into a MediaStream for clip recording.
     * Call {@link disableRecordTap} when the recorder stops so we don't keep
     * an unused destination node around across matches.
     */
    enableRecordTap(): MediaStream {
        const ctx = this.ensureCtx();
        if (ctx.state === 'suspended') void ctx.resume();
        if (!this.recordDest) {
            this.recordDest = ctx.createMediaStreamDestination();
            this.master.connect(this.recordDest);
        }
        this.recordTapUsers += 1;
        return this.recordDest.stream;
    }

    disableRecordTap(): void {
        if (this.recordTapUsers > 0) this.recordTapUsers -= 1;
        if (this.recordTapUsers > 0 || !this.recordDest) return;
        try {
            this.master.disconnect(this.recordDest);
        } catch {
            /* already disconnected */
        }
        this.recordDest = null;
    }

    /** Decode commander pick VO cues (optional — normally lazy on first play). */
    preloadCommanderPicks(): Promise<void> {
        const paths = new Set<string>();
        for (const [id, cue] of Object.entries(CUES)) {
            if (!id.startsWith('commander_')) continue;
            for (const p of cue.paths) paths.add(p);
        }
        return this.decodeAll([...paths]);
    }

    /** Decode unit VO cues (optional — normally lazy on first play). */
    preloadUnitSelects(): Promise<void> {
        const paths = new Set<string>();
        for (const [id, cue] of Object.entries(CUES)) {
            if (!id.startsWith('unit_')) continue;
            for (const p of cue.paths) paths.add(p);
        }
        return this.decodeAll([...paths]);
    }

    /**
     * Decode SFX/UI cue buffers. Music beds and unit/commander VO are
     * lazy-loaded on first play so boot (and a large VO roster) stay light.
     */
    preload(extraPaths: readonly string[] = []): Promise<void> {
        const paths = new Set<string>(extraPaths);
        for (const [id, cue] of Object.entries(CUES)) {
            if (cue.group === 'music') continue;
            if (id.startsWith('unit_') || id.startsWith('commander_')) continue;
            for (const p of cue.paths) paths.add(p);
        }
        return this.decodeAll([...paths]);
    }

    /** Decode one cue's paths (no-op if already buffered). */
    private async ensureCue(cueId: string): Promise<boolean> {
        const cue = CUES[cueId];
        if (!cue) return false;
        await this.decodeAll([...cue.paths]);
        return true;
    }

    /**
     * Place the ear over the board look-at (xz), with optional height.
     * Default y≈8 keeps a mild airborne offset; game raises y with camera
     * zoom so max-altitude orbits duck ground combat without orbit wobble.
     * {@link camAlt} is raw camera height above ground — hurt/death use it to
     * stay close-orbit only (they ignore the milder listenY blend).
     */
    setListener(x: number, z: number, y = 8, camAlt = 0): void {
        this.listenerX = x;
        this.listenerZ = z;
        this.listenerCamAlt = camAlt;
        const ctx = this.ctx;
        if (!ctx) return;
        const l = ctx.listener;
        if (l.positionX) {
            l.positionX.value = x;
            l.positionY.value = y;
            l.positionZ.value = z;
        } else {
            (l as AudioListener & { setPosition?: (x: number, y: number, z: number) => void }).setPosition?.(
                x,
                y,
                z,
            );
        }
    }

    setListenerOrientation(fx: number, fy: number, fz: number): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const l = ctx.listener;
        if (l.forwardX) {
            l.forwardX.value = fx;
            l.forwardY.value = fy;
            l.forwardZ.value = fz;
            l.upX.value = 0;
            l.upY.value = 1;
            l.upZ.value = 0;
        }
    }

    applyPrefs(): void {
        if (!this.ctx) return;
        const p = prefs();
        const mute = p.audioMuted ? 0 : 1;
        this.master.gain.value = mute * clamp01(p.masterVolume);
        const sfx = clamp01(p.sfxVolume);
        this.groups.sfx.gain.value = sfx * sfxTimeDuck(this.timeScale);
        this.loopBus.gain.value = sfx;
        this.groups.music.gain.value = clamp01(p.musicVolume);
        this.groups.ui.gain.value = clamp01(p.uiVolume);
        // mute stops the bed, unmute brings back whatever the state wants
        this.syncMusic();
    }

    /**
     * Match one-shot SFX to battle/replay speed.
     * Loops (fire/acid/beams) stay at real time and ignore the fast-forward duck.
     */
    setTimeScale(scale: number): void {
        const next = Number.isFinite(scale) ? Math.max(0, scale) : 1;
        if (Math.abs(next - this.timeScale) < 1e-4) return;
        this.timeScale = next;
        const oneShotRate = sfxPlaybackRate(next);
        for (const v of this.voices) {
            if (CUES[v.cueId]?.group !== 'sfx') continue;
            try {
                v.source.playbackRate.value = oneShotRate;
            } catch {
                /* ended */
            }
        }
        if (this.ctx) {
            this.groups.sfx.gain.value = clamp01(prefs().sfxVolume) * sfxTimeDuck(next);
        }
    }

    play(
        cueId: string,
        worldX?: number,
        worldZ?: number,
        opts?: CombatSpatialOpts,
    ): boolean {
        if (!this.unlocked) this.unlock();
        const cue = CUES[cueId];
        if (!cue || !this.ctx) return false;
        if (prefs().audioMuted) return false;

        const maxV = cue.maxVoices ?? 8;
        if ((this.voiceCount.get(cueId) ?? 0) >= maxV) return false;

        const maxD = opts?.maxDistance ?? cue.maxDistance ?? SPATIAL_MAX;
        if (cue.spatial && worldX != null && worldZ != null) {
            if (distXZ(worldX, worldZ, this.listenerX, this.listenerZ) > maxD) return false;
        }

        const path = this.pickCuePath(cueId, cue);
        let buf = this.buffers.get(path);
        if (!buf) {
            // New cues after boot / HMR — decode then play (same frame was silent).
            void this.ensureCue(cueId).then((ok) => {
                if (ok) this.play(cueId, worldX, worldZ, opts);
            });
            return false;
        }

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        if (cue.group === 'sfx') {
            src.playbackRate.value = sfxPlaybackRate(this.timeScale);
        }
        const gain = this.ctx.createGain();
        gain.gain.value = (cue.gain ?? 1) * (opts?.gainMul ?? 1);

        let panner: PannerNode | undefined;
        if (cue.spatial && worldX != null && worldZ != null) {
            panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = opts?.refDistance ?? cue.refDistance ?? SPATIAL_REF;
            panner.maxDistance = maxD;
            panner.rolloffFactor = opts?.rolloff ?? cue.rolloff ?? SPATIAL_ROLLOFF;
            panner.positionX.value = worldX;
            panner.positionY.value = 1.2;
            panner.positionZ.value = worldZ;
            src.connect(gain);
            gain.connect(panner);
            panner.connect(this.groups[cue.group]);
        } else {
            src.connect(gain);
            gain.connect(this.groups[cue.group]);
        }

        const voice: Voice = { cueId, source: src, gain, panner };
        this.voices.push(voice);
        this.voiceCount.set(cueId, (this.voiceCount.get(cueId) ?? 0) + 1);
        this.lastCuePath.set(cueId, path);

        src.onended = () => this.releaseVoice(voice);
        try {
            src.start(0);
        } catch {
            this.releaseVoice(voice);
            return false;
        }
        return true;
    }

    /**
     * Pick a variant path for a cue. With 2+ paths, never immediately
     * re-play the last one (random among the rest). Single-path cues unchanged.
     */
    private pickCuePath(cueId: string, cue: CueDef): string {
        const paths = cue.paths;
        if (paths.length <= 1) return paths[0]!;
        const last = this.lastCuePath.get(cueId);
        let pick = paths[(Math.random() * paths.length) | 0]!;
        if (pick === last) {
            // re-roll among the others
            const others = paths.filter((p) => p !== last);
            pick = others[(Math.random() * others.length) | 0]!;
        }
        return pick;
    }

    /**
     * Declare the bed the game's current state wants (`null` = silence).
     * Called from state changes only — menu shown, match started — never
     * from buttons. Playback follows on its own: it waits for the first
     * gesture's context, stops on mute and comes back on unmute, and asking
     * again for the bed already playing or loading changes nothing.
     */
    playMusic(cueId: string | null): void {
        this.wantedMusic = cueId;
        this.syncMusic();
    }

    /** make what plays match {@link wantedMusic} (and mute) */
    private syncMusic(): void {
        const want = prefs().audioMuted ? null : this.wantedMusic;
        const current = this.musicSource ? this.musicCueId : this.loadingMusic;
        if (want === current) return;
        const gen = ++this.musicGen;
        this.stopMusicImmediate();
        this.loadingMusic = null;
        // no context before the first gesture — unlock() syncs again then
        if (!want || !this.ctx) return;
        this.loadingMusic = want;
        void this.startMusic(want, gen);
    }

    get currentMusic(): string | null {
        return this.musicCueId;
    }

    private async startMusic(cueId: string, gen: number): Promise<void> {
        const cue = CUES[cueId];
        if (!cue || cue.group !== 'music') return;
        const path = this.pickCuePath(cueId, cue);
        if (!path) return;
        await this.decodeAll([path]);
        if (gen !== this.musicGen) return;
        this.loadingMusic = null;
        if (!this.ctx || prefs().audioMuted) return;
        const buf = this.buffers.get(path);
        if (!buf) return;
        this.lastCuePath.set(cueId, path);

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = this.ctx.createGain();
        const target = cue.gain ?? 0.4;
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this.groups.music);
        try {
            src.start(0);
        } catch {
            return;
        }
        const now = this.ctx.currentTime;
        gain.gain.linearRampToValueAtTime(target, now + 1.2);
        this.musicSource = src;
        this.musicGain = gain;
        this.musicCueId = cueId;
    }

    private stopMusicImmediate(): void {
        if (this.musicSource) {
            try {
                this.musicSource.stop();
            } catch {
                /* already stopped */
            }
            this.musicSource.disconnect();
            this.musicSource = null;
        }
        if (this.musicGain) {
            this.musicGain.disconnect();
            this.musicGain = null;
        }
        this.musicCueId = null;
    }

    /** Non-spatial UI / phase / match stings. */
    playUi(cueId: string): void {
        this.play(cueId);
    }

    /** Soft menu hover tick (fine pointer only — callers gate that). */
    playUiHover(): void {
        this.play('ui_hover');
    }

    /**
     * Cold-boot main-menu greeting. Gated by voicesEnabled. Call only when
     * landing on the title screen — not on match resume / reconnect.
     */
    playNarrationWelcome(): void {
        this.playNarrationCue('narration_welcome');
    }

    /** The Year intro cover when no rounds have been played yet. */
    playNarrationYearBegins(): void {
        this.playNarrationCue('narration_year_begins');
    }

    private playNarrationCue(cueId: string): void {
        if (!this.voicesOn()) return;
        const cue = CUES[cueId];
        if (!cue) return;
        if (!cue.paths.every((p) => isBaseAsset(p))) return;
        if (!this.unlocked) this.unlock();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /** True when spoken unit/commander VO may play (prefs toggle). */
    private voicesOn(): boolean {
        const p = prefs();
        return !p.audioMuted && p.voicesEnabled;
    }

    /** Human commander bark — stops any other commander VO so hover switches cleanly. */
    playCommanderPick(cardId: string): void {
        this.stopCommanderBarks();
        const cueId = `commander_${cardId}`;
        if (!CUES[cueId] || !this.voicesOn()) {
            this.playUi('card_pick');
            return;
        }
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
            else this.playUi('card_pick');
        });
    }

    /**
     * Enemy commander HUD bark (`commander_<id>_rival`) — same stop/switch
     * behavior as {@link playCommanderPick}, no select cooldown (hover-friendly).
     */
    playCommanderRivalPick(cardId: string): void {
        this.stopCommanderBarks();
        if (!this.voicesOn()) return;
        const cueId = `commander_${cardId}_rival`;
        if (!CUES[cueId]) return;
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Stronghold click bark: same cooldown as unit select, stops unit +
     * commander VO. No card_pick fallback (silent if cue missing).
     */
    playCommanderSelect(cardId: string): void {
        if (!this.voicesOn()) return;
        const cueId = `commander_${cardId}`;
        if (!CUES[cueId]) return;
        const now = performance.now();
        if (now - this.lastUnitSelectAt < UNIT_SELECT_COOLDOWN_MS) return;
        this.lastUnitSelectAt = now;
        this.stopUnitBarks();
        this.stopCommanderBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Enemy/ally stronghold click — cheeky {@link VoiceLineEvent} `pickRival`
     * bark (`commander_<id>_rival`). Silent until shipped.
     */
    playCommanderSelectRival(cardId: string): void {
        if (!this.voicesOn()) return;
        const cueId = `commander_${cardId}_rival`;
        if (!CUES[cueId]) return;
        const now = performance.now();
        if (now - this.lastUnitSelectAt < UNIT_SELECT_COOLDOWN_MS) return;
        this.lastUnitSelectAt = now;
        this.stopUnitBarks();
        this.stopCommanderBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Round-win taunt for a commander. Cue id `commander_<id>_win` with up to
     * three path variants — silent until those assets are shipped.
     */
    playCommanderWin(cardId: string): void {
        if (!this.voicesOn()) return;
        const cueId = `commander_${cardId}_win`;
        if (!CUES[cueId]) return;
        this.stopCommanderBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Match-win line for a commander (`commander_<id>_victory`). Longer than
     * round win. Silent until the ogg is shipped and listed in the asset
     * manifest (`assetUrl` + `npm run assets:manifest`).
     */
    playCommanderVictory(cardId: string): void {
        if (!this.voicesOn()) return;
        const cueId = `commander_${cardId}_victory`;
        const cue = CUES[cueId];
        if (!cue) return;
        if (!cue.paths.every((p) => isBaseAsset(p))) return;
        this.stopCommanderBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Match-loss line for a commander (`commander_<id>_defeat`).
     */
    playCommanderDefeat(cardId: string): void {
        if (!this.voicesOn()) return;
        const cueId = `commander_${cardId}_defeat`;
        const cue = CUES[cueId];
        if (!cue) return;
        if (!cue.paths.every((p) => isBaseAsset(p))) return;
        this.stopCommanderBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Unit pack select bark. Cue `unit_<typeId>`; aliases like
     * stronghold-archer → archer. Always tries when voices are on, but
     * cooldown keeps rapid re-selects from stacking. VO loads on first play.
     */
    playUnitSelect(typeId: string): void {
        if (!this.voicesOn()) return;
        const voiceId = UNIT_VOICE_ALIAS[typeId] ?? typeId;
        const cueId = `unit_${voiceId}`;
        if (!CUES[cueId]) return;
        const now = performance.now();
        if (now - this.lastUnitSelectAt < UNIT_SELECT_COOLDOWN_MS) return;
        if (Math.random() > UNIT_SELECT_CHANCE) return;
        this.lastUnitSelectAt = now;
        this.stopUnitBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Homepage / loadout testing: play the next select line for this unit (in
     * path order), then advance. One click → one bark. No random skip.
     */
    playUnitSelectNext(typeId: string): void {
        if (!this.voicesOn()) return;
        const voiceId = UNIT_VOICE_ALIAS[typeId] ?? typeId;
        const cueId = `unit_${voiceId}`;
        const cue = CUES[cueId];
        if (!cue || cue.paths.length === 0) return;
        const now = performance.now();
        // Short debounce only — intentional clicks should advance promptly.
        if (now - this.lastUnitSelectAt < 180) return;
        this.lastUnitSelectAt = now;
        const i = this.unitSelectNextIndex.get(voiceId) ?? 0;
        const path = cue.paths[i % cue.paths.length]!;
        this.unitSelectNextIndex.set(voiceId, i + 1);
        this.stopUnitBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (!ok) return;
            this.playCuePathUi(cueId, path);
        });
    }

    /**
     * Rival pack click — frech {@link VoiceLineEvent} `pickRival` bark
     * (`unit_<id>_rival`). Same cooldown as select; silent until shipped.
     */
    playUnitSelectRival(typeId: string): void {
        if (!this.voicesOn()) return;
        const voiceId = UNIT_VOICE_ALIAS[typeId] ?? typeId;
        const cueId = `unit_${voiceId}_rival`;
        if (!CUES[cueId]) return;
        const now = performance.now();
        if (now - this.lastUnitSelectAt < UNIT_SELECT_COOLDOWN_MS) return;
        this.lastUnitSelectAt = now;
        this.stopUnitBarks();
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Building select SFX (towers / tent). Normal UI group — not gated by
     * voicesEnabled. Shares the unit-select cooldown so rapid clicks stay tidy.
     */
    playBuildingSelect(typeId: string): void {
        const cueId = BUILDING_SELECT_CUE[typeId];
        if (!cueId || !CUES[cueId]) return;
        const now = performance.now();
        if (now - this.lastUnitSelectAt < UNIT_SELECT_COOLDOWN_MS) return;
        this.lastUnitSelectAt = now;
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.playUi(cueId);
        });
    }

    /**
     * Homepage / testing: play every shipped select + death + hurt line for a
     * unit in order (non-spatial UI), with a short gap. Loads only that unit's
     * clips. Switching units cancels.
     */
    playUnitVoPreview(typeId: string): void {
        if (!this.voicesOn()) return;
        const voiceId = UNIT_VOICE_ALIAS[typeId] ?? typeId;
        const cueIds = [
            `unit_${voiceId}`,
            `unit_${voiceId}_rival`,
            `unit_${voiceId}_death`,
            `unit_${voiceId}_hurt`,
        ];
        const queue: { cueId: string; path: string }[] = [];
        for (const id of cueIds) {
            const cue = CUES[id];
            if (!cue) continue;
            for (const path of cue.paths) queue.push({ cueId: id, path });
        }
        if (queue.length === 0) return;

        this.stopUnitBarks();
        const gen = ++this.unitPreviewGen;
        const gapMs = 150;
        const paths = queue.map((q) => q.path);

        void this.decodeAll(paths).then(() => {
            if (gen !== this.unitPreviewGen) return;
            const playNext = (i: number) => {
                if (gen !== this.unitPreviewGen) return;
                if (i >= queue.length) return;
                const item = queue[i]!;
                const dur = this.playCuePathUi(item.cueId, item.path);
                const waitMs = Math.max(200, (dur > 0 ? dur : 0.4) * 1000 + gapMs);
                window.setTimeout(() => playNext(i + 1), waitMs);
            };
            playNext(0);
        });
    }

    /**
     * Play one specific cue path as UI (ignores spatial). Returns buffer
     * duration in seconds, or 0 if it did not start.
     */
    private playCuePathUi(cueId: string, path: string): number {
        if (!this.unlocked) this.unlock();
        const cue = CUES[cueId];
        if (!cue || !this.ctx) return 0;
        if (prefs().audioMuted) return 0;
        const buf = this.buffers.get(path);
        if (!buf) return 0;

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const gain = this.ctx.createGain();
        gain.gain.value = cue.gain ?? 1;
        src.connect(gain);
        gain.connect(this.groups.ui);

        const voice: Voice = { cueId, source: src, gain };
        this.voices.push(voice);
        this.voiceCount.set(cueId, (this.voiceCount.get(cueId) ?? 0) + 1);
        src.onended = () => this.releaseVoice(voice);
        try {
            src.start(0);
        } catch {
            this.releaseVoice(voice);
            return 0;
        }
        return buf.duration;
    }

    /**
     * Merge size presence with close-cam altitude duck.
     * Returns null when the camera is too high (skip play).
     */
    private closeCamSpatialOpts(
        typeId: string | undefined,
    ): CombatSpatialOpts | null {
        const altMul = closeCamAltitudeGain(this.listenerCamAlt);
        if (altMul <= 0) return null;
        const base = sizeSpatialOpts(typeId);
        if (altMul >= 1) return base ?? {};
        return {
            ...base,
            gainMul: (base?.gainMul ?? 1) * altMul,
        };
    }

    /** Spatial death yelp when a voiced unit dies — silent until that cue ships. */
    playUnitDeath(typeId: string, worldX: number, worldZ: number): void {
        if (!this.voicesOn()) return;
        const voiceId = UNIT_VOICE_ALIAS[typeId] ?? typeId;
        const cueId = `unit_${voiceId}_death`;
        if (!CUES[cueId]) return;
        const opts = this.closeCamSpatialOpts(typeId);
        if (!opts) return;
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.play(cueId, worldX, worldZ, opts);
        });
    }

    /**
     * Short hurt yelp on a flesh hit. Near-field only (cue maxDistance) +
     * global cooldown so packs don't chorus. Silent until that unit's cue ships.
     * Scaled by {@link UnitType.soundSize}. Close-cam only — ducks in the sky.
     */
    playUnitHurt(typeId: string, worldX: number, worldZ: number): void {
        if (!this.voicesOn()) return;
        const voiceId = UNIT_VOICE_ALIAS[typeId] ?? typeId;
        const cueId = `unit_${voiceId}_hurt`;
        if (!CUES[cueId]) return;
        const now = performance.now();
        if (now - this.lastUnitHurtAt < UNIT_HURT_COOLDOWN_MS) return;
        const opts = this.closeCamSpatialOpts(typeId);
        if (!opts) return;
        const cue = CUES[cueId]!;
        const maxD = opts.maxDistance ?? cue.maxDistance ?? SPATIAL_MAX;
        if (distXZ(worldX, worldZ, this.listenerX, this.listenerZ) > maxD) return;
        this.lastUnitHurtAt = now;
        void this.ensureCue(cueId).then((ok) => {
            if (ok) this.play(cueId, worldX, worldZ, opts);
        });
    }

    /** Cut in-flight commander pick barks (hover preview / card change). */
    stopCommanderBarks(): void {
        for (const v of [...this.voices]) {
            if (!v.cueId.startsWith('commander_')) continue;
            try {
                v.source.stop();
            } catch {
                /* already ended */
            }
            this.releaseVoice(v);
        }
    }

    /** Cut in-flight unit select / preview barks. */
    stopUnitBarks(): void {
        this.unitPreviewGen++;
        for (const v of [...this.voices]) {
            if (!v.cueId.startsWith('unit_')) continue;
            try {
                v.source.stop();
            } catch {
                /* already ended */
            }
            this.releaseVoice(v);
        }
    }

    /** Attack-phase sting only — deploy / match reload stay silent. */
    playPhase(phase: 'deploy' | 'battle'): void {
        if (phase === 'battle') this.playUi('phase_battle');
    }

    playMatchEnd(result: 'victory' | 'defeat' | 'draw'): void {
        this.playUi(result === 'draw' ? 'draw_match' : result);
    }

    /** Soul hit on HP bar — short ethereal spirit tick scaled to wave tier. */
    playHpDrawHit(tier: 'low' | 'medium' | 'high'): void {
        this.playUi(
            tier === 'high' ? 'hp_draw_high' : tier === 'medium' ? 'hp_draw_medium' : 'hp_draw_low',
        );
    }

    /**
     * Keep convert / ramp beam loops in sync with live actors.
     * Sound sits at the ray muzzle; volume is near-field only.
     */
    syncBeamLoops(actors: readonly Actor[]): void {
        this.ensureLoopReady('convert_beam');
        this.ensureLoopReady('prism_hum');
        const lx = this.listenerX;
        const lz = this.listenerZ;
        let bestConvert = BEAM_LOOP_MAX_DIST + 1;
        let cx = lx;
        let cy = 1.5;
        let cz = lz;
        let bestRamp = BEAM_LOOP_MAX_DIST + 1;
        let rx = lx;
        let ry = 1.5;
        let rz = lz;
        for (const a of actors) {
            if (!a.alive || !a.convertRayActive) continue;
            const muzzle = beamMuzzleWorld(a);
            const d = distXZ(muzzle.x, muzzle.z, lx, lz);
            if (a.unit.type.rampBeam) {
                if (d < bestRamp) {
                    bestRamp = d;
                    rx = muzzle.x;
                    ry = muzzle.y;
                    rz = muzzle.z;
                }
            } else if (a.unit.type.convertRay) {
                if (d < bestConvert) {
                    bestConvert = d;
                    cx = muzzle.x;
                    cy = muzzle.y;
                    cz = muzzle.z;
                }
            }
        }
        this.setLoop('convert_beam', true, cx, cz, beamLoopVolume(bestConvert), cy);
        this.setLoop('prism_hum', true, rx, rz, beamLoopVolume(bestRamp), ry);
    }

    /**
     * Keep fire / acid crackle beds in sync with hazards near the listener.
     * Loudness = soft-saturating sum of per-cell XZ falloffs × camera-height
     * duck (zoomed-out / high in the sky stays quiet).
     */
    syncHazardLoops(
        hazards: {
            forEachFireCell: (
                now: number,
                fn: (x: number, z: number) => void,
            ) => void;
            forEachAcidCell: (fn: (x: number, z: number) => void) => void;
        } | null,
        now: number,
        cameraY = 40,
    ): void {
        if (!hazards) {
            this.setLoop('fire_loop', false, 0, 0, 0);
            this.setLoop('acid_loop', false, 0, 0, 0);
            return;
        }
        const lx = this.listenerX;
        const lz = this.listenerZ;
        const heightMul = hazardAltitudeGain(cameraY);
        if (heightMul < 0.02) {
            this.setLoop('fire_loop', false, 0, 0, 0);
            this.setLoop('acid_loop', false, 0, 0, 0);
            return;
        }
        let bestFire = FIRE_LOOP_MAX_DIST + 1;
        let fx = lx;
        let fz = lz;
        let fireEnergy = 0;
        hazards.forEachFireCell(now, (x, z) => {
            const d = distXZ(x, z, lx, lz);
            const cell = hazardCellFalloff(d, FIRE_LOOP_MAX_DIST);
            if (cell <= 0) return;
            fireEnergy += cell;
            if (d < bestFire) {
                bestFire = d;
                fx = x;
                fz = z;
            }
        });
        let bestAcid = ACID_LOOP_MAX_DIST + 1;
        let ax = lx;
        let az = lz;
        let acidEnergy = 0;
        hazards.forEachAcidCell((x, z) => {
            const d = distXZ(x, z, lx, lz);
            const cell = hazardCellFalloff(d, ACID_LOOP_MAX_DIST);
            if (cell <= 0) return;
            acidEnergy += cell;
            if (d < bestAcid) {
                bestAcid = d;
                ax = x;
                az = z;
            }
        });
        this.setLoop('fire_loop', true, fx, fz, hazardMassGain(fireEnergy) * heightMul);
        this.setLoop('acid_loop', true, ax, az, hazardMassGain(acidEnergy) * heightMul);
    }

    /**
     * Deployment hurry-up: one beep per whole second while remaining is in
     * (0, until] — i.e. at 5, 4, 3, 2, 1. Silent outside that window.
     */
    tickTimerWarn(phaseRemaining: number, until = 5): void {
        if (phaseRemaining <= 0 || phaseRemaining > until) {
            this.timerWarnSecond = -1;
            return;
        }
        const sec = Math.ceil(phaseRemaining);
        if (sec === this.timerWarnSecond) return;
        this.timerWarnSecond = sec;
        this.playUi('timer_warn');
    }

    private timerWarnSecond = -1;

    /** Stop convert / prism / hazard / stone-fly beds (battle end / tear-down). */
    stopBeamLoops(): void {
        this.setLoop('convert_beam', false, 0, 0, 0);
        this.setLoop('prism_hum', false, 0, 0, 0);
        this.setLoop('ramp_beam', false, 0, 0, 0);
        this.setLoop('fire_loop', false, 0, 0, 0);
        this.setLoop('acid_loop', false, 0, 0, 0);
        this.setLoop('stone_whistle', false, 0, 0, 0);
        this.setLoop('collapse_thunder', false, 0, 0, 0);
        this.setLoop('spell_dragon_approach', false, 0, 0, 0);
        this.setLoop('spell_dragon_breath', false, 0, 0, 0);
    }

    /**
     * Dragon flyover beds: wing whoosh while diving/strafing/exiting, breath
     * while the fire tube is spitting/pouring/shrinking. Positions follow the
     * mesh; pass null to stop.
     */
    syncDragonLoops(
        approach: { x: number; z: number; y: number; volume?: number } | null,
        breath: { x: number; z: number; y: number; volume?: number } | null,
    ): void {
        this.ensureLoopReady('spell_dragon_approach');
        this.ensureLoopReady('spell_dragon_breath');
        if (approach) {
            this.setLoop(
                'spell_dragon_approach',
                true,
                approach.x,
                approach.z,
                approach.volume ?? 1,
                approach.y,
            );
        } else {
            this.setLoop('spell_dragon_approach', false, 0, 0, 0);
        }
        if (breath) {
            this.setLoop(
                'spell_dragon_breath',
                true,
                breath.x,
                breath.z,
                breath.volume ?? 1,
                breath.y,
            );
        } else {
            this.setLoop('spell_dragon_breath', false, 0, 0, 0);
        }
    }

    /** Decode a loop cue if the buffer is not yet ready (first flyover after boot). */
    private ensureLoopReady(cueId: string): void {
        const cue = CUES[cueId];
        const path = cue?.paths[0];
        if (!path || this.buffers.get(path)) return;
        void this.ensureCue(cueId);
    }

    /**
     * Proximity bed on the expanding stronghold-collapse rim (fire/acid family).
     * Loudest when the camera is near the dust front; keeps playing at 0× speed.
     */
    syncCollapseThunder(
        fronts: readonly { x: number; z: number; radius: number }[],
    ): void {
        const lx = this.listenerX;
        const lz = this.listenerZ;
        let bestRim = COLLAPSE_THUNDER_MAX_DIST + 1;
        let sx = lx;
        let sz = lz;
        let energy = 0;
        for (const f of fronts) {
            const dCenter = distXZ(f.x, f.z, lx, lz);
            const rimDist = Math.abs(dCenter - f.radius);
            const cell = hazardCellFalloff(rimDist, COLLAPSE_THUNDER_MAX_DIST);
            if (cell <= 0) continue;
            energy += cell;
            if (rimDist < bestRim) {
                bestRim = rimDist;
                // park the bed on the nearest point on the rim
                if (dCenter < 1e-3) {
                    sx = f.x + f.radius;
                    sz = f.z;
                } else {
                    const s = f.radius / dCenter;
                    sx = f.x + (lx - f.x) * s;
                    sz = f.z + (lz - f.z) * s;
                }
            }
        }
        this.setLoop('collapse_thunder', true, sx, sz, hazardMassGain(energy));
    }

    /**
     * Proximity bed while ballistic stones fly near the camera (same pattern
     * as fire/acid). One loop; mild rate nudge from climb vs dive — mostly constant.
     */
    syncStoneWhistles(projectiles: readonly Projectile[]): void {
        // Temporarily off — set true to restore the in-flight stone whistle bed.
        if (!STONE_WHISTLE_ENABLED) {
            this.setLoop('stone_whistle', false, 0, 0, 0);
            return;
        }
        const lx = this.listenerX;
        const lz = this.listenerZ;
        let best = STONE_FLY_MAX_DIST + 1;
        let sx = lx;
        let sy = 8;
        let sz = lz;
        let energy = 0;
        let nearestVy = 0;
        for (const p of projectiles) {
            if (p.style !== 'stone' || !p.gravity) continue;
            if (p.stone?.rolling) continue;
            if (p.stone?.landed && p.y < (p.stone.radius ?? 0.5) + 0.4) continue;
            const d = distXZ(p.x, p.z, lx, lz);
            const cell = hazardCellFalloff(d, STONE_FLY_MAX_DIST);
            if (cell <= 0) continue;
            energy += cell;
            if (d < best) {
                best = d;
                sx = p.x;
                sy = Math.max(1, p.y);
                sz = p.z;
                nearestVy = p.vy;
            }
        }
        // Tiny climb/dive bias (~±8%) so it stays “constant” but reads direction.
        const rate = 1 + Math.max(-0.08, Math.min(0.08, nearestVy * 0.004));
        this.setLoop(
            'stone_whistle',
            true,
            sx,
            sz,
            hazardMassGain(energy),
            sy,
            rate,
        );
    }

    /**
     * UI feedback for a human {@link dispatchPlayer} attempt.
     * Returns without sound for silent kinds (move/rotate) or when `ok` and
     * the caller will play a richer cue (e.g. deploy levelup bursts).
     */
    playPlayerAction(kind: string, ok: boolean): void {
        if (!ok) {
            this.playUi('ui_deny');
            return;
        }
        const cue = playerActionCue(kind);
        if (cue) this.playUi(cue);
    }

    private setLoop(
        cueId: string,
        on: boolean,
        x: number,
        z: number,
        volume = 1,
        y = 1.5,
        playbackRate = 1,
    ): void {
        const existing = this.loops.get(cueId);
        const cue = CUES[cueId];
        const level = clamp01(volume) * (cue?.gain ?? 0.4);
        if (!on || level < 0.02) {
            if (existing) {
                try {
                    existing.source.stop();
                } catch {
                    /* noop */
                }
                existing.source.disconnect();
                existing.gain.disconnect();
                existing.panner?.disconnect();
                this.loops.delete(cueId);
            }
            return;
        }
        if (existing) {
            existing.gain.gain.value = level;
            existing.source.playbackRate.value = playbackRate;
            if (existing.panner) {
                existing.panner.positionX.value = x;
                existing.panner.positionY.value = y;
                existing.panner.positionZ.value = z;
            }
            return;
        }
        if (!this.unlocked) this.unlock();
        if (!cue || !this.ctx || prefs().audioMuted) return;
        const path = cue.paths[0];
        if (!path) return;
        const buf = this.buffers.get(path);
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.playbackRate.value = playbackRate;
        const gain = this.ctx.createGain();
        gain.gain.value = level;
        let panner: PannerNode | undefined;
        if (cue.spatial) {
            panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = cue.refDistance ?? 4;
            panner.maxDistance = cue.maxDistance ?? 22;
            panner.rolloffFactor = cue.rolloff ?? 1.4;
            panner.positionX.value = x;
            panner.positionY.value = y;
            panner.positionZ.value = z;
            src.connect(gain);
            gain.connect(panner);
            panner.connect(this.loopBus);
        } else {
            src.connect(gain);
            gain.connect(this.loopBus);
        }
        try {
            src.start(0);
        } catch {
            return;
        }
        this.loops.set(cueId, { source: src, gain, panner });
    }

    /** Battle SimEvents → spatial SFX. */
    spawnFromEvents(events: readonly SimEvent[]): void {
        // One Mario-style powerup for the whole batch (unit or multi-upgrade)
        let levelup = false;
        for (const e of events) {
            switch (e.kind) {
                case 'muzzle':
                    this.play(muzzleCue(e.style, e.unitTypeId), e.x, e.z);
                    break;
                case 'meleeSwing':
                    // Ogre smash plays on cleave slam (explosion/impact), not windup.
                    if (e.unitTypeId === 'ogre') break;
                    this.play('melee_swing', e.x, e.z, meleeSwingOpts(e.unitTypeId));
                    break;
                case 'impact': {
                    if (e.melee && e.attackerTypeId === 'ogre') {
                        this.play('ogre_smash', e.x, e.z);
                        if (e.flesh && e.unitTypeId) this.playUnitHurt(e.unitTypeId, e.x, e.z);
                        break;
                    }
                    const cue = impactCue(e);
                    // Melee contact uses melee hear ranges; other flesh hits keep sizeSpatialOpts.
                    const opts = e.melee
                        ? meleeHitOpts(e.unitTypeId)
                        : e.flesh
                          ? sizeSpatialOpts(e.unitTypeId)
                          : undefined;
                    this.play(cue, e.x, e.z, opts);
                    if (e.flesh && e.unitTypeId) this.playUnitHurt(e.unitTypeId, e.x, e.z);
                    break;
                }
                case 'explosion':
                    if (e.unitTypeId === 'ogre') {
                        this.play('ogre_smash', e.x, e.z);
                        break;
                    }
                    this.play(
                        e.rocket
                            ? 'rocket_blast'
                            : e.fire
                              ? 'explosion_fire'
                              : e.heavy
                                ? 'explosion_heavy'
                                : 'explosion',
                        e.x,
                        e.z,
                    );
                    break;
                case 'death':
                    if (e.structure) {
                        const cue = structureDeathCue(e.unitTypeId);
                        if (cue) this.play(cue); // global — no spatial falloff
                    } else {
                        // soundSize drives which death bank + presence (VFX still uses e.big).
                        // Close-cam only — sky orbits keep shots, not body thuds / yelps.
                        const closeOpts = this.closeCamSpatialOpts(e.unitTypeId);
                        if (closeOpts) {
                            const size = soundSizeOf(e.unitTypeId);
                            this.play(
                                size === 'large' ? 'death_unit_big' : 'death_unit',
                                e.x,
                                e.z,
                                closeOpts,
                            );
                            if (e.unitTypeId) this.playUnitDeath(e.unitTypeId, e.x, e.z);
                        }
                    }
                    break;
                case 'strongholdCollapse':
                    this.play('stronghold_collapse');
                    break;
                case 'towerDebuff':
                    this.play('tower_debuff', e.x, e.z);
                    break;
                case 'levelup':
                    levelup = true;
                    break;
                case 'summon':
                    this.play(e.flying ? 'summon_flying' : 'summon_ground', e.x, e.z);
                    break;
                case 'convert':
                    this.play('convert', e.x, e.z);
                    break;
                case 'groundFire':
                    this.play('ground_fire', e.x, e.z);
                    break;
                case 'hazardDrip': {
                    const drop =
                        e.hazard === 'oil'
                            ? 'spell_oil_drop'
                            : e.hazard === 'acid'
                              ? // Poison Cloud acidRain sets dripScale; Acid Spill does not.
                                e.dripScale != null
                                  ? 'spell_acid_rain'
                                  : 'spell_acid_drop'
                              : e.hazard === 'fire'
                                ? 'spell_fire_drop'
                                : 'hazard_drip';
                    this.play(drop, e.x, e.z);
                    break;
                }
                case 'spellLightning':
                    this.play('spell_lightning', e.x, e.z);
                    break;
                case 'spellMeteor':
                    this.play('spell_meteor_fall', e.x, e.z);
                    break;
                case 'hammerCrush':
                    this.play('hammer_crush');
                    break;
                default:
                    break;
            }
        }
        if (levelup) this.playUi('levelup');
    }

    private releaseVoice(voice: Voice): void {
        const i = this.voices.indexOf(voice);
        if (i >= 0) this.voices.splice(i, 1);
        const n = (this.voiceCount.get(voice.cueId) ?? 1) - 1;
        if (n <= 0) this.voiceCount.delete(voice.cueId);
        else this.voiceCount.set(voice.cueId, n);
        try {
            voice.source.disconnect();
            voice.gain.disconnect();
            voice.panner?.disconnect();
        } catch {
            /* noop */
        }
    }

    private ensureCtx(): AudioContext {
        if (this.ctx) return this.ctx;
        const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.groups = {
            sfx: this.ctx.createGain(),
            music: this.ctx.createGain(),
            ui: this.ctx.createGain(),
        };
        this.loopBus = this.ctx.createGain();
        this.groups.sfx.connect(this.master);
        this.loopBus.connect(this.master);
        this.groups.music.connect(this.master);
        this.groups.ui.connect(this.master);
        this.applyPrefs();
        if (!this.unsubPrefs) {
            this.unsubPrefs = onPrefsChange(() => this.applyPrefs());
        }
        const l = this.ctx.listener;
        if (l.forwardX) {
            l.forwardX.value = 0;
            l.forwardY.value = -0.35;
            l.forwardZ.value = -1;
            l.upX.value = 0;
            l.upY.value = 1;
            l.upZ.value = 0;
        }
        return this.ctx;
    }

    private async decodeAll(paths: string[]): Promise<void> {
        this.ensureCtx();
        await Promise.all(
            paths.map(async (path) => {
                if (this.buffers.has(path)) return;
                let inflight = this.inflightDecode.get(path);
                if (!inflight) {
                    inflight = (async () => {
                        try {
                            const res = await fetch(assetUrl(path));
                            const raw = await res.arrayBuffer();
                            const buf = await this.ctx!.decodeAudioData(raw.slice(0));
                            this.buffers.set(path, buf);
                        } catch (err) {
                            console.warn(`[audio] failed to load ${path}`, err);
                        } finally {
                            this.inflightDecode.delete(path);
                        }
                    })();
                    this.inflightDecode.set(path, inflight);
                }
                await inflight;
            }),
        );
    }
}

function structureDeathCue(unitTypeId: string | undefined): string | null {
    switch (unitTypeId) {
        case 'command-tower':
            return 'death_command_tower';
        case 'research-center':
            return 'death_research_center';
        case 'tent':
            return 'death_tent';
        case 'shield':
            return 'death_shield';
        case 'stronghold':
            // Covered by stronghold_collapse — avoid double bang
            return null;
        default:
            return 'death_structure';
    }
}

function muzzleCue(
    style: 'bolt' | 'arrow' | 'largeArrow' | 'stone' | 'orb' | undefined,
    unitTypeId: string | undefined,
): string {
    if (unitTypeId === 'rocket') return 'rocket_launch';
    if (unitTypeId === 'hammerer') return 'hammerer_smash';
    if (unitTypeId === 'mortar') return 'mortar_shot';
    switch (style) {
        case 'largeArrow':
            return 'ballista_shot';
        case 'bolt':
            return 'bolt_shot';
        case 'orb':
            return 'orb_shot';
        case 'stone':
            return 'stone_throw';
        case 'arrow':
            // Goblins share the archer clip bank but a quieter cue (many small shots).
            if (unitTypeId === 'goblin') return 'goblin_shot';
            return 'archer_shot';
        default:
            return 'archer_shot';
    }
}

function impactCue(e: Extract<SimEvent, { kind: 'impact' }>): string {
    if (e.melee) return 'melee_hit';
    if (e.ward) return 'impact_ward';
    if (e.dropStone) return 'impact_stone_drop';
    if (e.masonry) return 'impact_masonry';
    if (e.flesh) return 'impact_flesh';
    if (e.sod) return 'impact_ground';
    return 'impact_ground';
}

/** Success cues for human actions. `null` = silent (caller plays richer SFX). */
function playerActionCue(kind: string): string | null {
    switch (kind) {
        case 'chooseCard':
            return null; // voice bark via playCommanderPick
        case 'roundCard':
            return 'card_pick';
        case 'forgeLight':
            return 'forge_light';
        case 'sellUnit':
            return 'tactic_sell';
        case 'mobilizeUnit':
            return 'tactic_move';
        case 'tutorUnit':
            return 'tactic_tutor';
        case 'placeRallyRoute':
            return 'tactic_rally';
        case 'move':
        case 'moveGroup':
        case 'rotate':
        case 'endDeployment':
        case 'removeSpell':
        case 'removeRallyRoute':
        case 'removeOilSpill':
        case 'removeItem':
        case 'forgeRemove':
        case 'forgeUnlight':
        case 'buyLevel':
        case 'buyLevelBatch':
        case 'applyItem':
        case 'forfeitSide':
        case 'clearArmy':
            return null;
        default:
            return 'ui_confirm';
    }
}

function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
}

function distXZ(ax: number, az: number, bx: number, bz: number): number {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.hypot(dx, dz);
}

/** Fire: hear it from a bit farther out. */
const FIRE_LOOP_MAX_DIST = 28;
/** Acid: tighter — only loud when actually over it, not from high orbit. */
const ACID_LOOP_MAX_DIST = 16;
/** Ballistic stones — hear the air whoosh when flying near the camera. */
const STONE_FLY_MAX_DIST = 36;
/** Temporary mute for the stone fly bed (mortar / Stormcaller). */
const STONE_WHISTLE_ENABLED = false;
/** Stronghold collapse dust front — thunder bed near the expanding rim. */
const COLLAPSE_THUNDER_MAX_DIST = 30;

function hazardCellFalloff(dist: number, maxDist: number): number {
    if (dist >= maxDist) return 0;
    const t = 1 - dist / maxDist;
    // cubic — stays quiet until closer, then ramps
    return t * t * t;
}

/**
 * Soft-saturating gain from summed per-cell falloffs.
 * One cell underfoot ≈ 0.75; a few nearby cells fill toward 1 without clipping.
 */
function hazardMassGain(energy: number): number {
    if (energy <= 0) return 0;
    return 1 - Math.exp(-energy * 1.4);
}

/**
 * Quiet hazard beds when the camera is high (default zoom ~75 → height ~60).
 * Low orbit / close-in stays full; bird's-eye drops out.
 */
function hazardAltitudeGain(cameraY: number): number {
    const fullBelow = 36;
    const silentAbove = 110;
    if (cameraY <= fullBelow) return 1;
    if (cameraY >= silentAbove) return 0;
    const t = 1 - (cameraY - fullBelow) / (silentAbove - fullBelow);
    return t * t;
}

/**
 * Hurt / death body cues — close orbit only. Stricter than the listenY blend
 * used for attacks: mid zoom already fades, high sky is silent.
 */
function closeCamAltitudeGain(camAlt: number): number {
    const fullBelow = 26;
    const silentAbove = 72;
    if (camAlt <= fullBelow) return 1;
    if (camAlt >= silentAbove) return 0;
    const t = 1 - (camAlt - fullBelow) / (silentAbove - fullBelow);
    return t * t;
}

/** Prism / convert beams — loud when near the caster; hear a bit farther than before. */
const BEAM_LOOP_MAX_DIST = 32;

function beamLoopVolume(dist: number): number {
    if (dist >= BEAM_LOOP_MAX_DIST) return 0;
    const t = 1 - dist / BEAM_LOOP_MAX_DIST;
    return t * t; // gentler than cubic — stays audible at mid range
}

/**
 * SFX one-shot rate vs battle speed: stretch in slo-mo, natural pitch when fast.
 * Near-zero freezes in-flight one-shots. Loops never use this.
 */
function sfxPlaybackRate(scale: number): number {
    if (scale <= 0) return 0.0001;
    if (scale < 1) return Math.max(0.05, scale);
    return 1;
}

/** Soft one-shot SFX duck above 1× so fast-forward stays readable. */
function sfxTimeDuck(scale: number): number {
    if (scale <= 1) return 1;
    return 1 / Math.sqrt(scale);
}

/** Singleton — one bus for the whole app. */
export const audio = new AudioBus();

/**
 * Music bed resolver — menu, default battle, or seasonal phase tracks.
 * Year-tour beats with deploy+battle variants; others fall back to music_battle.
 */
export function resolveMusicBed(opts: {
    scene: 'menu' | 'match';
    /** Year-tour atmosphere label, e.g. `Spring morning`. */
    atmosphereLabel?: string | null;
    /** Match phase — picks deploy vs battle seasonal bed when available. */
    phase?: 'deploy' | 'battle';
    season?: string;
    mode?: string;
}): string {
    void opts.season;
    void opts.mode;
    if (opts.scene === 'menu') return 'music_menu';
    const seasonal: Record<string, { deploy: string; battle: string }> = {
        'Spring morning': {
            deploy: 'music_spring_morning_deploy',
            battle: 'music_spring_morning_battle',
        },
        'Spring rain': {
            deploy: 'music_spring_rain_deploy',
            battle: 'music_spring_rain_battle',
        },
        'Summer noon': {
            deploy: 'music_summer_noon_deploy',
            battle: 'music_summer_noon_battle',
        },
        'Summer golden': {
            deploy: 'music_summer_golden_deploy',
            battle: 'music_summer_golden_battle',
        },
        'Summer night': {
            deploy: 'music_summer_night_deploy',
            battle: 'music_summer_night_battle',
        },
        'Autumn dusk': {
            deploy: 'music_autumn_dusk_deploy',
            battle: 'music_autumn_dusk_battle',
        },
        'Autumn storm': {
            deploy: 'music_autumn_storm_deploy',
            battle: 'music_autumn_storm_battle',
        },
        'First snow': {
            deploy: 'music_first_snow_deploy',
            battle: 'music_first_snow_battle',
        },
        'Deep winter': {
            deploy: 'music_deep_winter_deploy',
            battle: 'music_deep_winter_battle',
        },
    };
    const pair = opts.atmosphereLabel ? seasonal[opts.atmosphereLabel] : undefined;
    if (pair) {
        const cue = opts.phase === 'battle' ? pair.battle : pair.deploy;
        if (CUES[cue]) return cue;
    }
    return 'music_battle';
}

export function playMenuMusic(): void {
    audio.playMusic(resolveMusicBed({ scene: 'menu' }));
}

export function playMatchMusic(opts?: {
    atmosphereLabel?: string | null;
    phase?: 'deploy' | 'battle';
    season?: string;
    mode?: string;
}): void {
    audio.playMusic(resolveMusicBed({ scene: 'match', ...opts }));
}

export function registerCue(id: string, def: CueDef): void {
    CUES[id] = def;
}

export function cueIds(): string[] {
    return Object.keys(CUES);
}
