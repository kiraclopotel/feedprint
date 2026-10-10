// @vitest-environment jsdom
// Privacy-gate invariant tests (CYCLE N+30).
//
// FW must NEVER extract DOM content from private-message surfaces.
// VISION §0 + §1.1: public-feed protection only — DMs are out of scope.
// This file locks the URL-pattern coverage so any future change that
// accidentally weakens the gate fails the suite before shipping. Add
// new platform DM patterns to BOTH the test cases AND
// `src/content/platforms/adapter.ts:PRIVATE_SURFACE_PATTERNS`.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectCurrentPlatform,
  isPrivateMessageSurface,
  hasActiveChatOverlay,
  findChatOverlayAncestor,
} from '../../../../src/content/platforms/adapter';

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, search: '', hash: '' },
    writable: true,
    configurable: true,
  });
}

describe('isPrivateMessageSurface — DM URL coverage', () => {
  beforeEach(() => {
    setLocation('www.facebook.com', '/');
  });

  describe('Facebook Messenger surfaces', () => {
    const samples = [
      '/messages',
      '/messages/',
      '/messages/t/1234567890',
      '/messages/t/abc-conversation-id',
      '/messenger',
      '/messenger/',
      '/messenger/100012345',
    ];
    for (const path of samples) {
      it(`flags facebook.com${path} as private`, () => {
        setLocation('www.facebook.com', path);
        expect(isPrivateMessageSurface()).toBe(true);
        expect(detectCurrentPlatform()).toBeNull();
      });
    }
  });

  describe('Instagram direct surfaces', () => {
    const samples = ['/direct', '/direct/', '/direct/inbox', '/direct/t/1234567890'];
    for (const path of samples) {
      it(`flags instagram.com${path} as private`, () => {
        setLocation('www.instagram.com', path);
        expect(isPrivateMessageSurface()).toBe(true);
        expect(detectCurrentPlatform()).toBeNull();
      });
    }
  });

  describe('Twitter / X message surfaces', () => {
    const samples = ['/messages', '/messages/', '/messages/compose', '/messages/1234567890'];
    for (const host of ['twitter.com', 'x.com']) {
      for (const path of samples) {
        it(`flags ${host}${path} as private`, () => {
          setLocation(host, path);
          expect(isPrivateMessageSurface()).toBe(true);
          expect(detectCurrentPlatform()).toBeNull();
        });
      }
    }
  });

  describe('TikTok message + inbox surfaces', () => {
    const samples = ['/messages', '/messages/', '/messages/1234', '/inbox', '/inbox/'];
    for (const path of samples) {
      it(`flags tiktok.com${path} as private`, () => {
        setLocation('www.tiktok.com', path);
        expect(isPrivateMessageSurface()).toBe(true);
        expect(detectCurrentPlatform()).toBeNull();
      });
    }
  });
});

describe('isPrivateMessageSurface — public URLs must remain scannable', () => {
  const cases: Array<{ host: string; path: string; expected: string }> = [
    { host: 'www.facebook.com', path: '/', expected: 'facebook' },
    { host: 'www.facebook.com', path: '/home', expected: 'facebook' },
    { host: 'www.facebook.com', path: '/reel/1234', expected: 'facebook' },
    { host: 'www.facebook.com', path: '/marketplace', expected: 'facebook' },
    { host: 'www.facebook.com', path: '/groups/somegroup', expected: 'facebook' },
    // Usernames that happen to start with the substring (must NOT match — patterns anchor on path start)
    { host: 'www.facebook.com', path: '/messagesUser', expected: 'facebook' },
    { host: 'www.facebook.com', path: '/inboxFan', expected: 'facebook' },
    { host: 'www.instagram.com', path: '/', expected: 'instagram' },
    { host: 'www.instagram.com', path: '/somehandle/', expected: 'instagram' },
    { host: 'www.instagram.com', path: '/p/CXyz123', expected: 'instagram' },
    { host: 'www.instagram.com', path: '/reels/abc', expected: 'instagram' },
    { host: 'www.instagram.com', path: '/directHandle', expected: 'instagram' },
    { host: 'twitter.com', path: '/', expected: 'twitter' },
    { host: 'x.com', path: '/home', expected: 'twitter' },
    { host: 'x.com', path: '/somehandle/status/1234', expected: 'twitter' },
    { host: 'www.tiktok.com', path: '/', expected: 'tiktok' },
    { host: 'www.tiktok.com', path: '/@creator', expected: 'tiktok' },
    { host: 'www.tiktok.com', path: '/foryou', expected: 'tiktok' },
    { host: 'www.youtube.com', path: '/watch', expected: 'youtube' },
    { host: 'www.youtube.com', path: '/shorts/abc123', expected: 'youtube' },
  ];
  for (const { host, path, expected } of cases) {
    it(`allows ${host}${path}`, () => {
      setLocation(host, path);
      expect(isPrivateMessageSurface()).toBe(false);
      expect(detectCurrentPlatform()).toBe(expected);
    });
  }
});

