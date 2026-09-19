/**
 * The specialist system: before round 1 each player picks a SPECIALIST card
 * — a starting army (equal total value), a starting HP pool, a permanent
 * speciality, and possibly pack items. Between rounds, round cards are
 * offered; the live offer currently draws advanced runes only.
 *
 * Commanders and round cards are data (`assets/data/commanders`,
 * `assets/data/roundCards`, rune cards from `assets/data/runes`), served by the
 * match's {@link TypeRegistry}. What a speciality DOES stays code here and in
 * the game — `speciality` in the data names one.
 *
 * Each specialist also unlocks a small set of Stronghold forge spells
 * ({@link StartCard.forgeSpells}); teammates share the union of those lists.
 */

import { DISPLAY } from './displayNames';
import { t, tacticDescription, tacticName } from '../i18n';
import type { TypeRegistry } from './content/typeRegistry';
import { forgeIngredientIcons } from './forgeRecipes';

/**
 * A commander's identity (portrait art, telemetry, the hidden tutorial
 * commanders). What a commander DOES is its `effects`.
 */
export type SpecialityId =
    | 'air'
    | 'costControl'
    | 'elite'
    | 'archer'
    | 'addi'
    | 'flanky'
    | 'meteor'
    | 'speed'
    | 'giant'
    | 'tutor'
    | 'money'
    /** also The Komtur's side in The Year — fields the forest roster (her own shop) */
    | 'cursed'
    /** Hidden tutorial-only commander — never offered in normal pools. */
    | 'tutorial';

/** round a commander's gifted tactic charges (StartCard.tactics) land in, unless the card says otherwise */
export const SPECIALITY_TACTIC_ROUND = 2;

/**
 * Shop unlock fee for a seat, after its commander's discount. The dispatcher,
 * the shop UI and the AI all price through this — they must agree or a seat
 * sees a price it cannot pay (or the AI hoards for a fee it no longer owes).
 */
export function unlockCostFor(typeId: string, commander: StartCard | null, types: TypeRegistry): number {
    const base = types.unlockCost(typeId);
    if (!Number.isFinite(base)) return base;
    const discount = commander?.effects?.unlockDiscount;
    if (discount && base >= discount.from) return Math.max(0, base - discount.amount);
    return base;
}

/** flank spawn duration multiplier of the Flanky round card */
export const FLANK_SPAWN_HALF_MULT = 0.5;

/** skipping the between-round card pays this instead */
export const SKIP_CARD_REWARD = 50;

/** a between-round card: picked from a random 4 at each round start (round 2+) */
export interface RoundCard {
    id: string;
    title: string;
    /** supply price (0 = free) */
    cost: number;
    /** free units spawned on pick (movable that round) */
    units?: string[];
    unitsLabel?: string;
    /** items granted into the inventory */
    items?: string[];
    /** tactical order charges granted into the tactics strip */
    tactics?: string[];
    /** halves flank spawn time for the rest of the match */
    flankSpawnHalf?: boolean;
    /** which offer pool deals it: `units` / `spells` from data/roundCards, `runes` from data/runes */
    pool: RoundCardDrawPool;
    description: string;
}

/** shuffle in place with the given rng */
function shuffleInPlace<T>(deck: T[], rng: () => number): void {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
}

/** Which catalog slice a between-round offer draws from. */
export type RoundCardDrawPool = 'runes' | 'units' | 'spells';

/**
 * Between-round offer: shuffle the configured pool and take up to `offerCount`.
 * The rune pool defaults to **advanced** runes only (bases are shop / forge).
 */
export function drawRoundCardOffer(
    types: TypeRegistry,
    rng: () => number,
    opts?: {
        itemIds?: readonly string[];
        offerCount?: number;
        pool?: RoundCardDrawPool;
    },
): RoundCard[] {
    const pool = opts?.pool ?? 'runes';
    let deck = types.roundCardsInPool(pool);
    if (pool === 'runes') {
        const allowed = new Set(opts?.itemIds?.length ? opts.itemIds : types.advancedRuneIds);
        deck = deck.filter((c) => allowed.has(c.id));
    }
    if (deck.length === 0) return [];
    const shuffled = [...deck];
    shuffleInPlace(shuffled, rng);
    const n = Math.max(1, opts?.offerCount ?? shuffled.length);
    return shuffled.slice(0, Math.min(n, shuffled.length));
}

/** Classify a round card for offer-title wording. */
export function roundCardKind(c: RoundCard): 'rune' | 'unit' | 'spell' | 'other' {
    if (c.items?.length) return 'rune';
    if (c.units?.length) return 'unit';
    if (c.tactics?.length) return 'spell';
    return 'other';
}

/**
 * Title for the between-round picker. When every offered card is the same
 * kind: "Choose your rune" / "Choose your unit pack" / "Choose your spell"; mixed
 * offers stay generic.
 */
export function roundOfferTitle(cards: readonly RoundCard[]): string {
    if (cards.length === 0) return t('hud:chooseCard');
    const kinds = new Set(cards.map(roundCardKind));
    if (kinds.size !== 1) return t('hud:chooseCard');
    switch ([...kinds][0]) {
        case 'rune':
            return `Choose your ${DISPLAY.item.toLowerCase()}`;
        case 'unit':
            return 'Choose your unit pack';
        case 'spell':
            return `Choose your ${DISPLAY.tactic.toLowerCase()}`;
        default:
            return t('hud:chooseCard');
    }
}
/** atlas icon for a round-card face (rune / tactic / Flanky) */
export function roundCardIcon(c: RoundCard, types: TypeRegistry): string | null {
    const itemId = c.items?.[0];
    if (itemId) return types.rune(itemId)?.icon ?? null;
    const tacticId = c.tactics?.[0];
    if (tacticId) return types.tactic(tacticId)?.icon ?? null;
    if (c.flankSpawnHalf) return 'spec-flanky';
    return null;
}

