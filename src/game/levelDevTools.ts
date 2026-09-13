/**
 * Dev-only console helpers for trying a level folder before the level screen
 * exists (dev builds only — see main.ts):
 *
 *   await melodanLevel.pick()    choose a folder laid out like assets/
 *                                (data/models/…, models/…, textures/…)
 *   await melodanLevel.clear()   back to the base game
 *   melodanLevel.active()        what is loaded now
 *
 * Switch in the main menu, then start a match. Files and model data (scale,
 * yaw, animation clips) apply; unit and building definitions are validated
 * but matches keep the base definitions until the scenario boot hands the
 * level's registry to the Game.
 */
import { buildAssetOverlay, type OverlayFile, type OverlayReport } from './assets';
import { activeLevel, switchLevel, type ActiveLevel } from './level';

type DirHandle = {
    name: string;
    kind: 'directory';
    values(): AsyncIterable<DirHandle | FileHandle>;
};
type FileHandle = { name: string; kind: 'file'; getFile(): Promise<File> };

async function readFolder(dir: DirHandle, prefix: string, out: OverlayFile[]): Promise<OverlayFile[]> {
    for await (const handle of dir.values()) {
        if (handle.name.startsWith('.')) continue;
        const path = `${prefix}${handle.name}`;
        if (handle.kind === 'directory') await readFolder(handle, `${path}/`, out);
        else out.push({ path, bytes: await (await handle.getFile()).arrayBuffer() });
    }
    return out;
}

export function installLevelDevTools(): void {
    const tools = {
        async pick(): Promise<OverlayReport> {
            const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> })
                .showDirectoryPicker;
            if (!picker) throw new Error('[level] needs showDirectoryPicker (Chromium / Electron)');
            const dir = await picker.call(window);
            const files = await readFolder(dir, '', []);
            const overlay = await buildAssetOverlay(dir.name, files);
            const { replaced, added, unreferenced, invalid } = overlay.report;
            console.info(`[level] '${dir.name}': ${files.length} files, hash ${overlay.hash.slice(0, 12)}`);
            console.info('[level] replaced', replaced, 'added', added);
            if (unreferenced.length > 0) console.warn('[level] nothing refers to', unreferenced);
            if (invalid.length > 0) console.warn('[level] ignored (bad paths)', invalid);
            if ([...replaced, ...added].some((p) => /^data\/(units|buildings|pack\.jsonc)/.test(p))) {
                console.warn('[level] unit/building definitions are validated but matches still use the base ones');
            }
            await switchLevel(overlay);
            console.info(`[level] '${dir.name}' is active — start a match`);
            return overlay.report;
        },
        async clear(): Promise<void> {
            await switchLevel(null);
            console.info('[level] base game');
        },
        active(): ActiveLevel {
            return activeLevel();
        },
    };
    (window as unknown as { melodanLevel: typeof tools }).melodanLevel = tools;
    console.info('[level] dev: melodanLevel.pick() / melodanLevel.clear()');
}
