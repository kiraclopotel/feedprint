// @vitest-environment node
//
// The AI drawer's fold, read in a real layout engine with the popup's own sheets: in the look the build ships, with
// motion on or off, the card folds into its pill and back over 200 ms, and a width read halfway sits between the two;
// for a person who asked for less motion, and while the stored choice is still being read, nothing in it moves. A
// selector-name test passed while a heavier rule switched the fold off, so this reads computed styles.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readSource } from '../../../helpers/read-source';
import { POPUP_LIFE } from '../../../../src/ui/popup/life';
import { POPUP_LOOKS } from '../../../../src/ui/shared/looks';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SHEETS = ['src/ui/shared/tokens.css', 'src/ui/popup/popup-design.css', 'src/ui/popup/popup-life.css', 'src/ui/popup/popup-looks.css']
  .map((p) => readSource(p)).join('\n');

function pageHtml(motion: boolean, theme: 'dark' | 'light'): string {
  const life = [POPUP_LIFE.depth ? 'fw-life-depth' : '', motion ? 'fw-life-motion' : ''].filter(Boolean).join(' ');
  return `<!doctype html><html class="${life}" data-theme="${theme}"><head><style>${SHEETS}</style></head>
<body style="width:380px;margin:0"><div class="fw-popup">
<div class="pop-card mode-card">level</div>
<div class="pop-card ai-drawer" id="drawer">
  <button type="button" class="ai-drawer-head"><span class="ai-drawer-title">AI protection</span><span class="ai-drawer-sep">·</span><span class="ai-drawer-plan">The reading</span><svg class="ai-drawer-chev open" width="14" height="14"></svg></button>
  <div class="ai-drawer-body" id="body"><div class="ai-drawer-rows"><div style="height:160px">rows</div></div></div>
</div></div></body></html>`;
}

const durations = (page: Page, sel: string) =>
  page.$eval(sel, (el) => getComputedStyle(el).transitionDuration.split(',').map((d) => parseFloat(d)));
const width = (page: Page) => page.$eval('#drawer', (el) => el.getBoundingClientRect().width);

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

describe('the AI drawer folds in a real browser', () => {
  for (const motion of [POPUP_LIFE.motion, !POPUP_LIFE.motion]) {
    for (const theme of ['dark', 'light'] as const) {
      it(`with motion ${motion ? 'on' : 'off'} (${motion === POPUP_LIFE.motion ? 'as shipped' : 'the other look'}), ${theme}: the fold takes 200 ms and is seen halfway`, async () => {
        const page = await browser.newPage();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.setContent(pageHtml(motion, theme));
        const card = await page.$eval('#drawer', (el) => getComputedStyle(el).transitionProperty);
        expect(card).toContain('width');
        expect(Math.max(...await durations(page, '#drawer'))).toBeCloseTo(0.2);
        expect(Math.max(...await durations(page, '#body'))).toBeCloseTo(0.2);
        expect(Math.max(...await durations(page, '.ai-drawer-chev'))).toBeCloseTo(0.2);

        const open = await width(page);
        // The fold is read at 100 ms of its own clock, not after 90 ms of the machine's: under the full suite's load
        // the first frame came late and the "halfway" width was still the open card (364 against 362, the 2.5.19
        // freeze dry run, 15 Oct 2026). Reading the transitions starts them (getAnimations flushes the style), each is
        // held at 100 ms for the halfway width, then finished for the pill.
        const halfway = await page.$eval('#drawer', (el) => {
          el.classList.add('closed');
          const folds = el.getAnimations();
          for (const a of folds) { a.pause(); a.currentTime = 100; }
          const widthFold = folds.some((a) => (a as CSSTransition).transitionProperty === 'width');
          return { width: el.getBoundingClientRect().width, widthFold };
        });
        expect(halfway.widthFold, 'the card has a running width transition to hold').toBe(true);
        await page.$eval('#drawer', (el) => { for (const a of el.getAnimations()) a.finish(); });
        const pill = await width(page);
        expect(pill).toBeLessThan(open - 40);
        expect(halfway.width, `halfway ${halfway.width} between pill ${pill} and card ${open}`).toBeGreaterThan(pill + 2);
        expect(halfway.width).toBeLessThan(open - 2);
        // Closed, it is the pill: rounded, in its own green.
        const look = await page.$eval('#drawer', (el) => {
          const cs = getComputedStyle(el);
          return { radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor, pill: getComputedStyle(document.documentElement).getPropertyValue('--ai-pill-bg').trim() };
        });
        expect(look.radius).toBeGreaterThan(14);
        const hex = look.pill.replace('#', '');
        expect(look.bg).toBe(`rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`);
        await page.close();
      });
    }
  }

  for (const motion of [false, true]) {
    it(`for a person who asked for less motion, nothing in the drawer moves (motion ${motion ? 'on' : 'off'})`, async () => {
      const page = await browser.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setContent(pageHtml(motion, 'light'));
      for (const sel of ['#drawer', '#body', '.ai-drawer-chev']) {
        expect(await durations(page, sel), sel).toEqual(expect.arrayContaining([0]));
        expect(Math.max(...await durations(page, sel)), sel).toBe(0);
      }
      const open = await width(page);
      await page.$eval('#drawer', (el) => el.classList.add('closed'));
      await page.waitForTimeout(30);
      expect(await width(page)).toBeLessThan(open - 40);
      await page.close();
    });
  }

  it('drawn before its stored choice is read, the drawer settles without moving', async () => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setContent(pageHtml(POPUP_LIFE.motion, 'dark'));
    await page.$eval('#drawer', (el) => el.classList.add('unread', 'closed'));
    for (const sel of ['#drawer', '#body', '.ai-drawer-chev']) expect(Math.max(...await durations(page, sel)), sel).toBe(0);
    await page.close();
  });
});

