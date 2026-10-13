// The decision block, written from what the current paths know
// (docs/design/DECISION-BLOCK-2026-09-07.md; Stage 2 of the 2026-09-07 plan).
//
// Until the judge is measured under all modes the AI rows of the policy table
// stay dark, and the actions the product performs come from the legacy paths.
// This module writes the block honestly for that state:
//   - a rail (blocklist, slur, coded harm, sponsored) is the one case where the
//     table already chooses: `action` is decide()'s cell for the mode, `rails`
//     names the rail and, for the household's own word, the match;
//   - every other named row keeps the legacy action as `action`, with
//     `judge: null` because no measured judge produced it (the record's
//     techniques still say what the legacy path asserted);
//   - the swear mask is `allow` applied as `mask`, household.mask true;
//   - when no row can be named honestly, no block is written: a record without
//     `decision` states nothing, and stating nothing beats inventing.
// `applied` is what the page showed; when it differs from `action` the note
// says so in one fixed sentence (M61: the chain hears what happened).

import type { DecisionAction, DecisionBlock, DecisionRail } from '../../types/forensic';
import { levelOf, type Mode } from '../../types/mode';
import type { PolicyRowId } from '../../types/policy-row';
import { actionRank, decide, type Rail, type JudgeFamily } from '../../core/policy/table';
import type { AnalysisResult } from '../../types/analysis';
import { whyFor, type Why } from '../../core/policy/why';

/** The reader profile until the household picker exists (design section 2). */
export const READER_DEFAULT = 'default';

const RAIL_BY_ROW: Readonly<Partial<Record<PolicyRowId, Rail>>> = {
  R1: 'blocklist',
  R2: 'identity-slur',
  R3: 'coded-harm',
  R4: 'sponsored',
  R5: 'topic',
};

export const NOTE_NOT_APPLIED = 'the page could not apply the action; the item stayed as the record says under applied';
/** The household switched the action off; nothing was applied and the item stayed as served. */
export const NOTE_SETTING_OFF = 'the household switched this action off; the item stayed as served';

export interface LegacyDecisionFacts {
  mode: Mode;
  detectionMode?: string;
  techniques: readonly string[];
  severity?: number;
  /** What the page ended up showing. */
  applied: DecisionAction;
  /** True when the household masks swearing (blanketProfanitySoften). */
  mask: boolean;
  reader?: string;
  /** True when a household switch (Block Ads off) is why nothing was applied. */
  settingOff?: boolean;
  /** Set when a fold on a video item was turned into a hide by the mode's video rule. */
  videoRule?: 'folded';
  /** Set when the reading answered after the item had scrolled away and was applied when it came back. */
  late?: boolean;
  /** False when the page change did not land; a late verdict then says so instead of saying it was applied. */
  landed?: boolean;
}

/**
 * The sentence for a verdict that arrived late. It says "applied when the item came back", so it
 * speaks only when the page change landed: a change that did not land keeps the sentence for that.
 */
function lateOrNotApplied(notLanded: boolean): string {
  return notLanded ? NOTE_NOT_APPLIED : NOTE_LATE_VERDICT;
}

function household(f: LegacyDecisionFacts): DecisionBlock['household'] {
  return { mode: levelOf(f.mode), reader: f.reader ?? READER_DEFAULT, topicRule: null, mask: f.mask };
}

function block(
  f: LegacyDecisionFacts,
  row: string,
  action: DecisionAction,
  rails: DecisionBlock['rails'],
): DecisionBlock {
  const plain = f.applied === action || (action === 'allow' && f.applied === 'mask')
    ? null
    : f.settingOff ? NOTE_SETTING_OFF
      : f.videoRule === 'folded' && f.applied === 'hide' ? NOTE_VIDEO_FOLDED
        : actionRank(f.applied) > actionRank(action) ? NOTE_LEGACY_ACTED : NOTE_NOT_APPLIED;
  return {
    judge: null,
    reading: null,
    descriptor: null,
    rails,
    household: household(f),
    row,
    action,
    applied: f.applied,
    rewrite: null,
    // A mask stacks on allow by design (table section 2), so it is not a miss.
    //
    // Three ways applied can differ from action, and each has its own sentence. Until
    // 2026-09-20 there were two, so the third borrowed a false one: a promoted post with
    // media only on X is HIDDEN by media-only-ad-blocker, the sponsored row (R4) says
    // collapse, and every such record was signed 'the page could not apply the action'.
    // Nothing had failed; the page had done more than the row names. Found by running
    // decisionForBlock with that caller's own arguments. When the page shows LESS of the
    // item than the row asks (a higher actionRank), the legacy path acted, and the
    // sentence written for that says so.
    // A late verdict says "could not apply" only when the caller says the page change did not land
    // (landed false). What the row asked is not the test: a collapse that landed on a row asking
    // for hide did land. A switched-off setting keeps its own sentence, since nothing was meant to land.
    note: f.late && plain !== NOTE_SETTING_OFF
      ? lateOrNotApplied(f.landed === false)
      : plain,
  };
}

