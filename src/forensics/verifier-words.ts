// The standalone checker's own sentences, per language.
//
// WHY THIS FILE EXISTS. M363: `feelingwise.org/check-ro.html` is headed
// "Verifică un export" and printed its whole verdict in English, because
// `describe()` and `render()` in the standalone checker took no language at
// all. The checker EMBEDDED in an export is built per locale
// (`verifierScript(i18n)` in html-export-scripts.ts), so a Romanian export's
// own script speaks Romanian. The lead sentence on the check page exists to
// talk a reader out of trusting that script and into trusting ours, so
// following our advice cost them their language.
//
// WHY NOT REUSE THE EXPORT'S TABLE, which an earlier note claimed would make
// this cheap. It would not: the export says "Signature and integrity check:
// VERIFIED" and this checker says "VERIFIED: 1500 record(s), every hash
// recomputed and every signature checked under the 1 key(s) this file carries;
// the signed manifest matches." Different sentences for a different surface.
// Reusing them would change what the published checker says in English, which
// is a separate decision from translating it.
//
// WHY DATA WITH PLACEHOLDERS RATHER THAN FUNCTIONS. The checker is GENERATED:
// `scripts/build-standalone-verifier.ts` assembles it out of template literals.
// Functions written inside a template literal that is itself building code mean
// every `${` has to be escaped, and a missed escape is a silent change to a
// published tool. A plain table serialises with `JSON.stringify` the way
// `verifierScript` already serialises its own strings, and `{name}` is the
// placeholder convention `src/i18n/export-strings.ts` already uses.
//
// THE ENGLISH IS BYTE-IDENTICAL to what the checker printed before this file
// existed. That is deliberate: translating it and rewording it are two changes,
// and only one of them is being made. If an English sentence here reads oddly,
// it read that way in the shipped tool yesterday.

export type VerifierLocale = 'en' | 'ro';

/**
 * Locales this table carries. Anything else falls back to English, out loud:
 * `wordsFor()` says which locale it actually used, and the checker prints the
 * English text rather than a half-translated report.
 *
 * NOT YET DONE: Spanish and Brazilian Portuguese. The extension exports in both
 * and about half this product's users read one of them, so this is a real gap
 * and not a decision that they do not matter. It is left because there is no
 * Spanish or Portuguese check page on the site for the text to appear on, and
 * because 58 sentences of forensic prose translated without a reader who speaks
 * the language is a worse failure than English: a wrong verdict sentence in a
 * tool people use to settle whether a file was altered. Adding a locale here is
 * the whole job once someone can check the wording.
 */
export const VERIFIER_LOCALES: readonly VerifierLocale[] = ['en', 'ro'];

