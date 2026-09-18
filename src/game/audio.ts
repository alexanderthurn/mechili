/**
 * Web Audio bus for Melodan: groups (master / sfx / music / ui), cue variants,
 * concurrent voice caps (pooling), and distance attenuation for battlefield SFX.
 *
 * Render-only — never touch from the deterministic sim. Drive from SimEvent
 * drain + UI, same lifecycle as particles.
 */
import { assetUrl } from './assets';
import type { Projectile, SimEvent } from './sim';
import { onPrefsChange, prefs } from './prefs';
import { beamMuzzleWorld } from './conversionFx';
import type { Actor } from './sim';

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
        maxVoices: 10,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    ballista_shot: {
        paths: [
            'audio/ballista_shot_1.ogg',
            'audio/ballista_shot_2.ogg',
            'audio/ballista_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 6,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    bolt_shot: {
        paths: [
            'audio/bolt_shot_1.ogg',
            'audio/bolt_shot_2.ogg',
            'audio/bolt_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
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
    commander_addi: {
        paths: ['audio/commander_addi.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_air: {
        paths: ['audio/commander_air.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_archer: {
        paths: ['audio/commander_archer.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_cost: {
        paths: ['audio/commander_cost.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_elite: {
        paths: ['audio/commander_elite.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_flanky: {
        paths: ['audio/commander_flanky.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_giant: {
        paths: ['audio/commander_giant.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_meteor: {
        paths: ['audio/commander_meteor.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.95,
    },
    commander_money: {
        paths: ['audio/commander_money.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_speed: {
        paths: ['audio/commander_speed.ogg'],
        group: 'ui',
        maxVoices: 1,
        gain: 0.85,
    },
    commander_tutor: {
        paths: ['audio/commander_tutor.ogg'],
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
        refDistance: 4,
        maxDistance: 22,
        rolloff: 1.4,
        gain: 0.32,
    },
    death_structure: {
        paths: [
            'audio/death_structure_1.ogg',
            'audio/death_structure_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    death_unit: {
        paths: [
            'audio/death_unit_1.ogg',
            'audio/death_unit_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    death_unit_big: {
        paths: [
            'audio/death_unit_big_1.ogg',
            'audio/death_unit_big_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
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
            'audio/hammer_crush_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    hammerer_smash: {
        paths: [
            'audio/hammerer_smash_1.ogg',
            'audio/hammerer_smash_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
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
    hp_draw: {
        paths: [
            'audio/hp_draw_1.ogg',
            'audio/hp_draw_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    impact_flesh: {
        paths: [
            'audio/impact_flesh_1.ogg',
            'audio/impact_flesh_2.ogg',
            'audio/impact_flesh_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 14,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
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
    impact_ward: {
        paths: [
            'audio/impact_ward_1.ogg',
            'audio/impact_ward_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    levelup: {
        paths: [
            'audio/levelup_1.ogg',
            'audio/levelup_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    melee_hit: {
        paths: [
            'audio/melee_hit_1.ogg',
            'audio/melee_hit_2.ogg',
            'audio/melee_hit_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    melee_swing: {
        paths: [
            'audio/melee_swing_1.ogg',
            'audio/melee_swing_2.ogg',
            'audio/melee_swing_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 10,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    /** Siege mortar tube fire — not the generic stone_throw (crow/hammerer). */
    mortar_shot: {
        paths: [
            'audio/mortar_shot_1.ogg',
            'audio/mortar_shot_2.ogg',
            'audio/mortar_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.7,
    },
    /** Default match bed — later: music_battle_winter / horde / etc. */
    music_battle: {
        paths: ['audio/music_battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** Main menu bed — later: seasonal menu variants. */
    music_menu: {
        paths: ['audio/music_menu_1.ogg'],
        group: 'music',
        gain: 0.42,
    },
    orb_shot: {
        paths: [
            'audio/orb_shot_1.ogg',
            'audio/orb_shot_2.ogg',
            'audio/orb_shot_3.ogg',
        ],
        group: 'sfx',
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
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
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
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
    spell_dragon_approach: {
        paths: [
            'audio/spell_dragon_approach_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    spell_dragon_breath: {
        paths: [
            'audio/spell_dragon_breath_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.7,
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
        maxVoices: 8,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 0.55,
    },
    /** Seamless airplane-air whoosh — proximity bed (same family as fire/acid). */
    stone_whistle: {
        paths: ['audio/stone_whistle_1.ogg'],
        group: 'sfx',
        maxVoices: 1,
        gain: 0.55,
    },
    stronghold_collapse: {
        paths: [
            'audio/stronghold_collapse_1.ogg',
            'audio/stronghold_collapse_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 2,
        spatial: true,
        refDistance: SPATIAL_REF,
        maxDistance: SPATIAL_MAX,
        rolloff: SPATIAL_ROLLOFF,
        gain: 1.0,
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
        paths: [
            'audio/ui_click_1.ogg',
            'audio/ui_click_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.35,
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
    assetUrl('audio/commander_air.ogg'),
    assetUrl('audio/commander_archer.ogg'),
    assetUrl('audio/commander_cost.ogg'),
    assetUrl('audio/commander_elite.ogg'),
    assetUrl('audio/commander_flanky.ogg'),
    assetUrl('audio/commander_giant.ogg'),
    assetUrl('audio/commander_meteor.ogg'),
    assetUrl('audio/commander_money.ogg'),
    assetUrl('audio/commander_speed.ogg'),
    assetUrl('audio/commander_tutor.ogg'),
    assetUrl('audio/convert_1.ogg'),
    assetUrl('audio/convert_2.ogg'),
    assetUrl('audio/convert_beam_1.ogg'),
    assetUrl('audio/death_structure_1.ogg'),
    assetUrl('audio/death_structure_2.ogg'),
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
    assetUrl('audio/hammer_crush_2.ogg'),
    assetUrl('audio/hammerer_smash_1.ogg'),
    assetUrl('audio/hammerer_smash_2.ogg'),
    assetUrl('audio/hazard_drip_1.ogg'),
    assetUrl('audio/hazard_drip_2.ogg'),
    assetUrl('audio/hazard_drip_3.ogg'),
    assetUrl('audio/hp_draw_1.ogg'),
    assetUrl('audio/hp_draw_2.ogg'),
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
    assetUrl('audio/levelup_1.ogg'),
    assetUrl('audio/levelup_2.ogg'),
    assetUrl('audio/melee_hit_1.ogg'),
    assetUrl('audio/melee_hit_2.ogg'),
    assetUrl('audio/melee_hit_3.ogg'),
    assetUrl('audio/melee_swing_1.ogg'),
    assetUrl('audio/melee_swing_2.ogg'),
    assetUrl('audio/melee_swing_3.ogg'),
    assetUrl('audio/mortar_shot_1.ogg'),
    assetUrl('audio/mortar_shot_2.ogg'),
    assetUrl('audio/mortar_shot_3.ogg'),
    assetUrl('audio/music_battle_1.ogg'),
    assetUrl('audio/music_menu_1.ogg'),
    assetUrl('audio/orb_shot_1.ogg'),
    assetUrl('audio/orb_shot_2.ogg'),
    assetUrl('audio/orb_shot_3.ogg'),
    assetUrl('audio/phase_gong_1.ogg'),
    assetUrl('audio/phase_gong_2.ogg'),
    assetUrl('audio/collapse_thunder_1.ogg'),
    assetUrl('audio/ramp_beam_1.ogg'),
    assetUrl('audio/rocket_blast_1.ogg'),
    assetUrl('audio/rocket_blast_2.ogg'),
    assetUrl('audio/rocket_launch_1.ogg'),
    assetUrl('audio/rocket_launch_2.ogg'),
    assetUrl('audio/spell_acid_spill_1.ogg'),
    assetUrl('audio/spell_dragon_approach_1.ogg'),
    assetUrl('audio/spell_dragon_breath_1.ogg'),
    assetUrl('audio/spell_fire_spill_1.ogg'),
    assetUrl('audio/spell_lightning_1.ogg'),
    assetUrl('audio/spell_lightning_2.ogg'),
    assetUrl('audio/spell_lightning_3.ogg'),
    assetUrl('audio/spell_meteor_fall_1.ogg'),
    assetUrl('audio/spell_meteor_fall_2.ogg'),
    assetUrl('audio/spell_oil_spill_1.ogg'),
    assetUrl('audio/spell_poison_cloud_1.ogg'),
    assetUrl('audio/spell_storm_1.ogg'),
    assetUrl('audio/stone_throw_1.ogg'),
    assetUrl('audio/stone_throw_2.ogg'),
    assetUrl('audio/stone_throw_3.ogg'),
    assetUrl('audio/stone_whistle_1.ogg'),
    assetUrl('audio/stronghold_collapse_1.ogg'),
    assetUrl('audio/stronghold_collapse_2.ogg'),
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
    assetUrl('audio/ui_click_1.ogg'),
    assetUrl('audio/ui_click_2.ogg'),
    assetUrl('audio/ui_confirm_1.ogg'),
    assetUrl('audio/ui_confirm_2.ogg'),
    assetUrl('audio/ui_deny_1.ogg'),
    assetUrl('audio/ui_deny_2.ogg'),
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
    private buffers = new Map<string, AudioBuffer>();
    private voices: Voice[] = [];
    private voiceCount = new Map<string, number>();
    private listenerX = 0;
    private listenerZ = 0;
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
     * Decode SFX/UI cue buffers. Music beds are lazy-loaded on
     * {@link playMusic} so boot stays light.
     */
    preload(extraPaths: readonly string[] = []): Promise<void> {
        const paths = new Set<string>(extraPaths);
        for (const cue of Object.values(CUES)) {
            if (cue.group === 'music') continue;
            for (const p of cue.paths) paths.add(p);
        }
        return this.decodeAll([...paths]);
    }

    setListener(x: number, z: number): void {
        this.listenerX = x;
        this.listenerZ = z;
        const ctx = this.ctx;
        if (!ctx) return;
        const l = ctx.listener;
        if (l.positionX) {
            l.positionX.value = x;
            l.positionY.value = 8;
            l.positionZ.value = z;
        } else {
            (l as AudioListener & { setPosition?: (x: number, y: number, z: number) => void }).setPosition?.(
                x,
                8,
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

    play(cueId: string, worldX?: number, worldZ?: number): boolean {
        if (!this.unlocked) this.unlock();
        const cue = CUES[cueId];
        if (!cue || !this.ctx) return false;
        if (prefs().audioMuted) return false;

        const maxV = cue.maxVoices ?? 8;
        if ((this.voiceCount.get(cueId) ?? 0) >= maxV) return false;

        if (cue.spatial && worldX != null && worldZ != null) {
            const maxD = cue.maxDistance ?? SPATIAL_MAX;
            if (distXZ(worldX, worldZ, this.listenerX, this.listenerZ) > maxD) return false;
        }

        const path = cue.paths[(Math.random() * cue.paths.length) | 0]!;
        const buf = this.buffers.get(path);
        if (!buf) return false;

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        if (cue.group === 'sfx') {
            src.playbackRate.value = sfxPlaybackRate(this.timeScale);
        }
        const gain = this.ctx.createGain();
        gain.gain.value = cue.gain ?? 1;

        let panner: PannerNode | undefined;
        if (cue.spatial && worldX != null && worldZ != null) {
            panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = cue.refDistance ?? SPATIAL_REF;
            panner.maxDistance = cue.maxDistance ?? SPATIAL_MAX;
            panner.rolloffFactor = cue.rolloff ?? SPATIAL_ROLLOFF;
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
        await this.decodeAll([...cue.paths]);
        if (gen !== this.musicGen) return;
        this.loadingMusic = null;
        if (!this.ctx || prefs().audioMuted) return;
        const path = cue.paths[0];
        if (!path) return;
        const buf = this.buffers.get(path);
        if (!buf) return;

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

    /** Human commander pick bark — falls back to card_pick if unknown. */
    playCommanderPick(cardId: string): void {
        const cueId = `commander_${cardId}`;
        if (CUES[cueId]) this.playUi(cueId);
        else this.playUi('card_pick');
    }

    playPhase(phase: 'deploy' | 'battle'): void {
        this.playUi(phase === 'deploy' ? 'phase_deploy' : 'phase_battle');
    }

    playMatchEnd(result: 'victory' | 'defeat' | 'draw'): void {
        this.playUi(result === 'draw' ? 'draw_match' : result);
    }

    /**
     * Keep convert / ramp beam loops in sync with live actors.
     * Sound sits at the ray muzzle; volume is near-field only.
     */
    syncBeamLoops(actors: readonly Actor[]): void {
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
        this.setLoop('ramp_beam', true, rx, rz, beamLoopVolume(bestRamp), ry);
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

    /** Stop convert / ramp / hazard / stone-fly beds (battle end / tear-down). */
    stopBeamLoops(): void {
        this.setLoop('convert_beam', false, 0, 0, 0);
        this.setLoop('ramp_beam', false, 0, 0, 0);
        this.setLoop('fire_loop', false, 0, 0, 0);
        this.setLoop('acid_loop', false, 0, 0, 0);
        this.setLoop('stone_whistle', false, 0, 0, 0);
        this.setLoop('collapse_thunder', false, 0, 0, 0);
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
        for (const e of events) {
            switch (e.kind) {
                case 'muzzle':
                    this.play(muzzleCue(e.style, e.unitTypeId), e.x, e.z);
                    break;
                case 'meleeSwing':
                    this.play('melee_swing', e.x, e.z);
                    break;
                case 'impact':
                    this.play(impactCue(e), e.x, e.z);
                    break;
                case 'explosion':
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
                    this.play(
                        e.structure ? 'death_structure' : e.big ? 'death_unit_big' : 'death_unit',
                        e.x,
                        e.z,
                    );
                    break;
                case 'strongholdCollapse':
                    this.play('stronghold_collapse', e.x, e.z);
                    break;
                case 'towerDebuff':
                    this.play('tower_debuff', e.x, e.z);
                    break;
                case 'levelup':
                    this.play('levelup', e.x, e.z);
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
                case 'hazardDrip':
                    this.play('hazard_drip', e.x, e.z);
                    break;
                case 'spellLightning':
                    this.play('spell_lightning', e.x, e.z);
                    break;
                case 'spellMeteor':
                    this.play('spell_meteor_fall', e.x, e.z);
                    break;
                case 'hammerCrush':
                    this.play('hammer_crush', e.x, e.z);
                    break;
                default:
                    break;
            }
        }
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
                try {
                    const res = await fetch(assetUrl(path));
                    const raw = await res.arrayBuffer();
                    const buf = await this.ctx!.decodeAudioData(raw.slice(0));
                    this.buffers.set(path, buf);
                } catch (err) {
                    console.warn(`[audio] failed to load ${path}`, err);
                }
            }),
        );
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

/** Prism / convert beams — only loud when nearly on top of the caster. */
const BEAM_LOOP_MAX_DIST = 20;

function beamLoopVolume(dist: number): number {
    if (dist >= BEAM_LOOP_MAX_DIST) return 0;
    const t = 1 - dist / BEAM_LOOP_MAX_DIST;
    return t * t * t; // steeper than hazards — “super close” only
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
 * Music bed resolver — today menu vs match; later season / mode variants
 * (e.g. `music_battle_winter`, `music_menu_horde`) plug in here.
 */
export function resolveMusicBed(opts: {
    scene: 'menu' | 'match';
    season?: string;
    mode?: string;
}): string {
    void opts.season;
    void opts.mode;
    return opts.scene === 'menu' ? 'music_menu' : 'music_battle';
}

export function playMenuMusic(): void {
    audio.playMusic(resolveMusicBed({ scene: 'menu' }));
}

export function playMatchMusic(opts?: { season?: string; mode?: string }): void {
    audio.playMusic(resolveMusicBed({ scene: 'match', ...opts }));
}

export function registerCue(id: string, def: CueDef): void {
    CUES[id] = def;
}

export function cueIds(): string[] {
    return Object.keys(CUES);
}