describe('isPrivateMessageSurface — case-insensitive', () => {
  it('flags /MESSAGES (uppercase)', () => {
    setLocation('www.facebook.com', '/MESSAGES');
    expect(isPrivateMessageSurface()).toBe(true);
  });

  it('flags /Messages/t/123 (mixed case)', () => {
    setLocation('www.facebook.com', '/Messages/t/123');
    expect(isPrivateMessageSurface()).toBe(true);
  });
});

describe('isPrivateMessageSurface — 2026-05-27 sub-path coverage', () => {
  // Pre-2026-05-27 the patterns were anchored to `^/` only; sub-path DM
  // URLs (FB marketplace messenger, FB group chat, FB permalink chat)
  // would pass through. A 2026-05-27 incident: FW rewrote an outgoing
  // Messenger message; the chat URL was a sub-path the old
  // gate missed. New patterns: `(^|\/)keyword(\/|$)` — match anywhere.
  const subPathCases = [
    'www.facebook.com:/marketplace/messages',
    'www.facebook.com:/marketplace/messages/t/123',
    'www.facebook.com:/groups/somegroup/chat',
    'www.facebook.com:/groups/somegroup/messages',
    'www.facebook.com:/groups/somegroup/chat/abc',
    'www.facebook.com:/page/somepage/messages',
    'www.facebook.com:/permalink/messages',
    'www.instagram.com:/somehandle/direct/abc',
    'x.com:/somehandle/dm',
    'www.tiktok.com:/somehandle/inbox',
  ];
  for (const c of subPathCases) {
    const [host, path] = c.split(':');
    it(`flags sub-path private surface ${host}${path}`, () => {
      setLocation(host, path);
      expect(isPrivateMessageSurface()).toBe(true);
      expect(detectCurrentPlatform()).toBeNull();
    });
  }

  // FW must NOT flag random paths that contain DM keywords as
  // substrings without the path-segment boundary.
  const benignSubPaths = [
    'www.facebook.com:/messagesUser',
    'www.facebook.com:/some/messagesfan/page',
    'www.facebook.com:/inboxFan',
    'www.facebook.com:/some/chatterbox',  // 'chat' is a prefix of 'chatterbox' — no slash-or-end boundary
    'www.instagram.com:/directHandle',
    'www.instagram.com:/some/conversationalist',
  ];
  for (const c of benignSubPaths) {
    const [host, path] = c.split(':');
    it(`does NOT flag benign sub-path ${host}${path}`, () => {
      setLocation(host, path);
      expect(isPrivateMessageSurface()).toBe(false);
    });
  }
});

describe('hasActiveChatOverlay — DOM-level chat detection', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    setLocation('www.facebook.com', '/home');
  });

  it('returns false on a clean DOM (no dialogs)', () => {
    expect(hasActiveChatOverlay()).toBe(false);
  });

  it('returns false when a [role="dialog"] exists but its aria-label is not chat-related', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Photo viewer');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(false);
  });

  it('detects FB Messenger chat-head popup (English aria-label "Messages")', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Messages');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects "Chat with X" English label', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Chat with Maria');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects Romanian label "Mesaje"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Mesaje');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects Romanian "Conversație cu X"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Conversație cu Maria');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects Spanish "Mensajes"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Mensajes');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects French "Discussion avec X"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Discussion avec Maria');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects German "Nachrichten"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Nachrichten');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects Italian "Messaggi"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Messaggi');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('detects Portuguese "Mensagens"', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Mensagens');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });

  it('case-insensitive — detects "MESSAGES" all-caps', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'MESSAGES');
    document.body.appendChild(dlg);
    expect(hasActiveChatOverlay()).toBe(true);
  });
});

describe('findChatOverlayAncestor — per-element walk', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    setLocation('www.facebook.com', '/home');
  });

  it('returns null when element has no chat-dialog ancestor', () => {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    document.body.appendChild(article);
    expect(findChatOverlayAncestor(article)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findChatOverlayAncestor(null)).toBeNull();
  });

  it('returns the dialog ancestor when present (chat bubble inside Messages dialog)', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Messages');
    const inner = document.createElement('div');
    const bubble = document.createElement('span');
    bubble.textContent = 'hi there';
    inner.appendChild(bubble);
    dlg.appendChild(inner);
    document.body.appendChild(dlg);
    const result = findChatOverlayAncestor(bubble);
    expect(result).toBe(dlg);
  });

  it('walks past non-dialog ancestors to find the chat dialog', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Conversație cu Maria');
    const layer1 = document.createElement('div');
    const layer2 = document.createElement('section');
    const text = document.createElement('span');
    layer2.appendChild(text);
    layer1.appendChild(layer2);
    dlg.appendChild(layer1);
    document.body.appendChild(dlg);
    expect(findChatOverlayAncestor(text)).toBe(dlg);
  });

  it('returns null when the only ancestor dialog is a non-chat dialog', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-label', 'Photo viewer');
    const inner = document.createElement('span');
    dlg.appendChild(inner);
    document.body.appendChild(dlg);
    expect(findChatOverlayAncestor(inner)).toBeNull();
  });
});

describe('isPrivateMessageSurface — defensive', () => {
  it('returns false when window is in a state without pathname', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '' },
      writable: true,
      configurable: true,
    });
    expect(isPrivateMessageSurface()).toBe(false);
  });
});
