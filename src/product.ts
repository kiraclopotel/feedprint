// FeelingWise ships as two extensions built from one tree:
//
//   • `off`      — the filter. Switches only: counts, Reels, ads, emoji, the
//                  word list, quiet hours. No AI, no record, no service worker.
//   • `receipts` — the recorder. Everything the tree has: the signed local
//                  record, the dashboard, the export, the optional AI reading.
//
// `__FW_PRODUCT__` is baked in by Vite (`define`) per build target. Anything
// that must behave differently per product reads it through this module, so
// tests can override it and no other file touches the global.

declare const __FW_PRODUCT__: string | undefined;

export type ProductId = 'off' | 'receipts';

let overrideForTesting: ProductId | null = null;

export function currentProduct(): ProductId {
  if (overrideForTesting) return overrideForTesting;
  return typeof __FW_PRODUCT__ !== 'undefined' && __FW_PRODUCT__ === 'off' ? 'off' : 'receipts';
}

/** True in the Off build: no record is kept and no service worker exists. */
export function isOffProduct(): boolean {
  return currentProduct() === 'off';
}

export function _setProductForTesting(product: ProductId | null): void {
  overrideForTesting = product;
}
