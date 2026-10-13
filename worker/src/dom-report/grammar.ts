// The closed sets a page report is made of (11 Oct 2026).
//
// This file exists twice, byte for byte: src/core/dom-report/grammar.ts (the extension) and worker/src/dom-report/grammar.ts
// (the relay; its tsconfig cannot reach src/). A test fails when they differ. Edit both.
//
// Every string in a report is a member of one of these sets or has one of these shapes. The builder (skeleton.ts) only
// ever writes members; the checker (report.ts) refuses anything else, on the page before it is sent and at the relay
// when it arrives. See vocabulary.ts for the two kinds of string, labels and addresses, that are kept as shapes.

export const MAX_NODES = 500;
export const MAX_DEPTH = 14;
export const LAYER_MAX_NODES = 150;
export const MAX_LAYERS = 3;
export const MAX_REPORT_CHARS = 40_000;
export const MAX_ATTR_NAMES = 24;
export const MAX_LEDGER_KEYS = 200;
export const MAX_FAMILIES = 40;

const set = (words: string): ReadonlySet<string> => new Set(words.split(/\s+/).filter(Boolean));

/** Tags the report names. 'private' stands for a chat the report never looks into, 'x' for a tag not on this list. */
export const HTML_TAGS: ReadonlySet<string> = set(`
  a abbr address article aside audio b blockquote body br button canvas caption code col colgroup data datalist dd details
  dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr html i iframe img input label
  legend li main mark menu meter nav noscript object ol optgroup option output p picture pre progress q s section select
  small source span strong sub summary sup svg table tbody td template textarea tfoot th thead time tr track u ul var video
  wbr private x`);

/** A custom element's name (YouTube's are structural: ytd-rich-item-renderer). Letters and hyphens only. */
export const CUSTOM_TAG = /^[a-z]{1,16}(?:-[a-z]{1,16}){1,4}$/;

export const ARIA_ROLES: ReadonlySet<string> = set(`
  alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo
  definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main
  marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar
  radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab
  table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem other`);

/** Attribute names the report may list (names only). */
export const PLAIN_ATTRS: ReadonlySet<string> = set(`
  id class href src srcset alt title type name value placeholder tabindex contenteditable draggable dir lang style target
  rel for disabled hidden checked selected controls autoplay loading width height download action method role slot part
  inert popover`);

export const ARIA_ATTRS: ReadonlySet<string> = set(`
  aria-label aria-labelledby aria-describedby aria-hidden aria-expanded aria-haspopup aria-pressed aria-checked
  aria-selected aria-disabled aria-modal aria-live aria-atomic aria-busy aria-controls aria-owns aria-current aria-level
  aria-posinset aria-setsize aria-orientation aria-valuenow aria-valuemin aria-valuemax aria-valuetext aria-readonly
  aria-required aria-multiline aria-placeholder aria-relevant aria-roledescription aria-activedescendant
  aria-autocomplete aria-colcount aria-rowcount aria-colindex aria-rowindex aria-flowto aria-details aria-errormessage
  aria-invalid aria-keyshortcuts aria-sort aria-description`);

/** A data attribute's name: set by the site's code, not by a person. Letters and hyphens only. */
export const DATA_NAME = /^data-[a-z]{1,16}(?:-[a-z]{1,16}){0,4}$/;

export function isAttrName(name: string): boolean {
  return PLAIN_ATTRS.has(name) || ARIA_ATTRS.has(name) || (name.length <= 48 && DATA_NAME.test(name));
}

const TRUE_FALSE = ['true', 'false', 'mixed'];

/** Attributes whose value is one of a short list. A value off the list is written '*'. */
export const ENUM_ATTRS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  ...['aria-expanded', 'aria-hidden', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-disabled', 'aria-modal',
    'aria-busy', 'aria-atomic', 'aria-readonly', 'aria-required', 'aria-multiline', 'aria-invalid'].map((n) => [n, new Set(TRUE_FALSE)] as const),
  ['aria-haspopup', set('true false menu dialog listbox tree grid')],
  ['aria-live', set('off polite assertive')],
  ['aria-orientation', set('horizontal vertical')],
  ['aria-current', set('true false page step location date time')],
  ['type', set('button submit reset text search checkbox radio email url tel number file hidden image range date password color')],
  ['contenteditable', set('true false plaintext-only')],
  ['dir', set('ltr rtl auto')],
  ['tabindex', set('-1 0 +')],
  ['draggable', set('true false')],
  ['loading', set('lazy eager')],
  ['target', set('_blank _self _parent _top')],
]);

/** Attributes whose value is a technical label the site's own code chose (a test id, a pagelet name). */
export const FREE_VALUE_ATTRS: ReadonlySet<string> = set(`
  data-e2e data-testid data-pagelet data-visualcompletion data-ad-preview data-ad-comet-preview`);

/**
 * The shape of such a value after every run of digits was turned into 0: words of letters (each with at most a trailing 0)
 * joined by - _ or :, up to four, short. Anything else is written '*'.
 */
const FREE_PART = '(?:[A-Za-z]{1,16}0?|0)';
export const FREE_VALUE = new RegExp(`^${FREE_PART}(?:[-_:]${FREE_PART}){0,3}$`);

/** Our own stamps: a name and a short value of lower-case letters, digits and hyphens. */
export const OWN_STAMP_NAME = /^data-fw-[a-z]{1,16}(?:-[a-z]{1,16}){0,3}$/;
export const OWN_STAMP_VALUE = /^[a-z0-9-]{1,40}$/;

/** Is `value` a legal value for the attribute `name` in a skeleton node's "v"? */
export function isLegalValue(name: string, value: string): boolean {
  if (value === '*') return ENUM_ATTRS.has(name) || FREE_VALUE_ATTRS.has(name) || OWN_STAMP_NAME.test(name);
  const enumValues = ENUM_ATTRS.get(name);
  if (enumValues) return enumValues.has(value);
  if (FREE_VALUE_ATTRS.has(name)) return value.length <= 40 && FREE_VALUE.test(value);
  if (OWN_STAMP_NAME.test(name)) return OWN_STAMP_VALUE.test(value);
  return false;
}

/** The sites a report may name (the platform ids of src/types/post.ts). */
export const SITES: ReadonlySet<string> = set('facebook instagram tiktok youtube twitter');
export const PRODUCTS: ReadonlySet<string> = set('feedprint off');
export const PROBLEMS: ReadonlySet<string> = set('hid-too-much did-not-hide other');

export interface SkeletonNode {
  /** Tag name (or 'private', or 'x' for a tag not on the list). */
  t: string;
  /** Role, when the element has one. */
  r?: string;
  /** Names of its attributes, sorted. */
  a?: string[];
  /** How many attributes had a name this report may not copy. */
  o?: number;
  /** Values of the few attributes whose value is structural. */
  v?: Record<string, string>;
  /** Shape of its aria-label. */
  l?: string;
  /** Shape of its href. */
  h?: string;
  /** Size of the text it holds directly: 1 under 10 characters, 2 under 50, 3 under 200, 4 more. */
  n?: number;
  /** 1 when that text holds a picture character. */
  e?: 1;
  /** 'n' when drawn with display none, 'h' with visibility hidden. */
  s?: 'n' | 'h';
  /** The number of identical siblings this one stands for. */
  x?: number;
  /** The number of children left out for room. */
  z?: number;
  c?: SkeletonNode[];
}
