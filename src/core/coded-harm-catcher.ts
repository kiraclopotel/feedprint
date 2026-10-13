/**
 * Fixed patterns for harm the AI misses on the comment batch path, where no pattern classifier
 * runs (enrichWithHarmFloor in comment-batch-scorer.ts calls computeHarmFloor(text, [])). Each
 * rule needs a harm-carrying companion, so a group or topic word alone never fires. Without the
 * self-harm rules, "kill yourself" in a comment was caught only when the AI ran and succeeded,
 * and passed silently on the free tier, under rate limits and in fail-closed builds.
 *
 * On a local calibration set (honest-en-v1.json, not in the repository) the wired rules add 12
 * harm catches (20 to 32 of 41) and no new false alarm on its 248 benign items. A list tuned on a
 * corpus reports an upper bound for that corpus; the clickbait rules will catch less elsewhere,
 * and the cliffhanger rule matches two literal phrases only.
 *
 * Left out after measurement: a "[nationality] migrant arrested for [crime]" frame, which would
 * fire on neutral crime news the benign set lacks, and a "#WATCH |" intro, which added no catch
 * and would fire on real news.
 */

type CodedHarmCategory =
  | 'self-harm-encouragement'
  | 'sexual-solicitation'
  | 'sexual-explicit'
  | 'doxxing'
  | 'direct-threat'
  | 'shaming-harassment'
  | 'coded-scapegoating'
  | 'clickbait-fomo'
  | 'violence-narration';

export interface CodedHarmHit {
  category: CodedHarmCategory;
  pattern: string;
  evidence: string;
}

interface Rule {
  pattern: string;
  re: RegExp;
}

