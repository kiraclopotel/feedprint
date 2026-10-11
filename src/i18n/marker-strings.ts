// FeelingWise — on-page marker strings (EN, ES, PT-BR, RO).
//
// Every static user-visible string the teen marker (src/content/markers/teen-marker.ts)
// renders on the social-media page lives here. Both language tables implement
// the same interfaces, so a missing translation is a compile error.
//
// NOT here, on purpose:
//   • analysis.explanation / rewrites — AI-generated data, language is
//     controlled by settings.outputLanguage, never by these tables.
//   • technique IDs in dataset attributes — keys, not copy.
//
// Register matches popup-strings.ts: plain instructional prose, short verbs,
// full diacritics. Romanian uses „…” quotes; Spanish and Brazilian
// Portuguese address the reader informally (tú / você), which is what a teen
// reading a marker on the page expects. The technique titles teach a child
// what the pattern does — keep them plain and non-scary.

import type { ResolvedUiLanguage } from './index';
import type { TechniqueName } from '../types/analysis';

import type { PolicyRowId } from '../types/policy-row';
export type { PolicyRowId };

export interface MarkerStrings {
  buttonLabel: string;
  fallbackExplanation: string;
  // Provisional-shield "checking" copy (D8 fold, 2026-07-14 — previously a
  // private table in provisional-shield.ts, the only language-keyed UI
  // strings living outside this file). Compiler-guaranteed EN/RO parity.
  checkingText: string;           // visible overlay + live status
  checkingAria: string;           // overlay aria-label
  // Marker v3 — semaphore aria labels per state.
  reframePrefix: string;          // "FeelingWise Feedback"
  greenAriaLabel: string;         // GREEN state: rewrite shown
  redAriaLabel: string;           // RED state: original shown
  yellowAriaLabel: string;        // YELLOW state: reason shown
  // Collapse (folded post) aria labels: no rewrite and no original to reveal.
  collapseCalmAria: string;       // calm placeholder shown
  collapseWhyAria: string;        // YELLOW state: why-folded reason shown
  // Fallbacks when the technique is unknown / unmapped.
  patternDetected: string;        // marker title fallback
  fallbackReason: string;         // YELLOW reason fallback
  // Deterministic grounding suffix for the YELLOW reason when no per-item
  // LLM explanation survived the guard chain (pickYellowReason). Count-only
  // by design: the matched words themselves are never re-shown — re-printing
  // a slur inside the explanation would re-deliver the harm the filter
  // just removed.
  matchedTermsLine: (n: number) => string;   // profanity / slur floor
  harmSignalsLine: (n: number) => string;    // harm-floor signals
  // Collapse / hide placeholder line (injector.ts reasonTextFor) — the calm
  // text left in place of a folded or hidden post, with a category label.
  hidLine: (category: string) => string;
  foldedLine: (category: string) => string;
  foldedLineNoReason: string;
  /** Teen: the same placeholder in words that say where the post went, not who ruled on it. */
  hidLineTeen: (category: string) => string;
  foldedLineTeen: (category: string) => string;
  foldedLineNoReasonTeen: string;
  /** Child: one kind line for a hidden or folded post; a child never reads the reason. */
  skipLineChild: string;
  catAdvertisement: string;
  catGraphicViolence: string;
  catSexual: string;
  catSelfHarm: string;
  catDrugPromotion: string;
  catAiSynthetic: string;
  catGroupClaim: string;
  catExtremeHostility: string;
  catDirectThreat: string;
  // Hard-hide notice + reveal controls (Q61/W58 fold — previously hardcoded
  // EN/RO ternaries in content/index.ts, the last on-page UI strings
  // outside this file). Compiler-guaranteed parity.
  hideNoticeBy: (handle: string) => string;
  hideNoticePlain: string;
  hideNoticeByTeen: (handle: string) => string;
  hideNoticePlainTeen: string;
  /** Child's cover when a post is held: moves on, names nothing. */
  hideNoticeChild: string;
  /**
   * The cover a Child sees when the extension is replaced under an open tab
   * (M68). The page-side script keeps running and every call into the
   * extension fails, so a cover mounted as "FeelingWise is checking this
   * content" can never resolve and says something untrue for as long as the
   * tab stays open. The post stays covered, which is the safe direction, and
   * this sentence replaces the copy so a parent is told what happened and what
   * clears it. Never shortened to "an error occurred": the one thing the
   * reader needs is the refresh.
   */
  coverStrandedNotice: string;
  hideShowAnyway: string;
  hideHideAgain: string;
  // Single-player video feeds (video-feed-hide.ts): the chip shown when the
  // advance past hidden videos stops, and when no next video is loaded.
  videoRunNotice: (count: number) => string;
  videoHiddenScrollOn: string;
  /**
   * The why behind an action, one sentence fragment per policy row
   * (docs/design/HIDE-NOTICE-2026-09-07.md section 3; rows in
   * src/core/policy/table.ts). Names the row's condition, never a severity
   * number, a technique name or a model. Read by the on-page notice and by the
   * export card, so the reader sees on the page what the parent sees in the
   * record. Locked by tests/unit/core/policy/policy-why-strings.test.ts: every row has a
   * fragment in every language.
   */
  whyByRow: Readonly<Record<PolicyRowId, string>>;
  /**
   * The words for a family the measured reader answered, used in place of a band row's
   * words (J1, J2, J7, J8) when the record or the caller knows the family. Those four rows
   * fire on a severity alone, for any family, and until 2026-09-20 their words named
   * hostility: a reading of commercial at 8 printed "hostility", body at 1 "mild
   * hostility". Found by reading an export of adult-mode records against the records.
   * The phrases follow readMechanism above, which is the same reader's own vocabulary:
   * threat is alarm (danger, urgency, doom), never a threat made against somebody.
   * Composed by src/i18n/why-words.ts; locked by
   * tests/unit/forensics/why-follows-the-reading.test.tsx.
   */
  whyByFamily: Readonly<Record<Exclude<ReadFamily, 'none'>, string>>;
  /** The comment placeholder: the same verb as hidLine, for a comment. */
  hidCommentLine: (why: string) => string;
  /** The comment placeholder when no row can honestly be named (a legacy hide path). */
  hidCommentPlain: string;
  hidCommentLineTeen: (why: string) => string;
  hidCommentPlainTeen: string;
  /**
   * The one line left in an Instagram ad's slot. Instagram positions its
   * feed from its own height bookkeeping, so the hidden ad keeps its box
   * (measured 2026-08-11 and again 2026-09-03: a box shrunk to 0 or 60px
   * stops the feed loading); the line says the blank is deliberate.
   */
  adSlotNote: string;
  /** Off's note in the empty space where YouTube's home feed was, and its button that shows the feed for one visit. */
  ytHomeHidden: string;
  ytHomeShow: string;
  /** Off's "block this" picker, on the page. */
  pickHint: string;
  pickHintMany: string;
  /** `product` is the popup the pick is undone in: "Off" or "Receipts". */
  pickHiddenShape: (product: string) => string;
  pickHiddenAccount: (handle: string, product: string) => string;
  pickRefused: string;
  /** The recorder's "read this for me", on the page (content/read-this.ts). */
  readHint: string;
  readRefused: string;
  readWaiting: string;
  readNeedsKey: string;
  readAiOff: string;
  readFailed: string;
  readClose: string;
  /** Line 1: "Charged: yes. Hostile, severity 5." */
  readVerdict: (family: string, severity: number) => string;
  readFamilyName: Readonly<Record<ReadFamily, string>>;
  /** Line 2: the mechanism the family names, never the author. */
  readMechanism: Readonly<Record<ReadFamily, string>>;
  /** Line 3, first half: what it leaves in a reader. */
  readEffect: Readonly<Record<ReadEffect, string>>;
  /** Line 3, second half: what it wants the reader to do. */
  readIntent: Readonly<Record<ReadIntent, string>>;
  /** Line 4: the line that keeps the tool honest. */
  readHonest: string;
  /** The one line when nothing is charged. */
  readNotCharged: string;
  /** The record's line, when the chain holds the account. */
  readRecordLine: (seen: number, charged: number) => string;
}

