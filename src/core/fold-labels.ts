// The words a fold control carries on the platforms, and the one way to read them.
//
// Two readers need the list: the content script, which finds the control in the page
// (content/record/text-fold.ts), and the recorder, which takes the control's label off the
// end of a text it was stuck to (forensics/stuck-fold-label.ts). Neither may import the other's
// module, so the list lives here.

/**
 * Labels a fold control carries, lower-cased, with any ellipsis or dots and the
 * surrounding whitespace stripped. The platforms' interface languages the
 * recorder's users read (English, Spanish, Portuguese, Romanian) and the
 * larger ones. Exact match on the whole label: "View more comments" is not a
 * fold control, "See more" is.
 */
export const FOLD_LABELS: ReadonlySet<string> = new Set([
  // English
  'see more', 'show more', 'read more', 'more', 'see original', 'view more',
  // Romanian, both comma-below and cedilla spellings
  'vezi mai mult', 'afișează mai mult', 'afişează mai mult', 'afiseaza mai mult', 'mai mult', 'mai multe',
  'citește mai mult', 'citeşte mai mult', 'citeste mai mult',
  // Spanish
  'ver más', 'ver mas', 'mostrar más', 'mostrar mas', 'leer más', 'leer mas', 'más', 'mas',
  // Portuguese
  'ver mais', 'mostrar mais', 'ler mais', 'mais', 'veja mais',
  // French
  'voir plus', 'afficher plus', 'afficher la suite', 'lire la suite', 'en voir plus', 'plus',
  // German
  'mehr anzeigen', 'mehr ansehen', 'weiterlesen', 'mehr',
  // Italian
  'altro', 'mostra altro', 'leggi altro', 'visualizza altro', 'vedi altro',
  // Dutch
  'meer weergeven', 'lees meer', 'meer',
  // Polish
  'zobacz więcej', 'pokaż więcej', 'czytaj więcej', 'więcej',
  // Turkish
  'daha fazla göster', 'daha fazlasını gör', 'devamını oku', 'daha fazla',
  // Russian and Ukrainian
  'ещё', 'еще', 'показать ещё', 'показать еще', 'читать дальше', 'читать далее', 'подробнее',
  'ще', 'показати більше', 'читати далі',
  // Hindi
  'और देखें', 'और पढ़ें', 'और',
  // Indonesian
  'lihat selengkapnya', 'baca selengkapnya', 'selengkapnya',
  // Vietnamese
  'xem thêm', 'thêm',
  // Japanese, Korean, Chinese
  'もっと見る', '続きを読む', '더 보기', '더보기', '查看更多', '显示更多', '顯示更多', '展开', '展開', '更多',
  // Arabic and Thai
  'عرض المزيد', 'اقرأ المزيد', 'المزيد', 'ดูเพิ่มเติม', 'เพิ่มเติม',
]);

export function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** A control's label as the list carries it: lower-cased, ellipsis and dots off both ends. */
export function normalizeLabel(raw: string): string {
  return squash(raw)
    .toLowerCase()
    .replace(/^[\s.…]+/, '')
    .replace(/[\s.…]+$/, '')
    .trim();
}