// Every pattern needs the second person, so "I want to kill myself", which is distress, never
// matches. These hide. No false positive on the honest-en-v1 benign set or the production-43
// benign set before they were wired.
const SELF_HARM_ENCOURAGEMENT: Rule[] = [
  { pattern: 'kys', re: /\bkys\b/i },
  { pattern: 'kill-yourself', re: /\bkill\s+(your\s?self|urself|yourselves|ya\s?self)\b/i },
  { pattern: 'neck-rope-hang-yourself', re: /\b(neck|rope|hang)\s+(your\s?self|urself|yourselves)\b/i },
  { pattern: 'off-yourself', re: /\boff\s+(your\s?self|urself|yourselves)\b/i },
  { pattern: 'end-yourself', re: /\bend\s+(your\s?self|urself|your\s+life)\b/i },
  { pattern: 'slit-your-wrists', re: /\bslit\s+(your|ur)\s+wrists?\b/i },
  { pattern: 'drink-bleach', re: /\b(go\s+)?drink\s+(some\s+|the\s+)?bleach\b/i },
  // No bare "go die" or "just die": they are gaming talk ("go die in the lava level"). The AI
  // reads those when it runs.
  //
  // Romanian, written without diacritics because detectCodedHarm folds them away. Every form is
  // second person ('te', 'mori'), so neither distress ('vreau sa ma omor') nor the oath 'sa mor
  // eu' (I swear) matches. 'Sa mori de ras' (die laughing) is excluded.
  { pattern: 'omoara-te-ro', re: /\bomoara[\s-]*te\b/i },
  { pattern: 'sinucide-te-ro', re: /\bsinucide[\s-]*te\b/i },
  { pattern: 'spanzura-te-ro', re: /\bspanzura[\s-]*te\b/i },
  { pattern: 'taie-ti-venele-ro', re: /\btaie[\s-]*ti\s+venele\b/i },
  { pattern: 'du-te-si-mori-ro', re: /\bdu[\s-]*te\s+si\s+mori\b/i },
  { pattern: 'sa-mori-ro', re: /\bsa\s+mori\b(?!\s+de\s+ras)/i },
  //
  // Spanish, without diacritics. An order carries the pronoun at the end ('matate'); a negation
  // puts it in front and changes the verb ('no te mates'). So these forms cannot fire on a
  // negation, or on 'quiero matarme'. The lookaheads drop everyday hyperbole: 'matate de risa',
  // 'muerete de envidia' (banter, and a compliment).
  { pattern: 'matate-es', re: /\bmata(?:te|nse)\b(?!\s+(?:de\s+(?:risa|la\s+risa|hambre|frio|calor|envidia)|a\s+estudiar|estudiando|trabajando|riendo))/i },
  { pattern: 'suicidate-es', re: /\bsuicida(?:te|nse)\b/i },
  { pattern: 'ahorcate-es', re: /\bahorca(?:te|nse)\b/i },
  { pattern: 'cortate-las-venas-es', re: /\bcorta(?:te|nse)\s+las\s+venas\b/i },
  { pattern: 'pegate-un-tiro-es', re: /\b(?:pega|da)(?:te|nse)\s+un\s+tiro\b/i },
  { pattern: 'tirate-de-es', re: /\btira(?:te|nse)\s+(?:de|por)\s+(?:un|el|la)\s+(?:puente|balcon|ventana|azotea|edificio)\b/i },
  { pattern: 'muerete-es', re: /\bmuere(?:te|nse)\b(?!\s+de\s+(?:risa|envidia|celos|amor|ganas|verguenza))/i },
  { pattern: 'ojala-te-mueras-es', re: /\bojala\s+(?:te\s+)?(?:mueras|murieras)\b/i },
  { pattern: 'andate-a-morir-es', re: /\b(?:andate|vete|vayanse)\s+a\s+morir\b/i },
  //
  // Portuguese keeps the order under negation ('nao se mate'), so SELF_HARM_NEGATION guards
  // these. 'mate-se' needs its hyphen: with a space it matched "El mate se puede tomar dulce", the
  // drink. 'se mate' is also a subjunctive, a worry about someone else ("que ... se mate por causas
  // tan livianas" in Don Quijote), and its 'que' can sit a clause away where no lookbehind reaches.
  // An order opens its clause, so 'se mate' must start the text or follow punctuation.
  { pattern: 'se-mate-pt', re: /(?:(?<=^|[.!?;:,\n¡¿]\s{0,3})se\s+mate|\bmate-se)\b/i },
  { pattern: 'se-suicide-pt', re: /(?:(?<=^|[.!?;:,\n¡¿]\s{0,3})se\s+suicide|\bsuicide-se)\b/i },
  { pattern: 'se-enforque-pt', re: /(?:(?<=^|[.!?;:,\n¡¿]\s{0,3})se\s+enforque|\benforque-se)\b/i },
  { pattern: 'corta-os-pulsos-pt', re: /\bcort[ae]\s+os\s+pulsos\b/i },
  { pattern: 'se-joga-pt', re: /\bse\s+jog[ae]\s+d[ao]\s+(?:ponte|janela|predio|viaduto|telhado)\b/i },
  // 'vai se matar' is also how one says someone else will ('ele vai se matar') or worries about
  // overwork ('voce vai se matar de tanto trabalhar'). The encouragement has no subject before it
  // and no reason after, so those are excluded instead of the phrase. Not 'vai te matar' ("will
  // kill you"), a threat or an idiom: the corpus caught it on "Tom vai te matar".
  { pattern: 'vai-se-matar-pt', re: /(?<!\b(?:ele|ela|eles|elas|voce|alguem|ninguem|que|se)\s)\bvai\s+se\s+matar\b(?!\s+(?:de\s+tanto|trabalhando|estudando|de\s+trabalhar|de\s+rir))/i },
];