// The judge's own vocabulary (src/ai/prompts.ts, JUDGE-V1), repeated here as
// plain unions so this table depends on no other layer.
type ReadFamily = 'hostile' | 'threat' | 'commercial' | 'body' | 'profanity' | 'none';
type ReadEffect = 'recruit' | 'inert' | 'nourish';
type ReadIntent = 'scroll' | 'react' | 'buy' | 'compare' | 'fear' | 'belong' | 'inform' | 'none';

const STRINGS_EN: MarkerStrings = {
  buttonLabel: 'See why FeelingWise changed this post',
  checkingText: 'One moment, checking this one…',
  checkingAria: 'Checking…',
  fallbackExplanation: 'FeelingWise stepped in on this post.',
  reframePrefix: 'FeelingWise Feedback',
  greenAriaLabel: 'Post rewritten by AI. Select to see why.',
  yellowAriaLabel: 'Showing the reason. Select to see the original.',
  redAriaLabel: 'Showing the original. Select to go back to the rewrite.',
  collapseCalmAria: 'Post folded. Select to see why.',
  collapseWhyAria: 'Showing why this post is folded. Select to hide the reason.',
  patternDetected: 'Pattern detected',
  fallbackReason: 'matched a manipulation pattern.',
  matchedTermsLine: (n) => n === 1
    ? 'The original text had one word or phrase from the filter list.'
    : `The original text had ${n} words or phrases from the filter list.`,
  harmSignalsLine: (n) => n === 1
    ? 'One sign of harmful content was found in this text.'
    : `${n} signs of harmful content were found in this text.`,
  hidLine: (category) => `Hidden: ${category}`,
  foldedLine: (category) => `Folded: ${category}`,
  foldedLineNoReason: 'Folded',
  hidLineTeen: (category) => `Hidden here: ${category}`,
  foldedLineTeen: (category) => `Folded away: ${category}`,
  foldedLineNoReasonTeen: 'Folded away',
  skipLineChild: 'Skipped by your Strict filter. Keep scrolling.',
  catAdvertisement: 'advertisement',
  catGraphicViolence: 'graphic violence',
  catSexual: 'sexual content',
  catSelfHarm: 'self-harm content',
  catDrugPromotion: 'drug promotion',
  catAiSynthetic: 'AI-generated synthetic content',
  catGroupClaim: 'generic claim about a group',
  catExtremeHostility: 'extreme hostility',
  catDirectThreat: 'direct threat or harassment',
  hideNoticeBy: (handle) => `A post by ${handle} is hidden`,
  hideNoticePlain: 'This post is hidden',
  hideNoticeByTeen: (handle) => `A post by ${handle} is hidden here`,
  hideNoticePlainTeen: 'A post is hidden here',
  hideNoticeChild: 'Skipped by your Strict filter. Keep scrolling.',
  coverStrandedNotice: 'An update was installed. Refresh this page to check posts again.',
  hideShowAnyway: 'show anyway',
  hideHideAgain: 'hide again',
  videoRunNotice: (count) => `Skipped ${count} videos in a row. Scroll on to keep going.`,
  videoHiddenScrollOn: 'Skipped this video. Scroll on to keep going.',
  /* The accusation, in the reader's own language, printed on the page notice
     and on every export card that carries a decision block. It is the one place
     the product says out loud what it thinks somebody did.
     Read all four tables beside each other before touching a row. On
     2026-09-18 twenty one of the twenty two agreed and R3 did not: English said
     "coded harm" and Romanian, Spanish and Portuguese all said coded HATE. The
     catcher behind R3 (src/core/coded-harm-catcher.ts) finds four structures,
     and three of them, self-harm encouragement aimed at a reader, manufactured
     scarcity and referral loops, and real violence narrated as spectacle, are
     not hate in any reading. Three quarters of the product's readers were being
     told a post was hate speech where the code had found something else.
     No check can compare these across languages, because the thing that drifts
     is the meaning and not the shape. A row is reviewed against the code path
     that emits it, in all four, or it is not changed. */
  whyByRow: {
    R1: "on this household's block list",
    R2: 'an identity slur',
    R3: 'harm in coded words',
    R4: 'an advertisement',
    P1: 'an adult seeking contact with a minor',
    P2: 'self-harm content',
    P3: 'sexual content',
    P4: 'drug promotion',
    P4b: 'a dangerous challenge',
    P5: 'graphic violence',
    J1: 'severely charged content',
    J2: 'highly charged content',
    J3: 'hostility aimed at someone here',
    J4: 'hostility aimed at a group',
    J5: 'body or appearance pressure',
    J6: 'commercial pressure',
    J7: 'charged content',
    J8: 'mildly charged content',
    T1: 'a topic this household chose not to see',
    T2: 'gambling',
    D1: 'no harm found',
  },
  whyByFamily: {
    hostile: 'hostility',
    threat: 'alarm: danger, urgency or doom',
    commercial: 'commercial pressure',
    body: 'body or appearance pressure',
    profanity: 'vulgarity or graphic violence',
  },
  hidCommentLine: (why) => `Comment hidden: ${why}`,
  hidCommentPlain: 'This comment is hidden',
  hidCommentLineTeen: (why) => `Comment hidden: ${why}`,
  hidCommentPlainTeen: 'Comment hidden',
  adSlotNote: 'An ad is hidden here. Instagram keeps its space.',
  ytHomeHidden: 'Off is hiding your YouTube home feed. Search, your subscriptions and your own pages still work.',
  ytHomeShow: 'Show it this time',
  pickHint: 'Click what you want gone. Esc to stop.',
  pickHintMany: 'Click everything you want gone, one by one. Esc when done.',
  pickHiddenShape: (product) => `Hidden. It stays hidden when it comes back; undo in the ${product} popup.`,
  pickHiddenAccount: (handle, product) => `Posts by ${handle} are hidden from now on. Undo in the ${product} popup.`,
  pickRefused: 'FeelingWise cannot name this box safely. Try a smaller part of it.',
  readHint: 'Click the post or comment you want read. Esc to stop.',
  readRefused: 'Nothing to read there. Click a post or a comment with text.',
  readWaiting: 'Reading.',
  readNeedsKey: 'Live Rephrase needs the license key. Add it in the License tab of the popup.',
  readAiOff: 'Live Rephrase is off in the popup, so nothing was sent.',
  readFailed: 'No answer from the AI service. Try again in a moment.',
  readClose: 'Close',
  readVerdict: (family, severity) => `Charged: yes. ${family}, severity ${severity}.`,
  readFamilyName: { hostile: 'Hostile', threat: 'Threat', commercial: 'Commercial', body: 'Body comparison', profanity: 'Profanity', none: '' },
  readMechanism: {
    hostile: 'It works by contempt, mockery or us-against-them.',
    threat: 'It works by alarm: danger, urgency, doom.',
    commercial: 'It works by selling: manufactured want or engagement bait.',
    body: 'It works by comparison of bodies: appearance, weight, sexual display.',
    profanity: 'Vulgarity or graphic violence is the point of it.',
    none: '',
  },
  readEffect: {
    recruit: 'It pulls you in and leaves you carrying something.',
    inert: 'It passes through and leaves nothing.',
    nourish: 'It leaves something worth having.',
  },
  readIntent: {
    scroll: 'It wants you to keep watching.',
    react: 'It wants a reaction.',
    buy: 'It wants you to buy, or to want.',
    compare: 'It wants you to measure yourself against it.',
    fear: 'It wants you alarmed.',
    belong: 'It wants you to take a side.',
    inform: 'It wants to tell you something.',
    none: 'No clear design.',
  },
  readHonest: 'You may read it differently.',
  readNotCharged: 'Nothing here reads as built to work on you: plain opinion, information or humour.',
  readRecordLine: (seen, charged) => {
    if (seen === 1) return `This account has come up once this week. That one was ${charged > 0 ? '' : 'not '}flagged.`;
    const n = charged === 0 ? 'None' : charged === 1 ? 'One' : String(charged);
    return `This account has come up ${seen} times this week. ${n} of those ${charged === 1 ? 'was' : 'were'} flagged.`;
  },
};