export interface VerifierWords {
  // describeHolding
  holdingMade: string;
  holdingBy: string;
  holdingKey: string;
  holdingStamps: string;
  holdingStampsAndKey: string;
  holdingNoStamps: string;
  holdingUnchecked: string;
  holdingReport: string;
  holdingWhole: string;
  holdingWholeUnreadable: string;
  holdingWholeClaimed: string;
  holdingEnvelope: string;
  // describe
  verifiedReport: string;
  verified: string;
  partial: string;
  partialAndNoSignature: string;
  partialPriorKey: string;
  partialUnsigned: string;
  partialUncheckable: string;
  partialRejected: string;
  partialCarriedKey: string;
  brokenAtRecord: string;
  brokenBefore: string;
  brokenDetail: string;
  broken: string;
  failedInAll: string;
  unknownFields: string;
  checkerOlder: string;
  // the notes: the footnotes under the verdict. They are part of the reading,
  // so leaving them in English would give a Romanian reader a Romanian verdict
  // with English footnotes, which is the half-translated result this change
  // exists to avoid.
  noteNoManifest: string;
  /** No manifest, though every record is dated on or after the day builds began signing one; {first} the oldest day. */
  noteNoManifestDated: string;
  /** No manifest, and the records' own dates (which the file itself carries) do not show it was made after 2026-09-06. */
  noteNoManifestEither: string;
  noteBareEnvelope: string;
  noteCoveredRows: string;
  /** The same note as a person reads it: the count, without the field names the report's notes carry for tools. */
  noteCoveredRowsRead: string;
  noteSetAside: string;
  noteSeams: string;
  noteUnattributed: string;
  noteOutsideSelection: string;
  noteOutsideUnreadable: string;
  noteOutside: string;
  noteRedactedHead: string;
  noteRedactedAllChecked: string;
  noteRedactedNoneChecked: string;
  noteRedactedSomeChecked: string;
  whyUnsignedOne: string;
  whyUnsignedMany: string;
  whyPriorKeyOne: string;
  whyPriorKeyMany: string;
  whyNoKey: string;
  noteNoTimeStamp: string;
  noteStampedNotInFile: string;
  noteStampBeyond: string;
  /** One line per run, the count page one prints; {a} {b} the positions, {n} of {m}, {t} the newest stamp. */
  stampRun: string;
  stampRunNewest: string;
  // describeTimestamps
  stamps: string;
  stampsAuthorities: string;
  stampUnknown: string;
  stampUnnamed: string;
  stampFailed: string;
  stampFailedUnknown: string;
  keyExisted: string;
  keyNotDated: string;
  // render
  labelHolding: string;
  labelVerdict: string;
  labelRaw: string;
  // the sentence every reading ends on
  limit: string;
}

