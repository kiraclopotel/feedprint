// src/ui/dashboard/components/color-maps.ts
//
// Per-platform / per-technique / per-blocked-category color maps.
// Extracted from the previous inline declarations in Dashboard.tsx so that
// FeedCard / PlatformTabs / StatisticsTab / RecidivistAuthorsPanel can
// share without re-importing the dashboard shell.
//
// These are intentionally NOT in tokens.css — they're brand colors for
// outside platforms (or the internal technique taxonomy), not part of the
// FW design system. Keeping them as a separate map preserves the
// token-discipline contract in `DASHBOARD_FULL_INVENTORY_2026-05-24.md` §5.

export const PLATFORM_COLORS: Record<string, string> = {
  twitter:   '#1da1f2',
  facebook:  '#4267b2',
  instagram: '#e1306c',
  tiktok:    '#69c9d0',
  youtube:   '#ff0000',
};

export const PLATFORM_LABELS: Record<string, string> = {
  twitter:   'x.com',
  facebook:  'facebook.com',
  instagram: 'instagram.com',
  tiktok:    'tiktok.com',
  youtube:   'youtube.com',
};

// Keyed by the persisted TechniqueName enum (src/types/analysis.ts). Every
// one of the 23 union members has a color; lookups default to grey only for
// labels outside the taxonomy.
export const TECHNIQUE_COLORS: Record<string, string> = {
  'fear-appeal':              '#7c83ff',
  'repeat-exposure':          '#8a8f98',
  'anger-trigger':            '#ef5350',
  'shame-attack':             '#ab47bc',
  'false-urgency':            '#ffee58',
  'bandwagon':                '#42a5f5',
  'scapegoating':             '#ec407a',
  'fomo':                     '#ff7043',
  'toxic-positivity':         '#66bb6a',
  'misleading-format':        '#90a4ae',
  // The "multiple techniques" mix color — MUST stay equal to the
  // --fw-tech-combined token (tokens.css): the Activity record dot and the
  // Technique frequency chart both read this entry for multi-technique items.
  'combined':                 '#5c6bc0',
  'ai-content-block':         '#7b1fa2',
  'profanity':                '#bdbdbd',
  'body-comparison-priming':  '#f06292',
  'parasocial-coercion':      '#26c6da',
  'consumer-rapid-frame':     '#9ccc65',
  'hyperreal-trauma-bait':    '#8d6e63',
  'combined-stack':           '#5c6bc0',
  'sexual':                   '#d81b60',
  'violence-graphic':         '#c62828',
  'self-harm':                '#ad1457',
  'drug-promotion':           '#6d4c41',
  'unsafe-health-experiment': '#ff8f00',
  'extreme-toxicity':         '#b71c1c',
};

// The five techniques the dashboard names take the page's theme (their --fw-tech-* tokens carry a light value since
// 12 Oct 2026); TECHNIQUE_COLORS stays hex for the readers that need a value. A chart fill reads this.
const THEMED_TECHNIQUE_TOKENS: Record<string, string> = {
  'anger-trigger': '--fw-tech-anger-trigger',
  'fear-appeal':   '--fw-tech-fear-appeal',
  'false-urgency': '--fw-tech-false-urgency',
  'shame-attack':  '--fw-tech-shame-attack',
  'scapegoating':  '--fw-tech-scapegoating',
};
export function techniqueFill(name: string): string | undefined {
  const hex = TECHNIQUE_COLORS[name];
  const token = THEMED_TECHNIQUE_TOKENS[name];
  return token && hex ? `var(${token}, ${hex})` : hex;
}

// Maps the `<reason>` segment of `detectionMode = 'block:<reason>:<token>'`
// to a parent-readable category label. `ai-label` collapses under "AI-content
// videos" with the AI-content blocker; `hashtag` has its own label, because
// the hashtag list holds whatever tags the household adds (#cheap is not AI
// content), not only the AI tags it starts with.
export const BLOCKED_CATEGORY_LABELS: Record<string, string> = {
  'ai-content':    'AI-content videos',
  'hashtag':       'Blocked hashtags',
  'ai-label':      'AI-content videos',
  'reel-surface':  'Reels & shorts',
  'media-timeout': 'Platform breaks',
  // Adult-mode Block Ads events ('block:ads:<token>', content/index.ts
  // collapse/hide path). Child/teen ads stay technique records
  // (detectionMode 'sponsored-ad'), not blocked-category records.
  'ads':           'Ads',
  // A sponsored post hidden by the same rule is the same set, so it takes the same name
  // the Statistics blocked tile gives it, instead of "Other (sponsored)".
  'sponsored':     'Ads',
};

export const BLOCKED_CATEGORY_COLORS: Record<string, string> = {
  'AI-content videos': '#ab47bc',
  'Blocked hashtags':  '#8d6e63',
  'Reels & shorts':    '#ef5350',
  'Platform breaks':   '#ffab40',
  'Ads':               '#42a5f5',
};

// Keyed by the ENGLISH display label (the stable filter key), not the
// `<reason>` segment — `categorizeBlockedRecord` already collapsed reasons
// into these labels before they reach a display point.
export const BLOCKED_CATEGORY_LABELS_RO: Record<string, string> = {
  'AI-content videos': 'Videoclipuri cu conținut AI',
  'Blocked hashtags':  'Hashtaguri blocate',
  'Reels & shorts':    'Reels & shorts',
  'Platform breaks':   'Pauze de platformă',
  'Ads':               'Reclame',
  'Other blocks':      'Alte blocări',
  'Your own list':     'Lista ta',
  'Hidden':            'Ascuns',
};

export const BLOCKED_CATEGORY_LABELS_ES: Record<string, string> = {
  'AI-content videos': 'Videos con contenido de IA',
  'Blocked hashtags':  'Hashtags bloqueados',
  'Reels & shorts':    'Reels y shorts',
  'Platform breaks':   'Pausas de plataforma',
  'Ads':               'Anuncios',
  'Other blocks':      'Otros bloqueos',
  'Your own list':     'Tu propia lista',
  'Hidden':            'Oculto',
};

export const BLOCKED_CATEGORY_LABELS_PT_BR: Record<string, string> = {
  'AI-content videos': 'Vídeos com conteúdo de IA',
  'Blocked hashtags':  'Hashtags bloqueadas',
  'Reels & shorts':    'Reels e shorts',
  'Platform breaks':   'Pausas de plataforma',
  'Ads':               'Anúncios',
  'Other blocks':      'Outros bloqueios',
  'Your own list':     'Sua própria lista',
  'Hidden':            'Oculto',
};

// The four technique-label maps moved to src/i18n/technique-labels.ts on 2026-09-16
// (PLAN-2026-09-16 item 8.7): the export builder in forensics needs them, and forensics may not
// import a dashboard component. Re-exported here, so the dashboard's own imports are unchanged.
export {
  PRETTY_TECHNIQUE,
  PRETTY_TECHNIQUE_RO,
  PRETTY_TECHNIQUE_ES,
  PRETTY_TECHNIQUE_PT_BR,
} from '../../../i18n/technique-labels';