const STRINGS_RO: MarkerStrings = {
  buttonLabel: 'Vezi de ce FeelingWise a schimbat această postare',
  checkingText: 'O clipă, verificăm postarea asta…',
  checkingAria: 'Se verifică…',
  fallbackExplanation: 'FeelingWise a intervenit la această postare.',
  reframePrefix: 'Feedback FeelingWise',
  greenAriaLabel: 'Postare rescrisă de AI. Apasă ca să vezi de ce.',
  yellowAriaLabel: 'Se afișează motivul. Apasă ca să vezi originalul.',
  redAriaLabel: 'Se afișează originalul. Apasă ca să revii la varianta rescrisă.',
  collapseCalmAria: 'Postare restrânsă. Apasă ca să vezi de ce.',
  collapseWhyAria: 'Se afișează de ce a fost restrânsă postarea. Apasă ca să ascunzi motivul.',
  patternDetected: 'Tipar detectat',
  fallbackReason: 'a corespuns unui tipar de manipulare.',
  matchedTermsLine: (n) => n === 1
    ? 'Textul original avea un cuvânt sau o expresie din lista de filtre.'
    : `Textul original avea ${n} ${n % 100 >= 20 || n % 100 === 0 ? 'de ' : ''}cuvinte sau expresii din lista de filtre.`,
  harmSignalsLine: (n) => n === 1
    ? 'Un semn de conținut dăunător a fost găsit în acest text.'
    : `${n} semne de conținut dăunător au fost găsite în acest text.`,
  hidLine: (category) => `Postare ascunsă: ${category}`,
  foldedLine: (category) => `Postare restrânsă: ${category}`,
  foldedLineNoReason: 'Postare restrânsă',
  hidLineTeen: (category) => `Postare ascunsă: ${category}`,
  foldedLineTeen: (category) => `Postare restrânsă: ${category}`,
  foldedLineNoReasonTeen: 'Postare restrânsă',
  skipLineChild: 'Filtrul tău Strict a sărit peste asta. Continuă să derulezi.',
  catAdvertisement: 'reclamă',
  catGraphicViolence: 'violență explicită',
  catSexual: 'conținut sexual',
  catSelfHarm: 'conținut despre autovătămare',
  catDrugPromotion: 'promovarea drogurilor',
  catAiSynthetic: 'conținut artificial generat de AI',
  catGroupClaim: 'generalizare despre un grup',
  catExtremeHostility: 'ostilitate extremă',
  catDirectThreat: 'amenințare directă sau hărțuire',
  hideNoticeBy: (handle) => `O postare de la ${handle} e ascunsă`,
  hideNoticePlain: 'Postarea aceasta e ascunsă',
  hideNoticeByTeen: (handle) => `O postare de la ${handle} e ascunsă aici`,
  hideNoticePlainTeen: 'O postare e ascunsă aici',
  hideNoticeChild: 'Filtrul tău Strict a sărit peste asta. Continuă să derulezi.',
  coverStrandedNotice: 'S-a instalat o actualizare. Reîncarcă pagina ca postările să fie verificate din nou.',
  hideShowAnyway: 'arată oricum',
  hideHideAgain: 'ascunde din nou',
  videoRunNotice: (count) => `Au fost sărite ${count} ${count % 100 >= 20 || count % 100 === 0 ? 'de ' : ''}videoclipuri la rând. Derulează ca să continui.`,
  videoHiddenScrollOn: 'Videoclipul acesta a fost sărit. Derulează ca să continui.',
  whyByRow: {
    R1: 'pe lista de blocare a acestei familii',
    R2: 'o insultă legată de identitate',
    R3: 'vătămare în cuvinte codificate',
    R4: 'o reclamă',
    P1: 'un adult care caută contact cu un minor',
    P2: 'conținut despre autovătămare',
    P3: 'conținut sexual',
    P4: 'promovarea drogurilor',
    P4b: 'o provocare periculoasă',
    P5: 'violență explicită',
    J1: 'conținut extrem de încărcat',
    J2: 'conținut puternic încărcat',
    J3: 'ostilitate îndreptată spre cineva de aici',
    J4: 'ostilitate îndreptată spre un grup',
    J5: 'presiune legată de corp sau aspect',
    J6: 'presiune comercială',
    J7: 'conținut încărcat',
    J8: 'conținut ușor încărcat',
    T1: 'un subiect pe care această familie a ales să nu-l vadă',
    T2: 'jocuri de noroc',
    D1: 'nu s-a găsit nimic dăunător',
  },
  whyByFamily: {
    hostile: 'ostilitate',
    threat: 'alarmă: pericol, urgență sau prăpăd',
    commercial: 'presiune comercială',
    body: 'presiune legată de corp sau aspect',
    profanity: 'vulgaritate sau violență explicită',
  },
  hidCommentLine: (why) => `Comentariu ascuns: ${why}`,
  hidCommentPlain: 'Comentariul acesta e ascuns',
  hidCommentLineTeen: (why) => `Comentariu ascuns: ${why}`,
  hidCommentPlainTeen: 'Comentariu ascuns',
  adSlotNote: 'Reclama de aici e ascunsă. Instagram păstrează locul gol.',
  ytHomeHidden: 'Off ascunde feedul de pe prima pagină YouTube. Căutarea, abonamentele și paginile tale merg în continuare.',
  ytHomeShow: 'Arată-l de data asta',
  pickHint: 'Dă clic pe ce vrei să dispară. Esc pentru a opri.',
  pickHintMany: 'Dă clic pe tot ce vrei să dispară, pe rând. Esc la final.',
  pickHiddenShape: (product) => `Ascuns. Rămâne ascuns când revine; anulezi din fereastra ${product}.`,
  pickHiddenAccount: (handle, product) => `Postările de la ${handle} sunt ascunse de acum. Anulezi din fereastra ${product}.`,
  pickRefused: 'FeelingWise nu poate numi această casetă în siguranță. Încearcă o parte mai mică din ea.',
  readHint: 'Dă clic pe postarea sau comentariul pe care vrei să îl citească. Esc pentru a opri.',
  readRefused: 'Nu e nimic de citit acolo. Dă clic pe o postare sau pe un comentariu cu text.',
  readWaiting: 'Se citește.',
  readNeedsKey: 'Live Rephrase are nevoie de cheia de licență. Adaug-o în fila Licență din fereastra extensiei.',
  readAiOff: 'Live Rephrase este oprit în fereastra extensiei, așa că nu s-a trimis nimic.',
  readFailed: 'Niciun răspuns de la serviciul AI. Încearcă din nou peste puțin timp.',
  readClose: 'Închide',
  readVerdict: (family, severity) => `Încărcat emoțional: da. ${family}, severitate ${severity}.`,
  readFamilyName: { hostile: 'Ostil', threat: 'Amenințare', commercial: 'Comercial', body: 'Comparație de corpuri', profanity: 'Vulgaritate', none: '' },
  readMechanism: {
    hostile: 'Lucrează prin dispreț, batjocură sau „noi contra lor”.',
    threat: 'Lucrează prin alarmă: pericol, urgență, prăpăd.',
    commercial: 'Lucrează prin vânzare: dorință fabricată sau momeală de reacții.',
    body: 'Lucrează prin compararea corpurilor: aspect, greutate, expunere sexuală.',
    profanity: 'Vulgaritatea sau violența explicită este scopul în sine.',
    none: '',
  },
  readEffect: {
    recruit: 'Te trage înăuntru și te lasă cu ceva pe suflet.',
    inert: 'Trece prin tine și nu lasă nimic.',
    nourish: 'Lasă ceva care merită păstrat.',
  },
  readIntent: {
    scroll: 'Vrea să continui să privești.',
    react: 'Vrea o reacție.',
    buy: 'Vrea să cumperi sau să îți dorești.',
    compare: 'Vrea să te măsori cu el.',
    fear: 'Vrea să te alarmezi.',
    belong: 'Vrea să alegi o tabără.',
    inform: 'Vrea să îți spună ceva.',
    none: 'Fără un scop clar.',
  },
  readHonest: 'Poți să îl citești altfel.',
  readNotCharged: 'Nimic de aici nu pare construit să acționeze asupra ta: opinie, informație sau umor.',
  readRecordLine: (seen, charged) => {
    if (seen === 1) return `Contul acesta a apărut o dată săptămâna aceasta. Acea apariție ${charged > 0 ? 'a fost' : 'nu a fost'} semnalată.`;
    const n = charged === 0 ? 'Niciuna nu a fost semnalată' : charged === 1 ? 'Una a fost semnalată' : `${charged} au fost semnalate`;
    return `Contul acesta a apărut de ${seen} ori săptămâna aceasta. ${n}.`;
  },
};


