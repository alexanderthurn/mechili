/**
 * `meta.jsonc` — optional information about a package: its name, author,
 * cover, and the order and progression of its scenarios (plan §4.1, §9.4).
 * A package without it is simply a collection of scenarios, listed by file.
 * Campaign play comes later: today the file is validated, and the
 * progression fields are reserved for it.
 */
export interface PackageMetaLevel {
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

export interface PackageMeta {
    version: 1;
    id: string;
    name: string;
    description?: string;
    author?: string;
    /** image path inside the package, e.g. `ui/cover.webp` */
    cover?: string;
    /** played in this order */
    levels: PackageMetaLevel[];
}
