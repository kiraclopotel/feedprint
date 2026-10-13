// The export prints the prompts a level really sends. Silent sent nothing out of the computer, so on 12 Oct 2026 the
// "How items were identified" block stopped printing two child prompts as if Silent's models received them (the owner's
// export, crew/reading/EXPORT-STUDY-2026-10-12.md) and said what Silent does in the file's four languages. The same day Silent
// began to read once a key is added and agreed to, so the block prints the comment instructions Silent receives with the others
// (the post judge is one text for Silent and Calm), in the names the screens use: Silent, Calm and Open.

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import { UI_LANGUAGES } from '../../../src/i18n';
import { I18N } from '../../../src/i18n/export-strings';
import type { ForensicRecord } from '../../../src/types/forensic';

const RECORD = {
  id: 'r-1', timestamp: '2026-10-12T12:00:00Z', platform: 'twitter', originalText: 'sample post', originalHash: 'abc123',
  originalLength: 11, neutralizedText: '', author: '@example', postUrl: 'https://x.com/example/status/1', techniques: [],
  overallScore: 0, userAgeCategory: 'child', aiSource: 'none', feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig',
  publicKeyFingerprint: 'fp123', chainPosition: 0, verdict: 'skipped', skipReason: 'level-reads-nothing',
} as unknown as ForensicRecord;

const exportFor = (locale: ExportMetadata['locale']): string => buildForensicHtmlExport([RECORD], {
  fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp123', locale,
  methodology: buildMethodologyBlock('1.2.3'),
});

describe('the export prints the prompts a level sends', () => {
  const html = exportFor('en');

  it('prints the comment instructions Silent receives, once, and the post judge once under both Silent and Calm', () => {
    expect(html).toContain('Comment judge: Silent (with a key and the agreement)');
    // The child comment text names a child of 8 to 12 and is printed under Silent's label.
    expect(html).toContain('8-12 year old child');
    expect(html.split('<summary>Post judge:').length - 1).toBe(1);
    expect(html).toContain('<summary>Post judge: Silent and Calm (not used for Open posts)');
    expect(html).not.toContain('Comment judge: Strict');
    expect(html).not.toContain('Post judge: Strict');
  });

  it("says what Silent does without a key, in the file's own language", () => {
    for (const lang of UI_LANGUAGES) {
      const note = I18N[lang].methodologyStrictNote;
      expect(note.length, lang).toBeGreaterThan(40);
      expect(exportFor(lang), lang).toContain(note.replace(/&/g, '&amp;'));
    }
    expect(html).toContain('Silent without a key: no model reads anything.');
  });

  it('still prints what Calm and Open receive, under the names the screens use', () => {
    expect(html).toContain('Comment judge: Calm (Open uses this framing)');
    expect(html).toContain('Open reader: every Open post, and the read-this button');
    expect(html).toContain('Rewriter');
    expect(html).not.toContain('Comment judge: Moderate');
    expect(html).not.toContain('Relaxed reader');
  });

  it('the note under the prompts says when Silent sends a prompt', () => {
    const block = buildMethodologyBlock('1.2.3');
    expect(block.prompts.promptsNote).toContain('Silent without a key sends no prompt at all');
    expect(block.prompts.promptsNote).toContain('with a key and the agreement it sends');
    expect(block.prompts.promptsNote).not.toContain('Strict');
  });
});
