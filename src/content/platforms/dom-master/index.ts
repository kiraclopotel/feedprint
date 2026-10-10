// FeelingWise — Universal DOM Master.
//
// Public entry point for platform adapters. Each platform exports a
// `DomMasterAdapter` config (tiers + shape anchors + content signals)
// and calls `extractCommentRows(container, adapter)` to get rows back.
//
// Architecture overview in src/content/platforms/dom-master/types.ts. The dom-
// master is the FW-wide solution to platform DOM rotation: shared
// fallback + diagnostics across all 5 supported platforms.

export {
  extractCommentRows,
} from './tier-runner';

export type {
  DomMasterAdapter,
} from './types';

export { _resetRotationDiagnosticGuards } from './rotation-diagnostic';
