/**
 * Dev-only console helpers for trying a level before scenarios have a real
 * home (dev builds only — see main.ts). The Custom Game screen can also load a
 * zip in web builds.
 *
 *   await melodanLevel.pick()      choose a folder laid out like assets/
 *                                  (data/…, models/…, textures/…)
 *   await melodanLevel.clear()     back to the base game
 *   melodanLevel.active()          what is loaded now
 *
 * A picked level stays active; a Custom Game started afterwards plays it.
 */
import type { OverlayFile, OverlayReport } from './assets';
import { activeLevel, loadLevel, prepareLevel, type ActiveLevel } from './level';

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
            const { ref, report } = await loadLevel(dir.name, files);
            console.info(`[level] '${ref.id}': ${files.length} files, hash ${ref.hash.slice(0, 12)}`);
            console.info('[level] replaced', report.replaced, 'added', report.added);
            if (report.unreferenced.length > 0) console.warn('[level] nothing refers to', report.unreferenced);
            if (report.invalid.length > 0) console.warn('[level] ignored (bad paths)', report.invalid);
            await prepareLevel(ref);
            console.info(`[level] '${ref.id}' is active — start a Custom Game`);
            return report;
        },
        async clear(): Promise<void> {
            await prepareLevel(undefined);
            console.info('[level] base game');
        },
        active(): ActiveLevel {
            return activeLevel();
        },
    };
    (window as unknown as { melodanLevel: typeof tools }).melodanLevel = tools;
    console.info('[level] dev: melodanLevel.pick() / melodanLevel.clear()');
}
