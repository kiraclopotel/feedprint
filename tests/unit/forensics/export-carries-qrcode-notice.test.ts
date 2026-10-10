// Every export carries the qrcode-generator MIT notice, in front of the library it covers.
//
// Each exported HTML file embeds a full copy of qrcode-generator 2.0.4 so the recipient's browser can
// draw a scannable code offline. MIT's single condition is that the copyright and permission notice
// travel with every copy. Until 2026-09-16 the notice lived only in THIRD-PARTY-NOTICES.md in the
// repository, which never reaches a recipient, so every export ever handed to a school or a lawyer
// was a copy of the library without its licence.
//
// This builds a real export in all four languages and checks three things: the notice is there, it
// is the licence and not a mention of one, and it sits directly in front of the library, so a reader
// can tell which code it covers.
import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { QR_LIB_NOTICE, QR_LIB_SOURCE } from '../../../src/forensics/qrcode-vendor';

const meta: ExportMetadata = {
  fwVersion: 'licence probe',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' },
  publicKeyFingerprint: 'fp',
  locale: 'en',
};

describe('the qrcode-generator notice', () => {
  it('is the MIT licence itself, with its copyright line and its one condition', () => {
    expect(QR_LIB_NOTICE).toMatch(/^\/\*!/);
    expect(QR_LIB_NOTICE).toContain('Copyright (c) 2009 Kazuhiko Arase');
    expect(QR_LIB_NOTICE).toContain('The above copyright notice and this permission notice shall be included in');
    expect(QR_LIB_NOTICE).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    // Written into a <script>: nothing in it may end the comment or the element early.
    expect(QR_LIB_NOTICE.slice(3, -4)).not.toContain('*/');
    expect(QR_LIB_NOTICE).not.toMatch(/<\/script|<!--/i);
  });

  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('travels with the library in every export, in %s', (locale) => {
    const html = buildForensicHtmlExport([], { ...meta, locale });
    expect(html).toContain(`<script>${QR_LIB_NOTICE}${QR_LIB_SOURCE}</script>`);
  });
});