// Explicit sexual asks aimed at the reader. Each pairs an explicit word with an ask (send, show, dm,
// hmu), so neither an anatomy word nor "send me" alone fires. These hide. Grooming is not here:
// its tells ("our little secret") build over many messages, mostly in DMs FeelingWise never
// reads, and a phrase rule for them flags ordinary speech. Recall cannot be measured, since the
// corpora hold almost none of this, so the rules were narrowed against the adversarial benign set
// in the deterministic-floor probe, and none fires on the 752 benign items:
//   • `nudes` plural only: "nude" is a makeup shade;
//   • 'booty' and 'nude' are not picture words here ("booty pics" at the gym);
//   • no "to smash" ("dm me to smash ranked") and no bare "sex" ("hmu for sex ed notes").
const SEXUAL_SOLICITATION: Rule[] = [
  { pattern: 'send-nudes', re: /\bsend\s+(?:me\s+|us\s+|her\s+|him\s+)?(?:your\s+|ur\s+|some\s+)?nudes\b/i },
  // Not "a naked photo of the tree"; "of you" is still the ask.
  { pattern: 'send-naked-media', re: /\bsend\s+(?:me\s+|us\s+)?(?:a\s+|some\s+|your\s+|ur\s+)?(?:nude|naked)\s+(?:pic|pics|picture|pictures|photo|photos|selfie|selfies|vid|vids|video|videos)\b(?!\s+of\s+(?:the|a|an|my|his|her|their|its|that|this|some|these|those|\d))/i },
  { pattern: 'explicit-pic-noun', re: /\b(?:dick|nudie|titty)\s+pics?\b/i },
  { pattern: 'show-me-explicit', re: /\bshow\s+(?:me\s+|us\s+)?(?:your\s+|ur\s+)?(?:tits|titties|boobs|pussy|cock|dick|nudes)\b/i },
  { pattern: 'solicit-hookup', re: /\b(?:hit\s+me\s+up|hmu|dm\s+me|message\s+me)\b.{0,25}\b(?:for\s+)?(?:nudes|hookups?|to\s+fuck)\b/i },
  //
  // Spanish and Portuguese, the same rule: 'mandame una foto' alone does not fire. Both languages
  // borrow 'nudes', so one pattern serves both.
  { pattern: 'manda-nudes-es-pt', re: /\b(?:manda|mandame|mande|mandem|envia|enviame|env[ií]e|passa|pasa)\s*(?:me\s+|nos\s+)?(?:tus\s+|teus\s+|suas\s+|unas\s+|umas\s+|uma\s+|una\s+)?nudes\b/i },
  { pattern: 'manda-foto-desnuda-es', re: /\b(?:manda|mandame|mande|envia|enviame|pasa|pasame)\s*(?:me\s+)?(?:una\s+|unas\s+|tus\s+|la\s+)?fotos?\s+(?:desnud[ao]s?|sin\s+ropa|en\s+pelotas)\b/i },
  { pattern: 'manda-foto-pelada-pt', re: /\b(?:manda|mande|manda\s+me|envia|envie|passa|passe)\s*(?:me\s+|pra\s+mim\s+)?(?:uma\s+|umas\s+|tua\s+|sua\s+)?fotos?\s+(?:pelad[ao]s?|nu[ao]s?)\b/i },
  { pattern: 'muestrame-explicito-es', re: /\b(?:muestrame|ensename|muestra|ensena)\s+(?:las\s+|tus\s+|el\s+|tu\s+)?(?:tetas|chichis|el\s+culo|la\s+concha|la\s+panocha|el\s+pene)\b/i },
  { pattern: 'mostra-explicito-pt', re: /\b(?:mostra|mostre|me\s+mostra)\s+(?:a\s+|as\s+|o\s+|teus?\s+|tuas?\s+|seus?\s+|suas?\s+)?(?:peitos|buceta|bunda|piroca|xoxota)\b/i },
];

// Pornographic jargon that should not reach a child's feed with or without an ask; the AI rates
// it too low, so it went neither hidden nor flagged. Only words with no ordinary, news or
// figurative use; recall cannot be measured, so each was checked against the adversarial benign
// set instead. Left out for their other senses: "deep throat" as two words (Watergate), "cream
// pie" (a dessert), "gangbang" ("gangbanger"), "fisting" (boxing), "rim job" (wheel refinishing)
// and "bukkake" (a noodle dish). Only the verb forms of "felch", which is also a surname and a
// place.
const SEXUAL_EXPLICIT: Rule[] = [
  { pattern: 'cumshot', re: /\bcum\s?shots?\b/i },
  { pattern: 'deepthroat', re: /\bdeepthroat(?:ing|ed|s)?\b/i },
  { pattern: 'felching', re: /\bfelch(?:ing|ed)\b/i },
];

const VIOLENCE_NARRATION: Rule[] = [
  { pattern: 'petrol-bomb', re: /petrol\s*bomb|molotov/i },
  { pattern: 'chilling-cctv', re: /chilling\s+CCTV\s+footage|CCTV.{0,30}chilling/i },
  { pattern: 'lethal-combat-steps', re: /(?:stab|smash)\s+(?:his|her|their|the)\s+(?:exposed\s+)?(?:face|head)|rip\s+(?:the\s+)?helmet\s+off|internal\s+h[ae]morrhage/i },
];