const EN: VerifierWords = {
  holdingMade: ', made {when}',
  holdingBy: ' by {version}',
  holdingKey: ', key {fingerprint}',
  holdingStamps: ', {n} time stamp(s) from outside services',
  holdingStampsAndKey: ' and a stamp over the key',
  holdingNoStamps: ', no time stamp from an outside service',
  holdingUnchecked: " — the file's own claim, not checked here: with no signed manifest, records removed from the end or put out of order would not show",
  holdingReport: 'You are holding a report: {included} of the {total} records the install had, {leftOut} left out by its own gate',
  holdingWhole: 'You are holding the whole record: {n} record(s), everything the install still had',
  holdingWholeUnreadable: 'You are holding the whole record: {n} record(s), all the install still had apart from {u} archived record(s) it could not read',
  holdingWholeClaimed: 'The file says it is the whole record: {n} record(s)',
  holdingEnvelope: 'You are holding a bare envelope of {n} record(s)',

  verifiedReport: 'VERIFIED as a report of {included} of {total} records: every hash recomputed and every signature checked under the {keys} key(s) this file carries; the signed manifest matches.',
  verified: 'VERIFIED: {n} record(s), every hash recomputed and every signature checked under the {keys} key(s) this file carries; the signed manifest matches.',
  partial: 'PARTIALLY VERIFIED: {n} record(s), no hash failed{andNoSignature}.',
  partialAndNoSignature: ' and no signature failed',
  partialPriorKey: '{n} record(s) verify by hash only: their signing key is not in this file.',
  partialUnsigned: '{n} record(s) carry no signature.',
  partialUncheckable: '{n} record(s) could not have their signature checked.',
  partialRejected: '{n} record(s) were checked and their signature did not verify; they name no key, so this may be a key that has since rotated rather than an edit, and it is not proof of either.',
  partialCarriedKey: '{n} record(s) verify under a key that travelled in this file; the file cannot say whose key it is.',
  brokenAtRecord: 'FAILED at record {position} ({id}): {reason}.',
  brokenBefore: 'FAILED before any record was checked: {reason}{detail}.',
  brokenDetail: ' ({detail})',
  broken: 'FAILED.',
  failedInAll: '{n} record(s) failed in all.',
  unknownFields: '{n} of them also carry fields this checker does not know ({names}).',
  checkerOlder: 'A checker older than the file fails exactly this way. Check the version of this checker before reading the result as an edit.',

  noteNoManifest: 'no signed manifest: the file was made by a build before 2026-09-06, or the install could not sign it',
  noteNoManifestEither: 'no signed manifest: either the file was made by a build before 2026-09-06, or the manifest was taken out of this file, or the install could not sign it. The dates on the records cannot tell which, because they are in the file too. Without it, records removed from the file or put out of order cannot be detected',
  noteNoManifestDated: 'no signed manifest, though every record here is dated from {first}, after builds began signing one on 2026-09-06: it was taken out of this file, or the install could not sign it. Without it, records removed from the file or put out of order cannot be detected',
  noteBareEnvelope: 'this is a bare JSON envelope: everything in the manifest was checked except the digest over the page rows, which are not present in this form. Ask for the HTML export to check those too.',
  noteCoveredRows: 'the signature covers {n} statements this page makes about the file and its records: {rows}. Anything else on the page is outside it.',
  noteCoveredRowsRead: 'the signature covers {n} statements this page makes about the file and its records. Anything else on the page is outside it.',
  noteSetAside: '{n} record(s) continue from position {position} on a line the record did not keep; a restore from a backup does this, and so does replacing records and signing the replacements with the same key, and this file cannot say which',
  noteSeams: '{n} chain seam(s): the install signed records at positions it had already used, or restarted',
  noteUnattributed: '{n} seam(s) could not be attributed by signature',
  noteOutsideSelection: '{n} record(s) link to records this report left out on purpose; it holds {included} of the {total} the install had, chosen by its own gate, and says so under its signature. Ask for the whole record if you need everything.',
  noteOutsideUnreadable: '{n} record(s) name a predecessor that is not in this file; the install that made it says under its signature that it could not read {u} of its archived record(s), so they are not in it, and that accounts for the missing predecessors',
  noteOutside: '{n} record(s) name a predecessor that is not in this file',
  noteRedactedHead: '{n} record(s) had fields withheld before this file was made: their content is not here, so their hash was not recomputed. Each one is named by a signed redaction marker in this file',
  noteRedactedAllChecked: ' and its signature over that hash was checked.',
  noteRedactedNoneChecked: ', and none of their signatures were checked: {why}, so the marker is all there is.',
  noteRedactedSomeChecked: '. {checked} of them had their signature over that hash checked; of the rest, {why}, so for those the marker is all there is.',
  whyUnsignedOne: '{n} carries no signature at all',
  whyUnsignedMany: '{n} carry no signature at all',
  whyPriorKeyOne: '{n} names a signing key this file does not carry',
  whyPriorKeyMany: '{n} name a signing key this file does not carry',
  whyNoKey: '{n} could not be checked, because this file has no key of its own to check them under',
  noteNoTimeStamp: 'no time stamp from an outside service in this file: none over the records and none over the signing key; nothing here shows when these records existed beyond what the install wrote',
  noteStampedNotInFile: '{n} record(s) stamped by an outside time-stamp service are not in this file',
  noteStampBeyond: 'a time stamp from an outside service names position {position}, past the last record here',
  stampRun: 'Positions {a} to {b}: {n} of {m} records fall under a time stamp that passed this check.',
  stampRunNewest: 'Positions {a} to {b}: {n} of {m} records fall under a time stamp that passed this check, the newest signed at {t}.',

  stamps: 'Time-stamp tokens over the chain: {opened} opened; {known} verified under a recognised authority{authorities}; {unknown} under an authority this checker does not recognise; {failed} failed.',
  stampsAuthorities: ' ({list})',
  stampUnknown: 'position {position}: signed by {signer}, root {root}; anyone can run a timestamping service, so this token dates nothing on its own.',
  stampUnnamed: 'an unnamed certificate',
  stampFailed: 'position {position}: failed {why}.',
  stampFailedUnknown: 'unknown',
  keyExisted: 'The signing key existed no later than {when} ({authorities}), by a token over the key as it is in this file.',
  keyNotDated: 'The stamp over the signing key did not verify under a recognised authority; the key is not dated by this file.',

  labelHolding: 'What you are holding',
  labelVerdict: 'What its own cryptography says',
  labelRaw: 'The full report as data',

  limit: 'This checks the file against itself. It does not establish who made the file, whether the key is the original key, or that the file is complete.',
};

