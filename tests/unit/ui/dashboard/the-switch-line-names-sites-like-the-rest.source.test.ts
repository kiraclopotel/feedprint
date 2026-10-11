// The Timeline's quiet-gap line read "switched twitter → instagram" while every other place on the dashboard (the
// cards, the filter rail, the chips) says x.com and instagram.com: the line was handed the stored platform id
// (tester's picture, crew/visuals/shots-relaxed/seeded-dash-desk-1-timeline-light.png, 11 Oct 2026).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/ui/dashboard/components/ActivityTab.tsx', 'utf8');

describe('the platform-switch line on the Timeline', () => {
  it('passes the site names, not the stored ids', () => {
    const call = src.match(/t\.feedPlatformSwitch\(([^;]*?)\)\}/s)?.[1] ?? '';
    expect(call).toContain('PLATFORM_LABELS[div.fromPlatform]');
    expect(call).toContain('PLATFORM_LABELS[div.toPlatform]');
  });
});
