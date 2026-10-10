// The dashboard's own words for its new head and its timeline (9 Oct 2026), in the four languages the dashboard speaks.
//
// The product's name lives here and nowhere else on this page: it may change (the owner is choosing), and a rename
// must be one edit. The words reuse what the page already says and the record already proves: "hidden" is the Activity
// filter's word for an item a rule hid (record-sets.ts isBlockedItem), "flagged for review" is its word for a flagged
// item (isFlaggedItem). Nothing here counts anything; TodayHead counts with the Overview's own model.

import type { ResolvedUiLanguage } from '../../types/ui-language';
import { formatCount } from '../shared/format-number';

/** The product's name, said once. */
export const PRODUCT_NAME = 'Feedprint';

export interface DashboardWords {
  /** The main view: the dated sequence of what the feed showed (the owner's name for it, 9 Oct 02:4x). */
  tabTimeline: string;
  /** "Today", "Yesterday", or the date, opening the head's sentence. */
  dayOpener: (when: 'today' | 'yesterday' | 'date', dateText: string) => string;
  /** The head's first sentence after the day: what the feed showed, on how many sites. */
  showed: (items: number, sites: number) => string;
  /** The head's second sentence: the product kept every one. */
  keptAll: (product: string) => string;
  hiddenClause: (n: number) => string;
  flaggedClause: (n: number) => string;
  /** "items not checked" is the record's own word for them (EntriesBreakdown, the notChecked set). */
  notCheckedClause: (n: number) => string;
  /** The small labels over the three numbers beside the week. */
  labelRecorded: string;
  labelFlagged: string;
  labelHidden: string;
  /** The week's caption, for a screen reader and a hover. */
  weekCaption: string;
  /** One day of the week chart, read aloud: the chart is a picture, so its values are said in its label. */
  weekDayValue: (items: number | null, hidden: number) => string;
  /** The fold that holds the timeline's side panels. */
  breakdownShow: string;
  breakdownHide: string;
  /** The Overview's first card, now that the head says the counts: where they came from. */
  ovFromEyebrow: string;
  ovSessionsLine: (sessions: number) => string;
  /** The keyboard's first stop: straight to the open tab's list. */
  skipToList: string;
  /** The first day, before anything is written down: what a person does next, in three steps. */
  welcomeSteps: readonly [string, string, string];
  /** The header's reset: says what it does, and the dots say it asks before doing it (it wants the word typed, and the PIN if set). */
  resetLabel: string;
  /** Statistics' coverage footnote on an install without the AI reading: the same limit, with no word about the AI. */
  statsLimitNoAi: string;
  /** The Record tab's note on who found the flags, on a free install, where only the built-in filter does. */
  recordLimitNoAi: string;
  /** Statistics' note on where flags came from, without the image and "read this for me" clause a free install cannot have. */
  statsByPlatformSubNoAi: (n: number) => string;
  /** The Issues tab's opening line on an install without the AI reading: no AI allowance, no AI service. */
  opsIntroNoAi: (product: string) => string;
  /** The Record tab ledger's word for an item seen but given no verdict (skipped or cancelled), the head's own word. */
  ledgerNotChecked: string;
  /** The Issues tab's healthy state: the three figures it rests on, over the scan log's 30 days. */
  opsFigLooked: string;
  opsFigActed: string;
  opsFigUnfinished: string;
  /** The Issues tab's all-clear figures and the last tick of its one-day strip, whose other ticks are clock times. */
  opsFigCleanHours: string;
  opsDayNow: string;
  opsFigCutShort: string;
  /** The usage panel's flagged count and legend on a free install, where nothing is rewritten. */
  usageFlaggedNoAi: string;
  /** The not-yet-backed-up reminder on the Export tab itself, where pointing at the Export tab would send the reader nowhere. */
  backupNeverHere: string;
  legendMarkNoAi: string;
}

const enN = (n: number): string => formatCount(n, 'en');
const roN = (n: number): string => formatCount(n, 'ro');
const esN = (n: number): string => formatCount(n, 'es');
const ptbrN = (n: number): string => formatCount(n, 'pt-BR');
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
/** Romanian puts "de" between a number and its noun from 20 up and after a round hundred ("20 de lucruri"). */
const roDe = (n: number): string => (n % 100 >= 20 || (n !== 0 && n % 100 === 0) ? 'de ' : '');

