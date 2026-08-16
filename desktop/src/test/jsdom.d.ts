// jsdom ships no type declarations and @types/jsdom is not installed; this
// ambient declaration keeps `src/test/bun-dom.ts` (used only by `bun test`)
// type-clean. The JSDOM API is consumed through `any`.
declare module "jsdom";