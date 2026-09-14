/**
 * Campaigns that ship with the game: every folder under `assets/campaign/` is
 * a level package — `meta.jsonc` (name, level order) plus
 * `scenarios/<id>.jsonc` — bundled into the build and loaded like any other
 * scenario package when one of its levels is played.
 *
 * Progress is kept per machine: which levels of which package were won,
 * keyed by package id and scenario id, so editing a level's file keeps it
 * completed.
 */
import type { OverlayFile } from './assets';
import { loadLevel, supersedeLevel, summarizeLevel, type LevelRef, type LevelSummary } from './level';

const RAW = import.meta.glob('../../assets/campaign/**/*.jsonc', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const FOLDER = '/assets/campaign/';

export interface BuiltInCampaign {
    /** the folder name — also the package id */
    id: string;
    files: OverlayFile[];
}

let campaigns: BuiltInCampaign[] | null = null;

/** Every bundled campaign, by folder name. */
export function builtInCampaigns(): BuiltInCampaign[] {
    if (campaigns) return campaigns;
    const byId = new Map<string, OverlayFile[]>();
    const encoder = new TextEncoder();
    for (const [path, text] of Object.entries(RAW).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const inside = path.slice(path.indexOf(FOLDER) + FOLDER.length);
        const slash = inside.indexOf('/');
        if (slash < 0) continue;
        const id = inside.slice(0, slash);
        const list = byId.get(id) ?? [];
        list.push({ path: inside.slice(slash + 1), bytes: encoder.encode(text) });
        byId.set(id, list);
    }
    campaigns = [...byId].map(([id, files]) => ({ id, files }));
    return campaigns;
}

/** Is this package one of the bundled campaigns? */
export function isBuiltInCampaign(packageId: string): boolean {
    return builtInCampaigns().some((c) => c.id === packageId);
}

/** A bundled campaign's name and levels in order, without loading it. */
export function campaignSummary(campaign: BuiltInCampaign): LevelSummary {
    return summarizeLevel({ id: campaign.id, hash: '' }, campaign.files);
}

const loaded = new Map<string, Promise<LevelRef>>();

/** Load a bundled campaign as a level package (once per session); older copies of it leave the cache. */
export function campaignLevel(campaign: BuiltInCampaign): Promise<LevelRef> {
    let ref = loaded.get(campaign.id);
    if (!ref) {
        ref = loadLevel(campaign.id, campaign.files).then(async ({ ref }) => {
            await supersedeLevel(ref, Infinity);
            return ref;
        });
        ref.catch(() => loaded.delete(campaign.id));
        loaded.set(campaign.id, ref);
    }
    return ref;
}

// ---- progress

const PROGRESS_KEY = 'melodan-campaign-progress';

type Progress = Record<string, string[]>;

function readProgress(): Progress {
    try {
        const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as unknown;
        return raw && typeof raw === 'object' ? (raw as Progress) : {};
    } catch {
        return {};
    }
}

/** The scenario ids of a package the player has won. */
export function completedLevels(packageId: string): ReadonlySet<string> {
    const list = readProgress()[packageId];
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
}

/** Remember a won level. */
export function markLevelCompleted(packageId: string, scenarioId: string): void {
    const progress = readProgress();
    const list = new Set(Array.isArray(progress[packageId]) ? progress[packageId] : []);
    if (list.has(scenarioId)) return;
    list.add(scenarioId);
    progress[packageId] = [...list];
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
        /* private browsing: progress isn't kept */
    }
}