// Exposing someone's address, number or real name, or an order to dox them. These hide: a child
// should not be pulled into harassing a real person. Recall cannot be measured here either. `dox`
// needs an object ("dox her"), so "doxxing is a problem" and "got doxxed" do not fire. Exposure
// needs someone else's (his, her, their) locator; not email ("here's his email"), not the past
// tense ("posted", a report). DOXXING_NEGATION and DOXXING_CONDEMNATION let "don't dox them" and
// "posting his home address is nasty work" through.
const DOXXING: Rule[] = [
  { pattern: 'dox-imperative', re: /\bdoxx?(?:ing)?\s+(?:him|her|them|this|that)\b/i },
  { pattern: 'expose-private-locator', re: /\b(?:post|posting|leak|leaking|drop|dropping|share|sharing|expose|exposing)\s+(?:his|her|their)\s+(?:home\s+)?(?:address|phone\s*number|real\s+name)\b/i },
  //
  // Spanish and Portuguese, the same rule. Spanish 'su' is also the polite 'your', which does not
  // change the harm. Both guards speak these languages too ('publicar su direccion es ilegal').
  { pattern: 'expone-locator-es', re: /\b(?:publica|publiquen|publicar|filtra|filtren|filtrar|pasa|pasen|pasame|comparte|compartan|suelta|suelten|tiren)\s+(?:su|el|la)\s+(?:direccion|numero|telefono|nombre\s+real|casa)\b/i },
  { pattern: 'expone-locator-pt', re: /\b(?:posta|postem|postar|vaza|vazem|vazar|passa|passem|compartilha|compartilhem|solta|soltem)\s+(?:o|a)\s+(?:endereco|numero|telefone|nome\s+real)\s+(?:dele|dela|deles|delas)\b/i },
];

// A threat aimed at the reader: that the writer knows where they live, or will find them to hurt
// them. These hide. The test for each is that it names the reader (you, your kids) and a place or an
// act, so "I know where the bug lives" and "we'll find you a seat" never fire. "I know where you
// live" does not fire when it is followed by "now", or by a welcome, a move or a dinner within a
// few words (the adversarial benign set holds "I know where you live now, congrats on the move!").
// Left out on purpose: bare "I'll kill you", "you're dead", "I'll hunt you down" and "... make you
// pay", which are game chat and banter every day; the AI reads those when it runs. Romanian is written without diacritics because
// detectCodedHarm folds them away.
const DIRECT_THREAT: Rule[] = [
  { pattern: 'know-where-you-live', re: /\b(?:i|we|they|everyone|everybody|someone)\s+(?:all\s+)?knows?\s+where\s+(?:you|u)\s+(?:live|stay|sleep|work|study|go\s+to\s+(?:school|class|college|uni))\b(?!\s+now\b)(?!.{0,40}\b(?:congrats|congratulations|welcome|neighbou?rs?|moved?|moving|dinner|lunch|visit|come\s+over|haha+|lol)\b)/i },
  { pattern: 'know-where-your-people', re: /\b(?:i|we|they|everyone|everybody|someone)\s+(?:all\s+)?knows?\s+where\s+(?:your|ur)\s+(?:kids?|children|family|mom|mother|dad|father|wife|husband|sister|brother|parents)\s+(?:live|stay|sleep|work|go\s+to\s+school|are)\b(?!.{0,40}\b(?:congrats|congratulations|welcome|neighbou?rs?|moved?|moving|dinner|lunch|visit|come\s+over|haha+|lol)\b)/i },
  { pattern: 'find-you-and-hurt', re: /\b(?:i|we)(?:'ll|\s+will|'m\s+(?:going|gonna)\s+(?:to\s+)?|\s+am\s+(?:going|gonna)\s+(?:to\s+)?|\s+(?:going|gonna)\s+(?:to\s+)?)\s*(?:find|hunt|track)\s+(?:you|u)(?:\s+down)?\s+and\s+(?:kill|hurt|rape|stab|shoot)\b/i },
  { pattern: 'stiu-unde-locuiesti-ro', re: /\b(?:stiu|stim)\s+unde\s+(?:locuiesti|stai|dormi|lucrezi|inveti)\b/i },
  { pattern: 'se-donde-vives-es', re: /\b(?:se|sabemos|sabe)\s+donde\s+(?:vives|duermes|trabajas|estudias)\b/i },
];

