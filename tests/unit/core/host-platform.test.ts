// The host-to-platform matcher, against the manifests themselves (PLAN-2026-09-16 item 6.9).
//
// The old matcher asked whether the hostname CONTAINED 'x.com', so netflix.com, vox.com and
// xbox.com were all X. The content script was shielded by the manifest, which injects only on the
// five real domains; the popup's coverage panel was not, and told a parent that netflix.com was a
// page FeelingWise protects. This test reads both manifests and requires the matcher to answer for
// every host they name, and to refuse the hosts that only look like them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platformOfHost } from '../../../src/core/host-platform';
import type { Platform } from '../../../src/types/post';

import { REPO_ROOT as ROOT } from '../../helpers/repo-root';

/** The site hosts a manifest injects into: `*://*.<domain>/*` patterns only. */
function manifestDomains(file: string): string[] {
  const m = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as {
    content_scripts?: Array<{ matches?: string[] }>;
    host_permissions?: string[];
  };
  const patterns = [
    ...(m.content_scripts ?? []).flatMap((cs) => cs.matches ?? []),
    ...(m.host_permissions ?? []),
  ];
  return [...new Set(patterns
    .map((p) => /^\*:\/\/\*\.([^/]+)\/\*$/.exec(p)?.[1])
    .filter((d): d is string => Boolean(d)))];
}

const EXPECTED: Record<string, Platform> = {
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'facebook.com': 'facebook',
  'youtube.com': 'youtube',
};

describe('platformOfHost', () => {
  for (const file of ['manifest.json', 'manifest.off.json']) {
    it(`answers for every site host in ${file}, bare and with a subdomain`, () => {
      const domains = manifestDomains(file);
      expect(domains.length).toBeGreaterThan(0);
      for (const domain of domains) {
        const expected = EXPECTED[domain];
        expect(expected, `${domain} is not in this test's table`).toBeDefined();
        expect(platformOfHost(domain), domain).toBe(expected);
        expect(platformOfHost(`www.${domain}`), `www.${domain}`).toBe(expected);
        expect(platformOfHost(`mobile.${domain}`), `mobile.${domain}`).toBe(expected);
        expect(platformOfHost(domain.toUpperCase()), 'case does not matter').toBe(expected);
        expect(platformOfHost(`${domain}.`), 'a trailing root dot is still the same host').toBe(expected);
      }
    });
  }

  it('refuses a host that merely contains one of the names', () => {
    for (const host of [
      'netflix.com', 'vox.com', 'xbox.com', 'phx.com', 'x.community.example',
      'notfacebook.com', 'myinstagram.com.evil.example', 'tiktok.com.evil.example',
      'youtube.com.phishing.example', 'x.com.evil.example', 'twitter.com.evil.example',
    ]) {
      expect(platformOfHost(host), host).toBeNull();
    }
  });

  it('refuses nothing at all', () => {
    expect(platformOfHost('')).toBeNull();
    expect(platformOfHost(undefined)).toBeNull();
    expect(platformOfHost(null)).toBeNull();
  });
});
