// Exclusivity pressure, fear of missing out, and secret knowledge.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /\byou'?re missing out\b/i,
    /\b(exclusive|members only|invite only|limited access)\b/i,
    /\bdon'?t (miss|let this pass|regret)\b/i,
    /\bmiss out (forever|on this)\b/i,
    /\bonly available (for|until|today)\b/i,
    /\bsecret (method|trick|hack|way|formula)\b/i,
    /\b(they|the elite|the rich) don'?t want you to (have|use|know about) this\b/i,
    // Romanian
    /\bnu rata\b/i,
    /\b(acces exclusiv|edi[tț]ie limitat[aă]|locuri limitate)\b/i,
    // Spanish
    /\bte\s+(?:lo\s+)?est[aá]s\s+perdiendo\b/i,
    /\b(?:acceso\s+)?exclusivo\s+para\s+(?:miembros|suscriptores|invitados)\b/i,
    // The exclusivity frame is required. A bare "invitación" is a birthday invitation and
    // "edición limitada" a product description (English has no such entry either); both fired on
    // the benign corpus.
    /\b(?:solo|s[oó]lo|[uú]nicamente)\s+(?:con|por)\s+invitaci[oó]n\b/i,
    /\bno\s+te\s+lo\s+pierdas\b/i,
    /\b(plazas\s+limitadas|cupos\s+limitados|acceso\s+limitado)\b/i,
    /\b(?:m[eé]todo|truco|secreto|f[oó]rmula)\s+secret[oa]\b/i,
    /\b(?:ellos|los\s+ricos|las\s+[eé]lites)\s+no\s+quieren\s+que\s+(?:lo\s+)?(?:sepas|uses|tengas)\b/i,
    // Portuguese. "esta perdendo" needs its object: alone it means "you are wasting your time".
    /\bvoc[eê]\s+est[aá]\s+perdendo\s+(?:essa|esta|uma)\s+(?:chance|oportunidade)\b/i,
    /\b(?:acesso\s+)?exclusivo\s+para\s+(?:membros|assinantes|convidados)\b/i,
    /\b(?:somente|apenas|s[oó])\s+(?:com|por)\s+convite\b/i,
    /\bn[aã]o\s+perca\s+(?:essa|esta|isso)\b/i,
    /\b(vagas\s+limitadas|acesso\s+limitado)\b/i,
    /\b(?:m[eé]todo|truque|segredo|f[oó]rmula)\s+secret[oa]\b/i,
    /\b(?:eles|os\s+ricos|as\s+elites)\s+n[aã]o\s+querem\s+que\s+voc[eê]\s+(?:saiba|use|tenha)\b/i,
  ],
  moderate: [
    // Romanian
    /\b(o s[aă] regre[tț]i|nu l[aă]sa s[aă] treac[aă]|ultimele locuri)\b/i,
  ],
  exceptions: [
    /\b(event|concert|show|game) (tickets|registration)\b/i,
  ],
};

export const fomoClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'fomo', PATTERNS);
  },
};
