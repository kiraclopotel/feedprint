// FeelingWise — Romanian deterministic-floor unit tests
//
// Covers the Romanian vocabulary added to the three deterministic layers:
//   • profanity-filter — ROMANIAN_SLURS / ROMANIAN_PROFANITY + NFKD diacritic
//     fold (entries stored diacritic-free; ă/â→a, î→i, ș/ş→s, ț/ţ→t)
//   • harm-floor — AD_HOMINEM_PATTERNS_RO (category B)
//   • coded-harm-catcher — Romanian directed self-harm imperatives with the
//     first-person self-oath ('sa mor eu') and 'sa mori de ras' exclusions
//
// Each tier is tested WITH and WITHOUT diacritics, plus one leetspeak evasion
// case, plus the adversarial-benign traps that bound the forward-stem matcher.

import { describe, it, expect } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';
import { computeHarmFloor } from '../../../src/core/harm-floor';
import { detectCodedHarm } from '../../../src/core/coded-harm-catcher';

describe('Romanian slur tier (profanity-filter)', () => {
  const slurPositives: Array<[string, string]> = [
    ['esti un tigan imputit', 'tigan'],
    ['țigancă ordinară ce ești', 'tigan'],          // diacritics + inflection via stem
    ['poponarule, pleaca de aici', 'poponar'],
    ['bulangiilor, v-am vazut', 'bulangi'],
    ['esti handicapat la cap', 'handicapat'],
    ['handicapații astia nu inteleg nimic', 'handicapat'],
    ['jidanii controleaza tot', 'jidan'],
    ['bozgorii sa plece acasa', 'bozgor'],
    ['esti o muista ordinara', 'muist'],
  ];
  for (const [text, expected] of slurPositives) {
    it(`flags slur: "${text}"`, () => {
      const r = filterProfanity(text, 'teen', { tier: 'slurs' });
      expect(r.filtered, `expected ${expected}`).toBe(true);
      expect(r.matches).toContain(expected);
    });
  }

  it('catches leetspeak evasion: jid4n → jidan', () => {
    const r = filterProfanity('esti un jid4n nenorocit', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
    expect(r.matches).toContain('jidan');
  });

  const slurBenign = [
    'mergem la Tiganesti la bunici weekendul asta', // place name exception
    'am citit Țiganiada în liceu la română',        // literary epic, with diacritics
    'a handicapped parking spot near the entrance', // EN handicapped does not reach the handicapat stem
  ];
  for (const text of slurBenign) {
    it(`does not slur-flag benign: "${text}"`, () => {
      const r = filterProfanity(text, 'teen', { tier: 'slurs' });
      expect(r.filtered, `matched ${r.matches.join(',')}`).toBe(false);
    });
  }
});

describe('Romanian profanity tier (profanity-filter)', () => {
  const profanityPositives: Array<[string, string]> = [
    ['sugi pula', 'pula'],
    ['ia de-aici pulă', 'pula'],                    // diacritic form
    ['ce pizdă proasta', 'pizd'],
    ['muie la toti dusmanii', 'muie'],
    ['futu-ti mortii matii', 'futu'],               // hyphen splits; token = futu
    ['m-a futut la cap toata ziua', 'futut'],
    ['ce futai a fost asta', 'futai'],
    ['articolul asta e un cacat', 'cacat'],
    ['caca-m-as pe parerea ta', 'caca'],
    ['sa-mi bag picioarele, coaie', 'coaie'],
  ];
  for (const [text, expected] of profanityPositives) {
    it(`flags profanity: "${text}"`, () => {
      const r = filterProfanity(text, 'teen', { tier: 'profanity' });
      expect(r.filtered, `expected ${expected}`).toBe(true);
      expect(r.matches).toContain(expected);
    });
  }

  it('child mode asterisks the diacritic form', () => {
    const r = filterProfanity('sugi pulă', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
    expect(r.cleanText).toContain('****');
    expect(r.cleanText).not.toContain('pul');
  });

  const profanityBenign = [
    'muierea aia din sat era o femeie harnică',     // archaic "woman" exception
    'muierile din sat coceau paine vinerea',
    'designul futurist al cladirii este impresionant', // futur- loanword exceptions
    'the future of futures trading looks futuristic',
    'o cana de cacao calda inainte de culcare',     // cacao exception
    'Pulaski county road repairs continue',         // pulaski exception
    'copula este un verb de legatura in gramatica', // forward-only: input-prefix never matches
    'fractura de scapula se vindeca in sase saptamani',
    'fotbal sau futsal, tot sport e',               // fut is 3 chars → exact-only, no stem
  ];
  for (const text of profanityBenign) {
    it(`does not profanity-flag benign: "${text}"`, () => {
      const r = filterProfanity(text, 'teen', { tier: 'profanity' });
      expect(r.filtered, `matched ${r.matches.join(',')}`).toBe(false);
    });
  }

  it('ACCEPTED token-level collision: the Croatian city "Pula" flags (documented in ROMANIAN_PROFANITY)', () => {
    // A token matcher cannot distinguish the toponym from the vulgarity.
    // Accepted because the profanity tier is mode-aware (child asterisks,
    // teen flags only) and never reaches the slur-tier deterministic floor.
    // Pinned so a future change to this tradeoff is a conscious one.
    const r = filterProfanity('am vizitat Pula in Croatia vara trecuta', 'teen', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
  });
});

describe('Romanian ad-hominem (harm-floor category B)', () => {
  it('fires ad-hominem-density on stacked RO insults (no diacritics)', () => {
    const hf = computeHarmFloor('esti un prost si un tampit, nesimtitule');
    const sig = hf.signals.find((s) => s.id === 'ad-hominem-density');
    expect(sig).toBeDefined();
    expect(sig!.weight).toBeGreaterThanOrEqual(15); // 3 distinct tokens × 5, cap 15
  });

  it('fires ad-hominem-density on diacritic forms via the aggressive haystack', () => {
    const hf = computeHarmFloor('ești o proastă jegoasă și tâmpită');
    const sig = hf.signals.find((s) => s.id === 'ad-hominem-density');
    expect(sig).toBeDefined();
  });

  it('does NOT fire on "prostata" (medical) — prost is enumerated, not an open stem', () => {
    const hf = computeHarmFloor('controlul de prostata este recomandat anual');
    expect(hf.signals.find((s) => s.id === 'ad-hominem-density')).toBeUndefined();
  });

  it('does NOT fire on benign prost-prefixed forms outside the enumeration', () => {
    const hf = computeHarmFloor('un reportaj despre prostituatie si saracie in orasele mici');
    expect(hf.signals.find((s) => s.id === 'ad-hominem-density')).toBeUndefined();
  });
});

describe('Romanian directed self-harm (coded-harm-catcher)', () => {
  const selfHarmPositives = [
    'omoara-te si gata',
    'omoară-te odată',                              // diacritics
    'sinucide-te, nimeni nu te place',
    'spanzura-te de un copac',
    'taie-ti venele daca tot esti asa trista',
    'taie-ți venele',
    'du-te si mori undeva departe',
    'sper sa mori in chinuri',
  ];
  for (const text of selfHarmPositives) {
    it(`catches directed imperative: "${text}"`, () => {
      const hit = detectCodedHarm(text);
      expect(hit).not.toBeNull();
      expect(hit!.category).toBe('self-harm-encouragement');
    });
  }

  const selfHarmBenign = [
    'sa mor eu daca mint, chiar asa a zis',         // 1st-person self-oath idiom
    'să mor eu dacă nu e adevărat',
    'sa mori de ras la clipul asta, e genial',      // "die laughing" idiom
    'vreau sa ma omor, nu mai pot',                 // 1st-person distress, not encouragement
    'nu te omori cu firea pentru examen',           // idiom: do not stress yourself
    'e un frig al dracului afara azi',              // mild register, dracu not in any list
  ];
  for (const text of selfHarmBenign) {
    it(`does not flag benign/first-person: "${text}"`, () => {
      const hit = detectCodedHarm(text);
      expect(hit, hit ? `${hit.category}/${hit.pattern}` : '').toBeNull();
    });
  }
});