const STRINGS_ES: MarkerStrings = {
  buttonLabel: 'Mira por qué FeelingWise cambió esta publicación',
  checkingText: 'Un momento, revisando esta publicación…',
  checkingAria: 'Revisando…',
  fallbackExplanation: 'FeelingWise intervino en esta publicación.',
  reframePrefix: 'Comentario de FeelingWise',
  greenAriaLabel: 'Publicación reescrita por IA. Pulsa para ver por qué.',
  yellowAriaLabel: 'Mostrando el motivo. Pulsa para ver el original.',
  redAriaLabel: 'Mostrando el original. Pulsa para volver al texto reescrito.',
  collapseCalmAria: 'Publicación contraída. Pulsa para ver por qué.',
  collapseWhyAria: 'Mostrando por qué está contraída esta publicación. Pulsa para ocultar el motivo.',
  patternDetected: 'Patrón detectado',
  fallbackReason: 'coincidió con un patrón de manipulación.',
  matchedTermsLine: (n) => n === 1
    ? 'El texto original tenía una palabra o expresión de la lista de filtros.'
    : `El texto original tenía ${n} palabras o expresiones de la lista de filtros.`,
  harmSignalsLine: (n) => n === 1
    ? 'Se encontró una señal de contenido dañino en este texto.'
    : `Se encontraron ${n} señales de contenido dañino en este texto.`,
  hidLine: (category) => `Publicación oculta: ${category}`,
  foldedLine: (category) => `Publicación contraída: ${category}`,
  foldedLineNoReason: 'Publicación contraída',
  hidLineTeen: (category) => `Publicación escondida: ${category}`,
  foldedLineTeen: (category) => `Publicación contraída: ${category}`,
  foldedLineNoReasonTeen: 'Publicación contraída',
  skipLineChild: 'Omitido por tu filtro Estricto. Sigue bajando.',
  catAdvertisement: 'publicidad',
  catGraphicViolence: 'violencia explícita',
  catSexual: 'contenido sexual',
  catSelfHarm: 'contenido sobre autolesiones',
  catDrugPromotion: 'promoción de drogas',
  catAiSynthetic: 'contenido sintético generado por IA',
  catGroupClaim: 'generalización sobre un grupo',
  catExtremeHostility: 'hostilidad extrema',
  catDirectThreat: 'amenaza directa u hostigamiento',
  hideNoticeBy: (handle) => `Una publicación de ${handle} está oculta`,
  hideNoticePlain: 'Esta publicación está oculta',
  hideNoticeByTeen: (handle) => `Una publicación de ${handle} quedó escondida aquí`,
  hideNoticePlainTeen: 'Una publicación quedó escondida aquí',
  hideNoticeChild: 'Omitido por tu filtro Estricto. Sigue bajando.',
  coverStrandedNotice: 'Se instaló una actualización. Vuelve a cargar esta página para revisar las publicaciones otra vez.',
  hideShowAnyway: 'mostrar de todos modos',
  hideHideAgain: 'ocultar de nuevo',
  videoRunNotice: (count) => `Se saltaron ${count} videos seguidos. Desliza para continuar.`,
  videoHiddenScrollOn: 'Se saltó este video. Desliza para continuar.',
  whyByRow: {
    R1: 'en la lista de bloqueo de este hogar',
    R2: 'un insulto discriminatorio',
    R3: 'daño en palabras en clave',
    R4: 'un anuncio',
    P1: 'un adulto que busca contacto con un menor',
    P2: 'contenido sobre autolesiones',
    P3: 'contenido sexual',
    P4: 'promoción de drogas',
    P4b: 'un reto peligroso',
    P5: 'violencia explícita',
    J1: 'contenido extremadamente cargado',
    J2: 'contenido muy cargado',
    J3: 'hostilidad dirigida a alguien de aquí',
    J4: 'hostilidad dirigida a un grupo',
    J5: 'presión sobre el cuerpo o la apariencia',
    J6: 'presión comercial',
    J7: 'contenido cargado',
    J8: 'contenido levemente cargado',
    T1: 'un tema que este hogar eligió no ver',
    T2: 'apuestas',
    D1: 'no se encontró nada dañino',
  },
  whyByFamily: {
    hostile: 'hostilidad',
    threat: 'alarma: peligro, urgencia o catástrofe',
    commercial: 'presión comercial',
    body: 'presión sobre el cuerpo o la apariencia',
    profanity: 'vulgaridad o violencia explícita',
  },
  hidCommentLine: (why) => `Comentario oculto: ${why}`,
  hidCommentPlain: 'Este comentario está oculto',
  hidCommentLineTeen: (why) => `Comentario oculto: ${why}`,
  hidCommentPlainTeen: 'Comentario oculto',
  adSlotNote: 'Aquí hay un anuncio oculto. Instagram mantiene su espacio.',
  ytHomeHidden: 'Off está ocultando tu feed de inicio de YouTube. La búsqueda, tus suscripciones y tus propias páginas siguen funcionando.',
  ytHomeShow: 'Mostrarlo esta vez',
  pickHint: 'Haz clic en lo que quieres quitar. Esc para parar.',
  pickHintMany: 'Haz clic en todo lo que quieres quitar, uno por uno. Esc al terminar.',
  pickHiddenShape: (product) => `Oculto. Sigue oculto cuando vuelva; puedes deshacerlo en la ventana de ${product}.`,
  pickHiddenAccount: (handle, product) => `Las publicaciones de ${handle} quedan ocultas desde ahora. Puedes deshacerlo en la ventana de ${product}.`,
  pickRefused: 'FeelingWise no puede identificar esta caja con seguridad. Prueba con una parte más pequeña.',
  readHint: 'Haz clic en la publicación o el comentario que quieres que lea. Esc para parar.',
  readRefused: 'Ahí no hay nada que leer. Haz clic en una publicación o un comentario con texto.',
  readWaiting: 'Leyendo.',
  readNeedsKey: 'Live Rephrase necesita la clave de licencia. Añádela en la pestaña Licencia de la ventana.',
  readAiOff: 'Live Rephrase está apagado en la ventana, así que no se envió nada.',
  readFailed: 'Sin respuesta del servicio de IA. Vuelve a intentarlo en un momento.',
  readClose: 'Cerrar',
  readVerdict: (family, severity) => `Con carga: sí. ${family}, gravedad ${severity}.`,
  readFamilyName: { hostile: 'Hostil', threat: 'Amenaza', commercial: 'Comercial', body: 'Comparación de cuerpos', profanity: 'Vulgaridad', none: '' },
  readMechanism: {
    hostile: 'Funciona por desprecio, burla o “nosotros contra ellos”.',
    threat: 'Funciona por alarma: peligro, urgencia, catástrofe.',
    commercial: 'Funciona por venta: deseo fabricado o cebo de reacciones.',
    body: 'Funciona por comparación de cuerpos: aspecto, peso, exhibición sexual.',
    profanity: 'La vulgaridad o la violencia explícita es el punto en sí.',
    none: '',
  },
  readEffect: {
    recruit: 'Te atrapa y te deja cargando con algo.',
    inert: 'Pasa de largo y no deja nada.',
    nourish: 'Deja algo que vale la pena.',
  },
  readIntent: {
    scroll: 'Quiere que sigas mirando.',
    react: 'Quiere una reacción.',
    buy: 'Quiere que compres, o que desees.',
    compare: 'Quiere que te midas con ello.',
    fear: 'Quiere que te alarmes.',
    belong: 'Quiere que tomes partido.',
    inform: 'Quiere contarte algo.',
    none: 'Sin un propósito claro.',
  },
  readHonest: 'Puedes leerlo de otra manera.',
  readNotCharged: 'Nada aquí parece hecho para actuar sobre ti: opinión, información o humor.',
  readRecordLine: (seen, charged) => {
    if (seen === 1) return `Esta cuenta ha aparecido una vez esta semana. Esa vez ${charged > 0 ? 'fue' : 'no fue'} marcada.`;
    const n = charged === 0 ? 'Ninguna fue marcada' : charged === 1 ? 'Una fue marcada' : `${charged} fueron marcadas`;
    return `Esta cuenta ha aparecido ${seen} veces esta semana. ${n}.`;
  },
};

