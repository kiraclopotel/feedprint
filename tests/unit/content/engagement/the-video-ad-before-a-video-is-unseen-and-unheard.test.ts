// @vitest-environment jsdom
//
// The video ad YouTube plays before a video passed Off 1.0.13 on 6 of 8 watch
// pages in the Brand seat's signed-out runs (9 Oct 2026). While the player
// carries ad-showing, Off makes the ad's picture transparent and mutes it; when
// the ad ends the sound is given back as it was. Nothing in the player is
// skipped, sought or clicked, and the Skip button stays. The head's check of
// 3c97f5bb: the person's own mute or unmute during the ad is kept, and a video
// element YouTube swaps in (back-to-back ads) is covered too. The checker's
// finding on 53ce1aa1: only a press inside the player, or the M key, is the
// person's; and Off's own sound event, which a real browser fires later, is
// told apart by order. The tester's live run on 91ef0a8c: under Off's mute the
// person's first M press did nothing and the second brought sound; one press
// must give sound.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPlayerAdCover, PLAYER_AD_ATTR } from '../../../../src/content/engagement/youtube-player-ad';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';
import { incrementMetricsHidden } from '../../../../src/storage/settings';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

const PLAYER = `<div id="movie_player" class="html5-video-player">
  <div class="html5-video-container"><video class="html5-main-video"></video></div>
  <div class="ytp-ad-module"><button class="ytp-skip-ad-button">Skip</button></div>
  <div class="ytp-chrome-bottom"><button class="ytp-mute-button">Mute</button></div>
</div>`;

const player = () => document.getElementById('movie_player')!;
const video = () => player().querySelector('video')!;
const flush = () => new Promise((r) => setTimeout(r, 0));
/** The person's own press inside the player, as on its mute button. */
const personTouches = () => player().dispatchEvent(new Event('pointerdown', { bubbles: true }));

/** Make `v` fire volumechange after the change, as a real browser does, instead of at once as jsdom does. */
function laterSoundEvents(v: HTMLVideoElement): void {
  let muted = v.muted;
  Object.defineProperty(v, 'muted', {
    configurable: true,
    get: () => muted,
    set: (next: boolean) => {
      if (next === muted) return;
      muted = next;
      setTimeout(() => v.dispatchEvent(new Event('volumechange')), 0);
    },
  });
}

let stop: () => void = () => {};
beforeEach(() => { vi.useRealTimers(); document.head.innerHTML = ''; document.body.innerHTML = PLAYER; });
afterEach(() => { stop(); document.body.innerHTML = ''; });

