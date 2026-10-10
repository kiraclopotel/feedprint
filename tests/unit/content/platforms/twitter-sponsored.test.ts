// @vitest-environment jsdom
//
// X ad detection: placementTracking is the VIDEO-PLAYER wrapper, NOT an ad
// marker (found 2026-06-05, "show more → advertisement" — organic video posts
// flagged as ads once the video hydrated). The reliable signal is the bare
// "Ad"/"Promoted" header label shown INSTEAD of a <time>. Live-verified:
// real ads = no <time> + "Ad"; organic videos = <time>.

import { describe, it, expect } from 'vitest';
import { extractIsXSponsored } from '../../../../src/content/platforms/twitter';

function art(html: string): HTMLElement {
  const a = document.createElement('article');
  a.setAttribute('role', 'article');
  a.innerHTML = html;
  return a;
}

describe('extractIsXSponsored', () => {
  it('does NOT flag an organic video post just because it has placementTracking', () => {
    // organic video: placementTracking wraps the video, but it has a <time>
    const a = art('<time datetime="2026-06-04">8h</time><div data-testid="placementTracking"><div data-testid="videoPlayer"></div></div>');
    expect(extractIsXSponsored(a)).toBe(false);
  });

  it('flags a real ad: no <time> + bare "Ad" leaf (even when placementTracking is absent)', () => {
    const a = art('<div><span>ExampleSat</span></div><span>Ad</span><div data-testid="tweetText">Fast internet</div>');
    expect(extractIsXSponsored(a)).toBe(true);
  });

  it('flags a real ad with bare "Ad" AND placementTracking (video ad)', () => {
    const a = art('<span>Ad</span><div data-testid="placementTracking"><div data-testid="videoPlayer"></div></div>');
    expect(extractIsXSponsored(a)).toBe(true);
  });

  it('flags an explicit Promoted aria-label', () => {
    const a = art('<div aria-label="Promoted Tweet"></div><div data-testid="tweetText">x</div>');
    expect(extractIsXSponsored(a)).toBe(true);
  });

  it('does NOT flag an organic post that merely contains the word "Ad" in body text (has <time>)', () => {
    const a = art('<time>2h</time><div data-testid="tweetText">I read the Ad and disagreed with it</div>');
    expect(extractIsXSponsored(a)).toBe(false);
  });

  it('does NOT flag an organic post discussing sponsorship (no header label)', () => {
    const a = art('<time>5h</time><div data-testid="tweetText">This event is sponsored by a great charity</div>');
    expect(extractIsXSponsored(a)).toBe(false);
  });
});
