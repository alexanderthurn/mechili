/**
 * Shared GLTF loader with Draco mesh decompression.
 * Decoder WASM/JS lives in `public/draco/` (copied from three.js examples).
 */
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Served from Vite `public/draco/` (`base: './'` in vite.config). */
const DRACO_DECODER_PATH = './draco/';

let shared: GLTFLoader | null = null;
let draco: DRACOLoader | null = null;

/** One GLTFLoader for the whole app (units, scenery, spells). */
export function getGltfLoader(): GLTFLoader {
    if (shared) return shared;
    draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    // glTF-flavored decoder build (draco_decoder.js + .wasm + wrapper)
    draco.setDecoderConfig({ type: 'wasm' });
    shared = new GLTFLoader();
    shared.setDRACOLoader(draco);
    return shared;
}

/** Release decoder workers (match teardown / HMR). */
export function disposeGltfLoader(): void {
    draco?.dispose();
    draco = null;
    shared = null;
}
