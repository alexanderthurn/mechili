/**
 * Web Audio bus for Melodan: groups (master / sfx / music / ui), cue variants,
 * concurrent voice caps (pooling), and distance attenuation for battlefield SFX.
 *
 * Render-only — never touch from the deterministic sim. Drive from SimEvent
 * drain + UI, same lifecycle as particles.
 */
import { assetUrl } from './assets';
import type { SimEvent } from './sim';
import { onPrefsChange, prefs } from './prefs';

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

const CUES: Record<string, CueDef> = {
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
    convert: {
        paths: [
            'audio/convert_1.ogg',
            'audio/convert_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    convert_beam: {
        paths: [
            'audio/convert_beam_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.4,
    },
    death_structure: {
        paths: [
            'audio/death_structure_1.ogg',
            'audio/death_structure_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
    ground_fire: {
        paths: [
            'audio/ground_fire_1.ogg',
            'audio/ground_fire_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    /** Default match bed — later: music_battle_winter / horde / etc. */
    music_battle: {
        paths: ['audio/music/battle_1.ogg'],
        group: 'music',
        gain: 0.38,
    },
    /** Main menu bed — later: seasonal menu variants. */
    music_menu: {
        paths: ['audio/music/menu_1.ogg'],
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    phase_battle: {
        paths: [
            'audio/phase_battle_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.42,
    },
    phase_deploy: {
        paths: [
            'audio/phase_deploy_1.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.4,
    },
    ramp_beam: {
        paths: [
            'audio/ramp_beam_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.45,
    },
    rocket_blast: {
        paths: [
            'audio/rocket_blast_1.ogg',
            'audio/rocket_blast_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    spell_acid_spill: {
        paths: [
            'audio/spell_acid_spill_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    spell_dragon_approach: {
        paths: [
            'audio/spell_dragon_approach_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    spell_dragon_breath: {
        paths: [
            'audio/spell_dragon_breath_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.7,
    },
    spell_fire_spill: {
        paths: [
            'audio/spell_fire_spill_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    spell_oil_spill: {
        paths: [
            'audio/spell_oil_spill_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    spell_poison_cloud: {
        paths: [
            'audio/spell_poison_cloud_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    spell_storm: {
        paths: [
            'audio/spell_storm_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.55,
    },
    stronghold_collapse: {
        paths: [
            'audio/stronghold_collapse_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
        gain: 0.85,
    },
    summon_flying: {
        paths: [
            'audio/summon_flying_1.ogg',
            'audio/summon_flying_2.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
            'audio/timer_warn_1.ogg',
            'audio/timer_warn_2.ogg',
        ],
        group: 'ui',
        maxVoices: 2,
        gain: 0.5,
    },
    tower_debuff: {
        paths: [
            'audio/tower_debuff_1.ogg',
        ],
        group: 'sfx',
        maxVoices: 4,
        spatial: true,
        refDistance: 12,
        maxDistance: 55,
        rolloff: 1.1,
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
    assetUrl('audio/music/battle_1.ogg'),
    assetUrl('audio/music/menu_1.ogg'),
    assetUrl('audio/orb_shot_1.ogg'),
    assetUrl('audio/orb_shot_2.ogg'),
    assetUrl('audio/orb_shot_3.ogg'),
    assetUrl('audio/phase_battle_1.ogg'),
    assetUrl('audio/phase_deploy_1.ogg'),
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
    assetUrl('audio/stronghold_collapse_1.ogg'),
    assetUrl('audio/summon_flying_1.ogg'),
    assetUrl('audio/summon_flying_2.ogg'),
    assetUrl('audio/summon_ground_1.ogg'),
    assetUrl('audio/summon_ground_2.ogg'),
    assetUrl('audio/tactic_move_1.ogg'),
    assetUrl('audio/tactic_rally_1.ogg'),
    assetUrl('audio/tactic_sell_1.ogg'),
    assetUrl('audio/tactic_tutor_1.ogg'),
    assetUrl('audio/timer_warn_1.ogg'),
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
    private unsubPrefs: (() => void) | null = null;
    /** Sustained beam loops keyed by cue id. */
    private loops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();

    /** Idempotent — call from first pointer/click and again at match start. */
    unlock(): void {
        const ctx = this.ensureCtx();
        if (ctx.state === 'suspended') void ctx.resume();
        this.unlocked = true;
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
        this.groups.sfx.gain.value = clamp01(p.sfxVolume);
        this.groups.music.gain.value = clamp01(p.musicVolume);
        this.groups.ui.gain.value = clamp01(p.uiVolume);
    }

    play(cueId: string, worldX?: number, worldZ?: number): boolean {
        if (!this.unlocked) this.unlock();
        const cue = CUES[cueId];
        if (!cue || !this.ctx) return false;
        if (prefs().audioMuted) return false;

        const maxV = cue.maxVoices ?? 8;
        if ((this.voiceCount.get(cueId) ?? 0) >= maxV) return false;

        if (cue.spatial && worldX != null && worldZ != null) {
            const maxD = cue.maxDistance ?? 50;
            if (distXZ(worldX, worldZ, this.listenerX, this.listenerZ) > maxD) return false;
        }

        const path = cue.paths[(Math.random() * cue.paths.length) | 0]!;
        const buf = this.buffers.get(path);
        if (!buf) return false;

        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const gain = this.ctx.createGain();
        gain.gain.value = cue.gain ?? 1;

        let panner: PannerNode | undefined;
        if (cue.spatial && worldX != null && worldZ != null) {
            panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = cue.refDistance ?? 10;
            panner.maxDistance = cue.maxDistance ?? 50;
            panner.rolloffFactor = cue.rolloff ?? 1;
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
     * Start / switch / stop a looping music bed.
     * Pass `null` to stop. Beds lazy-load; a newer call cancels an older load.
     */
    playMusic(cueId: string | null): void {
        if (cueId === this.musicCueId && this.musicSource) return;
        const gen = ++this.musicGen;
        this.stopMusicImmediate();
        if (!cueId) return;
        if (!this.unlocked) this.unlock();
        if (prefs().audioMuted) {
            // Remember intent so unmute / later unlock can resume if desired —
            // for now just leave stopped; caller can playMusic again.
            return;
        }
        void this.startMusic(cueId, gen);
    }

    get currentMusic(): string | null {
        return this.musicCueId;
    }

    private async startMusic(cueId: string, gen: number): Promise<void> {
        const cue = CUES[cueId];
        if (!cue || cue.group !== 'music') return;
        await this.decodeAll([...cue.paths]);
        if (gen !== this.musicGen) return;
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

    playPhase(phase: 'deploy' | 'battle'): void {
        this.playUi(phase === 'deploy' ? 'phase_deploy' : 'phase_battle');
    }

    playMatchEnd(result: 'victory' | 'defeat' | 'draw'): void {
        this.playUi(result === 'draw' ? 'draw_match' : result);
    }

    /**
     * Keep convert / ramp beam loops in sync with live actors.
     * Call once per battle frame after sim update.
     */
    syncBeamLoops(
        actors: readonly {
            alive: boolean;
            convertRayActive?: boolean;
            unit: { type: { convertRay?: unknown; rampBeam?: unknown } };
            x: number;
            z: number;
        }[],
    ): void {
        let convert = false;
        let ramp = false;
        let cx = 0;
        let cz = 0;
        let rx = 0;
        let rz = 0;
        let cn = 0;
        let rn = 0;
        for (const a of actors) {
            if (!a.alive || !a.convertRayActive) continue;
            if (a.unit.type.rampBeam) {
                ramp = true;
                rx += a.x;
                rz += a.z;
                rn++;
            } else if (a.unit.type.convertRay) {
                convert = true;
                cx += a.x;
                cz += a.z;
                cn++;
            }
        }
        this.setLoop('convert_beam', convert, cn ? cx / cn : 0, cn ? cz / cn : 0);
        this.setLoop('ramp_beam', ramp, rn ? rx / rn : 0, rn ? rz / rn : 0);
    }

    /** Edge-trigger timer warning when remaining seconds first enter `<= until`. */
    tickTimerWarn(phaseRemaining: number, until = 5): void {
        if (phaseRemaining <= 0 || phaseRemaining > until) {
            this.timerWarnArmed = true;
            return;
        }
        if (this.timerWarnArmed) {
            this.timerWarnArmed = false;
            this.playUi('timer_warn');
        }
    }

    private timerWarnArmed = true;

    /** Stop convert / ramp beam loops (battle end / tear-down). */
    stopBeamLoops(): void {
        this.setLoop('convert_beam', false, 0, 0);
        this.setLoop('ramp_beam', false, 0, 0);
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

    private setLoop(cueId: string, on: boolean, _x: number, _z: number): void {
        const existing = this.loops.get(cueId);
        if (!on) {
            if (existing) {
                try {
                    existing.source.stop();
                } catch {
                    /* noop */
                }
                existing.source.disconnect();
                existing.gain.disconnect();
                this.loops.delete(cueId);
            }
            return;
        }
        if (existing) return;
        if (!this.unlocked) this.unlock();
        const cue = CUES[cueId];
        if (!cue || !this.ctx || prefs().audioMuted) return;
        const path = cue.paths[0];
        if (!path) return;
        const buf = this.buffers.get(path);
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = cue.gain ?? 0.4;
        src.connect(gain);
        gain.connect(this.groups[cue.group]);
        try {
            src.start(0);
        } catch {
            return;
        }
        this.loops.set(cueId, { source: src, gain });
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
        this.groups.sfx.connect(this.master);
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