describe('the video ad in the player', () => {
  it('is muted and made transparent while the player shows it, and the sound comes back after', async () => {
    stop = startPlayerAdCover();
    expect(video().muted).toBe(false);
    player().classList.add('ad-showing');
    await flush();
    expect(video().muted).toBe(true);
    expect(player().getAttribute(PLAYER_AD_ATTR)).toBe('true');
    expect(document.getElementById('fw-yt-player-ad')!.textContent).toContain('#movie_player.ad-showing video');
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(false);
    expect(player().hasAttribute(PLAYER_AD_ATTR)).toBe(false);
  });

  it('gives back a sound the person had already muted, muted', async () => {
    video().muted = true;
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(true);
  });

  it('an ad already showing when Off starts is covered at once', () => {
    player().classList.add('ad-showing');
    stop = startPlayerAdCover();
    expect(video().muted).toBe(true);
  });

  it('never touches the Skip button, the time or the speed', async () => {
    stop = startPlayerAdCover();
    const skip = player().querySelector<HTMLButtonElement>('.ytp-skip-ad-button')!;
    const clicked = vi.fn();
    skip.addEventListener('click', clicked);
    player().classList.add('ad-showing');
    await flush();
    expect(clicked).not.toHaveBeenCalled();
    expect(skip.style.display).toBe('');
    expect(video().currentTime).toBe(0);
    expect(video().playbackRate).toBe(1);
  });

  it('a person who unmutes during the ad hears it, stays unmuted through the ad, and after it', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    personTouches();
    video().muted = false;
    player().classList.add('ytp-ad-interrupting'); // another class change inside the same ad
    await flush();
    expect(video().muted).toBe(false);
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(false);
  });

  it('a person who mutes during the ad stays muted after it', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    personTouches();
    video().muted = false;
    personTouches();
    video().muted = true;
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(true);
  });

  it('the page turning the sound on during the ad, with no touch from the person, is muted again', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    video().muted = false; // the player applying its saved volume as the ad loads
    expect(video().muted).toBe(true);
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(false);
  });

  it('a video element swapped in during the ad is muted, and the one taken out gets its sound back', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    const first = video();
    first.remove();
    const second = document.createElement('video');
    player().querySelector('.html5-video-container')!.appendChild(second);
    await flush();
    expect(second.muted).toBe(true);
    expect(first.muted).toBe(false);
    player().classList.remove('ad-showing');
    await flush();
    expect(second.muted).toBe(false);
  });

  describe('the second ad of a pair (the tester\'s run on dc76c9eb: "Sponsored 2 of 2" heard in 1 of 6 loads)', () => {
    it('played in a second video element beside the first, with the class never leaving: unheard', async () => {
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      const second = document.createElement('video');
      player().querySelector('.html5-video-container')!.appendChild(second);
      await flush();
      expect(second.muted).toBe(true);
      expect(video().muted).toBe(true);
      player().classList.remove('ad-showing');
      await flush();
      expect(second.muted).toBe(false);
      expect(video().muted).toBe(false);
    });

    it('a new source in the same element, then the page turning the sound on: unheard', async () => {
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      video().src = 'blob:https://www.youtube.com/second-ad';
      video().muted = false; // the player applying its saved volume to the new ad
      await flush();
      expect(video().muted).toBe(true);
    });

    it('in a second element, with the page turning its sound on: unheard', async () => {
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      const second = document.createElement('video');
      player().querySelector('.html5-video-container')!.appendChild(second);
      await flush();
      second.muted = false;
      expect(second.muted).toBe(true);
    });
  });

  it('back-to-back ads, the second in a new video element: both unheard, and the sound comes back after the last', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    const first = video();
    expect(first.muted).toBe(true);
    // The first ad ends and the second begins in a new element, the class never leaving the player.
    const second = document.createElement('video');
    first.replaceWith(second);
    await flush();
    expect(second.muted).toBe(true);
    expect(first.muted).toBe(false);
    player().classList.remove('ad-showing');
    await flush();
    expect(second.muted).toBe(false);
    expect(player().hasAttribute(PLAYER_AD_ATTR)).toBe(false);
  });

  it('a click outside the player just before the page turns the sound on is not the person\'s: the ad stays muted', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    const thumbnail = document.createElement('a');
    document.body.appendChild(thumbnail);
    thumbnail.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    video().muted = false; // the player applying its saved volume
    expect(video().muted).toBe(true);
  });

  it('the M key anywhere is the person\'s', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    video().muted = false;
    expect(video().muted).toBe(false);
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(false);
  });

  it('an M typed into search or a comment is not a mute: the page turning the sound on is muted again', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    const search = document.createElement('input');
    const comment = document.createElement('div');
    comment.setAttribute('contenteditable', 'true');
    document.body.append(search, comment);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    comment.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));
    video().muted = false;
    expect(video().muted).toBe(true);
  });

  it('M held with Ctrl, Meta or Alt is not a mute', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, [mod]: true }));
      video().muted = false;
      expect(video().muted).toBe(true);
    }
  });

  describe('the person\'s mute press while Off\'s mute holds', () => {
    // YouTube's own toggle, as the player answers M and its mute button: it knows nothing of Off's mute.
    let ytMuted = false;
    const yt = vi.fn(() => { ytMuted = !ytMuted; video().muted = ytMuted; });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'm') yt(); };
    const onClick = (e: Event) => { if ((e.target as Element).closest('.ytp-mute-button')) yt(); };
    beforeEach(() => {
      ytMuted = false;
      yt.mockClear();
      document.addEventListener('keydown', onKey);
      document.addEventListener('click', onClick);
    });
    afterEach(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    });

    it('one M press gives sound, and the player, still unmuted in its own count, agrees', async () => {
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      expect(video().muted).toBe(true);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      expect(video().muted).toBe(false);
      expect(yt).not.toHaveBeenCalled();
      // The next press is the player's again, and mutes.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      expect(yt).toHaveBeenCalledTimes(1);
      expect(video().muted).toBe(true);
      player().classList.remove('ad-showing');
      await flush();
      expect(video().muted).toBe(true);
    });

    it('one press on the player\'s mute button gives sound', async () => {
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      player().querySelector<HTMLButtonElement>('.ytp-mute-button')!.click();
      expect(video().muted).toBe(false);
      expect(yt).not.toHaveBeenCalled();
      player().classList.remove('ad-showing');
      await flush();
      expect(video().muted).toBe(false);
    });

    it('a person muted before the ad: Off did not mute, so the press is the player\'s', async () => {
      ytMuted = true;
      video().muted = true;
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      expect(yt).toHaveBeenCalledTimes(1);
      expect(video().muted).toBe(false);
    });

    it('an M typed into search is never taken from the page', async () => {
      stop = startPlayerAdCover();
      player().classList.add('ad-showing');
      await flush();
      const search = document.createElement('input');
      document.body.appendChild(search);
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      expect(yt).toHaveBeenCalledTimes(1);
    });
  });

  describe('the hook, once per ad, with the last words the player shows about it', () => {
    const module = () => player().querySelector('.ytp-ad-module')!;
    /** Fake clocks for one test; the cover's own once-a-second look for the player is one of the timers. */
    async function withClock(body: () => Promise<void>): Promise<void> {
      vi.useFakeTimers();
      try { await body(); } finally { vi.useRealTimers(); }
    }
    const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

    it('is called once, with the player and its words, when they have settled', () => withClock(async () => {
      module().insertAdjacentHTML('afterbegin', '<div class="ytp-ad-avatar-lockup-card__headline">Brand</div>');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      player().classList.add('ytp-ad-interrupting');
      await tick(2100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'Brand'); // the Skip button's word is the player's
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('once, when YouTube swaps the video element during the ad', async () => {
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await flush();
      video().replaceWith(document.createElement('video'));
      await flush();
      expect(video().muted).toBe(true);
      player().classList.remove('ad-showing');
      await new Promise((r) => setTimeout(r, 1100)); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(1);
    });

    it('once, when YouTube swaps the whole player during the ad', () => withClock(async () => {
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      const next = player().cloneNode(true) as HTMLElement;
      player().replaceWith(next);
      await tick(1100); // the player is looked for again
      expect(video().muted).toBe(true);
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('a player taken away during the ad ends it: reported once, nothing left waiting', () => withClock(async () => {
      module().innerHTML = ''; // no words yet: only the ad's end can report it before the wait
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      __flushHiddenCountForTest(); // the hide counter's own write timer (and what its write starts) is not the cover's
      player().remove();
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1); // only the look for the player
    }));

    it('keeps the last words, not the first piece, and catches a text rewritten in place', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      module().innerHTML = '<span>Sponsored</span> <a>x</a>';
      await tick(500);
      module().querySelector('a')!.firstChild!.nodeValue = 'example.com'; // a text node rewritten, no child added
      await tick(500);
      expect(onAd).not.toHaveBeenCalled();
      await tick(2100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'Sponsored example.com');
    }));

    it('the countdown is not part of the words and does not hold the report back', () => withClock(async () => {
      module().innerHTML = '<span>Sponsored</span> <span class="t">0:15</span>';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      for (let s = 14; s > 11; s -= 1) {
        module().querySelector('.t')!.firstChild!.nodeValue = `0:${s}`;
        await tick(1000);
      }
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'Sponsored');
    }));

    it('an ad with no words waits for them, and is reported without them only at its end, once', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      __flushHiddenCountForTest(); // the hide counter's own write timer is not the cover's
      expect(vi.getTimerCount()).toBe(1); // only the look for the player: no wait is armed while no words show
      await tick(5000);
      expect(onAd).not.toHaveBeenCalled();
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), '');
    }));

    it('words the player draws late are in the record (load 2 of the tester\'s run on ddf472b9)', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(3000);
      module().innerHTML = '<div class="ytp-ad-avatar-lockup-card__headline">Late Brand</div>';
      await tick(2100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'Late Brand');
    }));

    it('the ad state leaving and coming back at once is the same ad: one record, with its words', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(200);
      player().classList.remove('ad-showing');
      await tick(300);
      player().classList.add('ad-showing');
      await tick(500);
      module().innerHTML = '<div class="ytp-ad-avatar-lockup-card__headline">Brand</div>';
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'Brand');
    }));

    it('a wordless ad is written when the tab closes or reloads, once', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(500);
      window.dispatchEvent(new Event('pagehide'));
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), '');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('an ad is written when YouTube moves to another video, once, and the next video\'s ad is its own', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(500);
      document.dispatchEvent(new Event('yt-navigate-start'));
      expect(onAd).toHaveBeenCalledTimes(1);
      module().innerHTML = '<div class="ytp-ad-avatar-lockup-card__headline">Same ad, words drawn late</div>';
      await tick(1100); // the same ad still on screen: not written again
      expect(onAd).toHaveBeenCalledTimes(1);
      player().classList.remove('ad-showing');
      await tick(1100);
      player().classList.add('ad-showing'); // the next video's own ad
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(2);
    }));

    it('YouTube moves to the next video mid-ad and its new player binds already showing an ad: one record each', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(500);
      document.dispatchEvent(new Event('yt-navigate-start'));
      expect(onAd).toHaveBeenCalledTimes(1);
      const next = player().cloneNode(true) as HTMLElement; // the next video's player, its own ad already on
      player().replaceWith(next);
      await tick(1100); // the player is looked for again
      next.classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(2);
    }));

    it('the navigation finishing on another video with an ad on in the same player: that ad is the next video\'s, with its own record', () => withClock(async () => {
      const before = location.href;
      history.replaceState(null, '', '/watch?v=first');
      try {
        module().innerHTML = '';
        const onAd = vi.fn();
        stop = startPlayerAdCover(onAd);
        player().classList.add('ad-showing');
        await tick(500);
        document.dispatchEvent(new Event('yt-navigate-start'));
        history.pushState(null, '', '/watch?v=second');
        document.dispatchEvent(new Event('yt-navigate-finish'));
        await tick(10);
        player().classList.remove('ad-showing');
        await tick(1100);
        expect(onAd).toHaveBeenCalledTimes(2);
      } finally {
        history.replaceState(null, '', before);
      }
    }));

    it('the navigation finishing on the same video with the same ad still showing: one record', () => withClock(async () => {
      const before = location.href;
      history.replaceState(null, '', '/watch?v=same');
      try {
        module().innerHTML = '';
        const onAd = vi.fn();
        stop = startPlayerAdCover(onAd);
        player().classList.add('ad-showing');
        await tick(500);
        document.dispatchEvent(new Event('yt-navigate-start'));
        history.pushState(null, '', '/watch?v=same&t=0');
        document.dispatchEvent(new Event('yt-navigate-finish'));
        await tick(10);
        player().classList.remove('ad-showing');
        await tick(1100);
        expect(onAd).toHaveBeenCalledTimes(1);
      } finally {
        history.replaceState(null, '', before);
      }
    }));

    it('"1 of 1" still wordless when the ad state leaves and returns: its words, drawn after, are its record', () => withClock(async () => {
      module().innerHTML = marks('1 of 1', '');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(300);
      player().classList.remove('ad-showing');
      await tick(300);
      player().classList.add('ad-showing');
      await tick(10);
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'Brand';
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'Brand');
    }));

    it('a pair whose ad state leaves and returns inside the grace, the next ad\'s place drawn late: each ad its own words', () => withClock(async () => {
      module().innerHTML = marks('1 of 2', 'first.example');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(500);
      player().classList.remove('ad-showing');
      await tick(300);
      player().classList.add('ad-showing');
      await tick(10);
      // The second ad's words are drawn while the place still reads "1 of 2", then blank, then "2 of 2".
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'second.example';
      await tick(10);
      module().querySelector('.ytp-ad-pod-index div')!.textContent = '';
      await tick(10);
      module().querySelector('.ytp-ad-pod-index div')!.textContent = '2 of 2';
      await tick(10);
      expect(onAd).toHaveBeenNthCalledWith(1, player(), 'first.example');
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(2);
      expect(onAd).toHaveBeenNthCalledWith(2, player(), 'second.example');
    }));

    it('only the ad\'s own words: the player\'s buttons, info, badge, place and Skip are left out, in any language', () => withClock(async () => {
      // The shapes read signed out on live watch pages, 9 Oct 2026.
      module().innerHTML = `
        <div class="ytp-ad-player-overlay-layout__ad-info-container">
          <div class="ytp-ad-avatar-lockup-card__text_container">
            <div class="ad-simple-attributed-string ytp-ad-avatar-lockup-card__headline">Sample Whitening Paste</div>
            <div class="ad-simple-attributed-string ytp-ad-avatar-lockup-card__description">example-shop.test</div>
          </div>
          <button class="ytp-ad-button-vm ytp-ad-component--clickable"><span class="ytp-ad-button-vm__text">Vino și tu</span></button>
          <span class="ytp-visit-advertiser-link ytp-ad-component--clickable"><span class="ytp-visit-advertiser-link__text">example-shop.test</span></span>
          <div class="ytp-ad-badge--clean-player"><div class="ad-simple-attributed-string ytp-ad-badge__text--clean-player">Sponsorizat</div></div>
          <div class="ytp-ad-pod-index"><div class="ad-simple-attributed-string">2 din 2</div></div>
          <div class="ytp-ad-hover-text-button ytp-ad-info-hover-text-button"><div class="ytp-ad-hover-text-container">Centrul meu de anunțuri</div></div>
        </div>
        <button class="ytp-skip-ad-button"><div class="ytp-skip-ad-button__text">Omite</div></button>`;
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(2100);
      expect(onAd).toHaveBeenCalledWith(player(), 'Sample Whitening Paste example-shop.test');
    }));

    // The player's own marks, as read signed out on live watch pages (9 Oct 2026): "Sponsored" in its badge, the place
    // in a pair in .ytp-ad-pod-index beside it, the advertiser's words in their own card.
    const marks = (place: string, copy: string) =>
      `<div class="ytp-ad-pod-index"><div class="ad-simple-attributed-string">${place}</div></div> `
      + '<div class="ytp-ad-badge--clean-player"><div class="ad-simple-attributed-string ytp-ad-badge__text--clean-player">Sponsored</div></div> '
      + `<div class="ytp-ad-avatar-lockup-card__headline">${copy}</div>`;

    it('two ads of a pair under one ad state: two reports, each with its own words', () => withClock(async () => {
      module().innerHTML = marks('1 of 2', 'first.example');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(500);
      module().querySelector('.ytp-ad-pod-index div')!.firstChild!.nodeValue = '2 of 2';
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'second.example';
      await tick(10);
      expect(onAd).toHaveBeenNthCalledWith(1, player(), 'first.example');
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(2);
      expect(onAd).toHaveBeenNthCalledWith(2, player(), 'second.example');
    }));

    it('the advertiser\'s own "buy 1 get 2", then "buy 1 get 3", is not a place in a pair: one report', () => withClock(async () => {
      module().innerHTML = marks('', 'shop: buy 1 get 2');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'shop: buy 1 get 3';
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('an advertiser\'s copy does not hide the real place: "2 of 3 colours" beside "1 of 2", then "2 of 2"', () => withClock(async () => {
      module().innerHTML = marks('1 of 2', '2 of 3 colours');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      module().querySelector('.ytp-ad-pod-index div')!.firstChild!.nodeValue = '2 of 2';
      await tick(10);
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('two ads loaded one after the other into the same element, the second drawing its own words: two reports', () => withClock(async () => {
      module().innerHTML = '<div class="ytp-ad-avatar-lockup-card__headline">first.example</div>';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/first-ad'); // the first ad fills in
      await tick(500);
      video().setAttribute('src', 'blob:https://www.youtube.com/second-ad');
      await tick(10);
      expect(onAd).toHaveBeenCalledTimes(1);
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'second.example';
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(2);
      expect(onAd).toHaveBeenNthCalledWith(1, player(), 'first.example');
      expect(onAd).toHaveBeenNthCalledWith(2, player(), 'second.example');
    }));

    // The tester's run on the 82799f35 zips (crew/tester/REPORT-2026-10-09-youtube-ads.md, re-cut): a pair wrote a third,
    // wordless record after its last ad, and a single ad two. The person's video comes back into the element while the
    // ad state still holds; on its old source or a new one, that is the ad ending, not another ad.
    it('the person\'s video coming back on its old source before the ad state leaves is that ad ending: one report', () => withClock(async () => {
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      await tick(10);
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-ad');
      await tick(500);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video'); // ad state still on
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('a single ad with words, the person\'s video back on a new source while the ad state lingers 3 s: one report, one count', () => withClock(async () => {
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video');
      module().innerHTML = '<div class="ytp-ad-avatar-lockup-card__headline">shop.example</div>';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      await tick(10);
      __flushHiddenCountForTest();
      vi.mocked(incrementMetricsHidden).mockClear();
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-ad');
      await tick(5000);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video-again'); // a new address for the person's video
      await tick(1000);
      module().innerHTML = ''; // the player takes its ad words away
      await tick(2000);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'shop.example');
      __flushHiddenCountForTest();
      const counted = vi.mocked(incrementMetricsHidden).mock.calls
        .reduce((n, call) => n + ((call[1] as Record<string, number> | undefined)?.['block-ads'] ?? 0), 0);
      expect(counted).toBe(1);
    }));

    // The same sequence is a pair of ads with no words and no place ("1 of 2") read: a new source alone cannot tell the
    // second ad from the person's video coming back, so both are one report. That pair is the known under-record, kept
    // on purpose, the safe direction (the head's check of ccd5f801); live, 18 of 19 ad reads showed a place. A sign of a
    // second ad without a place (its countdown restarting, its badge drawn again) needs its own test with that sign.
    it('a wordless single ad, the person\'s video back on a new source, or a wordless pair with no place read: one report', () => withClock(async () => {
      module().innerHTML = '';
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-ad');
      await tick(5000);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video-again');
      await tick(3000);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), '');
    }));

    it('a pair, then the person\'s video back on a new source while "2 of 2" and its words linger: two reports, each its own words', () => withClock(async () => {
      module().innerHTML = marks('1 of 2', 'amigo.example');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/first-ad');
      await tick(5000);
      video().setAttribute('src', 'blob:https://www.youtube.com/second-ad'); // the second ad's source, its place still "1 of 2"
      await tick(10);
      module().querySelector('.ytp-ad-pod-index div')!.textContent = '2 of 2';
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'concert.example';
      await tick(5000);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video-again'); // the person's video; the ad's marks linger
      await tick(3000);
      module().innerHTML = '';
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(2);
      expect(onAd).toHaveBeenNthCalledWith(1, player(), 'amigo.example');
      expect(onAd).toHaveBeenNthCalledWith(2, player(), 'concert.example');
    }));

    it('a pair whose second ad shows its words before its place: two reports, not three', () => withClock(async () => {
      module().innerHTML = marks('1 of 2', 'amigo.example');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/first-ad');
      await tick(5000);
      video().setAttribute('src', 'blob:https://www.youtube.com/second-ad');
      await tick(10);
      module().querySelector('.ytp-ad-avatar-lockup-card__headline')!.textContent = 'concert.example'; // words first
      await tick(300);
      module().querySelector('.ytp-ad-pod-index div')!.textContent = '2 of 2'; // then its place
      await tick(5000);
      player().classList.remove('ad-showing');
      await tick(1100);
      expect(onAd).toHaveBeenCalledTimes(2);
      expect(onAd).toHaveBeenNthCalledWith(2, player(), 'concert.example');
    }));

    it('the element still holding the person\'s video when the ad starts, then the ad\'s source: one ad, one report', () => withClock(async () => {
      video().setAttribute('src', 'blob:https://www.youtube.com/the-video');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      await tick(10);
      player().classList.add('ad-showing');
      await tick(10);
      video().setAttribute('src', 'blob:https://www.youtube.com/the-ad');
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(1);
    }));

    it('a module emptied as the ad ends keeps the last words in the report', () => withClock(async () => {
      module().innerHTML = marks('', 'shop.example');
      const onAd = vi.fn();
      stop = startPlayerAdCover(onAd);
      player().classList.add('ad-showing');
      await tick(500);
      module().innerHTML = '';
      await tick(10);
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      expect(onAd).toHaveBeenCalledTimes(1);
      expect(onAd).toHaveBeenCalledWith(player(), 'shop.example');
    }));

    it('the wait is cleared when the ad ends and when the cover stops', () => withClock(async () => {
      module().innerHTML = '<div class="ytp-ad-avatar-lockup-card__headline">Brand</div>';
      stop = startPlayerAdCover(vi.fn());
      player().classList.add('ad-showing');
      await tick(10);
      __flushHiddenCountForTest(); // the hide counter's own write timer is not the cover's
      expect(vi.getTimerCount()).toBe(2); // the look for the player, and the wait
      player().classList.remove('ad-showing');
      await tick(1100); // the ad's end, after the grace for a brief leave
      __flushHiddenCountForTest();
      expect(vi.getTimerCount()).toBe(1);
      player().classList.add('ad-showing');
      await tick(10);
      __flushHiddenCountForTest();
      expect(vi.getTimerCount()).toBe(2);
      stop();
      stop = () => {};
      expect(vi.getTimerCount()).toBe(0);
    }));
  });

  it('with sound events arriving late, a person who unmutes before Off\'s own event and then mutes stays muted after', async () => {
    laterSoundEvents(video());
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush(); // Off mutes; its event is still queued
    personTouches();
    video().muted = false; // before Off's event arrives
    await flush();
    await flush();
    personTouches();
    video().muted = true;
    await flush();
    player().classList.remove('ad-showing');
    await flush();
    expect(video().muted).toBe(true);
  });

  it('with sound events arriving late, the page turning the sound on before Off\'s own event is muted again', async () => {
    laterSoundEvents(video());
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    video().muted = false; // the page, before Off's event arrives
    await flush();
    await flush();
    await flush();
    expect(video().muted).toBe(true);
  });

  it('the stop gives the sound back and takes its style away', async () => {
    stop = startPlayerAdCover();
    player().classList.add('ad-showing');
    await flush();
    stop();
    stop = () => {};
    expect(video().muted).toBe(false);
    expect(document.getElementById('fw-yt-player-ad')).toBeNull();
  });
});
