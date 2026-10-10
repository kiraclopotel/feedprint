// What the pattern classifiers read instead of raw text: a normalized copy that typography tricks
// cannot slip past, counted features (capitals, pronouns, emoji), and the context that tells
// someone reporting manipulation from someone doing it (quotes, news attribution, register).

// Zero-width, soft-hyphen and direction marks, used to split a keyword so a filter misses it.
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\u00AD\u180E\uFEFF]/g;

// So the patterns' plain `'` and `"` match typographic quotes too.
const SMART_QUOTE_MAP: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
  '\u2039': "'", '\u203A': "'",
  '\u00AB': '"', '\u00BB': '"',
  '\u2014': '-', '\u2013': '-', '\u2212': '-',
  '\u2026': '...',
};

const SMART_QUOTE_RE = new RegExp(`[${Object.keys(SMART_QUOTE_MAP).join('')}]`, 'g');

// Only next to a letter, so "5G" and phone numbers stay intact: "k!ll" becomes "kill". A scan, not
// a regex replace, because a replace consumes the letter it matched beside: in "C@t@strophic" it
// took "C@t" and then missed the second "@".
const LEET_SUBSTITUTE: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '*': 'a',
};
function deobfuscateLeetspeak(text: string): string {
  const chars = [...text];
  // Adjacency is judged on the original letters, so one replacement cannot make the next symbol
  // look like it sits beside a letter and set off a cascade.
  const isLetter: boolean[] = chars.map(c => /[a-zA-Z]/.test(c));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (LEET_SUBSTITUTE[c] !== undefined) {
      const prevLetter = i > 0 && isLetter[i - 1];
      const nextLetter = i < chars.length - 1 && isLetter[i + 1];
      if (prevLetter || nextLetter) {
        chars[i] = LEET_SUBSTITUTE[c];
      }
    }
  }
  return chars.join('');
}

