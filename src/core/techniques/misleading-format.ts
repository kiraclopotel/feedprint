// Formatting that shouts instead of arguing: capitals, emoji, exclamation marks, headline case.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';

const ACRONYMS = new Set([
  'USA', 'FBI', 'CIA', 'NASA', 'NFL', 'NBA', 'MLB', 'NHL', 'UFC',
  'CEO', 'CFO', 'CTO', 'COO', 'VP', 'HR', 'PR', 'IT', 'AI', 'ML',
  'UN', 'EU', 'UK', 'US', 'GDP', 'GPA', 'GPS', 'HIV', 'AIDS',
  'DNA', 'RNA', 'PDF', 'URL', 'API', 'CSS', 'HTML', 'SQL', 'PHP',
  'AM', 'PM', 'TV', 'PC', 'OK', 'ID', 'IQ', 'DIY', 'FAQ', 'FYI',
  'ASAP', 'RSVP', 'ATM', 'PIN', 'SIM', 'USB', 'WIFI', 'LOL',
  'OMG', 'BTW', 'IMO', 'IMHO', 'TBH', 'SMH', 'DM', 'RT',
  // Spanish and Portuguese. Without them one ordinary abbreviation ("Todos os estudantes são dos
  // EUA") pushed a short sentence over the caps ratio: 0.09% of both benign corpora. 'DJ' and
  // 'CV' serve English too.
  'EUA', 'EEUU', 'EE', 'ONU', 'UE', 'OMS', 'OTAN', 'UNESCO', 'UNICEF',
  'PIB', 'IVA', 'IRPF', 'DNI', 'NIF', 'CIF', 'RRHH', 'SL', 'SA',
  'CPF', 'CNPJ', 'CEP', 'RG', 'SUS', 'IBGE', 'INSS', 'STF', 'PF',
  'ADN', 'VIH', 'SIDA', 'TDAH', 'CI', 'DJ', 'CV', 'PDF', 'PS', 'PSD',
]);

const EMOJI_PATTERN = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;

export const misleadingFormatClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const { text } = input;
    const evidence: string[] = [];
    let score = 0;

    const words = text.split(/\s+/).filter(w => w.length > 0);
    const totalWords = words.length;

    if (totalWords === 0) {
      return {
        technique: 'misleading-format',
        present: false,
        confidence: 0.4,
        severity: 0,
        evidence: [],
      };
    }

    const capsPrefix = /^(MUST[- ]?(WATCH|SEE|READ|SHARE|KNOW)|BREAKING|URGENT|ALERT|EXPOSED|LEAKED|BOMBSHELL|SHOCK(ING)?)\s*[:\-!]/;
    if (capsPrefix.test(text.trim())) {
      score += 3;
      evidence.push(`manipulative ALL-CAPS prefix: "${text.trim().match(capsPrefix)?.[0]}"`);
    }

    const capsWords = words.filter(w => {
      const cleaned = w.replace(/[^A-Za-z]/g, '');
      return cleaned.length >= 2
        && cleaned === cleaned.toUpperCase()
        && !ACRONYMS.has(cleaned)
        // Roman numerals are not shouting ("siglo XVIII", "Henry VIII"). Spanish and Portuguese
        // write centuries this way all the time: 0.06% of the benign corpus on their own.
        && !/^[IVXLCDM]+$/.test(cleaned);
    });
    const capsCount = capsWords.length;
    const capsRatio = capsCount / totalWords;

    // One abbreviation is not shouting: alone it cleared the ratio in a short sentence ("Esse e o
    // meu CD, nao e?"), most often in the two languages that abbreviate most.
    if (capsRatio > 0.12 && capsCount >= 2) {
      score += 3;
      evidence.push(`caps ratio ${capsRatio.toFixed(2)} (${capsCount}/${totalWords} words)`);
    } else if (capsCount > 0) {
      score += capsCount * 0.5;
      evidence.push(`${capsCount} ALL-CAPS word(s)`);
    }

    const emojis = text.match(EMOJI_PATTERN);
    const emojiCount = emojis ? emojis.length : 0;
    const emojiDensity = emojiCount / totalWords;

    if (emojiDensity > 0.15) {
      score += 2;
      evidence.push(`emoji density ${emojiDensity.toFixed(2)} (${emojiCount} emojis)`);
    }

    // Five Title Case words in a row read as a clickbait headline.
    let maxConsecutiveTitleCase = 0;
    let currentStreak = 0;
    for (const w of words) {
      const cleaned = w.replace(/[^A-Za-z]/g, '');
      if (cleaned.length >= 2 && /^[A-Z][a-z]/.test(cleaned)) {
        currentStreak++;
        if (currentStreak > maxConsecutiveTitleCase) {
          maxConsecutiveTitleCase = currentStreak;
        }
      } else {
        currentStreak = 0;
      }
    }
    if (maxConsecutiveTitleCase >= 5) {
      score += 2;
      evidence.push(`${maxConsecutiveTitleCase} consecutive Title Case words`);
    }

    const exclCount = (text.match(/!/g) || []).length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCount = Math.max(sentences.length, 1);
    const exclDensity = exclCount / sentenceCount;

    if (exclDensity > 0.3) {
      score += 2;
      evidence.push(`exclamation density ${exclDensity.toFixed(2)} (${exclCount} in ${sentenceCount} sentences)`);
    }

    const severity = Math.min(Math.floor(score), 10);

    return {
      technique: 'misleading-format',
      present: severity >= 3,
      confidence: Math.min(0.4 + severity * 0.04, 0.70),
      severity,
      evidence,
    };
  },
};