// Shaming and exile aimed at the reader, the shape of school bullying online: a claim that nobody
// likes them or everyone hates them, paired with an order to vanish, or a claim that everyone
// laughs at them behind their back. A claim alone never fires ("nobody likes you when you're 23" is
// a song, "everybody hates you" a sitcom title); neither does the order alone ("delete your account"
// is support talk). Plain insults ("you are an idiot") are left to the AI: a rule for them would
// hide ordinary rudeness at every level. These hide.
const SHAME_CLAIM_EN = String.raw`(?:(?:nobody|no\s*one)(?:\s+(?:at|in|from)\s+\w+(?:\s+\w+)?)?\s+(?:likes|wants|loves|cares\s+about|needs|misses)\s+(?:you|u)(?:\s+here)?|(?:everyone|everybody)\s+(?:here\s+)?(?:hates|despises)\s+(?:you|u)|we\s+all\s+hate\s+(?:you|u))`;
const SHAME_ORDER_EN = String.raw`(?:(?:just\s+)?delete\s+(?:your|ur)\s+(?:account|acc|profile|page|channel)|(?:just\s+)?go\s+away(?:\s+(?:forever|for\s+good))?|(?:just\s+)?disappear(?:\s+(?:forever|for\s+good))?|never\s+(?:come\s+back|post\s+again)|get\s+off\s+(?:the\s+)?(?:internet|here)|leave\s+(?:forever|for\s+good))`;
const SHAME_CLAIM_RO = String.raw`(?:nimeni\s+nu\s+te\s+(?:place|vrea|iubeste|suporta)|toti\s+te\s+(?:urasc|dispretuiesc)|toata\s+lumea\s+te\s+uraste)`;
const SHAME_ORDER_RO = String.raw`(?:dispari|pleaca\s+(?:de\s+aici|pentru\s+totdeauna)|nu\s+(?:mai\s+)?reveni\s+(?:niciodata|aici)|sterge[\s-]*ti\s+contul|inchide[\s-]*ti\s+contul)`;
// A name-calling at the reader, paired with an order to vanish: the form of the bullying line on every feed ("you are a
// pathetic little nobody ... do us all a favour and disappear"). An insult alone stays with the AI, as above; only the pair
// is a rule, and only when the insult is said OF the reader ("you are a ...", no negation between) and the order is one of
// the vanishing orders. The modifiers in between are listed, not wild, so "you are not a loser, go away and rest" and
// "you are a legend, go away" never fire.
const INSULT_NOUN_EN = String.raw`(?:loser|nobody|idiot|moron|failure|freak|clown|joke|pathetic|worthless|disgusting|ugly|stupid|dumb|trash|garbage|scum|waste\s+of\s+(?:space|oxygen|skin))`;
const INSULT_OF_YOU_EN = String.raw`(?:you|u)(?:'re|\s*are|\s+r)\s+(?:(?:such|just|really|so|a|an|the|total|complete|absolute|utter|little|big|pathetic|worthless|fucking)\s+){0,3}${INSULT_NOUN_EN}`;
const VANISH_ORDER_EN = String.raw`(?:do\s+(?:us|everyone|the\s+world|all\s+of\s+us)(?:\s+all)?\s+a\s+favou?r\s+and\s+(?:disappear|vanish|go\s+away|leave|delete\s+(?:your|ur)\s+(?:account|acc|profile)|stop\s+posting)|${SHAME_ORDER_EN}|nobody\s+(?:would|will)\s+miss\s+(?:you|u))`;
const INSULT_OF_YOU_ES = String.raw`eres\s+(?:un|una)\s+(?:\w+\s+)?(?:idiota|inutil|imbecil|perdedor|perdedora|fracasado|fracasada|basura|asco|payaso|payasa)`;
const VANISH_ORDER_ES = String.raw`(?:desaparece|desaparecete|largate|vete\s+(?:de\s+aqui|al\s+carajo)|borra\s+tu\s+cuenta|borrate\s+la\s+cuenta|nadie\s+te\s+(?:quiere|extranaria))`;
const INSULT_OF_YOU_PT = String.raw`(?:voce\s+e|tu\s+es)\s+(?:um|uma)\s+(?:\w+\s+)?(?:idiota|inutil|imbecil|perdedor|perdedora|fracassado|fracassada|lixo|palhaco|palhaca)`;
const VANISH_ORDER_PT = String.raw`(?:desaparece|desapareca|some\s+daqui|sai\s+daqui|apaga\s+(?:a\s+tua|a\s+sua|sua|tua)\s+conta|ninguem\s+(?:te\s+quer|vai\s+sentir\s+sua\s+falta))`;
const INSULT_OF_YOU_RO = String.raw`esti\s+(?:un|o)\s+(?:\w+\s+)?(?:idiot|idioata|prost|proasta|ratat|ratata|gunoi|jalnic|jalnica)`;
const INSULT_AND_VANISH = (insult: string, order: string): RegExp =>
  new RegExp(String.raw`\b${insult}\b.{0,100}?\b${order}\b|\b${order}\b.{0,100}?\b${insult}\b`, 'i');
