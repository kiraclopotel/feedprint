// ScanEvent: the shape, with no behavior attached.
//
// It was declared in src/forensics/scan-log.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

import type { Platform, FeedSource } from './post';

export interface ScanEvent {
  timestamp: string;
  platform: Platform;
  feedSource: FeedSource;
  author: string;
  postId: string;
  // The pipeline returns 'pass' / 'neutralize' / 'collapse' / 'hide'
  // / 'cancelled'. The three 'comments-*' values come from the
  // engagement controller's video-platform actions (separate
  // concern). 'cancelled' is the queue-driven cancel-on-stale outcome
  // — the chain records the observation via CANCEL_LOG →
  // logCancelEvent (verdict='cancelled-*').
  action: 'pass' | 'neutralize' | 'collapse' | 'hide' | 'mark' | 'cancelled' | 'comments-hidden' | 'comments-educational' | 'comments-rewritten';
  // Lightweight: no original text, no hash, no integrity chain
}