/** A buyable army type id — see {@link TypeRegistry.shopUnitIds} for the match's list. */
export type ShopUnitId = string;

/** Commander effects; any combination works. Numbers here are what the card face text promises. */
export interface CommanderEffects {
    /** flying units: attack and HP × (1 + this) — Sky Sorcerer 0.12 */
    flyingBonus?: number;
    /** every non-structure unit: attack and HP × (1 + this) — Greedy Prince −0.12 */
    unitStatsBonus?: number;
    /** supply credited at the start of every round — Greedy Prince 100 */
    incomePerRound?: number;
    /** extra supply at the start of round 1 — Elite Prince 100, Money Queen 200 */
    roundOneSupply?: number;
    /** level new units are recruited at, permanently — Elite Prince 2 */
    recruitLevel?: number;
    /** one free unit arriving in a round — Archer Commander: a level-3 archer in round 2 */
    giftUnit?: { typeId: string; level: number; round: number };
    /** one free unit of this type every round — Cursed Christine's Black Brood spider */
    unitEachRound?: string;
    /** flat movement bonus for every moving non-structure unit, after runes — Speedy Widow 3 */
    speedBonus?: number;
    /** shop unlocks costing at least `from` are `amount` cheaper — Countess Chonk 200 / 200 */
    unlockDiscount?: { from: number; amount: number };
    /** multiplier on first-time flank spawn duration — Flanky Shadow 0.5 */
    flankSpawnMult?: number;
}

export interface StartCard {
    id: string;
    title: string;
    /** atlas portrait for the specialist card face (`spec-*`) */
    portrait: string;
    /** starting army as unit type ids — every card totals 500 supply */
    units: string[];
    /** the army, human-readable, for the card face */
    unitsLabel: string;
    startingHp: number;
    /** what this commander does — a behaviour the game code implements */
    speciality: SpecialityId;
    /** the signature unit this commander can buy even if it is not in the starting army */
    unlock?: string;
    /**
     * This commander's own shop — the unit types its side can ever buy or
     * unlock, instead of the normal shop (e.g. The Komtur's forest roster,
     * whose units are otherwise not buyable). Omit = the normal shop.
     */
    shop?: string[];
    /** what the commander does in a match — each effect is code, the numbers are the commander's */
    effects?: CommanderEffects;
    /** pack items granted into the player's inventory */
    items?: string[];
    /**
     * Tactic charges this commander is gifted — NOT at pick time: they arrive
     * at the start of a round, like the archer's free unit.
     */
    tactics?: string[];
    /** which round {@link tactics} lands in (default {@link SPECIALITY_TACTIC_ROUND}) */
    tacticsRound?: number;
    /**
     * Stronghold forge spells this specialist unlocks (tactic ids).
     * Teammates share the union. One 1-rune, one 2-rune, one 3-rune spell.
     */
    forgeSpells: string[];
    description: string;
    /**
     * Spoken VO casting + lines (authoring / future gen). Runtime still plays
     * shipped cues; `externalIds` are for regen tools.
     */
    voice?: EntityVoice;
}

/**
 * Provider-agnostic spoken voice block (commanders now; units/spells later).
 * English lines live here as regen defaults; locales may override via i18n.
 */
export type VoiceProviderType = 'e';

/** Spoken bark events — expand as select / death / scream land. */
export type VoiceLineEvent = 'pick';

/** One provider voice binding — `type: "e"` = ElevenLabs. */
export interface VoiceExternalId {
    type: VoiceProviderType;
    /** Provider voice id; omit until Voice Design has created one. */
    id?: string;
    /** Voice-design prompt used to create this id; omit for stock library voices. */
    prompt?: string;
}

export interface EntityVoice {
    /** Provider voice ids used by regen / casting tools. */
    externalIds: VoiceExternalId[];
    /** English (and future locale-overridable) line pools per event. */
    lines?: Partial<Record<VoiceLineEvent, string[]>>;
}

/** atlas icons for a specialist's forge spell row */
export function startCardForgeIcons(
    card: StartCard,
    types: TypeRegistry,
): { icon: string; name: string; desc: string; cost?: number; ingredientIcons: string[] }[] {
    const out: {
        icon: string;
        name: string;
        desc: string;
        cost?: number;
        ingredientIcons: string[];
    }[] = [];
    for (const id of card.forgeSpells) {
        const def = types.tactic(id);
        if (def) {
            out.push({
                icon: def.icon,
                name: tacticName(id, def.name),
                desc: tacticDescription(id, def.description),
                // what this commander's own Stronghold charges for it
                cost: def.strongholdCost,
                ingredientIcons: forgeIngredientIcons(types, id),
            });
        }
    }
    return out;
}

/** Hidden tutorial commanders (`hiddenCommanders` in pack.jsonc), picked by the lessons. */
export const TUTORIAL_START_CARD_ID = 'tutorial';
export const TUTORIAL_2_START_CARD_ID = 'tutorial2';
export const TUTORIAL_3_START_CARD_ID = 'tutorial3';
export const TUTORIAL_4_START_CARD_ID = 'tutorial4';
export const TUTORIAL_5_START_CARD_ID = 'tutorial5';
/** hidden commander a scenario without commanders picks for every seat */
export const NO_COMMANDER_CARD_ID = 'none';

/** starter packs + the commander's signature unit (tutorial commanders have neither) */
export function starterUnlockedUnits(card: StartCard, types: TypeRegistry): ShopUnitId[] {
    const ids = new Set<ShopUnitId>(card.units);
    if (card.unlock !== undefined) ids.add(card.unlock);
    return types.shopFor(card).filter((id) => ids.has(id));
}