const SHAMING_HARASSMENT: Rule[] = [
  { pattern: 'insult-and-vanish-en', re: INSULT_AND_VANISH(INSULT_OF_YOU_EN, VANISH_ORDER_EN) },
  { pattern: 'insult-and-vanish-es', re: INSULT_AND_VANISH(INSULT_OF_YOU_ES, VANISH_ORDER_ES) },
  { pattern: 'insult-and-vanish-pt', re: INSULT_AND_VANISH(INSULT_OF_YOU_PT, VANISH_ORDER_PT) },
  { pattern: 'insult-and-vanish-ro', re: INSULT_AND_VANISH(INSULT_OF_YOU_RO, SHAME_ORDER_RO) },
  { pattern: 'nobody-likes-you-go-away', re: new RegExp(String.raw`\b${SHAME_CLAIM_EN}\b.{0,50}?\b${SHAME_ORDER_EN}\b|\b${SHAME_ORDER_EN}\b.{0,50}?\b${SHAME_CLAIM_EN}\b`, 'i') },
  { pattern: 'laughs-at-you-behind-your-back', re: /\b(?:everyone|everybody|they\s+all|the\s+whole\s+(?:school|class))\s+(?:is\s+|are\s+)?(?:laughs?|laughing)\s+at\s+(?:you|u)\s+behind\s+(?:your|ur)\s+back\b/i },
  { pattern: 'nimeni-nu-te-place-ro', re: new RegExp(String.raw`\b${SHAME_CLAIM_RO}\b.{0,50}?\b${SHAME_ORDER_RO}\b|\b${SHAME_ORDER_RO}\b.{0,50}?\b${SHAME_CLAIM_RO}\b`, 'i') },
];

