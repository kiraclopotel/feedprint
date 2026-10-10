/** @vitest-environment jsdom */
//
// How many comments a reading of a "room" was made from must always be on the
// card, not only when the platform's own comment badge could be read.
//
// The environment record carries the model's sentence about a whole comment
// section and the number of comments it was made from. The card printed the
// number only when `totalVisible` was also a number, and that field is
// undefined whenever the platform's count could not be parsed. On those rooms
// a confident sentence about the discussion appeared with nothing saying it
// came from one or two comments.
//
// It is not a rare shape: of 286 environment records in the owner's 2026-09-08
// export, 154 rooms were read from fewer than four comments and 75 from a
// single one. The export already prints "· N comments read" whenever it has
// the number; the card now does the same.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function roomRecord(environment: Partial<NonNullable<ForensicRecord['environment']>>): ForensicRecord {
  return {
    id: 'fr-room', timestamp: '2026-09-08T00:00:00.000Z', platform: 'facebook',
    originalText: 'the room summary sentence', originalHash: 'h', originalLength: 20,
    neutralizedText: '', author: 'room', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'unknown', integrityHash: 'i',
    verdict: 'pass', kind: 'environment',
    environment: {
      label: 'healthy-discussion',
      summary: 'A civil exchange between a few people.',
      dominantTechnique: null,
      negativePct: 0, positivePct: 50, neutralPct: 50,
      sampled: 1,
      ...environment,
    },
  } as ForensicRecord;
}

let host: HTMLDivElement;
let root: Root;

async function render(record: ForensicRecord, lang: 'en' | 'ro' = 'en'): Promise<string> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang, children: createElement(FeedCard, { record }) }));
  });
  // The reading sits behind its own toggle, the way a user opens it. A second
  // render in one test reuses the same root, so the block may already be open.
  if (!host.querySelector('.fc-ai-block')) {
    const toggle = host.querySelector<HTMLButtonElement>('.fc-reveal-btn');
    if (toggle) await act(async () => { toggle.click(); });
  }
  return host.querySelector('.fc-ai-sample')?.textContent ?? '';
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('the card says how many comments a room reading was made from', () => {
  it('says it when the platform count is unknown, which is when it was silent before', async () => {
    expect(await render(roomRecord({ sampled: 1, totalVisible: undefined })))
      .toBe('1 comment read');
    expect(await render(roomRecord({ sampled: 3, totalVisible: undefined })))
      .toBe('3 comments read');
  });

  it('still says it with the denominator when the platform count was read', async () => {
    expect(await render(roomRecord({ sampled: 3, totalVisible: 500 })))
      .toBe('sampled 3 of 500 visible comments');
  });

  it('says it in the language the dashboard is in', async () => {
    expect(await render(roomRecord({ sampled: 1, totalVisible: undefined }), 'ro'))
      .toBe('1 comentariu citit');
    expect(await render(roomRecord({ sampled: 4, totalVisible: undefined }), 'ro'))
      .toBe('4 comentarii citite');
  });

  it('says nothing on a record that never carried a count', async () => {
    expect(await render(roomRecord({ sampled: undefined as unknown as number }))).toBe('');
  });
});
