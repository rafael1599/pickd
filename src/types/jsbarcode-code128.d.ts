// jsbarcode ships no type declarations for its internal encoder modules. This
// is an ambient module declaration (this file has no top-level import/export,
// so TS treats it as a declaration, not an augmentation of an untyped module).
// We describe only the slice used by src/utils/code128.ts: the headless CODE128
// encoder (no canvas/DOM), whose encode() returns the module pattern in `data`.
declare module 'jsbarcode/bin/barcodes/CODE128/index.js' {
  export class CODE128 {
    constructor(data: string, options: { ean128?: boolean });
    encode(): { data: string; text: string };
  }
}
