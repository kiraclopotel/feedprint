// Page builders for the record audit: one card as each site draws it, and the pipeline results the
// post path is handed. Shared by the producer and display tests so a row of the audit is one call.

import { vi } from 'vitest';
import type { AnalysisResult } from '../../src/types/analysis';
import type { NeutralizedContent } from '../../src/types/neutralization';
import type { PipelineResult } from '../../src/analysis/pipeline';
import type { PostContent } from '../../src/types/post';

export type Mode = 'child' | 'teen' | 'adult';
export type Site = 'tiktok' | 'reel' | 'x' | 'facebook' | 'instagram' | 'youtube';

export const CAPTION = 'you will never be enough unless you buy this';
export const REWRITE = 'this product is being promoted here';

export interface Card {
  site: Site;
  /** What the adapter hands the post path as domRef. */
  anchor: HTMLElement;
  /** The video item on TikTok and Instagram Reels. */
  item?: HTMLElement;
  video?: HTMLVideoElement;
  caption?: HTMLElement;
  next?: HTMLElement;
  post: PostContent;
}

export const PLATFORM: Record<Site, PostContent['platform']> = {
  tiktok: 'tiktok', reel: 'instagram', x: 'twitter', facebook: 'facebook', instagram: 'instagram', youtube: 'youtube',
} as never;

export function judged(severity = 7, text = CAPTION): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity, evidence: [] }],
    overallScore: severity,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'shame-attack',
    explanation: `it shames the viewer: ${text.slice(0, 10)}`,
    judge: {
      id: 'judge-v1', hash: 'judge-hash', model: 'openai/gpt-oss-120b',
      charged: true, family: 'hostile', severity, effect: 'recruit', intent: 'react',
    },
  } as AnalysisResult;
}

/** What a deterministic rule hands over: no judge, a technique name and a severity. */
export function legacy(technique: string, severity: number): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique, present: true, confidence: 0.99, severity, evidence: ['rule'] }],
    overallScore: severity,
    overallConfidence: 0.99,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: technique,
  } as unknown as AnalysisResult;
}

export function rewrite(analysis: AnalysisResult = judged()): NeutralizedContent {
  return {
    postId: 'p1', originalHash: 'h', rewrittenText: REWRITE, analysis,
    aiSource: 'cloud', processingTimeMs: 1, writerModel: 'openai/gpt-oss-20b',
  };
}

const AI = { model: 'openai/gpt-oss-120b', provider: 'deepinfra' };

export type Kind =
  | 'rewrite' | 'mark' | 'hide' | 'fold' | 'ad' | 'blocklist' | 'slur' | 'mask';

/** The result the pipeline gives the post path for each kind of verdict. */
export function pipelineResult(kind: Kind, mode: Mode): PipelineResult {
  switch (kind) {
    case 'rewrite':
      return { action: 'neutralize', neutralized: rewrite(), detectionMode: 'combined-detect-neutralize', aiMeta: AI } as PipelineResult;
    case 'mark':
      return { action: 'mark', analysis: judged(5), detectionMode: 'combined-detect-neutralize', aiMeta: AI } as unknown as PipelineResult;
    case 'hide':
      return { action: 'hide', analysis: judged(8), detectionMode: 'combined-detect-neutralize', aiMeta: AI } as unknown as PipelineResult;
    case 'fold':
      return { action: 'collapse', analysis: judged(6), detectionMode: 'combined-detect-neutralize', aiMeta: AI } as unknown as PipelineResult;
    case 'ad':
      return mode === 'adult'
        ? { action: 'collapse', analysis: { ...legacy('consumer-rapid-frame', 0), techniques: [], overallScore: 0, isManipulative: false }, detectionMode: 'sponsored-ad:adult' } as unknown as PipelineResult
        : { action: 'collapse', analysis: legacy('consumer-rapid-frame', 6), detectionMode: 'sponsored-ad' } as unknown as PipelineResult;
    case 'blocklist':
      // What the pipeline hands over for the household's own word: nothing was read, so no technique and no score.
      return { action: 'hide', analysis: { ...legacy('profanity', 0), techniques: [], overallScore: 0, isManipulative: false }, detectionMode: 'blocklist:word:cheapthing' } as unknown as PipelineResult;
    case 'slur':
      return { action: 'hide', analysis: legacy('profanity', 9), detectionMode: 'slur:1' } as unknown as PipelineResult;
    case 'mask':
      // What the pipeline hands over for a swear: the words starred by rules, a profanity technique at severity 4.
      return {
        action: 'neutralize',
        neutralized: { ...rewrite(legacy('profanity', 4)), aiSource: 'rules' },
        detectionMode: 'profanity-mask:1',
      } as unknown as PipelineResult;
  }
}

function postFor(site: Site, anchor: HTMLElement, id: string): PostContent {
  return {
    id, text: CAPTION, author: '@seller', timestamp: '2026-09-26T04:00:00Z',
    platform: PLATFORM[site], domRef: new WeakRef(anchor), kind: site === 'tiktok' ? 'video' : 'post',
  } as unknown as PostContent;
}

/** One card as the site draws it. `id` keeps two cards of a run apart. */
export function drawCard(site: Site, id: string): Card {
  document.body.innerHTML = '';
  if (site === 'tiktok') {
    const list = document.createElement('div');
    const make = (text: string) => {
      const item = document.createElement('div');
      item.setAttribute('data-e2e', 'recommend-list-item-container');
      const media = document.createElement('div');
      const video = document.createElement('video');
      media.appendChild(video);
      const caption = document.createElement('div');
      caption.setAttribute('data-e2e', 'video-desc');
      const span = document.createElement('span');
      span.textContent = text;
      caption.appendChild(span);
      const rail = document.createElement('div');
      rail.innerHTML = '<button data-e2e="comment-icon"></button>';
      item.append(media, caption, rail);
      list.appendChild(item);
      return { item, video, caption };
    };
    const first = make(CAPTION);
    const second = make('a calm video about bread');
    document.body.appendChild(list);
    const h = window.innerHeight;
    first.item.getBoundingClientRect = () => ({ top: 0, bottom: h, height: h, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    (second.item as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn();
    return { site, anchor: first.item, item: first.item, video: first.video, caption: first.caption, next: second.item, post: postFor(site, first.item, id) };
  }
  if (site === 'reel') {
    const main = document.createElement('main');
    const box = document.createElement('div');
    const video = document.createElement('video');
    const caption = document.createElement('span');
    caption.setAttribute('dir', 'auto');
    caption.textContent = CAPTION;
    const rail = document.createElement('div');
    rail.innerHTML = '<button aria-label="Like"></button>';
    box.append(video, caption, rail);
    main.appendChild(box);
    document.body.appendChild(main);
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    return { site, anchor: caption, item: box, video, caption, post: postFor(site, caption, id) };
  }
  // A text post: an article holding a text block. X, Facebook, Instagram's feed and a YouTube post
  // differ in their selectors, not in what the record is told about them.
  const feed = document.createElement('div');
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const body = document.createElement('div');
  if (site === 'x') body.setAttribute('data-testid', 'tweetText');
  body.textContent = CAPTION;
  article.appendChild(body);
  feed.appendChild(article);
  document.body.appendChild(feed);
  return { site, anchor: body, post: postFor(site, body, id) };
}

export const SITES: Site[] = ['x', 'facebook', 'instagram', 'youtube', 'tiktok', 'reel'];
export const MODES: Mode[] = ['child', 'teen', 'adult'];

export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 4));
}