const STRINGS_PT_BR: MarkerStrings = {
  buttonLabel: 'Veja por que o FeelingWise mudou esta publicação',
  checkingText: 'Um momentinho, estamos dando uma olhada…',
  checkingAria: 'Verificando…',
  fallbackExplanation: 'O FeelingWise interveio nesta publicação.',
  reframePrefix: 'Comentário do FeelingWise',
  greenAriaLabel: 'Publicação reescrita por IA. Selecione para ver o motivo.',
  yellowAriaLabel: 'Mostrando o motivo. Selecione para ver o original.',
  redAriaLabel: 'Mostrando o original. Selecione para voltar ao texto reescrito.',
  collapseCalmAria: 'Publicação minimizada. Selecione para ver o motivo.',
  collapseWhyAria: 'Mostrando por que esta publicação foi minimizada. Selecione para fechar.',
  patternDetected: 'Padrão detectado',
  fallbackReason: 'corresponde a um padrão de manipulação.',
  matchedTermsLine: (n) => n === 1
    ? 'O texto original tinha uma palavra ou expressão da lista de filtros.'
    : `O texto original tinha ${n} palavras ou expressões da lista de filtros.`,
  harmSignalsLine: (n) => n === 1
    ? 'Foi encontrado um sinal de conteúdo nocivo neste texto.'
    : `Foram encontrados ${n} sinais de conteúdo nocivo neste texto.`,
  hidLine: (category) => `Publicação oculta: ${category}`,
  foldedLine: (category) => `Publicação minimizada: ${category}`,
  foldedLineNoReason: 'Publicação minimizada',
  hidLineTeen: (category) => `Publicação escondida: ${category}`,
  foldedLineTeen: (category) => `Publicação minimizada: ${category}`,
  foldedLineNoReasonTeen: 'Publicação minimizada',
  skipLineChild: 'Pulado pelo seu filtro Rigoroso. Pode continuar rolando.',
  catAdvertisement: 'publicidade',
  catGraphicViolence: 'violência explícita',
  catSexual: 'conteúdo sexual',
  catSelfHarm: 'conteúdo sobre automutilação',
  catDrugPromotion: 'promoção de drogas',
  catAiSynthetic: 'conteúdo sintético gerado por IA',
  catGroupClaim: 'generalização sobre um grupo',
  catExtremeHostility: 'hostilidade extrema',
  catDirectThreat: 'ameaça direta ou assédio',
  hideNoticeBy: (handle) => `Uma publicação de ${handle} está oculta`,
  hideNoticePlain: 'Esta publicação está oculta',
  hideNoticeByTeen: (handle) => `Uma publicação de ${handle} ficou escondida aqui`,
  hideNoticePlainTeen: 'Uma publicação ficou escondida aqui',
  hideNoticeChild: 'Pulado pelo seu filtro Rigoroso. Pode continuar rolando.',
  coverStrandedNotice: 'Uma atualização foi instalada. Recarregue esta página para verificar as publicações de novo.',
  hideShowAnyway: 'mostrar mesmo assim',
  hideHideAgain: 'ocultar de novo',
  videoRunNotice: (count) => `${count} vídeos seguidos foram pulados. Role para continuar.`,
  videoHiddenScrollOn: 'Este vídeo foi pulado. Role para ver o próximo.',
  whyByRow: {
    R1: 'na lista de bloqueio desta família',
    R2: 'uma ofensa ligada à identidade',
    R3: 'dano em palavras em código',
    R4: 'um anúncio',
    P1: 'um adulto buscando contato com um menor',
    P2: 'conteúdo sobre automutilação',
    P3: 'conteúdo sexual',
    P4: 'promoção de drogas',
    P4b: 'um desafio perigoso',
    P5: 'violência explícita',
    J1: 'conteúdo extremamente carregado',
    J2: 'conteúdo muito carregado',
    J3: 'hostilidade dirigida a alguém daqui',
    J4: 'hostilidade dirigida a um grupo',
    J5: 'pressão sobre o corpo ou a aparência',
    J6: 'pressão comercial',
    J7: 'conteúdo carregado',
    J8: 'conteúdo levemente carregado',
    T1: 'um assunto que esta família escolheu não ver',
    T2: 'apostas',
    D1: 'não se encontrou nada nocivo',
  },
  whyByFamily: {
    hostile: 'hostilidade',
    threat: 'alarme: perigo, urgência ou catástrofe',
    commercial: 'pressão comercial',
    body: 'pressão sobre o corpo ou a aparência',
    profanity: 'vulgaridade ou violência explícita',
  },
  hidCommentLine: (why) => `Comentário oculto: ${why}`,
  hidCommentPlain: 'Este comentário está oculto',
  hidCommentLineTeen: (why) => `Comentário escondido: ${why}`,
  hidCommentPlainTeen: 'Comentário escondido',
  adSlotNote: 'Um anúncio foi ocultado aqui. O Instagram mantém o espaço reservado.',
  ytHomeHidden: 'O Off está ocultando seu feed inicial do YouTube. A busca, suas inscrições e suas próprias páginas continuam funcionando.',
  ytHomeShow: 'Mostrar desta vez',
  pickHint: 'Clique no que você quer tirar. Esc para parar.',
  pickHintMany: 'Clique em tudo o que você quer tirar, um por um. Esc quando terminar.',
  pickHiddenShape: (product) => `Oculto. Continua oculto quando voltar; você desfaz na janela do ${product}.`,
  pickHiddenAccount: (handle, product) => `As publicações de ${handle} ficam ocultas a partir de agora. Você desfaz na janela do ${product}.`,
  pickRefused: 'O FeelingWise não consegue identificar esta caixa com segurança. Tente uma parte menor dela.',
  readHint: 'Clique na publicação ou no comentário que você quer que a IA leia. Esc para parar.',
  readRefused: 'Não há nada para ler ali. Clique em uma publicação ou em um comentário com texto.',
  readWaiting: 'Lendo.',
  readNeedsKey: 'O Live Rephrase precisa da chave de licença. Adicione-a na aba Licença da janela.',
  readAiOff: 'O Live Rephrase está desligado na janela, então nada foi enviado.',
  readFailed: 'Sem resposta do serviço de IA. Tente de novo daqui a pouco.',
  readClose: 'Fechar',
  readVerdict: (family, severity) => `Com carga: sim. ${family}, gravidade ${severity}.`,
  readFamilyName: { hostile: 'Hostil', threat: 'Ameaça', commercial: 'Comercial', body: 'Comparação de corpos', profanity: 'Vulgaridade', none: '' },
  readMechanism: {
    hostile: 'Funciona por desprezo, zombaria ou “nós contra eles”.',
    threat: 'Funciona por alarme: perigo, urgência, catástrofe.',
    commercial: 'Funciona por venda: desejo fabricado ou isca de reações.',
    body: 'Funciona por comparação de corpos: aparência, peso, exibição sexual.',
    profanity: 'A vulgaridade ou a violência explícita é o ponto em si.',
    none: '',
  },
  readEffect: {
    recruit: 'Puxa você para dentro e deixa você carregando algo.',
    inert: 'Passa e não deixa nada.',
    nourish: 'Deixa algo que vale a pena.',
  },
  readIntent: {
    scroll: 'Quer que você continue olhando.',
    react: 'Quer uma reação.',
    buy: 'Quer que você compre, ou deseje.',
    compare: 'Quer que você se meça com isso.',
    fear: 'Quer alarmar você.',
    belong: 'Quer que você escolha um lado.',
    inform: 'Quer contar algo a você.',
    none: 'Sem um propósito claro.',
  },
  readHonest: 'Você pode ler de outro jeito.',
  readNotCharged: 'Nada aqui parece feito para agir sobre você: opinião, informação ou humor.',
  readRecordLine: (seen, charged) => {
    if (seen === 1) return `Esta conta apareceu uma vez esta semana. Essa vez ${charged > 0 ? 'foi' : 'não foi'} sinalizada.`;
    const n = charged === 0 ? 'Nenhuma foi sinalizada' : charged === 1 ? 'Uma foi sinalizada' : `${charged} foram sinalizadas`;
    return `Esta conta apareceu ${seen} vezes esta semana. ${n}.`;
  },
};

