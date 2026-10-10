// FeatureToggles: the shape, with no behavior attached.
//
// It was declared in src/storage/settings.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

import type { FeatureId, FeatureToggle } from './feature-id';

export type FeatureToggles = Record<FeatureId, FeatureToggle>;
