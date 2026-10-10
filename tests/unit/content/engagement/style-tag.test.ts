// @vitest-environment jsdom
// Shared <style> tag helper (ARCHITECTURE-6 item 1). Every engagement
// module used to carry its own copy of these two functions; this locks the
// one copy they now share.

import { describe, it, expect, beforeEach } from 'vitest';
import { ensureStyleTag, removeStyleTag } from '../../../../src/content/engagement/style-tag';

const ID = 'fw-style-tag-test-css';

describe('style-tag helpers', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('injects one <style> with the given id and css', () => {
    ensureStyleTag(ID, '.a { display: none; }');
    const tags = document.querySelectorAll(`style#${ID}`);
    expect(tags.length).toBe(1);
    expect(tags[0].textContent).toBe('.a { display: none; }');
    expect(tags[0].parentElement).toBe(document.head);
  });

  it('is idempotent: a second call with the same id keeps the first tag', () => {
    ensureStyleTag(ID, 'first');
    ensureStyleTag(ID, 'second');
    const tags = document.querySelectorAll(`style#${ID}`);
    expect(tags.length).toBe(1);
    expect(tags[0].textContent).toBe('first');
  });

  it('removes by id and leaves other tags alone', () => {
    ensureStyleTag(ID, 'a');
    ensureStyleTag('fw-other-css', 'b');
    removeStyleTag(ID);
    expect(document.getElementById(ID)).toBeNull();
    expect(document.getElementById('fw-other-css')).not.toBeNull();
  });

  it('removing a missing id is a no-op', () => {
    expect(() => removeStyleTag('fw-never-injected')).not.toThrow();
  });
});