export const MARKER_STRINGS: Record<ResolvedUiLanguage, MarkerStrings> = {
  en: STRINGS_EN,
  ro: STRINGS_RO,
  es: STRINGS_ES,
  'pt-BR': STRINGS_PT_BR,
};

// ─── Plain-language technique names (marker title) ──────────────────────────
//
// The dashboard-facing TECHNIQUE_NAMES in shared-panel.ts are designed for
// a parent's audit view. The teen marker needs everyday phrasing — not
// "fear-appeal" but "fear pressure". These maps are intentionally separate;
// changing one should not auto-change the other.

const TITLE_EN: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'Fear pressure',
  'repeat-exposure':          'Seen this a lot',
  'anger-trigger':            'Anger bait',
  'shame-attack':             'Shame attack',
  'false-urgency':            'Manufactured rush',
  'bandwagon':                'Crowd pressure',
  'scapegoating':             'Group blame',
  'fomo':                     'Fear of missing out',
  'toxic-positivity':         'Forced positivity',
  'misleading-format':        'Visual tricks',
  'combined':                 'Pressure of another kind',
  'profanity':                'Profanity',
  'body-comparison-priming':  'Body comparison',
  'parasocial-coercion':      'Loyalty test',
  'consumer-rapid-frame':     'Buy-now pressure',
  'hyperreal-trauma-bait':    'Synthetic AI drama',
  // combined-stack + 5 harm categories.
  'combined-stack':           'Stacked hostility',
  'sexual':                   'Sexual content',
  'violence-graphic':         'Graphic violence',
  'self-harm':                'Self-harm risk',
  'drug-promotion':           'Drug promotion',
  'unsafe-health-experiment': 'Unsafe health experiment',
  'extreme-toxicity':         'Extreme toxicity',
};

