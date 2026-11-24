/**
 * @symbol #gui-board
 *
 * What the board chunk carries in place of the engine code it must not ship
 * (spec §12.7 engine hygiene, §11.2 rule 6; Aegis S1 risks e, f): the font
 * subsetter and its worker (`eval`, `new Function`, WebAssembly), the image
 * resizer (WebAssembly), the Mermaid importer and every network fetch. Each
 * stand-in fails closed with a named error; none of the original source is in
 * the bundle (test/board-scan.test.ts scans the shipped bytes).
 */
export class BoardRefused extends Error {
  constructor(what: string) {
    super(`gnomon board: ${what} is not built into the board`);
    this.name = 'BoardRefused';
  }
}

const refuse = (what: string) => (): never => {
  throw new BoardRefused(what);
};

/** Stands in for every `fetch(` in the engine: the board makes no HTTP request of its own. */
export const gnomonBoardRefuseFetch = (): Promise<never> => Promise.reject(new BoardRefused('network fetch'));

/* font subsetting (subset-shared.chunk.js, subset-worker.chunk.js) */
export const Commands = Object.freeze({ Subset: 'SUBSET' });
export const subsetToBase64 = refuse('font subsetting');
export const subsetToBinary = refuse('font subsetting');
export const toBase64 = refuse('font subsetting');
export const WorkerUrl = undefined;

/* @excalidraw/mermaid-to-excalidraw */
export const parseMermaidToExcalidraw = refuse('the Mermaid importer');

/* pica, image-blob-reduce (default exports: factories) */
export default refuse('image resizing');
