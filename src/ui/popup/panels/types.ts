// The two names the popup's panels share: which screen is up, and which tab.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

export type Screen = 'setup' | 'main' | 'settings';
export type Tab = 'home' | 'keys';