/**
 * Romanian.
 *
 * The register follows `src/i18n/export-strings.ts`, which is what a Romanian
 * reader of an export has already seen: "VERIFICAT", "VERIFICAT PARȚIAL",
 * "EȘUAT" for the three states (one set in both checkers since 9 Oct 2026: the export said
 * "EȘUATĂ" and this table "EȘUAT", two names for one verdict), "înregistrare" for a record, "hash" left as
 * the borrowed word it is in the rest of that table, "amprentă" avoided in
 * favour of "cheie" where the English says key.
 *
 * VERIFICAT / VERIFICAT PARȚIAL / EȘUAT are kept in capitals exactly as the
 * English is, because the capitalised word is what a reader scans for and the
 * export's own table already capitalises these three.
 *
 * No em dash anywhere, unlike the English `holdingUnchecked`, which keeps one
 * only because its English is held byte-identical in this pass.
 */
const RO: VerifierWords = {
  holdingMade: ', făcut {when}',
  holdingBy: ' de {version}',
  holdingKey: ', cheie {fingerprint}',
  holdingStamps: ', {n|marcaj|marcaje|de marcaje} de timp de la servicii externe',
  holdingStampsAndKey: ' și un marcaj peste cheie',
  holdingNoStamps: ', niciun marcaj de timp de la un serviciu extern',
  holdingUnchecked: ', ceea ce este afirmația fișierului, neverificată aici: fără un manifest semnat, înregistrările scoase de la sfârșit sau puse în altă ordine nu s-ar vedea',
  holdingReport: 'Ai în mână un raport: {included} din {total|% înregistrare|cele % înregistrări|cele % de înregistrări} pe care le avea instalarea, {leftOut|lăsată|lăsate} deoparte de propriul ei filtru',
  holdingWhole: 'Ai în mână înregistrarea întreagă: {n|înregistrare|înregistrări|de înregistrări}, tot ce mai avea instalarea',
  holdingWholeUnreadable: 'Ai în mână înregistrarea întreagă: {n|înregistrare|înregistrări|de înregistrări}, tot ce mai avea instalarea în afară de {u|înregistrare arhivată|înregistrări arhivate|de înregistrări arhivate} pe care nu le-a putut citi',
  holdingWholeClaimed: 'Fișierul spune că este înregistrarea întreagă: {n|înregistrare|înregistrări|de înregistrări}',
  holdingEnvelope: 'Ai în mână un plic simplu cu {n|înregistrare|înregistrări|de înregistrări}',

  verifiedReport: 'VERIFICAT ca raport al {included} din {total|înregistrare|înregistrări|de înregistrări}: fiecare hash a fost recalculat și fiecare semnătură verificată cu {keys|cheia pe care o poartă|cele % chei pe care le poartă|cele % de chei pe care le poartă} acest fișier; manifestul semnat corespunde.',
  verified: 'VERIFICAT: {n|înregistrare|înregistrări|de înregistrări}, fiecare hash a fost recalculat și fiecare semnătură verificată cu {keys|cheia pe care o poartă|cele % chei pe care le poartă|cele % de chei pe care le poartă} acest fișier; manifestul semnat corespunde.',
  partial: 'VERIFICAT PARȚIAL: {n|înregistrare|înregistrări|de înregistrări}, niciun hash nu a eșuat{andNoSignature}.',
  partialAndNoSignature: ' și nicio semnătură nu a eșuat',
  partialPriorKey: '{n|înregistrare|înregistrări|de înregistrări} se verifică doar prin hash: cheia lor de semnare nu se află în acest fișier.',
  partialUnsigned: '{n|înregistrare|înregistrări|de înregistrări} nu poartă semnătură.',
  partialUncheckable: '{n|înregistrare nu a|înregistrări nu au|de înregistrări nu au} putut avea semnătura verificată.',
  partialRejected: '{n|înregistrare a fost verificată|înregistrări au fost verificate|de înregistrări au fost verificate}, iar semnătura nu a trecut; nu este numită nicio cheie, deci poate fi o cheie rotită între timp, nu o modificare, și nu este dovada niciuneia.',
  partialCarriedKey: '{n|înregistrare|înregistrări|de înregistrări} se verifică sub o cheie care a călătorit în acest fișier; fișierul nu poate spune a cui este cheia.',
  brokenAtRecord: 'EȘUAT la înregistrarea {position} ({id}): {reason}.',
  brokenBefore: 'EȘUAT înainte să fie verificată vreo înregistrare: {reason}{detail}.',
  brokenDetail: ' ({detail})',
  broken: 'EȘUAT.',
  failedInAll: '{n|înregistrare a eșuat|înregistrări au eșuat|de înregistrări au eșuat} în total.',
  unknownFields: '{n} dintre ele poartă și câmpuri pe care acest verificator nu le cunoaște ({names}).',
  checkerOlder: 'Un verificator mai vechi decât fișierul eșuează exact în acest fel. Verifică versiunea acestui verificator înainte să citești rezultatul ca pe o modificare.',

  noteNoManifest: 'niciun manifest semnat: fișierul a fost făcut de o versiune dinainte de 2026-09-06, sau instalarea nu l-a putut semna',
  noteNoManifestEither: 'niciun manifest semnat: fie fișierul a fost făcut de o versiune dinainte de 2026-09-06, fie manifestul a fost scos din acest fișier, fie instalarea nu l-a putut semna. Datele înregistrărilor nu pot arăta care dintre ele, pentru că și ele sunt în fișier. Fără el, înregistrările scoase din fișier sau puse în altă ordine nu pot fi observate',
  noteNoManifestDated: 'niciun manifest semnat, deși fiecare înregistrare de aici este datată din {first}, după ce versiunile au început să semneze unul pe 2026-09-06: a fost scos din acest fișier, sau instalarea nu l-a putut semna. Fără el, înregistrările scoase din fișier sau puse în altă ordine nu pot fi observate',
  noteBareEnvelope: 'acesta este un plic JSON simplu: totul din manifest a fost verificat în afară de amprenta peste rândurile paginii, care nu sunt prezente în această formă. Cere exportul HTML ca să le verifici și pe acelea.',
  noteCoveredRows: 'semnătura acoperă {n|afirmație|afirmații|de afirmații} pe care această pagină le face despre fișier și despre înregistrările lui: {rows}. Orice altceva de pe pagină este în afara ei.',
  noteCoveredRowsRead: 'semnătura acoperă {n|afirmație|afirmații|de afirmații} pe care această pagină le face despre fișier și despre înregistrările lui. Orice altceva de pe pagină este în afara ei.',
  noteSetAside: '{n|înregistrare|înregistrări|de înregistrări} continuă de la poziția {position} pe o linie pe care registrul nu a păstrat-o; o restaurare dintr-o copie de rezervă face asta, la fel și înlocuirea unor înregistrări urmată de semnarea înlocuitorilor cu aceeași cheie, iar acest fișier nu poate spune care dintre ele',
  noteSeams: '{n|cusătură|cusături|de cusături} în lanț: instalarea a semnat înregistrări pe poziții pe care le folosise deja, sau a luat-o de la capăt',
  noteUnattributed: '{n|cusătură nu a putut fi atribuită|cusături nu au putut fi atribuite|de cusături nu au putut fi atribuite} prin semnătură',
  noteOutsideSelection: '{n|înregistrare|înregistrări|de înregistrări} se leagă de înregistrări pe care acest raport le-a lăsat deoparte intenționat; el conține {included} din cele {total} pe care le avea instalarea, alese de propriul lui filtru, și spune asta sub semnătura lui. Cere înregistrarea întreagă dacă ai nevoie de tot.',
  noteOutsideUnreadable: '{n|înregistrare numește|înregistrări numesc|de înregistrări numesc} o predecesoare care nu se află în acest fișier; instalarea care l-a făcut spune sub semnătura ei că nu a putut citi {u} dintre înregistrările ei arhivate, așa că ele nu sunt în el, iar asta explică predecesoarele care lipsesc',
  noteOutside: '{n|înregistrare numește|înregistrări numesc|de înregistrări numesc} o predecesoare care nu se află în acest fișier',
  noteRedactedHead: '{n|înregistrare a avut|înregistrări au avut|de înregistrări au avut} câmpuri reținute înainte ca acest fișier să fie făcut: conținutul lor nu este aici, deci hash-ul lor nu a fost recalculat. Fiecare este numită de o marcă de redactare semnată din acest fișier',
  noteRedactedAllChecked: ' iar semnătura ei peste acel hash a fost verificată.',
  noteRedactedNoneChecked: ', și niciuna dintre semnăturile lor nu a fost verificată: {why}, deci marca este tot ce există.',
  noteRedactedSomeChecked: '. {checked} dintre ele au avut semnătura peste acel hash verificată; dintre restul, {why}, deci pentru acelea marca este tot ce există.',
  whyUnsignedOne: '{n} nu poartă nicio semnătură',
  whyUnsignedMany: '{n} nu poartă nicio semnătură',
  whyPriorKeyOne: '{n} numește o cheie de semnare pe care acest fișier nu o poartă',
  whyPriorKeyMany: '{n} numesc o cheie de semnare pe care acest fișier nu o poartă',
  whyNoKey: '{n} nu au putut fi verificate, pentru că acest fișier nu are o cheie proprie cu care să le verifice',
  noteNoTimeStamp: 'niciun marcaj de timp de la un serviciu extern în acest fișier: niciunul peste înregistrări și niciunul peste cheia de semnare; nimic de aici nu arată când au existat aceste înregistrări dincolo de ce a scris instalarea',
  noteStampedNotInFile: '{n|înregistrare marcată|înregistrări marcate|de înregistrări marcate} în timp de un serviciu extern nu se află în acest fișier',
  noteStampBeyond: 'un marcaj de timp de la un serviciu extern numește poziția {position}, dincolo de ultima înregistrare de aici',
  stampRun: 'Pozițiile {a} până la {b}: {n} din {m|înregistrare|înregistrări|de înregistrări} sunt sub un marcaj de timp care a trecut această verificare.',
  stampRunNewest: 'Pozițiile {a} până la {b}: {n} din {m|înregistrare|înregistrări|de înregistrări} sunt sub un marcaj de timp care a trecut această verificare, cel mai nou semnat la {t}.',

  stamps: 'Marcaje de timp peste lanț: {opened} deschise; {known} verificate sub o autoritate recunoscută{authorities}; {unknown} sub o autoritate pe care acest verificator nu o recunoaște; {failed} eșuate.',
  stampsAuthorities: ' ({list})',
  stampUnknown: 'poziția {position}: marcaj semnat de {signer}, rădăcină {root}; oricine poate rula un serviciu de marcare a timpului, deci acest marcaj nu datează nimic de unul singur.',
  stampUnnamed: 'un certificat fără nume',
  stampFailed: 'poziția {position}: a eșuat {why}.',
  stampFailedUnknown: 'necunoscut',
  keyExisted: 'Cheia de semnare exista cel târziu la {when} ({authorities}), pe baza unui marcaj peste cheie așa cum se află ea în acest fișier.',
  keyNotDated: 'Marcajul peste cheia de semnare nu s-a verificat sub o autoritate recunoscută; cheia nu este datată de acest fișier.',

  labelHolding: 'Ce ai în mână',
  labelVerdict: 'Ce spune propria ei criptografie',
  labelRaw: 'Raportul complet, ca date',

  limit: 'Aceasta verifică fișierul față de el însuși. Nu stabilește cine a făcut fișierul, dacă cheia este cheia originală, sau că fișierul este complet.',
};

export const VERIFIER_WORDS: Record<VerifierLocale, VerifierWords> = { en: EN, ro: RO };