// Green means the reading is at work. With AI checks off, or at a level that sends nothing, the closed drawer is
// "idle": the card's own colours, never the pill's green, in every look the chooser offers.
describe("the idle pill keeps the card's own colours in a real browser", () => {
  for (const look of POPUP_LOOKS) {
    for (const theme of ['dark', 'light'] as const) {
      it(`look ${look}, ${theme}: background and words are the card's, not the green pill's`, async () => {
        const page = await browser.newPage();
        const lookAttr = look === 'a' ? '' : ` data-look="${look}"`;
        await page.setContent(`<!doctype html><html data-theme="${theme}"${lookAttr}><head><style>${SHEETS}</style></head>
<body style="width:380px;margin:0"><div class="fw-popup">
<div class="pop-card" id="card"><div class="fr-name">a card</div></div>
<div class="pop-card ai-drawer closed idle" id="idle">
  <button type="button" class="ai-drawer-head"><span class="ai-drawer-title">AI protection</span><span class="ai-drawer-sep">·</span><span class="ai-drawer-plan">The reading</span><svg class="ai-drawer-chev" width="14" height="14"></svg></button>
</div>
<div class="pop-card ai-drawer closed" id="green">
  <button type="button" class="ai-drawer-head"><span class="ai-drawer-title">AI protection</span></button>
</div></div></body></html>`);
        const seen = await page.evaluate(() => {
          const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
          const root = getComputedStyle(document.documentElement);
          return {
            idleBg: cs('#idle').backgroundColor, cardBg: cs('#card').backgroundColor, greenBg: cs('#green').backgroundColor,
            title: cs('#idle .ai-drawer-title').color, plan: cs('#idle .ai-drawer-plan').color,
            text: root.getPropertyValue('--fw-text').trim(), muted: root.getPropertyValue('--fw-muted').trim(),
            pillInk: cs('#green .ai-drawer-title').color,
          };
        });
        const rgb = (hex: string) => {
          const h = hex.replace('#', '');
          return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
        };
        expect(seen.idleBg).toBe(seen.cardBg);
        expect(seen.idleBg).not.toBe(seen.greenBg);
        expect(seen.title).toBe(rgb(seen.text));
        expect(seen.plan).toBe(rgb(seen.muted));
        expect(seen.title).not.toBe(seen.pillInk);
        await page.close();
      });
    }
  }
});
