/// <reference types="vite/client" />

/** Injected by Vite from package.json */
declare const __APP_VERSION__: string;
/** Injected by Vite from `git rev-parse --abbrev-ref HEAD` (empty if unknown) */
declare const __GIT_BRANCH__: string;
/** Injected by Vite from package.json steamElectronBuild.steamAppId (0 if unset) */
declare const __STEAM_APP_ID__: number;
/** Injected by Vite: SHA-256 of every asset the game loads (plan §17.6) */
declare const __CONTENT_HASH__: string;
