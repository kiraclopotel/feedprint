// @vitest-environment jsdom
//
// Q70 (wiring W61): FeelingWise's own injected text must never re-enter
// the pipeline as post content. After rescanCurrentSurfaceNow clears the
// processed stamps (mode flip, image-understanding toggle), adapters
// re-read textContent, which on a protected element is FW's rewrite or
// fold placeholder; re-scoring that could write FW's own copy into the
// forensic chain as "what the child saw". The interceptor now filters
// every extracted post through carriesFwInjectedText.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { carriesFwInjectedText } from '../../../../src/content/post-path/dom-interceptor';

const INTERCEPTOR_PATH = 'src/content/post-path/dom-interceptor.ts';
const INJECTOR_PATH = 'src/content/injector.ts';

function div(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('carriesFwInjectedText', () => {
  it('true for an element inside a neutralized container', () => {
    const root = div('<article data-fw-neutralized="true"><span id="t">calm rewrite</span></article>');
    expect(carriesFwInjectedText(root.querySelector('#t'))).toBe(true);
  });

  it('true for a container holding a neutralized descendant', () => {
    const root = div('<article id="c"><span data-fw-neutralized="true">folded</span></article>');
    expect(carriesFwInjectedText(root.querySelector('#c'))).toBe(true);
  });

  it('true for hard-hidden and ad-hidden containers', () => {
    expect(carriesFwInjectedText(div('<div data-fw-hard-hidden="true"><p id="x">.</p></div>').querySelector('#x'))).toBe(true);
    expect(carriesFwInjectedText(div('<div data-fw-ad-hidden="true"><p id="y">.</p></div>').querySelector('#y'))).toBe(true);
  });

  it('false for untouched content and for null (virtualizer-fresh elements re-extract)', () => {
    const root = div('<article id="c"><span>organic post</span></article>');
    expect(carriesFwInjectedText(root.querySelector('#c'))).toBe(false);
    expect(carriesFwInjectedText(null)).toBe(false);
  });
});

describe('wiring (source-lock)', () => {
  it('the interceptor dispatch filter applies the gate', () => {
    const src = readFileSync(join(process.cwd(), INTERCEPTOR_PATH), 'utf8');
    expect(src).toContain('.filter(post => !carriesFwInjectedText(post.domRef.deref() ?? null));');
  });

  it('the neutralized stamp is still written by both injector paths', () => {
    const injector = readFileSync(join(process.cwd(), INJECTOR_PATH), 'utf8');
    expect(injector.match(/setAttribute\('data-fw-neutralized', 'true'\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
