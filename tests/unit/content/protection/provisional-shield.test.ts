// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyChildShield,
  commitChildShield,
  prepareChildShieldMutation,
  releaseChildShield,
} from '../../../../src/content/protection/provisional-shield';
import {
  _resetProtectionHealthForTesting,
  currentProtectionHealthSnapshot,
} from '../../../../src/diagnostics/protection-health';

const TOKEN_ATTRIBUTE = 'data-fw-provisional-shield-token';

beforeEach(() => {
  document.body.innerHTML = '';
  _resetProtectionHealthForTesting();
});

function makeHost(): {
  host: HTMLElement;
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
} {
  const host = document.createElement('article');
  const video = document.createElement('video');
  const audio = document.createElement('audio');
  host.append(video, audio);
  document.body.appendChild(host);
  return { host, video, audio };
}

describe('provisional Child shield', () => {
  it('synchronously mounts one opaque interaction-blocking shield and mutes without pausing', () => {
    const { host, video, audio } = makeHost();
    const videoPause = vi.spyOn(video, 'pause');
    const audioPause = vi.spyOn(audio, 'pause');
    audio.muted = true;

    const handle = applyChildShield(host, 'post-1');
    const again = applyChildShield(host, 'post-1');
    const overlays = host.querySelectorAll(':scope > .fw-provisional-shield');
    const overlay = overlays[0] as HTMLElement;
    const hostClick = vi.fn();
    host.addEventListener('click', hostClick);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const clickWasNotCancelled = overlay.dispatchEvent(click);

    expect(handle).not.toBeNull();
    expect(again).toBe(handle);
    expect(overlays).toHaveLength(1);
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('post-1');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.hasAttribute('inert')).toBe(true);
    expect(host.style.position).toBe('relative');
    expect(overlay.textContent, 'a plain veil: no words on it while it waits').toBe('');
    expect(overlay.getAttribute('aria-label')).toBe('Checking…');
    expect(overlay.style.position).toBe('absolute');
    expect(overlay.style.inset).toBe('0px');
    expect(overlay.style.pointerEvents).toBe('auto');
    expect(overlay.style.opacity).toBe('1');
    expect(overlay.style.backgroundColor).not.toBe('transparent');
    expect(overlay.style.getPropertyPriority('position')).toBe('important');
    expect(overlay.style.getPropertyPriority('background-color')).toBe('important');
    expect(clickWasNotCancelled).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    expect(hostClick).not.toHaveBeenCalled();
    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(true);
    expect(videoPause).not.toHaveBeenCalled();
    expect(audioPause).not.toHaveBeenCalled();
    const accessibleStatus = document.querySelector('.fw-provisional-shield-status');
    expect(accessibleStatus?.getAttribute('role')).toBe('status');
    expect(accessibleStatus?.textContent).toBe('One moment, checking this one…');
    expect(host.contains(accessibleStatus)).toBe(false);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');

    releaseChildShield(handle!);
    expect(document.querySelector('.fw-provisional-shield-status')).toBeNull();
  });

  it('renders a plain veil whose label and screen-reader line are Romanian when the resolved UI language is ro', () => {
    const { host } = makeHost();

    const handle = applyChildShield(host, 'ro-lang', { lang: 'ro' });
    const overlay = host.querySelector('.fw-provisional-shield') as HTMLElement;

    expect(handle).not.toBeNull();
    expect(overlay.textContent, 'a plain veil: no words on it while it waits').toBe('');
    expect(overlay.getAttribute('aria-label')).toBe('Se verifică…');
    const accessibleStatus = document.querySelector('.fw-provisional-shield-status');
    expect(accessibleStatus?.textContent).toBe('O clipă, verificăm postarea asta…');

    releaseChildShield(handle!);
  });

  it('keeps the English label and screen-reader line when lang is explicitly en', () => {
    const { host } = makeHost();

    const handle = applyChildShield(host, 'en-lang', { lang: 'en' });
    const overlay = host.querySelector('.fw-provisional-shield') as HTMLElement;

    expect(overlay.textContent, 'a plain veil: no words on it while it waits').toBe('');
    expect(overlay.getAttribute('aria-label')).toBe('Checking…');

    releaseChildShield(handle!);
  });

  it('uses the protected host colors instead of painting a light card on dark X', () => {
    const { host } = makeHost();
    host.style.backgroundColor = 'rgb(0, 0, 0)';
    host.style.color = 'rgb(231, 233, 234)';

    const handle = applyChildShield(host, 'dark-surface');

    expect(handle!.overlay.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(handle!.overlay.style.color).toBe('rgb(231, 233, 234)');
    releaseChildShield(handle!);
  });

  it('falls back to contrast-safe text when the page foreground matches its surface', () => {
    const { host } = makeHost();
    host.style.backgroundColor = 'rgb(255, 255, 255)';
    host.style.color = 'rgb(255, 255, 255)';

    const handle = applyChildShield(host, 'same-color-surface');

    expect(handle!.overlay.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(handle!.overlay.style.color).toBe('rgb(17, 24, 39)');
    releaseChildShield(handle!);
  });

  it('preserves live-region ownership when the page removes and a later cover recreates it', () => {
    const first = makeHost();
    const second = makeHost();
    const third = makeHost();
    const firstHandle = applyChildShield(first.host, 'live-region-a');
    const secondHandle = applyChildShield(second.host, 'live-region-b');
    document.querySelector('.fw-provisional-shield-status')?.remove();

    const thirdHandle = applyChildShield(third.host, 'live-region-c');
    const replacement = document.querySelector('.fw-provisional-shield-status');
    expect(replacement).not.toBeNull();

    releaseChildShield(thirdHandle!);
    expect(replacement?.isConnected).toBe(true);
    releaseChildShield(firstHandle!);
    expect(replacement?.isConnected).toBe(true);
    releaseChildShield(secondHandle!);
    expect(document.querySelector('.fw-provisional-shield-status')).toBeNull();
  });

  it('release restores exact prior position, ARIA, and mute state', () => {
    const { host, video, audio } = makeHost();
    host.style.setProperty('position', 'static', 'important');
    host.setAttribute('aria-busy', 'false');
    video.muted = false;
    audio.muted = true;
    const handle = applyChildShield(host, 'post-2');

    expect(handle).not.toBeNull();
    releaseChildShield(handle!);
    releaseChildShield(handle!);

    expect(host.querySelector('.fw-provisional-shield')).toBeNull();
    expect(host.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false);
    expect(host.style.getPropertyValue('position')).toBe('static');
    expect(host.style.getPropertyPriority('position')).toBe('important');
    expect(host.getAttribute('aria-busy')).toBe('false');
    expect(host.hasAttribute('inert')).toBe(false);
    expect(video.muted).toBe(false);
    expect(audio.muted).toBe(true);
  });

  it('replaces an owned token without adopting the old shield state', () => {
    const { host, video, audio } = makeHost();
    host.style.setProperty('position', 'static', 'important');
    host.setAttribute('aria-busy', 'false');
    video.muted = false;
    audio.muted = true;

    const oldHandle = applyChildShield(host, 'old-post');
    const oldOverlay = oldHandle!.overlay;
    const newHandle = applyChildShield(host, 'new-post');

    expect(newHandle).not.toBeNull();
    expect(newHandle).not.toBe(oldHandle);
    expect(oldOverlay.isConnected).toBe(false);
    expect(host.querySelectorAll(':scope > .fw-provisional-shield')).toHaveLength(1);
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('new-post');

    releaseChildShield(newHandle!);

    expect(host.querySelector('.fw-provisional-shield')).toBeNull();
    expect(host.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false);
    expect(host.style.getPropertyValue('position')).toBe('static');
    expect(host.style.getPropertyPriority('position')).toBe('important');
    expect(host.getAttribute('aria-busy')).toBe('false');
    expect(video.muted).toBe(false);
    expect(audio.muted).toBe(true);
  });

  it('does not claim or alter a host that already has non-static positioning', () => {
    const { host } = makeHost();
    host.style.position = 'absolute';
    const handle = applyChildShield(host, 'post-positioned');

    expect(handle).not.toBeNull();
    expect(host.style.position).toBe('absolute');
    releaseChildShield(handle!);
    expect(host.style.position).toBe('absolute');
  });

  it('commit removes provisional state but keeps descendant media muted', () => {
    const { host, video } = makeHost();
    video.muted = false;
    const handle = applyChildShield(host, 'post-3');

    expect(handle).not.toBeNull();
    commitChildShield(handle!);
    commitChildShield(handle!);

    expect(host.querySelector('.fw-provisional-shield')).toBeNull();
    expect(host.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false);
    expect(host.hasAttribute('aria-busy')).toBe(false);
    expect(host.style.position).toBe('');
    expect(video.muted).toBe(true);
  });

  it('token mismatch removes only the old overlay and never restores stale state', () => {
    const { host, video } = makeHost();
    const handle = applyChildShield(host, 'old-post');
    expect(handle).not.toBeNull();
    const oldOverlay = host.querySelector('.fw-provisional-shield') as HTMLElement;

    host.setAttribute(TOKEN_ATTRIBUTE, 'new-post');
    host.style.position = 'absolute';
    host.setAttribute('aria-busy', 'false');
    video.muted = false;
    const newOverlay = document.createElement('div');
    newOverlay.className = 'fw-provisional-shield';
    host.appendChild(newOverlay);

    releaseChildShield(handle!);

    expect(oldOverlay.isConnected).toBe(false);
    expect(newOverlay.isConnected).toBe(true);
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('new-post');
    expect(host.style.position).toBe('absolute');
    expect(host.getAttribute('aria-busy')).toBe('false');
    expect(video.muted).toBe(false);
  });

  it('same-token content replacement cannot restore the old content state', () => {
    const { host, audio } = makeHost();
    const body = document.createElement('span');
    body.textContent = 'first post';
    host.prepend(body);
    audio.muted = false;
    const handle = applyChildShield(host, 'reused-id');
    expect(handle).not.toBeNull();

    body.textContent = 'replacement post';
    host.style.setProperty('position', 'fixed', 'important');
    host.setAttribute('aria-busy', 'false');
    audio.muted = false;
    releaseChildShield(handle!);

    expect(host.querySelector('.fw-provisional-shield')).toBeNull();
    expect(host.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false);
    expect(host.style.getPropertyValue('position')).toBe('fixed');
    expect(host.style.getPropertyPriority('position')).toBe('important');
    expect(host.getAttribute('aria-busy')).toBe('false');
    expect(audio.muted).toBe(false);
  });

  it('cleans up owned state when harmless text changes while covered', () => {
    const { host, video } = makeHost();
    const body = document.createElement('span');
    body.textContent = 'stable post text';
    host.prepend(body);
    video.muted = false;
    const handle = applyChildShield(host, 'live-counter-change');

    body.append(' 1 like');
    releaseChildShield(handle!);

    expect(host.querySelector('.fw-provisional-shield')).toBeNull();
    expect(host.hasAttribute(TOKEN_ATTRIBUTE)).toBe(false);
    expect(host.hasAttribute('aria-busy')).toBe(false);
    expect(host.style.position).toBe('');
    expect(video.muted).toBe(false);
  });

  it('refuses a stale same-token reapply after the host was recycled', () => {
    const { host } = makeHost();
    const oldHandle = applyChildShield(host, 'old-post');
    expect(oldHandle).not.toBeNull();

    host.setAttribute(TOKEN_ATTRIBUTE, 'new-post');
    const staleReapply = applyChildShield(host, 'old-post');

    expect(staleReapply).toBeNull();
    expect(oldHandle!.overlay.isConnected).toBe(false);
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('new-post');
    expect(host.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it('restores the original baseline when a new token replaces an active shield', () => {
    const { host, video } = makeHost();
    host.setAttribute('aria-busy', 'false');
    video.muted = false;

    const first = applyChildShield(host, 'old-post');
    const second = applyChildShield(host, 'new-post');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(host.querySelectorAll(':scope > .fw-provisional-shield')).toHaveLength(1);
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('new-post');

    releaseChildShield(second!);

    expect(host.style.position).toBe('');
    expect(host.getAttribute('aria-busy')).toBe('false');
    expect(video.muted).toBe(false);
  });

  it('rotates a shared lease when the same owner scope presents a new identity', () => {
    const { host } = makeHost();
    host.prepend('same caption');
    const first = applyChildShield(host, 'post-owner-a', {
      shareExisting: true,
      ownerScope: 'post',
      ownerIdentity: 'twitter:a',
    });
    const firstOverlay = first!.overlay;
    const second = applyChildShield(host, 'post-owner-b', {
      shareExisting: true,
      ownerScope: 'post',
      ownerIdentity: 'twitter:b',
    });

    expect(first!.settled).toBe(true);
    expect(firstOverlay.isConnected).toBe(true);
    expect(second!.overlay).toBe(firstOverlay);
    expect(second).not.toBeNull();
    expect(host.querySelectorAll(':scope > .fw-provisional-shield')).toHaveLength(1);
    releaseChildShield(second!);
  });

  it('publishes one live host with each shared owner until the last terminal', () => {
    const { host } = makeHost();
    const post = applyChildShield(host, 'post-health', {
      shareExisting: true,
      ownerScope: 'post',
      ownerIdentity: 'twitter:post-health',
    });
    const video = applyChildShield(host, 'generic-health', {
      shareExisting: true,
      ownerScope: 'generic',
      ownerIdentity: 'twitter:generic-health',
    });

    expect(currentProtectionHealthSnapshot().liveHosts).toBe(1);
    expect(currentProtectionHealthSnapshot().owners).toEqual({
      post: 1, generic: 1,
    });

    releaseChildShield(post!);
    expect(currentProtectionHealthSnapshot().owners.generic).toBe(1);
    releaseChildShield(video!);
    expect(currentProtectionHealthSnapshot().liveHosts).toBe(0);
  });

  it('re-protects a reconciled host synchronously before its lease observer runs', () => {
    const host = document.createElement('article');
    host.textContent = 'first item';
    document.body.appendChild(host);
    const first = applyChildShield(host, 'first-token', {
      shareExisting: true,
      ownerScope: 'post',
      ownerIdentity: 'twitter:first',
    });
    const replacementVideo = document.createElement('video');
    replacementVideo.muted = false;

    host.removeAttribute(TOKEN_ATTRIBUTE);
    host.removeAttribute('aria-busy');
    host.removeAttribute('inert');
    host.replaceChildren(document.createTextNode('replacement item'), replacementVideo);
    const second = applyChildShield(host, 'second-token', {
      shareExisting: true,
      ownerScope: 'post',
      ownerIdentity: 'twitter:second',
    });

    expect(second).not.toBeNull();
    expect(first!.settled).toBe(true);
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('first-token');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.hasAttribute('inert')).toBe(true);
    expect(host.querySelectorAll(':scope > .fw-provisional-shield')).toHaveLength(1);
    expect(replacementVideo.muted).toBe(true);

    releaseChildShield(second!);
  });

  it('mutes media hydrated under an active cover and restores its exact baseline', async () => {
    const host = document.createElement('article');
    document.body.appendChild(host);
    const handle = applyChildShield(host, 'hydrated-release');
    const video = document.createElement('video');
    video.muted = false;

    host.appendChild(video);
    await Promise.resolve();

    expect(video.muted).toBe(true);
    releaseChildShield(handle!);
    expect(video.muted).toBe(false);
  });

  it('re-mutes media when volume controls try to unmute it under an active cover', () => {
    const { host, video } = makeHost();
    video.muted = false;
    const handle = applyChildShield(host, 'volume-guard');

    video.muted = false;
    video.dispatchEvent(new Event('volumechange', { bubbles: true }));

    expect(video.muted).toBe(true);
    releaseChildShield(handle!);
    expect(video.muted).toBe(false);
  });

  it('keeps an originally muted baseline after text drift and an unmute attempt', () => {
    const { host, audio } = makeHost();
    audio.muted = true;
    host.prepend('original caption');
    const handle = applyChildShield(host, 'muted-baseline');

    host.prepend('1 like ');
    audio.muted = false;
    audio.dispatchEvent(new Event('volumechange', { bubbles: true }));
    expect(audio.muted).toBe(true);

    releaseChildShield(handle!);
    expect(audio.muted).toBe(true);
  });

  it('restores the owned cover and mute guard after a same-host child rerender', async () => {
    const { host } = makeHost();
    const handle = applyChildShield(host, 'react-rerender');
    const replacementVideo = document.createElement('video');
    replacementVideo.muted = false;

    host.removeAttribute('aria-busy');
    host.removeAttribute('inert');
    host.style.removeProperty('position');
    host.replaceChildren(document.createTextNode('reconciled raw content'), replacementVideo);
    await Promise.resolve();

    expect(host.querySelector(':scope > .fw-provisional-shield')).not.toBeNull();
    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('react-rerender');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.hasAttribute('inert')).toBe(true);
    expect(host.style.getPropertyValue('position')).toBe('relative');
    expect(replacementVideo.muted).toBe(true);

    releaseChildShield(handle!);
    expect(replacementVideo.muted).toBe(false);
  });

  it('heals host-only removal of owned attributes before a terminal verdict', async () => {
    const { host, video } = makeHost();
    video.muted = false;
    const handle = applyChildShield(host, 'attribute-heal');

    host.removeAttribute(TOKEN_ATTRIBUTE);
    host.removeAttribute('aria-busy');
    host.removeAttribute('inert');
    host.style.removeProperty('position');
    await Promise.resolve();

    expect(host.getAttribute(TOKEN_ATTRIBUTE)).toBe('attribute-heal');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.hasAttribute('inert')).toBe(true);
    expect(host.style.getPropertyValue('position')).toBe('relative');
    expect(prepareChildShieldMutation(handle!)).toBe(true);
    releaseChildShield(handle!);
    expect(host.hasAttribute('inert')).toBe(false);
    expect(host.style.getPropertyValue('position')).toBe('');
    expect(video.muted).toBe(false);
  });

  it('keeps hydrated media muted when the final owner commits', async () => {
    const host = document.createElement('article');
    document.body.appendChild(host);
    const handle = applyChildShield(host, 'hydrated-commit');
    const audio = document.createElement('audio');
    audio.muted = false;
    host.appendChild(audio);
    await Promise.resolve();

    commitChildShield(handle!);

    expect(audio.muted).toBe(true);
  });
});