const EN: DashboardWords = {
  tabTimeline: 'Your timeline',
  dayOpener: (when, d) => (when === 'today' ? 'Today' : when === 'yesterday' ? 'Yesterday' : `On ${d}`),
  showed: (items, sites) => `your feed showed you ${enN(items)} ${plural(items, 'thing', 'things')} on ${enN(sites)} ${plural(sites, 'site', 'sites')}.`,
  keptAll: (p) => `${p} wrote down every one.`,
  hiddenClause: (n) => `${enN(n)} ${plural(n, 'was', 'were')} hidden`,
  flaggedClause: (n) => `${enN(n)} ${plural(n, 'was', 'were')} flagged for review`,
  notCheckedClause: (n) => `${enN(n)} ${plural(n, 'was', 'were')} not checked`,
  labelRecorded: 'written down',
  labelFlagged: 'flagged for review',
  labelHidden: 'hidden',
  weekCaption: 'The last seven days: each bar is what the feed showed that day; the dark top is the part that was hidden.',
  weekDayValue: (items, hidden) => (items === null ? 'nothing recorded' : `${enN(items)} in the feed, ${enN(hidden)} of them hidden`),
  breakdownShow: 'Show the breakdown',
  breakdownHide: 'Hide the breakdown',
  ovFromEyebrow: 'Where it came from',
  ovSessionsLine: (n) => `It came in ${enN(n)} ${plural(n, 'session', 'sessions')}.`,
  skipToList: 'Skip to the list',
  welcomeSteps: [
    'Open Facebook, Instagram, X, YouTube or TikTok in this browser.',
    'Scroll your feed for a minute, the way you usually do.',
    'Come back to this page: what the feed showed you is listed here, day by day.',
  ],
  resetLabel: 'Start a new record…',
  statsLimitNoAi: 'Coverage varies by record kind. The absence of a flag is not proof of absence.',
  recordLimitNoAi: 'Severity and techniques are what the built-in filter found at capture time. It can be wrong; the captured text itself is stored verbatim. You confirm or dispute flags in the feed.',
  statsByPlatformSubNoAi: (n) => `Where flags came from: ${enN(n)} flagged ${plural(n, 'entry', 'entries')}, all months.`,
  opsIntroNoAi: (p) => `When ${p} could not finish checking something, it is listed here with what was missed and why, for example a batch of comments that was cut short. An empty list means everything ran.`,
  ledgerNotChecked: 'not checked',
  opsFigLooked: 'posts looked at, last 30 days',
  opsFigActed: 'stepped in on',
  opsFigUnfinished: 'left the screen before the check finished',
  opsFigCleanHours: 'hours on a feed with nothing missed',
  opsDayNow: 'now',
  opsFigCutShort: 'comment batches cut short',
  usageFlaggedNoAi: 'flagged (marked)',
  backupNeverHere: `${PRODUCT_NAME} makes a copy once a day, and the first one has not run yet.`,
  legendMarkNoAi: 'Mark',
};

