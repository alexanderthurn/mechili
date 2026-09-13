/**
 * `campaign.jsonc` — the optional order and progression over a package's
 * scenarios (plan §9.4). A package without it is simply a collection of
 * scenarios; one with it is also a campaign. Campaign mode itself comes later:
 * today the file is validated, and the fields below are reserved for it.
 */
export interface CampaignLevel {
    /** id of `scenarios/<id>.jsonc` in the same package */
    scenario: string;
    title?: string;
    /** text shown before the level */
    briefing?: string;
    /** what the player takes into the next level (not applied yet) */
    carryOver?: 'none' | 'army' | 'army+supply';
    /** units that stay unlocked from this level on (not applied yet) */
    unlocks?: string[];
}

export interface CampaignDef {
    version: 1;
    id: string;
    name: string;
    description?: string;
    author?: string;
    /** image path inside the package, e.g. `ui/campaign-cover.webp` */
    cover?: string;
    /** played in this order */
    levels: CampaignLevel[];
}
