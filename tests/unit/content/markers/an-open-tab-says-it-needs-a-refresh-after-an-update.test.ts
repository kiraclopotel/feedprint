/** @vitest-environment jsdom */
// After an update, the script in an open feed tab can no longer reach the extension and checks
// nothing until the page is refreshed. With no cover up, the page said nothing and looked checked.
// The promise: the tab shows one line saying a refresh is needed, in the reader's language, naming
// no product (the old script cannot tell which product it belongs to); a click on it refreshes; and
// a person coming back to a quiet tab is told without having to scroll first.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';

const NOTICE = '[data-fw-update-notice]';

async function freshModules() {
  vi.resetModules();
  const guard = await import('../../../../src/storage/context-guard');
  const notice = await import('../../../../src/content/markers/update-notice');
  return { guard, notice };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('an open tab says it needs a refresh after an update', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as { chrome?: unknown }).chrome = { runtime: { id: 'extension-id' } };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  it('shows nothing while the extension is there', async () => {
    const { notice } = await freshModules();
    notice.armUpdateNotice(document, () => 'en');
    setVisibility('hidden');
    setVisibility('visible');
    expect(document.querySelector(NOTICE)).toBeNull();
  });

  it('shows one line when the extension goes away, in the reader language, naming no product', async () => {
    const { guard, notice } = await freshModules();
    notice.armUpdateNotice(document, () => 'ro');
    guard.markContextInvalidated();
    const shown = document.querySelectorAll(NOTICE);
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toBe(MARKER_STRINGS.ro.coverStrandedNotice);
    expect(shown[0].getAttribute('role')).toBe('status');
    expect(shown[0].querySelector('button')).not.toBeNull();
    guard.markContextInvalidated();
    expect(document.querySelectorAll(NOTICE)).toHaveLength(1);
  });

  it('is armed late too: a tab whose extension is already gone is told at once', async () => {
    const { guard, notice } = await freshModules();
    guard.markContextInvalidated();
    notice.armUpdateNotice(document, () => 'en');
    expect(document.querySelectorAll(NOTICE)).toHaveLength(1);
  });

  it('a person coming back to a quiet tab is told without scrolling', async () => {
    const { guard, notice } = await freshModules();
    notice.armUpdateNotice(document, () => 'en');
    setVisibility('hidden');
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    setVisibility('visible');
    expect(guard.isContextAlive()).toBe(false);
    expect(document.querySelector(NOTICE)?.textContent).toBe(MARKER_STRINGS.en.coverStrandedNotice);
  });

  it('a click on the line refreshes the page', async () => {
    const { guard, notice } = await freshModules();
    const reload = vi.fn();
    const view = document.defaultView as Window;
    const original = Object.getOwnPropertyDescriptor(view, 'location');
    Object.defineProperty(view, 'location', { configurable: true, value: { ...view.location, reload } });
    try {
      notice.armUpdateNotice(document, () => 'en');
      guard.markContextInvalidated();
      document.querySelector<HTMLButtonElement>(`${NOTICE} button`)!.click();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(view, 'location', original);
    }
  });

  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('the %s line names no product and says to refresh', (lang) => {
    const line = MARKER_STRINGS[lang].coverStrandedNotice;
    expect(line).not.toMatch(/FeelingWise|Receipts|\bOff\b/);
    expect(line).toMatch(/refresh|reîncarc|vuelve a cargar|recarregue/i);
    expect(line).not.toContain('—');
  });
});