const RO: DashboardWords = {
  tabTimeline: 'Cronologia ta',
  // Romanian opens on the date itself, "Joi, 8 octombrie,": a "Pe" before a weekday reads as a translation.
  dayOpener: (when, d) => (when === 'today' ? 'Azi' : when === 'yesterday' ? 'Ieri' : `${d.charAt(0).toUpperCase()}${d.slice(1)},`),
  showed: (items, sites) => `feedul ți-a arătat ${items === 1 ? 'un lucru' : `${roN(items)} ${roDe(items)}lucruri`} pe ${sites === 1 ? 'un site' : `${roN(sites)} ${roDe(sites)}site-uri`}.`,
  keptAll: (p) => `${p} le-a notat pe toate.`,
  hiddenClause: (n) => (n === 1 ? 'Unul a fost ascuns' : `${roN(n)} ${roDe(n)}au fost ascunse`),
  flaggedClause: (n) => (n === 1 ? 'unul a fost semnalat pentru verificare' : `${roN(n)} ${roDe(n)}au fost semnalate pentru verificare`),
  notCheckedClause: (n) => (n === 1 ? 'unul nu a fost verificat' : `${roN(n)} ${roDe(n)}nu au fost verificate`),
  labelRecorded: 'notate',
  labelFlagged: 'semnalate pentru verificare',
  labelHidden: 'ascunse',
  weekCaption: 'Ultimele șapte zile: fiecare bară e ce a arătat feedul în ziua aceea; partea închisă de sus e ce a fost ascuns.',
  weekDayValue: (items, hidden) => (items === null ? 'nimic înregistrat' : `${roN(items)} în feed, dintre care ${roN(hidden)} ascunse`),
  breakdownShow: 'Arată detalierea',
  breakdownHide: 'Ascunde detalierea',
  ovFromEyebrow: 'De unde a venit',
  ovSessionsLine: (n) => `A venit în ${n === 1 ? 'o sesiune' : `${roN(n)} ${roDe(n)}sesiuni`}.`,
  skipToList: 'Sari la listă',
  welcomeSteps: [
    'Deschide Facebook, Instagram, X, YouTube sau TikTok în acest browser.',
    'Derulează feedul un minut, cum faci de obicei.',
    'Revino pe această pagină: ce ți-a arătat feedul apare aici, zi de zi.',
  ],
  resetLabel: 'Începe un registru nou…',
  statsLimitNoAi: 'Acoperirea variază după tipul înregistrării. Absența unei semnalări nu este dovada absenței.',
  recordLimitNoAi: 'Severitatea și tehnicile sunt ce a găsit filtrul încorporat la momentul captării. Poate greși; textul captat este stocat cuvânt cu cuvânt. Semnalările le confirmi sau le contești în flux.',
  statsByPlatformSubNoAi: (n) => `De unde au venit semnalările: ${n === 1 ? 'o intrare semnalată' : `${roN(n)} ${roDe(n)}intrări semnalate`}, toate lunile.`,
  opsIntroNoAi: (p) => `Când ${p} nu a putut termina o verificare, o găsești aici, cu ce a rămas neverificat și de ce, de exemplu un lot de comentarii întrerupt. O listă goală înseamnă că totul a mers.`,
  ledgerNotChecked: 'neverificat',
  opsFigLooked: 'postări verificate, ultimele 30 de zile',
  opsFigActed: 'în care a intervenit',
  opsFigUnfinished: 'au ieșit de pe ecran înainte de final',
  opsFigCleanHours: 'ore pe un feed fără nimic ratat',
  opsDayNow: 'acum',
  opsFigCutShort: 'loturi de comentarii întrerupte',
  usageFlaggedNoAi: 'semnalate (marcate)',
  backupNeverHere: `${PRODUCT_NAME} face o copie pe zi, iar prima nu a fost făcută încă.`,
  legendMarkNoAi: 'Marcare',
};

const ES: DashboardWords = {
  tabTimeline: 'Tu cronología',
  dayOpener: (when, d) => (when === 'today' ? 'Hoy' : when === 'yesterday' ? 'Ayer' : `El ${d}`),
  showed: (items, sites) => `tu feed te mostró ${esN(items)} ${plural(items, 'cosa', 'cosas')} en ${esN(sites)} ${plural(sites, 'sitio', 'sitios')}.`,
  keptAll: (p) => `${p} las anotó todas.`,
  hiddenClause: (n) => `${esN(n)} ${plural(n, 'se ocultó', 'se ocultaron')}`,
  flaggedClause: (n) => `${esN(n)} ${plural(n, 'se marcó para revisar', 'se marcaron para revisar')}`,
  notCheckedClause: (n) => `${esN(n)} ${plural(n, 'no se comprobó', 'no se comprobaron')}`,
  labelRecorded: 'anotadas',
  labelFlagged: 'marcadas para revisar',
  labelHidden: 'ocultas',
  weekCaption: 'Los últimos siete días: cada barra es lo que mostró el feed ese día; la parte oscura de arriba es lo que se ocultó.',
  weekDayValue: (items, hidden) => (items === null ? 'nada registrado' : `${esN(items)} en el feed, ${esN(hidden)} de ellas ocultas`),
  breakdownShow: 'Mostrar el desglose',
  breakdownHide: 'Ocultar el desglose',
  ovFromEyebrow: 'De dónde vino',
  ovSessionsLine: (n) => `Llegó en ${esN(n)} ${plural(n, 'sesión', 'sesiones')}.`,
  skipToList: 'Saltar a la lista',
  welcomeSteps: [
    'Abre Facebook, Instagram, X, YouTube o TikTok en este navegador.',
    'Desplázate por tu feed un minuto, como sueles hacerlo.',
    'Vuelve a esta página: lo que te mostró el feed aparece aquí, día a día.',
  ],
  resetLabel: 'Empezar un registro nuevo…',
  statsLimitNoAi: 'La cobertura varía según el tipo de registro. La ausencia de un aviso no es prueba de ausencia.',
  recordLimitNoAi: 'La gravedad y las técnicas son lo que encontró el filtro integrado en el momento de la captura. Puede equivocarse; el texto capturado en sí se guarda literal. Tú confirmas o discutes los avisos en el feed.',
  statsByPlatformSubNoAi: (n) => `De dónde vinieron los avisos: ${esN(n)} ${plural(n, 'entrada marcada', 'entradas marcadas')}, todos los meses.`,
  opsIntroNoAi: (p) => `Cuando ${p} no pudo terminar una revisión, aparece aquí con lo que quedó sin revisar y por qué, por ejemplo un lote de comentarios que se cortó. Una lista vacía significa que todo funcionó.`,
  ledgerNotChecked: 'sin revisar',
  opsFigLooked: 'publicaciones revisadas, últimos 30 días',
  opsFigActed: 'en las que intervino',
  opsFigUnfinished: 'salieron de la pantalla antes de terminar',
  opsFigCleanHours: 'horas en un feed sin nada perdido',
  opsDayNow: 'ahora',
  opsFigCutShort: 'lotes de comentarios cortados',
  usageFlaggedNoAi: 'marcadas (señaladas)',
  backupNeverHere: `${PRODUCT_NAME} hace una copia una vez al día y la primera todavía no se ha hecho.`,
  legendMarkNoAi: 'Marca',
};

