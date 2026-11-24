/**
 * @symbol #gui-board
 *
 * Imported FIRST by the board entry: points Excalidraw's asset base at the
 * board chunk's own directory in the pinned bundle (spec §12.7 engine
 * hygiene: `EXCALIDRAW_ASSET_PATH` → the bundle; no CDN). The engine's CDN
 * fallback is removed at build time (scripts/board-patches.mjs), so this is
 * the only base an asset URL can be built from.
 */
(globalThis as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL('./', import.meta.url).href;

export {};