/** The block for a hide, collapse or mark the legacy paths chose; undefined when no row can be named. */
export function decisionForLegacy(f: LegacyDecisionFacts): DecisionBlock | undefined {
  const why: Why | null = whyFor(f.detectionMode, f.techniques, f.severity);
  if (!why) return undefined;
  const rail = RAIL_BY_ROW[why.row];
  if (rail) {
    const d = decide(
      { judge: null, descriptor: null, rails: [rail] },
      { mode: f.mode, topicRules: {}, swearing: f.mask ? 'mask' : 'show' },
    );
    // A chosen topic carries no quoted match: the topic is the household's rule (household.topicRule), so the card
    // reads "Mentions gambling" and not a word of the post.
    const rails: DecisionBlock['rails'] = [{ name: rail as DecisionRail, match: rail === 'topic' ? '' : (why.match ?? '') }];
    const made = adHidden(rail, block(f, d.row, d.action, rails));
    return rail === 'topic' ? { ...made, household: { ...made.household, topicRule: why.topic ?? null } } : made;
  }
  return block(f, why.row, f.applied, []);
}

export const NOTE_LEGACY_ACTED = 'the legacy path acted before the table was wired; applied is what it did';
/**
 * An advertisement hidden by Block ads. The sponsored row (R4) asks for a fold and Block ads hides, so until 9 Oct 2026
 * every hidden ad was signed NOTE_LEGACY_ACTED, and the timeline told a new user an older path acted on most of a
 * YouTube record. Signed text: never reworded, only added to.
 */
export const NOTE_AD_HIDDEN = 'Block ads hid this advertisement; applied is what it did';
/** The sponsored rail's hide is Block ads doing what it is for, not an unwired path: it gets its own sentence. */
function adHidden(rail: Rail | null | undefined, b: DecisionBlock): DecisionBlock {
  return rail === 'sponsored' && b.applied === 'hide' && b.note === NOTE_LEGACY_ACTED ? { ...b, note: NOTE_AD_HIDDEN } : b;
}
/** The first model fired but the second, asked because it did, did not agree; nothing acted. */
export const NOTE_PAIR_VETOED = 'a second model did not agree, so nothing acted';
/** Signed text: a record already written keeps its sentence, so these are never reworded, only added to. */
export const NOTE_VIDEO_SKIPPED = 'the video rule for this mode skipped the video; applied is what it did';
export const NOTE_VIDEO_MARKED = 'the video rule for this mode marked the caption in yellow and left the video playing; applied is what it did';
export const NOTE_VIDEO_FOLDED = 'a fold has no meaning on a video, so the video rule for this mode hid it; applied is what it did';
/** The reading answered after the item had scrolled away and a cancelled record was written; this record is what was applied on the item's return. */
export const NOTE_LATE_VERDICT = 'the reading answered after the item had scrolled away; it was applied when the item came back; applied is what it did';

/**
 * The sentence for a difference the video rule made on purpose. It is checked before a failed
 * rewrite, since a rewrite that failed on the way to a mark or a skip is not why the item was
 * skipped, and it only speaks when the page really did what the rule says: a skip that did not
 * land is not "skipped" (a page change that failed outranks it in the caller).
 */
function videoRuleNote(
  rule: 'skipped' | 'marked' | 'folded' | undefined,
  applied: DecisionAction,
): string | null {
  if (rule === 'skipped' && applied === 'hide') return NOTE_VIDEO_SKIPPED;
  if (rule === 'marked' && applied === 'mark') return NOTE_VIDEO_MARKED;
  if (rule === 'folded' && applied === 'hide') return NOTE_VIDEO_FOLDED;
  return null;
}