const PT_BR: DashboardWords = {
  tabTimeline: 'Sua linha do tempo',
  dayOpener: (when, d) => (when === 'today' ? 'Hoje' : when === 'yesterday' ? 'Ontem' : `Em ${d}`),
  showed: (items, sites) => `seu feed mostrou ${ptbrN(items)} ${plural(items, 'coisa', 'coisas')} em ${ptbrN(sites)} ${plural(sites, 'site', 'sites')}.`,
  keptAll: (p) => `${p} anotou todas.`,
  hiddenClause: (n) => `${ptbrN(n)} ${plural(n, 'foi ocultada', 'foram ocultadas')}`,
  flaggedClause: (n) => `${ptbrN(n)} ${plural(n, 'foi marcada para revisão', 'foram marcadas para revisão')}`,
  notCheckedClause: (n) => `${ptbrN(n)} ${plural(n, 'não foi verificada', 'não foram verificadas')}`,
  labelRecorded: 'anotadas',
  labelFlagged: 'marcadas para revisão',
  labelHidden: 'ocultas',
  weekCaption: 'Os últimos sete dias: cada barra é o que o feed mostrou naquele dia; a parte escura de cima é o que foi ocultado.',
  weekDayValue: (items, hidden) => (items === null ? 'nada registrado' : `${ptbrN(items)} no feed, ${ptbrN(hidden)} delas ocultadas`),
  breakdownShow: 'Mostrar o detalhamento',
  breakdownHide: 'Ocultar o detalhamento',
  ovFromEyebrow: 'De onde veio',
  ovSessionsLine: (n) => `Chegou em ${ptbrN(n)} ${plural(n, 'sessão', 'sessões')}.`,
  skipToList: 'Pular para a lista',
  welcomeSteps: [
    'Abra o Facebook, Instagram, X, YouTube ou TikTok neste navegador.',
    'Role o seu feed por um minuto, como você costuma fazer.',
    'Volte a esta página: o que o feed mostrou aparece aqui, dia a dia.',
  ],
  resetLabel: 'Começar um registro novo…',
  statsLimitNoAi: 'A cobertura varia conforme o tipo de registro. A ausência de um aviso não é prova de ausência.',
  recordLimitNoAi: 'A gravidade e as técnicas são o que o filtro embutido encontrou na hora da captura. Ele pode errar; o texto capturado em si é guardado literal. Você confirma ou contesta os avisos no feed.',
  statsByPlatformSubNoAi: (n) => `De onde vieram os avisos: ${ptbrN(n)} ${plural(n, 'entrada marcada', 'entradas marcadas')}, todos os meses.`,
  opsIntroNoAi: (p) => `Quando o ${p} não conseguiu terminar uma conferência, ela aparece aqui, com o que ficou sem conferir e por quê, por exemplo um lote de comentários que foi cortado. Uma lista vazia quer dizer que tudo funcionou.`,
  ledgerNotChecked: 'não conferido',
  opsFigLooked: 'posts conferidos, últimos 30 dias',
  opsFigActed: 'em que interveio',
  opsFigUnfinished: 'saíram da tela antes do fim',
  opsFigCleanHours: 'horas num feed sem nada perdido',
  opsDayNow: 'agora',
  opsFigCutShort: 'lotes de comentários interrompidos',
  usageFlaggedNoAi: 'sinalizadas (marcadas)',
  backupNeverHere: `O ${PRODUCT_NAME} faz uma cópia por dia, e a primeira ainda não foi feita.`,
  legendMarkNoAi: 'Marca',
};

const BY_LANG: Record<ResolvedUiLanguage, DashboardWords> = { en: EN, ro: RO, es: ES, 'pt-BR': PT_BR };

export function dashboardWords(lang: ResolvedUiLanguage): DashboardWords {
  return BY_LANG[lang] ?? EN;
}
