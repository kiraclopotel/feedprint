// The polish program's dashboard U11 (POLISH-BACKLOG-2026-10-12.md, "## Dashboard", rows 16, 56, 57, 58, 65, 76, 77, 80 and the
// loose ends the earlier units left): one corner scale for look A, one ladder of sizes and weights, one control height,
// one drawing for "open the original post", the Hidden Ads box quiet, the Timeline marker inside its column.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');
const dash = (f: string) => src(`ui/dashboard/${f}`);

// The body of the single rule that starts a line with this selector.
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  expect(css.indexOf(`\n${selector} {`, at + 1), `${selector} is stated once`).toBe(-1);
  return css.slice(at, css.indexOf('}', at));
};

const sheets = () => [dash('dashboard-design.css'), dash('dashboard-frame.css'), dash('dashboard-house.css'), dash('dashboard-looks.css')].join('\n');

describe('dashboard U11: the last loose ends', () => {
  it('16: look A takes the popup\'s corners (8px a control, 12px a card); the other looks and the tab strip stay flat', () => {
    const looks = dash('dashboard-looks.css');
    expect(looks).toMatch(/^:root:not\(\[data-look\]\) \{ --fw-r-1: 8px; --fw-r-2: 12px; --fw-r-lg: var\(--fw-r-2\); \}$/m);
    expect(looks).not.toMatch(/data-look="[b-e]"[^{]*\{[^}]*--fw-r-/);
    // The panels take the card corner by token, so look A's 12px reaches them and the other looks keep their 2px.
    expect(dash('dashboard-frame.css')).toMatch(/\.pat-section \{\n  background: var\(--fw-lift\);\n  border: 1px solid var\(--fw-line\);\n  border-radius: var\(--fw-radius-lg\);/);
    expect(dash('dashboard-frame.css')).toMatch(/^\.dash-tabs \{[^}]*border-radius: 0;/m);
    // The Feed log's joined groups are round at their ends only.
    expect(looks).toContain(':root:not([data-look]) .fl-bar .fl-chips .chip:first-child { border-radius: 8px 0 0 8px; }');
  });

  it('56: an explanation line under a card title is 14px with the shared line height, on Feed behavior and Overview too', () => {
    const design = dash('dashboard-design.css');
    expect(rule(design, '.pat-section-sub')).toMatch(/font-size: \.875rem; line-height: 1\.45;/);
    expect(rule(design, '.ov-card-sub')).toMatch(/font-size: \.875rem; line-height: 1\.45;/);
    // The interval lines under a headline are the 13px secondary step.
    expect(dash('components/StatisticsTab.tsx')).toContain("className=\"fwc-pct\" style={{ fontSize: 13,");
    expect(dash('components/OverviewTab.tsx')).toContain("className=\"ov-balance-interval\" style={{ fontSize: 13,");
  });

  it('57 and 58: Back up & restore paragraphs have a gap, and the name note is as quiet as its sibling notes', () => {
    const design = dash('dashboard-design.css');
    expect(design).toContain('.backup-lead > div + div { margin-top: 10px; }');
    expect(rule(design, '.export-intro')).toMatch(/font-size: 14px;/);
    const exportTab = dash('components/ExportTab.tsx');
    expect(exportTab).toContain("<div className=\"export-note\" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 6, lineHeight: 1.5 }}>{t.profileNameHint}</div>");
    expect(exportTab).not.toMatch(/opacity: 0\.8/);
    // The third status line wraps a long word like its two siblings.
    expect(exportTab).toMatch(/className="export-note" style=\{\{ fontSize: 12, marginTop: 12, lineHeight: 1\.5, overflowWrap: 'anywhere', color: donateMsg\.ok/);
  });

  it('65: "open the original post" is an icon and its words in every language, drawn as the buttons beside it', () => {
    const feedLog = dash('components/FeedLogTab.tsx');
    expect(feedLog).toMatch(/className="fx-withhold"[^>]*\n[^\n]*\n\s*<ExternalLink size=\{14\} \/>\{t\.openOriginalPost\}/);
    // The frame underlines every link under the root; the sibling buttons are not underlined.
    expect(dash('dashboard-design.css')).toContain('.dash-root a.fx-withhold { color: var(--fw-muted); text-decoration: none; }');
    for (const lang of ['en', 'es', 'pt-br', 'ro']) {
      const line = src(`i18n/dashboard/${lang}.ts`).split('\n').find((l) => l.includes('openOriginalPost:'));
      expect(line, lang).toBeDefined();
      expect(line, lang).not.toContain('↗');
    }
  });

  it('76: the Hidden Ads box on a Timeline card is a quiet outline, not a field', () => {
    const body = rule(dash('dashboard-design.css'), '.fc-shown-block');
    expect(body).toMatch(/background: none;/);
    expect(body).toMatch(/border: 1px solid var\(--fw-line\);/);
  });

  it('77: no off-scale size or weight is left in the sheets', () => {
    const all = sheets();
    expect(all).not.toMatch(/font-size: (12\.5|13\.5|15\.5|17|27)px/);
    expect([...all.matchAll(/font-weight: (\d+)/g)].map((m) => m[1]).filter((w) => !['200', '400', '500', '600', '700'].includes(w))).toEqual([]);
  });

  it('80: the Timeline row sits in its own column, its marker not on the rail\'s divider', () => {
    expect(rule(dash('dashboard-design.css'), '.fc-tl-row')).not.toMatch(/margin-left/);
  });

  it('every control is 32px tall: the lens, the action buttons, the window toggles, the banner buttons, Copy diagnostics', () => {
    const design = dash('dashboard-design.css');
    expect(rule(design, '.fb-lens')).toMatch(/min-height: 32px;/);
    expect(rule(design, '.fc-action-btn')).toMatch(/min-height: 32px;/);
    expect(dash('components/PatternsTab.tsx')).toMatch(/padding: '5px 12px', minHeight: 32,/);
    expect(dash('components/ChainBanner.tsx').match(/minHeight: 32/g)).toHaveLength(2);
    expect(dash('components/OperationalEventsPanel.tsx')).toMatch(/className="btn"\n\s+onClick=\{copyDiagnostics\}/);
    // The sessions strip's track and blocks share one height, and the flag marks stay clear under it.
    expect(rule(design, '.ov-sess-block')).toMatch(/height: 32px;/);
    expect(design).toMatch(/\.ov-sess-track \{\n  position: absolute; left: 0; right: 0; top: 18px; height: 32px;/);
  });

  it('dead rules are gone: the hint ping, the stat label, the old solid chosen fills, the link colour of the original-post link', () => {
    const design = dash('dashboard-design.css');
    expect(design).not.toContain('fw-hint-ping');
    expect(design).not.toMatch(/^\.stat-label \{/m);
    expect(design).not.toMatch(/^\.fl-link \{/m);
    const frame = dash('dashboard-frame.css');
    expect(frame).not.toMatch(/^\.frail-opt\.on \{ background/m);
    expect(frame).not.toMatch(/^\.fb-lens\.active \{/m);
  });

  it('the verbatim caret turns over when its record is open', () => {
    const design = dash('dashboard-design.css');
    expect(design).toContain('.fc-reveal-caret.open { transform: rotate(180deg); }');
    expect(design).toMatch(/\.fc-reveal-caret \{[^}]*transition: transform \.12s ease;/);
    // Stillness comes from the one rule that ends every transition under the dashboard root.
    expect(dash('dashboard-looks.css')).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.dash-root \*, [^{]*\{[^}]*transition-duration: \.001ms !important;/);
  });

  it('a scroll the page starts follows the motion setting, and the hover token is on the 120 ms clock', () => {
    const motion = src('ui/shared/motion.ts');
    expect(motion).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'");
    expect(dash('components/ExportTab.tsx')).toContain("scrollIntoView({ block: 'center', behavior: scrollBehavior() })");
    expect(dash('components/ForensicsTab.tsx')).toContain("scrollIntoView({ block: 'start', behavior: scrollBehavior() })");
    for (const f of ['ExportTab.tsx', 'ForensicsTab.tsx']) expect(dash(`components/${f}`), f).not.toContain("behavior: 'smooth'");
    expect(dash('dashboard-house.css')).toMatch(/--fw-d-hover: 0\.12s;/);
  });

  it('Feed behavior: no strip of the last seven days under a longer range, no hairline under the panel\'s edge, a wrapped handle under its letter', () => {
    const patterns = dash('components/PatternsTab.tsx');
    expect(patterns).toContain('if (anchor !== null && RANGE_DAYS[range] === 7) {');
    const frame = dash('dashboard-frame.css');
    expect(frame).not.toContain(':nth-child(-n+2)');
    expect(frame).toMatch(/^\.fb-card \{[^}]*border-top: 1px solid var\(--fw-line\) !important; border-radius: 0; margin-top: -1px;/m);
    const design = dash('dashboard-design.css');
    expect(design).toContain('.fb-voice { display: flex; align-items: flex-start; gap: 6px; }');
    expect(design).toMatch(/\.fb-pf-dot \{ flex: none;/);
    expect(dash('components/FeedBehaviorPanels.tsx')).toContain('<span className="fb-voice-name">{breakableHandle(v.author)}</span>');
  });

  it('Overview and Record: the letter tile is the first letters of the handle without its @, and the Accounts list names the site as the page does', () => {
    expect(dash('components/OverviewTab.tsx')).toContain("Array.from(s.author.replace(/^@+/, '')).slice(0, 2).join('').toUpperCase() || '?'");
    const forensics = dash('components/ForensicsTab.tsx');
    expect(forensics).toContain("lineHeight: 1.2 }}>{t.exclusionsTitle}</h3>");
    expect(forensics).toContain('{PLATFORM_LABELS[e.platform] ?? e.platform} · ');
  });
});