const TITLE_RO: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'Presiune prin frică',
  'repeat-exposure':          'Îl vezi des',
  'anger-trigger':            'Momeală de furie',
  'shame-attack':             'Atac prin rușinare',
  'false-urgency':            'Grabă fabricată',
  'bandwagon':                'Presiunea mulțimii',
  'scapegoating':             'Vină dată pe un grup',
  'fomo':                     'Frica de a rata ceva',
  'toxic-positivity':         'Pozitivitate forțată',
  'misleading-format':        'Trucuri vizuale',
  'combined':                 'Presiune de alt fel',
  'profanity':                'Limbaj vulgar',
  'body-comparison-priming':  'Comparație corporală',
  'parasocial-coercion':      'Test de loialitate',
  'consumer-rapid-frame':     'Presiune de cumpărare',
  'hyperreal-trauma-bait':    'Dramă artificială făcută cu AI',
  'combined-stack':           'Ostilitate cumulată',
  'sexual':                   'Conținut sexual',
  'violence-graphic':         'Violență explicită',
  'self-harm':                'Risc de autovătămare',
  'drug-promotion':           'Promovarea drogurilor',
  'unsafe-health-experiment': 'Experiment de sănătate nesigur',
  'extreme-toxicity':         'Toxicitate extremă',
};


const TITLE_ES: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'Presión por miedo',
  'repeat-exposure':          'Lo ves mucho',
  'anger-trigger':            'Cebo de rabia',
  'shame-attack':             'Ataque por vergüenza',
  'false-urgency':            'Prisa fabricada',
  'bandwagon':                'Presión del grupo',
  'scapegoating':             'Culpa a un grupo',
  'fomo':                     'Miedo a quedarte fuera',
  'toxic-positivity':         'Positividad forzada',
  'misleading-format':        'Trucos visuales',
  'combined':                 'Presión de otro tipo',
  'profanity':                'Lenguaje vulgar',
  'body-comparison-priming':  'Comparación de cuerpos',
  'parasocial-coercion':      'Prueba de lealtad',
  'consumer-rapid-frame':     'Presión de compra',
  'hyperreal-trauma-bait':    'Drama artificial de IA',
  'combined-stack':           'Hostilidad acumulada',
  'sexual':                   'Contenido sexual',
  'violence-graphic':         'Violencia explícita',
  'self-harm':                'Riesgo de autolesión',
  'drug-promotion':           'Promoción de drogas',
  'unsafe-health-experiment': 'Experimento de salud peligroso',
  'extreme-toxicity':         'Toxicidad extrema',
};

const TITLE_PT_BR: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'Pressão pelo medo',
  'repeat-exposure':          'Você vê muito isso',
  'anger-trigger':            'Isca de raiva',
  'shame-attack':             'Ataque por vergonha',
  'false-urgency':            'Pressa fabricada',
  'bandwagon':                'Pressão da maioria',
  'scapegoating':             'Culpa jogada num grupo',
  'fomo':                     'Medo de ficar de fora',
  'toxic-positivity':         'Positividade forçada',
  'misleading-format':        'Truques visuais',
  'combined':                 'Pressão de outro tipo',
  'profanity':                'Linguagem vulgar',
  'body-comparison-priming':  'Comparação de corpos',
  'parasocial-coercion':      'Teste de lealdade',
  'consumer-rapid-frame':     'Pressão para comprar',
  'hyperreal-trauma-bait':    'Drama artificial de IA',
  'combined-stack':           'Hostilidade acumulada',
  'sexual':                   'Conteúdo sexual',
  'violence-graphic':         'Violência explícita',
  'self-harm':                'Risco de automutilação',
  'drug-promotion':           'Promoção de drogas',
  'unsafe-health-experiment': 'Experimento de saúde perigoso',
  'extreme-toxicity':         'Toxicidade extrema',
};

export const MARKER_TITLES: Record<ResolvedUiLanguage, Readonly<Record<TechniqueName, string>>> = {
  en: TITLE_EN,
  ro: TITLE_RO,
  es: TITLE_ES,
  'pt-BR': TITLE_PT_BR,
};

// Per-technique one-line REASON templates. Used as the FALLBACK when the
// LLM-grounded `analysis.explanation` is missing or fails the guard chain in
// `pickYellowReason` (teen-marker.ts). One short sentence describing what
// THIS pattern does; the comment-specific LLM reason (when present) carries
// the per-record specificity.

const REASON_EN: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'uses fear or threat to push the reader toward a decision before they can think it through.',
  'repeat-exposure':          'is not unusual on its own. This source, or this exact post, has simply reached you many times.',
  'anger-trigger':            'designed to provoke anger so you react before thinking.',
  'shame-attack':             'personally attacks a target with shame language to silence them rather than answer the argument.',
  'false-urgency':            'manufactures urgency to short-circuit careful thought.',
  'bandwagon':                'implies "everyone is doing this" to pressure you to follow along.',
  'scapegoating':             'blames an entire group for problems with a sweeping generalization.',
  'fomo':                     'pushes fear of missing out to drive a quick action.',
  'toxic-positivity':         'forces an upbeat frame that dismisses real concerns.',
  'misleading-format':        'uses visual or formatting tricks to do the work the content cannot.',
  'combined':                 'pushes on the reader in a way none of the named patterns covers.',
  'profanity':                'uses vulgar language as a hostility signal aimed at silencing rather than discussing.',
  'body-comparison-priming':  'primes you to compare your body to an idealized or filtered image.',
  'parasocial-coercion':      'uses a fake personal bond to pressure loyalty.',
  'consumer-rapid-frame':     'frames buying as urgent and inevitable.',
  'hyperreal-trauma-bait':    'uses synthetic AI-generated drama to bait emotion.',
  'combined-stack':           'stacks several hostile signals at once: slurs, character attacks, group blame.',
  'sexual':                   'contains sexual content.',
  'violence-graphic':         'depicts graphic violence or its consequences.',
  'self-harm':                'references self-harm in a way that may normalize or romanticize it.',
  'drug-promotion':           'normalizes or promotes drug use.',
  'unsafe-health-experiment': 'frames risky health behavior like overdosing or megadosing as beneficial or worth imitating.',
  'extreme-toxicity':         'crosses into extreme toxicity beyond normal disagreement.',
};