export interface JudgeDecisionFacts {
  mode: Mode;
  judge: NonNullable<AnalysisResult['judge']>;
  /** DESCRIPTOR-V1's reading, when it ran. */
  descriptorV1?: AnalysisResult['descriptorV1'];
  provider: string;
  /** What the page ended up showing. */
  applied: DecisionAction;
  mask: boolean;
  rewrite: DecisionBlock['rewrite'];
  reader?: string;
  /** False when the page could not apply what the legacy path chose (a hide or collapse that did not land). */
  landed?: boolean;
  /** Set when the mode's video rule chose the action on a video item: Child skips it, Adult marks its caption in yellow, a fold becomes a hide. */
  videoRule?: 'skipped' | 'marked' | 'folded';
  /** Set when the reading answered after the item had scrolled away and was applied when it came back. */
  late?: boolean;
}

/**
 * The block for an item the measured judge read: the instrument named, its
 * five fields verbatim, the policy table's own row and action for the mode
 * (descriptor null, so the middle severities fall to J7), and what the legacy
 * adult path actually did as `applied`. When the two differ the note says the
 * legacy path acted first; that is the honest state until the table is wired.
 */
export function decisionForJudge(f: JudgeDecisionFacts): DecisionBlock {
  const d = decide(
    {
      judge: { charged: f.judge.charged, family: f.judge.family as JudgeFamily, severity: f.judge.severity },
      descriptor: null,
      rails: [],
    },
    { mode: f.mode, topicRules: {}, swearing: f.mask ? 'mask' : 'show' },
  );
  const plain = f.applied === d.action ? null
    : f.landed === false ? NOTE_NOT_APPLIED
      : videoRuleNote(f.videoRule, f.applied)
        ?? (f.rewrite?.outcome === 'failed' ? NOTE_NOT_APPLIED
          : f.judge.id === 'judge-v1-pair' && f.applied === 'allow' ? NOTE_PAIR_VETOED
          : NOTE_LEGACY_ACTED);
  return {
    judge: { id: f.judge.id, hash: f.judge.hash, model: f.judge.model, provider: f.provider },
    reading: {
      charged: f.judge.charged,
      family: f.judge.family,
      severity: f.judge.severity,
      effect: f.judge.effect,
      intent: f.judge.intent,
    },
    descriptor: null,
    ...(f.descriptorV1 ? { descriptorV1: f.descriptorV1 } : {}),
    // The paid reading's Claude reader, when it was asked: the record then names both companies
    // that read the item, not only the pair (found by the 11 Oct 2026 map: an item acted on because
    // Haiku agreed was signed as the pair alone).
    ...(f.judge.claude ? { claude: f.judge.claude } : {}),
    rails: [],
    household: { mode: levelOf(f.mode), reader: f.reader ?? READER_DEFAULT, topicRule: null, mask: f.mask },
    row: d.row,
    action: d.action,
    applied: f.applied,
    rewrite: f.rewrite,
    // 'The legacy path acted' is only true when it did. Until 2026-09-20 this was the one
    // sentence for every difference, so a rewrite that FAILED (applied allow, outcome failed)
    // and a hide that did not land (applied mark) were both signed 'the legacy path acted ...;
    // applied is what it did'. Found by running this function with the post path's own
    // arguments; the comment beside that call said NOTE_NOT_APPLIED was written, and no
    // path through here could write it.
    // A pair veto (the first model fired, the second was asked and did not agree) reaches
    // here the same way a plain pass does: applied 'allow', nothing acted. judge.id alone
    // is not enough to spot it: 'judge-v1-pair' is also stamped when the two models AGREED
    // and the page really did act (a mark the legacy path softened, a collapse it hid), and
    // that case is genuinely the legacy path acting, not a veto. What only a veto has is
    // applied 'allow': agreement always leaves the page showing something other than allow.
    // Found by the same instrument twice: first that pair vetoes were signed as the legacy
    // path (103 of 103, cold read of 24ac1a39), then that this branch also caught the 64
    // pair AGREEMENTS reaching a different applied action and mislabelled those as vetoes
    // (cold read of ede2c0b9, e.g. #8373, mark agreed and softened, signed as though nothing
    // had acted). Both reads are gem 75.
    // A failed rewrite that left the item as served changed nothing on the page; a mark shown in its
    // place did land.
    note: f.late ? lateOrNotApplied(f.landed === false || (f.rewrite?.outcome === 'failed' && f.applied === 'allow')) : plain,
  };
}

