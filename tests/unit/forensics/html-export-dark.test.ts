// The export on a dark device (12 Oct 2026, export polish U2). The page follows the reader's colour scheme, and a set of its rules
// held light literals that were written when it had one look: the empty part of every bar was #ececed (14.6:1 against the dark
// sheet, brighter than the coloured part beside it), the boxes for the time-stamp tokens, the AI instructions, the reconciliation
// badge, the cautious-reading caption, the rewrite pill and the platform and technique chips were #eef1f6, #eef7f9, #fbf1e3 and
// #f0f0f2 under light-scheme ink (1.2:1, unreadable), the check lines under each time stamp were fixed greens and reds that read
// 2.3 to 3.1:1, a label was #555, the web address under the scan code read 3.15:1, and the edges between sections were 1.29:1.
// The page's own CSS is the thing under test (a browser's colour engine is not in this suite); the sweep's measures of a built
// file in both schemes are the check on a real page, and the signed payload is checked byte for byte beside it.

import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { readSource } from '../../helpers/read-source';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function records(): ForensicRecord[] {
  return [1, 2, 3].map((n) => ({
    id: `fr-${n}`, timestamp: `2026-09-10T10:0${n}:00.000Z`, platform: 'twitter', originalText: `text ${n}`, originalHash: `hash-${n}`,
    originalLength: 6, neutralizedText: '', author: '@person', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: `ih-${n}`, signature: 'sig', publicKeyFingerprint: 'fp16', chainPosition: n,
    verdict: 'pass', kind: 'post',
  }) as unknown as ForensicRecord);
}

const html = buildForensicHtmlExport(records(), META);
const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
const noComments = style.replace(/\/\*[\s\S]*?\*\//g, '');
// The rules of the screen, before the print block (which restyles the code panel for paper).
const screen = noComments.slice(0, noComments.lastIndexOf('@media print'));
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...screen.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  expect(all.length, `a rule for ${selector}`).toBeGreaterThan(0);
  return all[all.length - 1][1];
};

describe('no box or track is a light literal under the page ink', () => {
  it('does not carry the light grounds the dark scheme could not read', () => {
    for (const literal of ['#ececed', '#eef1f6', '#eef7f9', '#fbf1e3', '#f0f0f2', '#f0dcc0', '#c8d0db']) {
      expect(noComments, literal).not.toContain(literal);
    }
  });

  it('draws one quiet ground for every empty bar track, and a well for the boxes that sit on the sheet, in both schemes', () => {
    expect(noComments).toMatch(/--well:color-mix\(in oklab,var\(--ink\) 6%,var\(--lift\)\);/);
    for (const track of ['.fw-exp-bartrack', '.fwb-skewtrack', '.fwb-segbar', '.fw-barrow .fw-bartrack']) {
      expect(rule(track), track).toContain('background:var(--well)');
    }
  });

  it('puts the time-stamp token box, the AI instruction box, the reconciliation badge, the caption and the chips on the well', () => {
    for (const box of ['.fw-anchor-tst', '.fw-mth-prompt pre', '.fw-recon-badge', '.fwb-cap', '.fw-tag']) {
      expect(rule(box), box).toContain('background:var(--well)');
    }
    // The pill and the badge keep an edge in the page's own line colour.
    // The rewrite pill is warm, not grey, from the warn token (U9): it keeps a cue that it is a beta, in both schemes.
    expect(rule('.fw-beta')).toContain('background:color-mix(in oklab,var(--warn) 10%,var(--lift))');
    expect(rule('.fw-recon-badge')).toContain('border:1px solid var(--line)');
  });
});

describe('the check lines and the manual badge use the page state colours', () => {
  it('reads pass, fail and warning from the page tokens, which hold in both schemes', () => {
    expect(rule('.fw-anchor-ok')).toContain('color:var(--ok)');
    expect(rule('.fw-anchor-bad')).toContain('color:var(--danger)');
    expect(rule('.fw-anchor-warn')).toContain('color:var(--warn)');
    const badge = rule('.fw-manual-badge');
    expect(badge).toContain('color:var(--warn)');
    expect(badge).toContain('border:1px solid var(--warn)');
    expect(badge).toContain('background:var(--lift)');
  });

  it('does not set the label of the time-stamp bytes in a fixed grey', () => {
    // The label is in the markup of a file that carries a time stamp, which this small file does not; the builder's source is read.
    const builder = readSource('src/forensics/html-export.ts');
    expect(builder).not.toContain('color:#555');
    expect(builder.match(/font-size:var\(--t3\);color:var\(--mut\);margin-top:\.4rem/g)).toHaveLength(2);
  });
});

describe('the scan code stays white, with ink that reads on it in both schemes', () => {
  it('keeps the code panel white and sets its text and its address in dark ink', () => {
    const holder = rule('.fw-qr-holder');
    expect(holder).toContain('background:#fff');
    expect(holder).toContain('color:#1a1a1a');
    expect(rule('.fw-qr-url')).toContain('color:#55565a');
  });
});

describe('the edges between sections show on the dark sheet', () => {
  it('sets the line colour in the dark block to a stronger mix of ink, and leaves the light one alone', () => {
    const dark = noComments.match(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\n\}/)![0];
    expect(dark).toContain('--line:color-mix(in oklab,var(--ink) 28%,var(--ground))');
    expect(noComments).toMatch(/--line:color-mix\(in oklab,var\(--ink\) 18%,var\(--ground\)\);/);
  });
});

describe('the dark-scheme rules change the style block and two inline colours of static markup only', () => {
  it('keeps the signed payload as one script of data, outside the style block', () => {
    const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    expect(payload).not.toBeNull();
    expect(payload![1]).toContain('"signature":"sig"');
    expect(style).not.toContain('fw-export-data');
  });
});
