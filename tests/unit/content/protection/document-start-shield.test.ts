// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTENT_READY_ATTRIBUTE,
  DOCUMENT_SHIELD_ATTRIBUTE,
  DOCUMENT_SHIELD_STYLE_ID,
  signalContentShieldReady,
  startDocumentStartShield,
  waitForDocumentBody,
} from '../../../../src/content/protection/document-start-shield';
import { applyChildShield, releaseChildShield } from '../../../../src/content/protection/provisional-shield';

const MANIFEST_PATH = 'manifest.json';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('document-start Child shield', () => {
  it('mounts synchronously before the storage mode read resolves', async () => {
    const mode = deferred<unknown>();
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: () => mode.promise,
    });

    expect(controller).not.toBeNull();
    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(true);
    expect(document.getElementById(DOCUMENT_SHIELD_STYLE_ID)?.textContent)
      .toContain('visibility: hidden !important');
    expect(document.documentElement.style.getPropertyValue('opacity')).toBe('0');
    expect(document.documentElement.style.getPropertyPriority('opacity')).toBe('important');

    mode.resolve('teen');
    await controller!.settled;
  });

  it('does not mount or read storage on a private-message surface', () => {
    const readMode = vi.fn(async () => 'child');

    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => true,
      readMode,
    });

    expect(controller).toBeNull();
    expect(readMode).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
    expect(document.getElementById(DOCUMENT_SHIELD_STYLE_ID)).toBeNull();
  });

  it.each(['teen', 'adult', 'invalid'])('releases as soon as non-Child mode %s resolves',
    async (mode) => {
      const controller = startDocumentStartShield({
        doc: document,
        isPrivateSurface: () => false,
        readMode: async () => mode,
      });

      expect(controller).not.toBeNull();
      await controller!.settled;

      expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
      expect(document.getElementById(DOCUMENT_SHIELD_STYLE_ID)).toBeNull();
    },
  );

  it('releases for the product Teen default when no mode key exists yet', async () => {
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => undefined,
    });

    await controller!.settled;
    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
  });

  it('holds Child fail-closed (does not release immediately) when storage or the extension context fails, leaving the timeout as sole release authority', async () => {
    vi.useFakeTimers();
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => { throw new Error('Extension context invalidated'); },
      timeoutMs: 5_000,
    });

    expect(controller).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);

    // A readMode rejection must not tear the curtain down immediately - that
    // would fail OPEN on the same storage-error class that getSettings()
    // resolves fail-CLOSED to Child. Only the 5s safety timeout may release.
    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(true);
    expect(document.getElementById(DOCUMENT_SHIELD_STYLE_ID)).not.toBeNull();
    expect(controller!.active).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    await controller!.settled;

    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
    expect(document.getElementById(DOCUMENT_SHIELD_STYLE_ID)).toBeNull();
    vi.useRealTimers();
  });

  it('restores pre-existing critical root styles exactly', async () => {
    document.documentElement.style.setProperty('opacity', '0.7', 'important');
    document.documentElement.style.setProperty('pointer-events', 'auto', 'important');
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'teen',
    });

    await controller!.settled;

    expect(document.documentElement.style.getPropertyValue('opacity')).toBe('0.7');
    expect(document.documentElement.style.getPropertyPriority('opacity')).toBe('important');
    expect(document.documentElement.style.getPropertyValue('pointer-events')).toBe('auto');
    document.documentElement.style.removeProperty('opacity');
    document.documentElement.style.removeProperty('pointer-events');
  });

  it('fails open if storage/readiness never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<unknown>(() => {});
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: () => never,
      timeoutMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await controller!.settled;

    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
    vi.useRealTimers();
  });

  it('keeps Child covered until content signals its initial item shields are ready', async () => {
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'child',
    });

    await flushPromises();
    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(true);

    signalContentShieldReady(document);
    await controller!.settled;

    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.hasAttribute(CONTENT_READY_ATTRIBUTE)).toBe(false);
    expect(document.getElementById(DOCUMENT_SHIELD_STYLE_ID)).toBeNull();
  });

  it('restores the inline root lock on readiness even if the host removed its token', async () => {
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'child',
    });
    await flushPromises();
    document.documentElement.removeAttribute(DOCUMENT_SHIELD_ATTRIBUTE);

    signalContentShieldReady(document);
    await controller!.settled;

    expect(document.documentElement.style.getPropertyValue('opacity')).toBe('');
    expect(document.documentElement.style.getPropertyValue('pointer-events')).toBe('');
  });

  it('restores the inline root lock on timeout even if the host removed its token', async () => {
    vi.useFakeTimers();
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: () => new Promise<unknown>(() => {}),
      timeoutMs: 100,
    });
    document.documentElement.removeAttribute(DOCUMENT_SHIELD_ATTRIBUTE);

    await vi.advanceTimersByTimeAsync(100);
    await controller!.settled;

    expect(document.documentElement.style.getPropertyValue('opacity')).toBe('');
    expect(document.documentElement.style.getPropertyValue('pointer-events')).toBe('');
    vi.useRealTimers();
  });

  it('mutes late-hydrated autoplay media until the Child handoff and restores its baseline', async () => {
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'child',
    });
    const video = document.createElement('video');
    video.muted = false;
    document.body.appendChild(video);
    video.dispatchEvent(new Event('playing'));
    await flushPromises();

    expect(video.muted).toBe(true);
    signalContentShieldReady(document);
    await controller!.settled;
    expect(video.muted).toBe(false);
  });

  it('re-mutes an active-curtain video after a volume control tries to unmute it', async () => {
    const video = document.createElement('video');
    video.muted = false;
    document.body.appendChild(video);
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'child',
    });
    expect(video.muted).toBe(true);

    video.muted = false;
    video.dispatchEvent(new Event('volumechange', { bubbles: true }));
    expect(video.muted).toBe(true);

    controller!.release();
    expect(video.muted).toBe(false);
  });

  it('hands the original mute baseline to an item shield without an audible gap', async () => {
    const video = document.createElement('video');
    video.muted = false;
    const host = document.createElement('article');
    host.appendChild(video);
    document.body.appendChild(host);

    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'child',
    });
    expect(video.muted).toBe(true);

    const itemShield = applyChildShield(host, 'root-item-handoff');
    expect(itemShield).not.toBeNull();
    signalContentShieldReady(document);
    await controller!.settled;

    // Root release must not create an audible interval while classification
    // remains pending under the item-level owner.
    expect(video.muted).toBe(true);
    releaseChildShield(itemShield!);
    expect(video.muted).toBe(false);
  });

  it('shares the mute handoff across separately evaluated bootstrap and content modules', async () => {
    vi.resetModules();
    const bootstrapModule = await import('../../../../src/content/protection/document-start-shield');
    const video = document.createElement('video');
    video.muted = false;
    const host = document.createElement('article');
    host.appendChild(video);
    document.body.appendChild(host);
    const controller = bootstrapModule.startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: async () => 'child',
    });
    expect(video.muted).toBe(true);

    // Simulate Vite's two independent IIFEs: content.js evaluates its own
    // document-start-shield module copy when importing provisional-shield.
    vi.resetModules();
    const contentModule = await import('../../../../src/content/protection/provisional-shield');
    const itemShield = contentModule.applyChildShield(host, 'split-bundle-handoff');
    controller!.release();

    expect(video.muted).toBe(true);
    contentModule.releaseChildShield(itemShield!);
    expect(video.muted).toBe(false);
  });

  it('does not miss a Child readiness signal that arrives before storage resolves', async () => {
    const mode = deferred<unknown>();
    const controller = startDocumentStartShield({
      doc: document,
      isPrivateSurface: () => false,
      readMode: () => mode.promise,
    });

    signalContentShieldReady(document);
    expect(document.documentElement.hasAttribute(CONTENT_READY_ATTRIBUTE)).toBe(true);

    mode.resolve('child');
    await controller!.settled;

    expect(document.documentElement.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.hasAttribute(CONTENT_READY_ATTRIBUTE)).toBe(false);
  });

  it('waits safely when content.js starts before document.body exists', async () => {
    const doc = document.implementation.createHTMLDocument('body-late');
    doc.body.remove();

    const bodyPromise = waitForDocumentBody(doc);
    const body = doc.createElement('body');
    doc.documentElement.appendChild(body);

    await expect(bodyPromise).resolves.toBe(body);
  });

  it('injects bootstrap before content at document_start with the same DM exclusions', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), MANIFEST_PATH), 'utf8'),
    ) as {
      content_scripts: Array<{
        js: string[];
        run_at: string;
        exclude_matches?: string[];
      }>;
    };
    const contentEntry = manifest.content_scripts.find(entry => entry.js.includes('content.js'));
    const pageWorldEntry = manifest.content_scripts.find(entry => entry.js.includes('page-world.js'));

    expect(contentEntry?.js).toEqual(['bootstrap.js', 'content.js']);
    expect(contentEntry?.run_at).toBe('document_start');
    expect(contentEntry?.exclude_matches).toEqual(pageWorldEntry?.exclude_matches);
  });
});