const CODED_SCAPEGOATING: Rule[] = [
  { pattern: 'these-people-dehumanize', re: /what('s| is) wrong with (these|those|their) people|these people'?s? (heads?|brains?|minds?|problem|agenda|mentality)|what kind of people (are|do) (these|those)/i },
  { pattern: 'group-always-involved', re: /(zionism|zionists?|the jews?|the muslims?|the chinese|the arabs?|the migrants?|the foreigners?|the immigrants?)\s+(is|are|was|were|will be|has been|have been)\s+always\s+(involved|behind|responsible|at fault|to blame|pulling|controlling|running)/i },
  { pattern: 'ethnic-appositive-smear', re: /,\s*a\s+(jewish|zionist|muslim|arab|chinese|afghan|iranian|ukrainian|russian|trans|queer|gay|black|white)\s+(lawyer|judge|banker|official|politician|journalist|doctor|professor|activist|leader|owner|ceo|executive|manager|teacher)\s*,/i },
  { pattern: 'group-people-generalize', re: /\b(chinese|japanese|korean|arab|african|mexican|hispanic|afghan|iranian|russian|jewish|muslim|christian|trans|black|white|foreigner|immigrant|migrant)\s+(people|men|women|kids?|children|community|population)\s+(have|has|had|always|never|tend|are known|keep|do|don't|won't|can't|will)\s+.{0,60}(gossip|crime|criminal|corrupt|problem|issue|scandal|mess|chaos|trouble|drama|violent|dishonest|cheat|steal|abuse|attack|lie|manipulate)/i },
  { pattern: 'disproportionate-crime-smear', re: /\b(disproportionate|disproportion(ately)?|outsize|over-?represent)\b.{0,60}\b(crime|criminal|arrest|incarceration|prison|conviction|offend|perpetrat)/i },
  { pattern: 'collective-historical-guilt', re: /\b(israel|zionism|jews?|muslims?|christians?|the (left|right|globalists?|elites?))\b.{0,80}(killed|murdered|crucified|poisoned|enslaved|destroyed|started|caused).{0,80}(jesus|prophet|messenger|john the baptist|virgin|mary|children|innocents|our country|civilization|culture)/i },
  { pattern: 'their-rate-smear', re: /\btheir\s+(crime|criminal|arrest|incarceration|prison|rape|violence|murder|terror|fraud|theft|gang)\s+rate\b/i },
  { pattern: 'group-conspiracy-kill-children', re: /(israel|zionism|zionists?|the jews?|the muslims?|the arabs?|the deep state|the globalists?)\s+.{0,80}(kill|murder|orchestrat|plan|got\s+\w+\s+to\s+do|ordered|arranged).{0,100}(school|children|girls?|boys?|civilians?|innocents?|schoolgirls?|schoolboys?)/i },
  { pattern: 'identity-shooter-smear', re: /school shoot.{0,200}(trans|non-binary)|(trans|non-binary).{0,200}school shoot/i },
  { pattern: 'replacement-naturalization', re: /(foreigner|immigrant|migrant).{0,120}(new\s+(japanese|german|french|american|british|swedish|danish|norwegian|italian|spanish)|naturali[sz]e.{0,80}replace|turn.{0,60}into.{0,40}new\s+\w+)/i },
];

const CLICKBAIT_FOMO: Rule[] = [
  { pattern: 'fake-validation', re: /\b(?:BBC|CNN|NYT|Fox|AP|Reuters|news)\b.{0,60}validat|validat.{0,60}\beverything\s+we.{0,20}(?:said|saying|been)/i },
  { pattern: 'win-rate-zero-loss', re: /100%\s*win\s*rate|\b0\s*losses?.{0,40}\bwins?\b|\bwins?.{0,40}\b0\s*losses?/i },
  { pattern: 'tracked-whale', re: /tracked\s+a\s+whale|trades?\s+right\s+before\s+(?:major|trump|the)\b/i },
  { pattern: 'referral-loop', re: /when\s+they\s+open\s+it.{0,30}(?:you\s+receive|you\s+get)|send.{0,40}friend.{0,80}get\s+(?:one\s+back|a\s+free)/i },
  { pattern: 'scarcity-cta', re: /before\s+they.?re\s+gone|limited\s*[-—]\s*act\s+fast/i },
  { pattern: 'curiosity-gap-cliffhanger', re: /sky\s+comes?\s+crashing\s+down|couldn.t\s+believe\s+what\s+(?:he|she|they)\s+saw\s+after/i },
  { pattern: 'supplement-transforms', re: /(?:brain\s+stack|nootropic|cognitive\s+supplement).{0,100}transform|poker.{0,15}proof\s+brain/i },
];

// Most severe first: the first category that matches wins.
const CATEGORY_RULES: ReadonlyArray<readonly [CodedHarmCategory, Rule[]]> = [
  ['self-harm-encouragement', SELF_HARM_ENCOURAGEMENT],
  ['sexual-solicitation', SEXUAL_SOLICITATION],
  ['sexual-explicit', SEXUAL_EXPLICIT],
  ['violence-narration', VIOLENCE_NARRATION],
  ['direct-threat', DIRECT_THREAT],
  ['doxxing', DOXXING],
  ['shaming-harassment', SHAMING_HARASSMENT],
  ['coded-scapegoating', CODED_SCAPEGOATING],
  ['clickbait-fomo', CLICKBAIT_FOMO],
];

// A negation right before the order turns it into support ("don't kill yourself, seek help"), a
// false positive the OpenAI moderation set showed. Portuguese needs it most ('nao se mate');
// 'nao' has no diacritic because the text is folded first.
const SELF_HARM_NEGATION = /\b(?:don'?t|do\s+not|dont|never|please\s+don'?t|won'?t|would\s?n'?t|shouldn'?t|no\s+one\s+should|nobody\s+should|stop|no|nao|nunca|jamais|ninguem|nadie|por\s+favor\s+n[ao]o?|para\s+de|pare\s+de|deixa\s+de|deja\s+de|nao\s+se|no\s+te)\s*$/i;

// Describing or denouncing doxxing is not doing it: a negation before the match ("it's illegal to
// post his address") or a judgement after it ("... is wrong").
const DOXXING_NEGATION = /\b(?:don'?t|do\s+not|dont|never|please\s+don'?t|stop|against|illegal\s+to|wrong\s+to|shouldn'?t|no|nao|nunca|nadie|ninguem|prohibido|proibido|ilegal|es\s+ilegal|e\s+ilegal)\s*$/i;
const DOXXING_CONDEMNATION = /^\s*(?:(?:is|are|was|were)\s+(?:wrong|illegal|nasty|messed\s+up|fucked\s+up|a\s+crime|not\s+ok|not\s+cool|doxx?ing|disgusting|gross|harassment)|(?:es|era|seria)\s+(?:ilegal|un\s+delito|horrible|acoso|una\s+bajeza)|(?:e|era|seria)\s+(?:ilegal|crime|assedio|nojento))\b/i;

/**
 * Each value is in both the comment verdict's techniques (`BatchCommentVerdict['technique']`) and
 * the post's (`TechniqueName`), so both callers assign it without a cast.
 */
export type CodedHarmTechnique =
  | 'scapegoating'
  | 'violence-graphic'
  | 'shame-attack'
  | 'combined'
  | 'self-harm'
  | 'sexual'
  | 'misleading-format';

/**
 * The one mapping from a hit to technique, severity and whether it hides, used by
 * applyOverrideGates and failClosed in comment-batch-scorer.ts and by the post path in
 * src/analysis/pipeline.ts. When each path had its own, directed self-harm passed at severity 0
 * on comments when the AI was off and passed entirely on the post path without AI.
 *
 * Each caller combines the severity itself: failClosed uses it as is, the comment gate takes the
 * higher of it and the AI's, and the post path uses it as its floor. The technique is only a
 * routing bucket; the real why is the reason and the detectionMode or overrideOrigin. A self-harm
 * push and a sexual ask are named 'self-harm' and 'sexual', which are harm categories beside the
 * manipulation techniques and already have titles in every language. Doxxing and a direct threat
 * match no technique or category, so they go to 'combined'; shaming and exile are the shame attack.
 */
export function codedHarmVerdictFields(coded: CodedHarmHit): {
  technique: CodedHarmTechnique;
  severity: number;
  hideTier: boolean;
} {
  const isViolence = coded.category === 'violence-narration';
  const isSelfHarm = coded.category === 'self-harm-encouragement';
  const isSexual = coded.category === 'sexual-solicitation' || coded.category === 'sexual-explicit';
  const isDoxxing = coded.category === 'doxxing';
  const isThreat = coded.category === 'direct-threat';
  const isShaming = coded.category === 'shaming-harassment';
  return {
    technique:
      coded.category === 'coded-scapegoating'
        ? 'scapegoating'
        : isViolence
          ? 'violence-graphic'
          : isSelfHarm
            ? 'self-harm'
            : isSexual
              ? 'sexual'
              : isShaming
                ? 'shame-attack'
                : isDoxxing || isThreat
                  ? 'combined'
                  : 'misleading-format',
    severity: isSelfHarm || isSexual ? 9 : isViolence || isDoxxing || isThreat || isShaming ? 8 : 6,
    hideTier: isViolence || isSelfHarm || isSexual || isDoxxing || isThreat || isShaming,
  };
}

/**
 * The first match, most severe category first, with up to 60 characters of evidence.
 *
 * Letter-spaced "k y s" is left alone on purpose. Collapsing the gaps was tried and reverted: the
 * only word short enough to reassemble is "kys", and spaced it looks like initials ("Knoxville
 * Youth Symphony (K.Y.S.)", "K. Y. S. Patel, MD"). Over-flagging is the worse failure, so the AI
 * reads it. The test "intentionally does NOT flag letter-spaced / monogram forms" holds this.
 */
export function detectCodedHarm(text: string): CodedHarmHit | null {
  if (!text || text.trim().length === 0) return null;
  // So the diacritic-free Romanian patterns match 'omoară-te' as well.
  const folded = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [category, rules] of CATEGORY_RULES) {
    for (const rule of rules) {
      const m = folded.match(rule.re);
      if (!m) continue;
      if (
        category === 'self-harm-encouragement' &&
        m.index !== undefined &&
        SELF_HARM_NEGATION.test(folded.slice(0, m.index))
      ) {
        continue;
      }
      if (category === 'doxxing' && m.index !== undefined) {
        const before = folded.slice(0, m.index);
        const after = folded.slice(m.index + m[0].length);
        if (DOXXING_NEGATION.test(before) || DOXXING_CONDEMNATION.test(after)) {
          continue;
        }
      }
      return {
        category,
        pattern: rule.pattern,
        evidence: m[0].slice(0, 60),
      };
    }
  }
  return null;
}