const REASON_RO: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'folosește frica sau amenințarea ca să împingă cititorul spre o decizie înainte să apuce să o gândească.',
  'repeat-exposure':          'nu are nimic ieșit din comun în sine. Doar că sursa asta, sau exact postarea asta, a ajuns la tine de multe ori.',
  'anger-trigger':            'este făcut să provoace furie, ca să reacționezi înainte să gândești.',
  'shame-attack':             'atacă personal pe cineva cu limbaj de rușinare, ca să-l reducă la tăcere în loc să răspundă argumentului.',
  'false-urgency':            'fabrică urgență ca să scurtcircuiteze gândirea atentă.',
  'bandwagon':                'sugerează că „toată lumea face asta” ca să te preseze să faci la fel.',
  'scapegoating':             'dă vina pe un grup întreg printr-o generalizare grăbită.',
  'fomo':                     'apasă pe frica de a rata ceva ca să provoace o acțiune rapidă.',
  'toxic-positivity':         'impune un ton forțat optimist care ignoră îngrijorările reale.',
  'misleading-format':        'folosește trucuri vizuale sau de formatare ca să facă treaba pe care conținutul nu o poate face.',
  'combined':                 'apasă pe cititor într-un fel pe care niciun tipar cu nume nu îl acoperă.',
  'profanity':                'folosește limbaj vulgar ca semnal de ostilitate, menit să reducă la tăcere, nu să discute.',
  'body-comparison-priming':  'te împinge să-ți compari corpul cu o imagine idealizată sau filtrată.',
  'parasocial-coercion':      'folosește o legătură personală falsă ca să preseze loialitatea.',
  'consumer-rapid-frame':     'prezintă cumpărarea ca urgentă și inevitabilă.',
  'hyperreal-trauma-bait':    'folosește dramă artificială generată de AI ca să stârnească emoții.',
  'combined-stack':           'cumulează mai multe semnale ostile deodată: insulte discriminatorii, atacuri la persoană, vină dată pe un grup.',
  'sexual':                   'conține conținut sexual.',
  'violence-graphic':         'arată violență explicită sau urmările ei.',
  'self-harm':                'face referire la autovătămare într-un mod care o poate normaliza sau romantiza.',
  'drug-promotion':           'normalizează sau promovează consumul de droguri.',
  'unsafe-health-experiment': 'prezintă un comportament riscant de sănătate, precum supradozarea, ca fiind benefic sau demn de imitat.',
  'extreme-toxicity':         'trece în toxicitate extremă, dincolo de un dezacord normal.',
};


const REASON_ES: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'usa el miedo o la amenaza para empujar al lector hacia una decisión antes de que pueda pensarla.',
  'repeat-exposure':          'no tiene nada raro en sí mismo. Simplemente esta fuente, o esta misma publicación, te ha llegado muchas veces.',
  'anger-trigger':            'está hecho para provocar rabia, para que reacciones antes de pensar.',
  'shame-attack':             'ataca personalmente a alguien con lenguaje de vergüenza, para callarlo en vez de responder al argumento.',
  'false-urgency':            'fabrica urgencia para cortocircuitar el pensamiento cuidadoso.',
  'bandwagon':                'insinúa que todo el mundo hace esto, para presionarte a seguir la corriente.',
  'scapegoating':             'culpa a un grupo entero de los problemas con una generalización de brocha gorda.',
  'fomo':                     'aprieta sobre el miedo a quedarte fuera para provocar una acción rápida.',
  'toxic-positivity':         'impone a la fuerza un tono animado que descarta preocupaciones reales.',
  'misleading-format':        'usa trucos visuales o de formato para hacer el trabajo que el contenido no puede hacer.',
  'combined':                 'presiona al lector de una forma que ningún patrón con nombre cubre.',
  'profanity':                'usa lenguaje vulgar como señal de hostilidad, dirigida a callar en vez de discutir.',
  'body-comparison-priming':  'te induce a comparar tu cuerpo con una imagen idealizada o filtrada.',
  'parasocial-coercion':      'usa un vínculo personal falso para presionar lealtad.',
  'consumer-rapid-frame':     'presenta la compra como urgente e inevitable.',
  'hyperreal-trauma-bait':    'usa drama artificial generado por IA para provocar emoción.',
  'combined-stack':           'acumula varias señales hostiles a la vez: insultos discriminatorios, ataques a la persona, culpa a un grupo.',
  'sexual':                   'contiene contenido sexual.',
  'violence-graphic':         'muestra violencia explícita o sus consecuencias.',
  'self-harm':                'menciona la autolesión de una forma que puede normalizarla o romantizarla.',
  'drug-promotion':           'normaliza o promueve el consumo de drogas.',
  'unsafe-health-experiment': 'presenta una conducta de salud arriesgada, como una sobredosis o una megadosis, como beneficiosa o digna de imitar.',
  'extreme-toxicity':         'cruza a una toxicidad extrema, más allá de un desacuerdo normal.',
};

const REASON_PT_BR: Readonly<Record<TechniqueName, string>> = {
  'fear-appeal':              'usa o medo ou a ameaça para empurrar o leitor a uma decisão antes que ele consiga pensar.',
  'repeat-exposure':          'não tem nada de estranho em si. Só que esta fonte, ou esta mesma publicação, chegou até você muitas vezes.',
  'anger-trigger':            'foi feito para provocar raiva, para você reagir antes de pensar.',
  'shame-attack':             'ataca alguém pessoalmente com linguagem de vergonha, para calar essa pessoa em vez de responder ao argumento.',
  'false-urgency':            'fabrica urgência para curto-circuitar o pensamento cuidadoso.',
  'bandwagon':                'sugere que todo mundo faz isso, para pressionar você a seguir junto.',
  'scapegoating':             'joga a culpa dos problemas num grupo inteiro com uma generalização grosseira.',
  'fomo':                     'aperta o medo de ficar de fora para provocar uma ação rápida.',
  'toxic-positivity':         'impõe à força um tom animado que descarta preocupações reais.',
  'misleading-format':        'usa truques visuais ou de formatação para fazer o trabalho que o conteúdo não consegue fazer.',
  'combined':                 'pressiona o leitor de um jeito que nenhum padrão com nome cobre.',
  'profanity':                'usa linguagem vulgar como sinal de hostilidade, feita para calar e não para discutir.',
  'body-comparison-priming':  'induz você a comparar seu corpo com uma imagem idealizada ou filtrada.',
  'parasocial-coercion':      'usa um vínculo pessoal falso para pressionar lealdade.',
  'consumer-rapid-frame':     'apresenta a compra como urgente e inevitável.',
  'hyperreal-trauma-bait':    'usa drama artificial gerado por IA para provocar emoção.',
  'combined-stack':           'acumula vários sinais hostis de uma vez: ofensas discriminatórias, ataques pessoais, culpa jogada num grupo.',
  'sexual':                   'contém conteúdo sexual.',
  'violence-graphic':         'mostra violência explícita ou suas consequências.',
  'self-harm':                'menciona automutilação de um jeito que pode normalizá-la ou romantizá-la.',
  'drug-promotion':           'normaliza ou promove o uso de drogas.',
  'unsafe-health-experiment': 'apresenta um comportamento de saúde arriscado, como overdose ou megadose, como benéfico ou digno de imitação.',
  'extreme-toxicity':         'passa para uma toxicidade extrema, além de uma discordância normal.',
};

export const MARKER_REASONS: Record<ResolvedUiLanguage, Readonly<Record<TechniqueName, string>>> = {
  en: REASON_EN,
  ro: REASON_RO,
  es: REASON_ES,
  'pt-BR': REASON_PT_BR,
};