function foldDiacritics(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** For matching only; the original text is kept for display. */
function normalizeForMatching(text: string): string {
  let out = text.normalize('NFC');
  out = out.replace(INVISIBLE_CHARS, '');
  out = out.replace(SMART_QUOTE_RE, (c) => SMART_QUOTE_MAP[c] ?? c);
  out = out.replace(/[ \t]+/g, ' ');
  return out;
}

/** A second pass for camouflaged words: diacritics folded ("ĸĩłł") and leetspeak decoded. */
function normalizeAggressive(text: string): string {
  const base = normalizeForMatching(text);
  const folded = foldDiacritics(base);
  return deobfuscateLeetspeak(folded);
}

interface LinguisticFeatures {
  charCount: number;
  wordCount: number;
  sentenceCount: number;

  capsRatio: number;          // share of letters that are capitals
  allCapsWordCount: number;   // words of 3 or more letters
  exclamationCount: number;
  exclamationDensity: number; // per 100 words
  questionCount: number;
  punctuationRunCount: number; // "!!!", "?!?!"

  secondPersonCount: number;
  secondPersonDensity: number; // per 100 words
  firstPersonCount: number;
  thirdPersonPluralCount: number;

  imperativeHintCount: number;
  superlativeCount: number;

  emojiCount: number;
  hashtagCount: number;
  mentionCount: number;
  urlCount: number;

  countdownTokenCount: number; // "3 days left"
  percentageMentionCount: number;
}

// Not \b, which treats every accented letter as a non-letter and cut the Romanian 'Îți' to 'i'. A
// word still starts and ends with a letter, digit or underscore, as it did with \b.
const WORD_RE = /(?<![\p{L}\p{N}_])[\p{L}\p{N}_](?:[\p{L}\p{N}'_-]*[\p{L}\p{N}_])?/gu;
const SENTENCE_RE = /[.!?]+(?:\s|$)/g;
const EMOJI_RE = /[\p{Extended_Pictographic}]/gu;

// Spanish and Portuguese usually drop the subject ("eres un idiota" has no 'tu'), so these counts
// run low there, and any classifier leaning on person counts is less sensitive in those two
// languages. Object pronouns and possessives are in the lists because they survive, which
// recovers part of it. Left out: 'os', 'los' and 'las', which are also the commonest articles,
// and 'su', which is third person as often as polite second.
const SECOND_PERSON_EN = ['you', 'your', 'yours', 'yourself', 'yourselves', 'ye'];
const SECOND_PERSON_RO = ['tu', 'tău', 'tau', 'ta', 'tale', 'tăi', 'tai', 'voi', 'vostru', 'voastră', 'voastra', 'voștri', 'vostri', 'voastre', 'ție', 'tie', 'vă', 'va', 'ți', 'ti', 'îți', 'iti'];
const FIRST_PERSON_EN = ['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves'];
const FIRST_PERSON_RO = ['eu', 'mie', 'meu', 'mea', 'mei', 'mele', 'noi', 'nouă', 'noua', 'nostru', 'noastră', 'noastra', 'noștri', 'nostri', 'noastre', 'îmi', 'imi'];
const THIRD_PLURAL_EN = ['they', 'them', 'their', 'theirs', 'themselves'];
const THIRD_PLURAL_RO = ['ei', 'ele', 'lor', 'le', 'îi', 'ii', 'au'];

const SECOND_PERSON_ES = ['tu', 'ti', 'te', 'tus', 'tuyo', 'tuya', 'tuyos', 'tuyas', 'contigo', 'usted', 'ustedes', 'vosotros', 'vosotras', 'vuestro', 'vuestra', 'vos'];
const SECOND_PERSON_PT = ['voce', 'voces', 'teu', 'tua', 'teus', 'tuas', 'contigo', 'convosco', 'vos'];
const FIRST_PERSON_ES = ['yo', 'mi', 'mis', 'mio', 'mia', 'conmigo', 'nosotros', 'nosotras', 'nuestro', 'nuestra', 'nuestros', 'nuestras'];
const FIRST_PERSON_PT = ['eu', 'meu', 'minha', 'meus', 'minhas', 'mim', 'comigo', 'nosso', 'nossa', 'nossos', 'nossas'];
const THIRD_PLURAL_ES_PT = ['ellos', 'ellas', 'les', 'suyos', 'eles', 'elas', 'lhes', 'deles', 'delas'];

const SECOND_PERSON_SET = new Set([
  ...SECOND_PERSON_EN, ...SECOND_PERSON_RO, ...SECOND_PERSON_ES, ...SECOND_PERSON_PT,
]);
const FIRST_PERSON_SET = new Set([
  ...FIRST_PERSON_EN, ...FIRST_PERSON_RO, ...FIRST_PERSON_ES, ...FIRST_PERSON_PT,
]);
const THIRD_PLURAL_SET = new Set([...THIRD_PLURAL_EN, ...THIRD_PLURAL_RO, ...THIRD_PLURAL_ES_PT]);

const IMPERATIVE_HINTS = new Set([
  // English
  'stop', 'start', 'click', 'share', 'tap', 'check', 'look', 'listen', 'watch',
  'buy', 'get', 'grab', 'hurry', 'act', 'join', 'sign', 'subscribe', 'donate',
  'avoid', 'beware', 'warn', 'remember', 'forget', 'never', 'always',
  // Romanian
  'opriți', 'opreste', 'opreşte', 'începe', 'incepe', 'apasă', 'apasa',
  'distribuie', 'împărtășește', 'impartaseste', 'verifică', 'verifica',
  'uită-te', 'uita-te', 'vezi', 'ascultă', 'asculta', 'cumpără', 'cumpara',
  'grăbește', 'grabeste', 'abonează', 'aboneaza', 'evită', 'evita',
  'atenție', 'atentie', 'ține', 'tine', 'ferește', 'fereste',
  // Spanish, unambiguous forms only: not 'para', far more often "for" than "stop", and not 'mira'.
  'detente', 'empieza', 'comienza', 'haz', 'clickea', 'pincha', 'comparte',
  'revisa', 'escucha', 'compra', 'consigue', 'apurate', 'apresurate', 'unete',
  'suscribete', 'dona', 'evita', 'cuidado', 'recuerda', 'olvida', 'nunca',
  'siempre', 'entra', 'descarga',
  // Portuguese
  'pare', 'comece', 'clique', 'compartilhe', 'confira', 'escute', 'assista',
  'compre', 'corra', 'participe', 'inscreva', 'doe', 'evite', 'lembre',
  'esqueca', 'nunca', 'sempre', 'baixe', 'acesse',
]);

const SUPERLATIVE_HINTS = new Set([
  // English
  'best', 'worst', 'only', 'most', 'least', 'never', 'always', 'every', 'everyone',
  'everything', 'nothing', 'nobody', 'none', 'all', 'ever', 'biggest', 'greatest',
  'ultimate', 'perfect', 'absolute', 'total', 'complete', 'utter',
  // Romanian
  'cel', 'cea', 'cei', 'cele', 'mai', 'niciodată', 'niciodata', 'întotdeauna',
  'intotdeauna', 'fiecare', 'toți', 'toti', 'toate', 'totul', 'nimic', 'nimeni',
  'absolut', 'total', 'complet',
  // Spanish. Not 'todo' or 'toda': ordinary quantifiers in almost every sentence ("todo el dia").
  'mejor', 'peor', 'unico', 'unica', 'mas', 'menos', 'nunca', 'siempre',
  'todos', 'todas', 'nada', 'nadie', 'jamas', 'absoluto', 'absoluta',
  'completo', 'completa', 'perfecto', 'perfecta', 'definitivo',
  // Portuguese
  'melhor', 'pior', 'unico', 'unica', 'mais', 'menos', 'nunca', 'sempre',
  'todos', 'todas', 'nada', 'ninguem', 'jamais', 'absoluto', 'completo',
  'perfeito', 'definitivo',
]);

const COUNTDOWN_RE = /\b\d+\s*(second|minute|hour|day|week|month|year|sec|min|hr|h|d|w|m|y|or[eă]|zi(?:le)?|s[aă]pt|lun[aă]|an(?:i)?)\s*(left|remaining|until|before|before|r[aă]mas|ramas|mai)\b/gi;

/** Expects text from normalizeForMatching. */
function extractFeatures(text: string): LinguisticFeatures {
  const charCount = text.length;
  const words = text.match(WORD_RE) ?? [];
  const wordCount = words.length;
  const sentenceCount = Math.max(1, (text.match(SENTENCE_RE) ?? []).length);

  let upperLetters = 0;
  let totalLetters = 0;
  for (const char of text) {
    if (/\p{L}/u.test(char)) {
      totalLetters++;
      if (char === char.toUpperCase() && char !== char.toLowerCase()) upperLetters++;
    }
  }
  const capsRatio = totalLetters > 0 ? upperLetters / totalLetters : 0;

  let allCapsWordCount = 0;
  for (const w of words) {
    if (w.length >= 3 && w === w.toUpperCase() && /\p{L}/u.test(w)) {
      allCapsWordCount++;
    }
  }

  const exclamationCount = (text.match(/!/g) ?? []).length;
  const questionCount = (text.match(/\?/g) ?? []).length;
  const punctuationRunCount = (text.match(/[!?]{2,}/g) ?? []).length;

  let secondPerson = 0;
  let firstPerson = 0;
  let thirdPlural = 0;
  let imperatives = 0;
  let superlatives = 0;

  for (const raw of words) {
    const w = raw.toLowerCase();
    if (SECOND_PERSON_SET.has(w)) secondPerson++;
    else if (FIRST_PERSON_SET.has(w)) firstPerson++;
    else if (THIRD_PLURAL_SET.has(w)) thirdPlural++;
    if (IMPERATIVE_HINTS.has(w)) imperatives++;
    if (SUPERLATIVE_HINTS.has(w)) superlatives++;
  }

  const emojiCount = (text.match(EMOJI_RE) ?? []).length;
  const hashtagCount = (text.match(/#\w+/g) ?? []).length;
  const mentionCount = (text.match(/@\w+/g) ?? []).length;
  const urlCount = (text.match(/https?:\/\/\S+/g) ?? []).length;

  const countdownTokenCount = (text.match(COUNTDOWN_RE) ?? []).length;
  const percentageMentionCount = (text.match(/\b\d+\s*%/g) ?? []).length;

  const per100 = (n: number): number => wordCount > 0 ? (n / wordCount) * 100 : 0;

  return {
    charCount,
    wordCount,
    sentenceCount,
    capsRatio,
    allCapsWordCount,
    exclamationCount,
    exclamationDensity: per100(exclamationCount),
    questionCount,
    punctuationRunCount,
    secondPersonCount: secondPerson,
    secondPersonDensity: per100(secondPerson),
    firstPersonCount: firstPerson,
    thirdPersonPluralCount: thirdPlural,
    imperativeHintCount: imperatives,
    superlativeCount: superlatives,
    emojiCount,
    hashtagCount,
    mentionCount,
    urlCount,
    countdownTokenCount,
    percentageMentionCount,
  };
}

type Register =
  | 'news-report'      // "According to X, Y happened"
  | 'clickbait'        // "You won't believe..."
  | 'conversational'   // casual, first person
  | 'promotional'
  | 'formal'
  | 'unknown';

const NEWS_ATTRIBUTION_RE = /\b(according to|reported by|sources? (say|said|report|reported)|officials? (say|said|announce[d]?)|study (find[s]?|found|show[s]?|showed)|data (show[s]?|showed|indicate[s]?|revealed)|spokes(?:person|man|woman) (said|announced)|press release|the (report|study|paper) (says|found|claims))\b/i;
const NEWS_ATTRIBUTION_RO_RE = /\b(potrivit|conform|surse? (spun|au spus|au raportat)|oficiali[iî]? (au spus|au anun[tț]at)|studiul (a (ar[aă]tat|descoperit|g[aă]sit)|arat[aă])|datele (arat[aă]|indic[aă])|purt[aă]torul de cuv[aâ]nt|comunicat de pres[aă])\b/i;

const NEWS_ATTRIBUTION_ES_RE = /\b(seg[uú]n|de acuerdo con|informa(?:ron)?|report[oó]|(?:alerta|advierte|avisa)n? de que|fuentes? (?:dicen|dijeron|informaron)|(?:el|un) estudio (?:muestra|mostr[oó]|encontr[oó]|revel[oó])|los datos (?:muestran|indican|revelan)|el portavoz|comunicado de prensa|autoridades (?:dijeron|informaron|anunciaron))\b/i;
const NEWS_ATTRIBUTION_PT_RE = /\b(segundo|de acordo com|informou|reportou|(?:alerta|adverte|avisa)m? que|fontes? (?:dizem|disseram|informaram)|(?:o|um) estudo (?:mostra|mostrou|encontrou|revelou)|os dados (?:mostram|indicam|revelam)|o porta-voz|comunicado (?:de|à) imprensa|autoridades (?:disseram|informaram|anunciaram))\b/i;

const CLICKBAIT_RE = /\b(you (won'?t|will not) believe|what happened next|doctors hate|this one (trick|secret)|shocking|unbelievable|jaw[- ]dropping|mind[- ]blowing)\b/i;
const CLICKBAIT_RO_RE = /\b(nu (î[tț]i|iti|o s[aă]) vin[aă] s[aă] crezi|incredibil|[sș]ocant|uluitor|n-o s[aă] crezi)\b/i;

const CLICKBAIT_ES_RE = /\b(no vas a creer|no te vas a creer|lo que pas[oó] despu[eé]s|los m[eé]dicos odian|este (?:truco|secreto)|impactante|incre[ií]ble|alucinante|te dejar[aá] sin palabras)\b/i;
const CLICKBAIT_PT_RE = /\b(voc[eê] n[aã]o vai acreditar|o que aconteceu depois|os m[eé]dicos odeiam|esse (?:truque|segredo)|chocante|inacredit[aá]vel|surpreendente|vai te deixar sem palavras)\b/i;

const PROMOTIONAL_RE = /\b(buy now|limited time|discount|sale|free shipping|click here|order today|link in bio|promo code|coupon)\b/i;
const PROMOTIONAL_RO_RE = /\b(cump[aă]r[aă]|oferta? limitat[aă]|reducere|transport gratuit|comand[aă] acum|link in bio|cod promo|cupon)\b/i;

const PROMOTIONAL_ES_RE = /\b(compra ahora|oferta limitada|descuento|rebajas?|env[ií]o gratis|haz clic aqu[ií]|pide hoy|link en (?:la )?bio|c[oó]digo promocional|cup[oó]n)\b/i;
const PROMOTIONAL_PT_RE = /\b(compre agora|oferta limitada|desconto|promo[cç][aã]o|frete gr[aá]tis|clique aqui|pe[cç]a hoje|link na bio|c[oó]digo promocional|cupom)\b/i;

/** Fear words in a news report are probably reported, not used, so the register scales scores. */
function computeRegister(text: string, features?: LinguisticFeatures): Register {
  const f = features ?? extractFeatures(text);

  if (
    NEWS_ATTRIBUTION_RE.test(text) || NEWS_ATTRIBUTION_RO_RE.test(text) ||
    NEWS_ATTRIBUTION_ES_RE.test(text) || NEWS_ATTRIBUTION_PT_RE.test(text)
  ) {
    return 'news-report';
  }
  if (
    CLICKBAIT_RE.test(text) || CLICKBAIT_RO_RE.test(text) ||
    CLICKBAIT_ES_RE.test(text) || CLICKBAIT_PT_RE.test(text)
  ) {
    return 'clickbait';
  }
  if (
    PROMOTIONAL_RE.test(text) || PROMOTIONAL_RO_RE.test(text) ||
    PROMOTIONAL_ES_RE.test(text) || PROMOTIONAL_PT_RE.test(text)
  ) {
    return 'promotional';
  }
  if (f.firstPersonCount >= 2 && f.wordCount < 80 && f.exclamationCount <= 2) {
    return 'conversational';
  }
  if (f.capsRatio < 0.05 && f.exclamationCount === 0 && f.wordCount >= 40) {
    return 'formal';
  }
  return 'unknown';
}

export interface QuotedSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * Someone writing "she told me 'YOU WILL REGRET THIS'" is reporting a fear appeal, not making
 * one, so matches inside quotes are dampened. Typographic quotes arrive here already made plain.
 */
function detectQuotedSpeech(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  // A single quote between two letters is an apostrophe (don't, it's), so it can neither open,
  // close nor end a quotation; read as quote marks, two contractions hid everything between them.
  const re = /"([^"]{3,300})"|(?<![\p{L}\p{N}])'((?:[^']|(?<=[\p{L}\p{N}])'(?=[\p{L}\p{N}])){3,300})'(?![\p{L}\p{N}])/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[1] ?? m[2] ?? '',
    });
  }
  return spans;
}

export function isInsideQuote(spans: QuotedSpan[], index: number): boolean {
  for (const s of spans) {
    if (index >= s.start && index < s.end) return true;
  }
  return false;
}

/** "According to the CDC, 3000 people died" is attribution, not a fear appeal. */
function hasNewsAttribution(text: string): boolean {
  return NEWS_ATTRIBUTION_RE.test(text) || NEWS_ATTRIBUTION_RO_RE.test(text) ||
    NEWS_ATTRIBUTION_ES_RE.test(text) || NEWS_ATTRIBUTION_PT_RE.test(text);
}

const FIRST_PERSON_VULNERABILITY_RE = /\b(i'?m|i am|i feel|i felt|i was|i'?ve been|i have been) (scared|afraid|worried|anxious|terrified|horrified|sad|depressed|lonely|ashamed|embarrassed|hurt|broken)/i;
const FIRST_PERSON_VULNERABILITY_ES_RE = /\b(?:estoy|estaba|estuve|me siento|me sent[ií]a|me sent[ií]|soy|fui|he estado|he sido|ando)\s+(?:muy\s+|tan\s+|bien\s+|super\s+)?(?:asustad[oa]|con miedo|preocupad[oa]|ansios[oa]|aterrad[oa]|angustiad[oa]|triste|deprimid[oa]|sol[oa]|solit[oa]|avergonzad[oa]|humillad[oa]|herid[oa]|rot[oa]|destrozad[oa]|hundid[oa]|perdid[oa]|agotad[oa]|vulnerable)\b/i;
const FIRST_PERSON_VULNERABILITY_PT_RE = /\b(?:estou|estava|fiquei|me sinto|me sentia|me senti|sou|fui|tenho estado|ando)\s+(?:muito\s+|t[aã]o\s+|bem\s+|super\s+)?(?:assustad[oa]|com medo|preocupad[oa]|ansios[oa]|aterroriza?d[oa]|angustiad[oa]|triste|deprimid[oa]|sozinh[oa]|s[oó]|envergonhad[oa]|humilhad[oa]|magoad[oa]|machucad[oa]|destru[ií]d[oa]|perdid[oa]|esgotad[oa]|vulner[aá]vel)\b/i;
// The optional intensifier matters: without it "sunt foarte trist" (I am very sad), the commonest
// way to say it, did not count while "sunt trist" did.
const FIRST_PERSON_VULNERABILITY_RO_RE = /\b(sunt|am fost|m[aă] simt|m-am sim[tț]it) (?:foarte |a[sș]a de |at[aâ]t de |cam |tare )?(speriat[aă]?|[iî]nfricoș?at[aă]?|[iî]ngrijorat[aă]?|trist[aă]?|depresiv[aă]?|singur[aă]?|ru[sș]inat[aă]?|r[aă]nit[aă]?)/i;

/**
 * "I'm scared of X" is someone voicing a feeling, not manipulating. Every language with harm
 * patterns needs this too, or "estoy deprimida" would be scored as manipulation where "i'm
 * depressed" is not. The Spanish and Portuguese patterns start at the verb because the subject
 * is usually dropped ("estoy triste").
 */
function hasFirstPersonVulnerability(text: string): boolean {
  return FIRST_PERSON_VULNERABILITY_RE.test(text) || FIRST_PERSON_VULNERABILITY_RO_RE.test(text) ||
    FIRST_PERSON_VULNERABILITY_ES_RE.test(text) || FIRST_PERSON_VULNERABILITY_PT_RE.test(text);
}

export interface LinguisticContext {
  original: string;
  normalized: string;
  aggressive: string;
  features: LinguisticFeatures;
  register: Register;
  quotedSpans: QuotedSpan[];
  hasNewsAttribution: boolean;
  hasFirstPersonVulnerability: boolean;
}

// A one-entry cache: detect() runs every classifier on the same text in turn, before the page
// paints, so it hits for all but the first. The context is shared between callers, so no
// classifier may change it.
let lastContextText: string | null = null;
let lastContext: LinguisticContext | null = null;

export function buildContext(text: string): LinguisticContext {
  if (lastContextText === text && lastContext !== null) return lastContext;
  const context = buildContextUncached(text);
  lastContextText = text;
  lastContext = context;
  return context;
}

function buildContextUncached(text: string): LinguisticContext {
  const normalized = normalizeForMatching(text);
  const aggressive = normalizeAggressive(text);
  const features = extractFeatures(normalized);
  const register = computeRegister(normalized, features);
  const quotedSpans = detectQuotedSpeech(normalized);
  return {
    original: text,
    normalized,
    aggressive,
    features,
    register,
    quotedSpans,
    hasNewsAttribution: hasNewsAttribution(normalized),
    hasFirstPersonVulnerability: hasFirstPersonVulnerability(normalized),
  };
}
