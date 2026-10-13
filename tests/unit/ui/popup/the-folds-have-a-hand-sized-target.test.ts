// @vitest-environment node
//
// The owner's word of 12 Oct 2026: the little bracket that closes a fold was too small to find. Read in a real layout
// engine with the popup's own sheets: every fold's header is at least 40 px tall, the chevron sits in a 32 px square, the
// chevron points down while the fold is shut and up while it is open, and three folds one under the other do not touch
// each other. The sheets are the real ones, so a heavier rule that shrank a target would show here, not in a selector test.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readSource } from '../../../helpers/read-source';
import { POPUP_LIFE } from '../../../../src/ui/popup/life';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SHEETS = ['src/ui/shared/tokens.css', 'src/ui/popup/popup-design.css', 'src/ui/popup/popup-life.css', 'src/ui/popup/popup-looks.css']
  .map((p) => readSource(p)).join('\n');

const fold = (name: string, title: string, open: boolean, atWork = false) => `
<div class="pop-card ai-drawer fold-${name}${open ? '' : ' closed'}${atWork ? '' : ' idle'}" id="${name}">
  <button type="button" class="ai-drawer-head" aria-expanded="${open}"><span class="ai-drawer-title">${title}</span><span class="ai-drawer-chip"><svg class="ai-drawer-chev${open ? ' open' : ''}" width="20" height="20" viewBox="0 0 24 24"></svg></span></button>
  <div class="ai-drawer-body"${open ? '' : ' hidden'}><div class="ai-drawer-rows"><div style="height:120px">rows</div></div></div>
</div>`;

// In the look the build ships, as the drawer's own browser test reads it.
const LIFE = [POPUP_LIFE.depth ? 'fw-life-depth' : '', POPUP_LIFE.motion ? 'fw-life-motion' : ''].filter(Boolean).join(' ');

function pageHtml(theme: 'dark' | 'light', open: boolean): string {
  return `<!doctype html><html class="${LIFE}" data-theme="${theme}"><head><style>${SHEETS}</style></head>
<body style="width:380px;margin:0"><div class="fw-popup">
<div class="pop-card mode-card">level</div>
${fold('general', 'General', open)}${fold('reading', 'Live Rephrase', open, true)}${fold('device', 'PIN and language', open)}
</div></body></html>`;
}

const box = (page: Page, sel: string) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom }; });

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

describe('the folds have a target the size of a thumb', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const open of [false, true]) {
      it(`${theme}, ${open ? 'open' : 'shut'}: the header is at least 40 px, the chip 32 px, and the three folds do not touch`, async () => {
        const page = await browser.newPage();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setContent(pageHtml(theme, open));
        for (const name of ['general', 'reading', 'device']) {
          const head = await box(page, `#${name} .ai-drawer-head`);
          expect(head.h, `${name} header height`).toBeGreaterThanOrEqual(40);
          const chip = await box(page, `#${name} .ai-drawer-chip`);
          expect(chip.w, `${name} chip width`).toBeGreaterThanOrEqual(32);
          expect(chip.h, `${name} chip height`).toBeGreaterThanOrEqual(32);
          const chev = await box(page, `#${name} .ai-drawer-chev`);
          expect(chev.w, `${name} chevron`).toBeGreaterThanOrEqual(20);
        }
        const [a, b, c] = await Promise.all(['general', 'reading', 'device'].map((n) => box(page, `#${n}`)));
        expect(b.top, 'Live Rephrase under General').toBeGreaterThan(a.bottom);
        expect(c.top, 'PIN and language under Live Rephrase').toBeGreaterThan(b.bottom);
        await page.close();
      });
    }
  }

  it('the chevron points down while a fold is shut and up while it is open', async () => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const matrix = async () => page.$eval('#general .ai-drawer-chev', (el) => getComputedStyle(el).transform);
    await page.setContent(pageHtml('dark', false));
    expect(await matrix(), 'shut: not turned, so the chevron points down').toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await page.setContent(pageHtml('dark', true));
    const open = await matrix();
    expect(open, 'open: turned half way round, so it points up').toMatch(/^matrix\(-1, [-0-9.e]+, [-0-9.e]+, -1, 0, 0\)$/);
    await page.close();
  });

  it('the chip lights its edge under the pointer, so the target answers before it is pressed', async () => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(pageHtml('dark', true));
    const edge = () => page.$eval('#general .ai-drawer-chip', (el) => getComputedStyle(el).borderTopColor);
    const rest = await edge();
    // Anywhere on the header counts: the whole row is the button, the chip is its picture.
    const head = await box(page, '#general .ai-drawer-head');
    await page.mouse.move(40, head.top + head.h / 2);
    const lit = await edge();
    expect(lit).not.toBe(rest);
    await page.close();
  });
});