/** A reason for the record is a short fixed token: lower case letters, digits and - : + only, never a quote. */
export function cleanWhy(why: string): string {
  return why.toLowerCase().replace(/[^a-z0-9:+-]/g, '-').slice(0, 40);
}

/**
 * The rewrite stage of a block whose rewrite was tried. `model` is the model
 * whose words the page showed under its machine-readable AI mark
 * (src/content/markers/ai-mark.ts), so the record says who wrote what the
 * reader saw. It is there only when the rewrite landed, a model wrote it and a
 * reply named that model.
 */
export function rewriteStage(
  landed: boolean,
  writer: { model?: string } | null | undefined,
  why?: string,
): NonNullable<DecisionBlock['rewrite']> {
  if (!landed) return { attempted: true, outcome: 'failed', ...(why ? { why: cleanWhy(why) } : {}) };
  return writer?.model
    ? { attempted: true, outcome: 'applied', model: writer.model }
    : { attempted: true, outcome: 'applied' };
}

/** What the page showed for a swear mask when the stars did not land, or a video rule acted instead. */
export interface MaskPageOutcome {
  applied: DecisionAction;
  rewrite: DecisionBlock['rewrite'];
  videoRule?: 'skipped' | 'marked';
}

/**
 * The block for a swear mask: nothing charged, the household's setting starred the words. Called
 * with no `page`, the stars landed. Called with one, the block says what the page showed instead:
 * a video item skipped or its caption marked by the video rule, a hide the Child fallback made, or
 * the words left as served because the stars did not land. A block that says mask over any of
 * those tells a card to read "shown with swearing starred" beside an item that was not.
 */
export function decisionForMask(mode: Mode, reader?: string, page?: MaskPageOutcome, late?: boolean): DecisionBlock {
  const stars = block({ mode, techniques: [], applied: 'mask', mask: true, reader, late }, 'D1', 'allow', []);
  if (!page || page.applied === 'mask') return stars;
  const ruleNote = videoRuleNote(page.videoRule, page.applied);
  return {
    ...stars,
    applied: page.applied,
    rewrite: page.rewrite,
    note: late ? lateOrNotApplied(!ruleNote && page.applied !== 'hide') : ruleNote ?? NOTE_NOT_APPLIED,
  };
}

/** Legacy action labels to the record's action vocabulary. */
export function appliedFor(kind: 'hide' | 'collapse' | 'mark' | 'neutralize', landed: boolean): DecisionAction {
  if (!landed) return 'mark';
  if (kind === 'neutralize') return 'soften';
  return kind;
}

/**
 * The block for a rule-based block (BLOCKED_LOG): the platform's ad marker is
 * the sponsored rail (R4), a household hashtag or account is the blocklist
 * rail (R1) with the matched token; the reel surface, the AI label and the
 * media timeout have no row and get no block, so the record states nothing
 * rather than something invented. Wiring audit 2026-09-13, C14.
 */
export function decisionForBlock(f: {
  mode: Mode;
  blockReason: string;
  matchedToken: string;
  applied: DecisionAction;
  mask: boolean;
  reader?: string;
  /** Set when a fold on a video item was turned into a hide by the mode's video rule. */
  videoRule?: 'folded';
  late?: boolean;
  /** False when the page change did not land; a late verdict then says so. */
  landed?: boolean;
}): DecisionBlock | undefined {
  const reason = f.blockReason.split(':')[0];
  const rail: Rail | null = reason === 'ads' ? 'sponsored'
    : reason === 'hashtag' || reason === 'account' ? 'blocklist'
      : null;
  if (!rail) return undefined;
  const d = decide(
    { judge: null, descriptor: null, rails: [rail] },
    { mode: f.mode, topicRules: {}, swearing: f.mask ? 'mask' : 'show' },
  );
  const rails: DecisionBlock['rails'] = [{ name: rail as DecisionRail, match: rail === 'blocklist' ? f.matchedToken : '' }];
  return adHidden(rail, block({ mode: f.mode, techniques: [], applied: f.applied, mask: f.mask, reader: f.reader, videoRule: f.videoRule, late: f.late, landed: f.landed }, d.row, d.action, rails));
}
